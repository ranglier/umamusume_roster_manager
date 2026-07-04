"""Read-only query helpers over data/runtime/reference.sqlite.

sqlite_reference.py owns the write side (schema, build_reference_database).
This module owns the read side: open a connection, run a query, return plain
dicts. serve_reference.py keeps owning HTTP concerns (status codes, param
parsing, route dispatch) and calls into these helpers instead of reading
data/normalized/*.json directly.

Connection pattern: open a fresh connection per call, close it immediately
(see docs/PROJECT_STATUS.md's "Migration SQLite" section for why - serve_reference.py
runs a ThreadingTCPServer, and this workload is 100% read-only from the
server's perspective since all writes happen out-of-process during
update_reference.py). PRAGMA query_only makes an accidental write fail loudly
instead of silently racing the next build_reference_database() run.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .sqlite_reference import get_reference_database_path

ENTITY_TABLES: dict[str, str] = {
    "characters": "characters",
    "character_progression": "character_progression",
    "supports": "supports",
    "support_progression": "support_progression",
    "skills": "skills",
    "races": "races",
    "racetracks": "racetracks",
    "g1_factors": "g1_factors",
    "cm_targets": "cm_targets",
    "scenarios": "scenarios",
    "training_events": "training_events",
    "compatibility": "compatibility",
}


def _connect(database_path: Path | None = None) -> sqlite3.Connection:
    path = Path(database_path) if database_path else get_reference_database_path()
    if not path.exists():
        raise FileNotFoundError(str(path))
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def fetch_reference_item(entity_key: str, item_id: str, *, database_path: Path | None = None) -> dict | None:
    table = ENTITY_TABLES.get(entity_key)
    if table is None:
        return None
    id_column = "character_id" if table == "character_progression" else "id"
    connection = _connect(database_path)
    try:
        row = connection.execute(f"SELECT payload_json FROM {table} WHERE {id_column} = ?", (item_id,)).fetchone()  # noqa: S608
    finally:
        connection.close()
    return json.loads(row["payload_json"]) if row else None


def fetch_reference_items_by_id(entity_key: str, ids: list[str], *, database_path: Path | None = None) -> dict[str, dict]:
    table = ENTITY_TABLES.get(entity_key)
    if table is None:
        return {}
    # Always open the connection (and let a missing database raise
    # FileNotFoundError) even when ids is empty, matching the previous
    # JSON-path behavior of always reading the reference file regardless of
    # roster size - an empty roster must still 404 as "not imported yet"
    # rather than silently succeed with an empty result.
    connection = _connect(database_path)
    try:
        if not ids:
            return {}
        placeholders = ",".join("?" for _ in ids)
        rows = connection.execute(f"SELECT id, payload_json FROM {table} WHERE id IN ({placeholders})", ids).fetchall()  # noqa: S608
    finally:
        connection.close()
    return {row["id"]: json.loads(row["payload_json"]) for row in rows}


def fetch_all_reference_items(entity_key: str, *, database_path: Path | None = None) -> dict[str, dict]:
    table = ENTITY_TABLES.get(entity_key)
    if table is None:
        return {}
    connection = _connect(database_path)
    try:
        rows = connection.execute(f"SELECT id, payload_json FROM {table}").fetchall()  # noqa: S608
    finally:
        connection.close()
    return {row["id"]: json.loads(row["payload_json"]) for row in rows}


def fetch_compatibility_by_character_id(*, database_path: Path | None = None) -> dict[str, dict]:
    connection = _connect(database_path)
    try:
        rows = connection.execute("SELECT character_id, payload_json FROM compatibility").fetchall()
    finally:
        connection.close()
    return {str(row["character_id"]): json.loads(row["payload_json"]) for row in rows if row["character_id"] is not None}


def existing_ids(entity_key: str, ids: list[str], *, database_path: Path | None = None) -> set[str]:
    table = ENTITY_TABLES.get(entity_key)
    if table is None or not ids:
        return set()
    placeholders = ",".join("?" for _ in ids)
    connection = _connect(database_path)
    try:
        rows = connection.execute(f"SELECT id FROM {table} WHERE id IN ({placeholders})", ids).fetchall()  # noqa: S608
    finally:
        connection.close()
    return {row["id"] for row in rows}


def fetch_character_progression_lookup(*, database_path: Path | None = None) -> dict[str, dict]:
    connection = _connect(database_path)
    try:
        rows = connection.execute("SELECT character_id, payload_json FROM character_progression").fetchall()
    finally:
        connection.close()
    return {row["character_id"]: json.loads(row["payload_json"]) for row in rows}


def fetch_support_progression_lookup(*, database_path: Path | None = None) -> dict[int, dict]:
    connection = _connect(database_path)
    try:
        rows = connection.execute("SELECT rarity, payload_json FROM support_progression").fetchall()
    finally:
        connection.close()
    return {row["rarity"]: json.loads(row["payload_json"]) for row in rows if row["rarity"]}


def fetch_entity_listing(*, database_path: Path | None = None) -> list[dict]:
    connection = _connect(database_path)
    try:
        rows = connection.execute(
            "SELECT entity_key, item_count, imported_at, source_json FROM reference_source_entities ORDER BY entity_key"
        ).fetchall()
    finally:
        connection.close()
    return [
        {
            "entity": row["entity_key"],
            "count": row["item_count"],
            # The JSON path's per-entity "generated_at" field (normalize-time
            # timestamp) isn't stored as its own column here - imported_at
            # (the latest raw-dataset download time from within "source") is
            # the closest per-entity timestamp actually available in SQLite.
            "generated_at": row["imported_at"],
            "source": json.loads(row["source_json"]),
        }
        for row in rows
    ]


def fetch_support_rarity_by_id(*, database_path: Path | None = None) -> dict[str, int]:
    connection = _connect(database_path)
    try:
        rows = connection.execute("SELECT id, rarity FROM supports").fetchall()
    finally:
        connection.close()
    return {row["id"]: row["rarity"] for row in rows if row["rarity"]}


def fetch_browsable_entity(
    entity_key: str,
    *,
    filters: dict[str, list[str]] | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
    database_path: Path | None = None,
) -> dict[str, Any]:
    if entity_key not in ENTITY_TABLES:
        raise KeyError(entity_key)

    view = f"browse_{entity_key}"
    where_clauses: list[str] = []
    params: list[Any] = []

    for filter_key, values in (filters or {}).items():
        if not values:
            continue
        placeholders = ",".join("?" for _ in values)
        where_clauses.append(
            f"id IN (SELECT item_id FROM entity_filter_values "
            f"WHERE entity_key = ? AND filter_key = ? AND filter_value IN ({placeholders}))"
        )
        params.extend([entity_key, filter_key, *values])

    if search:
        where_clauses.append("search_text LIKE ? ESCAPE '\\'")
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params.append(f"%{escaped}%")

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    connection = _connect(database_path)
    try:
        total = connection.execute(f"SELECT COUNT(*) FROM {view} {where_sql}", params).fetchone()[0]  # noqa: S608
        rows = connection.execute(
            f"SELECT * FROM {view} {where_sql} ORDER BY id LIMIT ? OFFSET ?",  # noqa: S608
            [*params, limit, offset],
        ).fetchall()
    finally:
        connection.close()

    return {
        "entity": entity_key,
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [_decode_browse_row(row) for row in rows],
    }


def _decode_browse_row(row: sqlite3.Row) -> dict[str, Any]:
    """browse_<entity> views expose sub-objects (badges, media) as *_json
    text columns - decode those into real JSON values and drop the _json
    suffix so API consumers get actual objects/arrays, not encoded strings.
    """
    item: dict[str, Any] = {}
    for key in row.keys():
        value = row[key]
        if key.endswith("_json"):
            item[key[: -len("_json")]] = json.loads(value) if value is not None else None
        else:
            item[key] = value
    return item


def entity_has_any_rows(entity_key: str, *, database_path: Path | None = None) -> bool:
    table = ENTITY_TABLES.get(entity_key)
    if table is None:
        return False
    connection = _connect(database_path)
    try:
        row = connection.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone()  # noqa: S608
    finally:
        connection.close()
    return row is not None
