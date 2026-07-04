#!/usr/bin/env python3

from __future__ import annotations

import argparse
import collections
import errno
import functools
import http.server
import io
import json
import re
import shutil
import socketserver
import sys
import tempfile
import threading
import uuid
import webbrowser
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from lib.builds_validation import (
    normalize_build_id_list,
    normalize_build_stats,
    normalize_build_aptitudes,
    normalize_build_legacy_pair,
    next_build_id,
)
from lib.common import normalize_string_list, utc_timestamp
from lib.gametora_reference import update_umamusume_reference
from lib.legacy_factors import (
    LEGACY_ID_PATTERN,
    LEGACY_FACTOR_KIND_LABELS,
    get_character_detail,
    legacy_entry_to_factors,
    build_legacy_spark_summary,
    legacy_entry_grandparents,
    get_legacy_lineage_entries,
    build_lineage_completion,
    normalize_legacy_entry,
    next_legacy_id,
    build_pair_compatibility,
    summarize_legacy_factors,
    build_legacy_reference_button,
    build_legacy_grandparent_view_item,
    build_lineage_factor_summary,
    build_empty_legacy_view,
    build_detailed_aptitude_coverage,
    build_compact_pair_summary,
)
from lib.profiles import next_profile_id, unique_profile_name
from lib.roster_progression import (
    get_support_level_cap,
    summarize_character_progression,
    summarize_support_progression,
    normalize_roster_entry,
)
from lib.sqlite_queries import (
    entity_has_any_rows,
    existing_ids,
    fetch_all_reference_items,
    fetch_browsable_entity,
    fetch_character_progression_lookup,
    fetch_compatibility_by_character_id,
    fetch_entity_listing,
    fetch_reference_item,
    fetch_reference_items_by_id,
    fetch_support_progression_lookup,
    fetch_support_rarity_by_id,
)
from lib.sqlite_reference import get_reference_database_path, read_reference_database_meta


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIST_ROOT = PROJECT_ROOT / "dist"
REFERENCE_META_PATH = DIST_ROOT / "data" / "reference-meta.json"
REFERENCE_DB_PATH = get_reference_database_path()
NORMALIZED_ROOT = PROJECT_ROOT / "data" / "normalized"
USER_DATA_ROOT = PROJECT_ROOT / "data" / "user"
BACKUP_ROOT = PROJECT_ROOT / "data" / "backups"
PROFILES_INDEX_PATH = USER_DATA_ROOT / "profiles.json"
PROFILE_DATA_ROOT = USER_DATA_ROOT / "profiles"
PROFILE_ID_PATTERN = re.compile(r"^p_\d{3,}$")
BUILD_ID_PATTERN = re.compile(r"^build_\d{3,}$")
BACKUP_ID_PATTERN = re.compile(r"^backup_\d{8}_\d{6}_[0-9a-f]{8}$")
PROFILE_EXPORT_KIND = "umamusume-profile-export"
FULL_BACKUP_KIND = "umamusume-full-backup"
ADMIN_JOB_HISTORY_LIMIT = 12


JOB_LOCK = threading.Lock()
ACTIVE_ADMIN_JOB: dict | None = None
ADMIN_JOB_HISTORY: list[dict] = []


def default_profiles_index() -> dict:
    return {
        "version": 1,
        "last_profile_id": None,
        "profiles": [],
    }


def default_roster() -> dict:
    return {
        "version": 1,
        "updated_at": utc_timestamp(),
        "characters": {},
        "supports": {},
    }


def default_legacy_document() -> dict:
    return {
        "version": 4,
        "updated_at": utc_timestamp(),
        "entries": [],
    }


def default_builds_document() -> dict:
    return {
        "version": 1,
        "updated_at": utc_timestamp(),
        "entries": [],
    }


def ensure_user_data_roots() -> None:
    USER_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    PROFILE_DATA_ROOT.mkdir(parents=True, exist_ok=True)


def ensure_backup_root() -> None:
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, fallback_factory):
    if not path.exists():
        return fallback_factory()

    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return fallback_factory()


def get_reference_entity_path(entity_key: str) -> Path:
    return NORMALIZED_ROOT / f"{entity_key}.json"


def load_reference_entity(entity_key: str) -> dict:
    path = get_reference_entity_path(entity_key)
    if not path.exists():
        raise FileNotFoundError(entity_key)
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError(entity_key)
    return payload


def load_reference_meta() -> dict:
    payload = read_json(REFERENCE_META_PATH, lambda: {})
    if not isinstance(payload, dict):
        return {}
    return payload


def load_reference_items_lookup(entity_key: str) -> dict[str, dict]:
    payload = load_reference_entity(entity_key)
    return {
        str(item.get("id")): item
        for item in payload.get("items", [])
        if isinstance(item, dict) and str(item.get("id") or "").strip()
    }


def build_character_progression_lookup() -> dict[str, dict]:
    try:
        return fetch_character_progression_lookup(database_path=REFERENCE_DB_PATH)
    except FileNotFoundError:
        return {}


def build_support_progression_lookup() -> dict[int, dict]:
    try:
        return fetch_support_progression_lookup(database_path=REFERENCE_DB_PATH)
    except FileNotFoundError:
        return {}


def build_roster_view(profile_id: str, entity_key: str) -> dict:
    if entity_key not in {"characters", "supports"}:
        raise ValueError("Unsupported roster entity.")

    roster = load_roster(profile_id)
    owned_ids = [
        str(item_id)
        for item_id, roster_entry in (roster.get(entity_key) or {}).items()
        if isinstance(roster_entry, dict) and roster_entry.get("owned")
    ]
    reference_lookup = fetch_reference_items_by_id(entity_key, owned_ids, database_path=REFERENCE_DB_PATH)
    progression_lookup = build_character_progression_lookup() if entity_key == "characters" else build_support_progression_lookup()

    entries: dict[str, dict] = {}
    for item_id, roster_entry in (roster.get(entity_key) or {}).items():
        if not isinstance(roster_entry, dict) or not roster_entry.get("owned"):
            continue

        reference_item = reference_lookup.get(str(item_id))
        if reference_item is None:
            continue

        detail = reference_item.get("detail") if isinstance(reference_item, dict) and reference_item.get("detail") else reference_item
        if entity_key == "characters":
            derived = summarize_character_progression(roster_entry, detail, progression_lookup.get(str(item_id)))
        else:
            derived = summarize_support_progression(roster_entry, detail, progression_lookup.get(int(detail.get("rarity") or 0)))

        entries[str(item_id)] = {
            "item_id": str(item_id),
            "roster": roster_entry,
            "derived": derived,
        }

    return {
        "profile_id": profile_id,
        "entity": entity_key,
        "updated_at": roster.get("updated_at"),
        "entries": entries,
    }


def profile_legacy_path(profile_id: str) -> Path:
    return PROFILE_DATA_ROOT / profile_id / "legacy.json"


def build_legacy_reference_catalogs() -> dict:
    characters = fetch_all_reference_items("characters", database_path=REFERENCE_DB_PATH)
    try:
        scenarios = fetch_all_reference_items("scenarios", database_path=REFERENCE_DB_PATH)
    except FileNotFoundError:
        scenarios = {}
    try:
        g1_factors = fetch_all_reference_items("g1_factors", database_path=REFERENCE_DB_PATH)
    except FileNotFoundError:
        g1_factors = {}
    try:
        skills = fetch_all_reference_items("skills", database_path=REFERENCE_DB_PATH)
    except FileNotFoundError:
        skills = {}
    try:
        compatibility = fetch_compatibility_by_character_id(database_path=REFERENCE_DB_PATH)
    except FileNotFoundError:
        compatibility = {}

    return {
        "characters": characters,
        "scenarios": scenarios,
        "g1_factors": g1_factors,
        "skills": skills,
        "compatibility": compatibility,
    }


def inspect_legacy_document(raw_document: object) -> dict:
    document = default_legacy_document()
    if not isinstance(raw_document, dict):
        return {
            "document": document,
            "unresolved_entries": [],
            "catalogs_ready": True,
        }

    raw_entries = list(raw_document.get("entries") or [])
    try:
        catalogs = build_legacy_reference_catalogs()
    except (FileNotFoundError, ValueError):
        return {
            "document": {
                "version": 4,
                "updated_at": str(raw_document.get("updated_at") or document["updated_at"]),
                "entries": [],
            },
            "unresolved_entries": raw_entries,
            "catalogs_ready": False,
        }

    entries: list[dict] = []
    unresolved_entries: list[object] = []
    for raw_entry in raw_entries:
        try:
            entry = normalize_legacy_entry(
                raw_entry,
                catalogs,
                existing_id=str(raw_entry.get("id") or "").strip() or None if isinstance(raw_entry, dict) else None,
                strict_sparks=False,
            )
        except ValueError:
            unresolved_entries.append(raw_entry)
            continue
        if not entry.get("id"):
            entry["id"] = next_legacy_id(entries)
        entries.append(entry)

    return {
        "document": {
            "version": 4,
            "updated_at": str(raw_document.get("updated_at") or document["updated_at"]),
            "entries": sorted(entries, key=lambda entry: str(entry.get("updated_at") or entry.get("created_at") or ""), reverse=True),
        },
        "unresolved_entries": unresolved_entries,
        "catalogs_ready": True,
    }


def normalize_legacy_document(raw_document: object) -> dict:
    return inspect_legacy_document(raw_document)["document"]


def load_legacies(profile_id: str) -> dict:
    return normalize_legacy_document(read_json(profile_legacy_path(profile_id), default_legacy_document))


def read_raw_legacies(profile_id: str) -> dict:
    raw_document = read_json(profile_legacy_path(profile_id), default_legacy_document)
    return raw_document if isinstance(raw_document, dict) else default_legacy_document()


def save_legacies(profile_id: str, document: dict, *, preserve_existing_unresolved: bool = True) -> dict:
    report = inspect_legacy_document(document)
    normalized = report["document"]
    unresolved_entries = list(report["unresolved_entries"])

    if preserve_existing_unresolved:
        existing_report = inspect_legacy_document(read_json(profile_legacy_path(profile_id), default_legacy_document))
        normalized_ids = {
            str(entry.get("id") or "").strip()
            for entry in normalized["entries"]
            if isinstance(entry, dict) and str(entry.get("id") or "").strip()
        }
        unresolved_ids = {
            str(entry.get("id") or "").strip()
            for entry in unresolved_entries
            if isinstance(entry, dict) and str(entry.get("id") or "").strip()
        }
        for raw_entry in existing_report["unresolved_entries"]:
            raw_id = str(raw_entry.get("id") or "").strip() if isinstance(raw_entry, dict) else ""
            if raw_id and (raw_id in normalized_ids or raw_id in unresolved_ids):
                continue
            unresolved_entries.append(raw_entry)
            if raw_id:
                unresolved_ids.add(raw_id)

    normalized["updated_at"] = utc_timestamp()
    if unresolved_entries:
        atomic_write_json(
            profile_legacy_path(profile_id),
            {
                "version": 4,
                "updated_at": normalized["updated_at"],
                "entries": list(normalized["entries"]) + unresolved_entries,
            },
        )
    else:
        atomic_write_json(profile_legacy_path(profile_id), normalized)
    return normalized


def persist_unresolved_legacies(profile_id: str, document: object) -> dict:
    raw_document = document if isinstance(document, dict) else {}
    preserved = {
        "version": 4,
        "updated_at": str(raw_document.get("updated_at") or utc_timestamp()),
        "entries": list(raw_document.get("entries") or []),
    }
    atomic_write_json(profile_legacy_path(profile_id), preserved)
    return preserved


def create_legacy_entry(profile_id: str, payload: dict) -> dict:
    document = load_legacies(profile_id)
    catalogs = build_legacy_reference_catalogs()
    entry = normalize_legacy_entry(payload, catalogs, strict_sparks=True)
    entry["id"] = next_legacy_id(document["entries"])
    document["entries"].insert(0, entry)
    saved_document = save_legacies(profile_id, document)
    saved_entry = next(item for item in saved_document["entries"] if item["id"] == entry["id"])
    return {"document": saved_document, "entry": saved_entry}


def update_legacy_entry(profile_id: str, legacy_id: str, payload: dict) -> dict:
    if not LEGACY_ID_PATTERN.match(legacy_id):
        raise FileNotFoundError("Legacy entry not found.")

    document = load_legacies(profile_id)
    existing_entry = next((entry for entry in document["entries"] if entry["id"] == legacy_id), None)
    if existing_entry is None:
        raise FileNotFoundError("Legacy entry not found.")

    catalogs = build_legacy_reference_catalogs()
    merged_payload = {**existing_entry, **(payload or {}), "id": legacy_id, "created_at": existing_entry.get("created_at")}
    entry = normalize_legacy_entry(merged_payload, catalogs, existing_id=legacy_id, strict_sparks=True)
    for index, current in enumerate(document["entries"]):
        if current["id"] == legacy_id:
            document["entries"][index] = entry
            break
    saved_document = save_legacies(profile_id, document)
    saved_entry = next(item for item in saved_document["entries"] if item["id"] == legacy_id)
    return {"document": saved_document, "entry": saved_entry}


def delete_legacy_entry(profile_id: str, legacy_id: str) -> dict:
    if not LEGACY_ID_PATTERN.match(legacy_id):
        raise FileNotFoundError("Legacy entry not found.")
    document = load_legacies(profile_id)
    remaining_entries = [entry for entry in document["entries"] if entry["id"] != legacy_id]
    if len(remaining_entries) == len(document["entries"]):
        raise FileNotFoundError("Legacy entry not found.")
    document["entries"] = remaining_entries
    return save_legacies(profile_id, document)


def build_legacy_view(profile_id: str) -> dict:
    document = load_legacies(profile_id)
    try:
        catalogs = build_legacy_reference_catalogs()
    except (FileNotFoundError, ValueError):
        return build_empty_legacy_view(profile_id, str(document.get("updated_at") or ""))
    scenario_counts: dict[str, int] = collections.Counter()
    factor_kind_counts: dict[str, int] = collections.Counter()
    tag_counts: dict[str, int] = collections.Counter()
    status_counts: dict[str, int] = collections.Counter()
    items: list[dict] = []

    for entry in document["entries"]:
        character_ref = catalogs["characters"].get(str(entry.get("character_card_id")))
        detail = get_character_detail(character_ref)
        scenario_ref = catalogs["scenarios"].get(str(entry.get("scenario_id"))) if entry.get("scenario_id") else None
        spark_summary = build_legacy_spark_summary(entry)
        factors = legacy_entry_to_factors(entry)
        factor_summary = summarize_legacy_factors(factors)
        lineage_factor_summary = build_lineage_factor_summary(entry)
        lineage_completion = build_lineage_completion(entry)
        grandparent_items = [
            build_legacy_grandparent_view_item("left", legacy_entry_grandparents(entry).get("left"), catalogs),
            build_legacy_grandparent_view_item("right", legacy_entry_grandparents(entry).get("right"), catalogs),
        ]
        scenario_label = (
            str(entry.get("scenario_name") or (scenario_ref.get("name") if scenario_ref else "") or "Unknown scenario")
            if entry.get("scenario_id")
            else "No scenario"
        )
        badges = []
        if entry.get("scenario_name"):
            badges.append(entry["scenario_name"])
        if entry.get("rating"):
            badges.append(f"Rating {entry['rating']}")
        if spark_summary["blue"]:
            badges.append(f"Blue {spark_summary['blue']['target_label']} {int(spark_summary['blue'].get('stars') or 0)}\u2605")
        if spark_summary["pink"]:
            badges.append(f"Pink {spark_summary['pink']['target_label']} {int(spark_summary['pink'].get('stars') or 0)}\u2605")
        if spark_summary["green"]:
            badges.append(f"Green {spark_summary['green']['target_label']} {int(spark_summary['green'].get('stars') or 0)}\u2605")
        if spark_summary["white_count"]:
            badges.append(f"{spark_summary['white_count']} white")
        badges.append(f"{lineage_completion['filled_count']}/2 lineage")

        compatible_matches = []
        compatibility_item = catalogs["compatibility"].get(str(entry.get("base_character_id") or ""))
        if compatibility_item is not None:
            for match in (compatibility_item.get("top_matches") or [])[:6]:
                compatible_matches.append(
                    build_legacy_reference_button(
                        "compatibility",
                        match.get("character_id"),
                        match.get("name") or f"#{match.get('character_id')}",
                        f"{match.get('base_points') or 0} pts",
                    )
                )

        linked_refs = []
        if character_ref is not None:
            linked_refs.append(
                build_legacy_reference_button(
                    "characters",
                    entry["character_card_id"],
                    str(detail.get("name") or entry["name"]),
                    str(detail.get("variant") or entry.get("variant") or ""),
                )
            )
        if scenario_ref is not None:
            linked_refs.append(
                build_legacy_reference_button(
                    "scenarios",
                    scenario_ref.get("id") or scenario_ref.get("scenario_id"),
                    str(scenario_ref.get("name") or entry.get("scenario_name") or "Scenario"),
                )
            )

        if spark_summary["green"] and spark_summary["green"].get("skill_id"):
            linked_refs.append(
                build_legacy_reference_button(
                    "skills",
                    spark_summary["green"]["skill_id"],
                    str(spark_summary["green"].get("target_label") or "Unique skill"),
                )
            )

        for factor in factors + [factor for grandparent in get_legacy_lineage_entries(entry) for factor in legacy_entry_to_factors(grandparent)]:
            factor_kind = str(factor.get("kind") or "")
            factor_kind_counts[factor_kind] += 1
            if factor_kind == "g1":
                factor_ref = catalogs["g1_factors"].get(str(factor.get("target_key") or ""))
                if factor_ref is not None:
                    linked_refs.append(
                        build_legacy_reference_button(
                            "g1_factors",
                            factor_ref.get("id") or factor_ref.get("factor_id"),
                            str(factor_ref.get("name") or factor.get("target_label") or "G1 factor"),
                        )
                    )
            elif factor_kind == "scenario" and factor.get("scenario_id"):
                scenario_item = catalogs["scenarios"].get(str(factor.get("scenario_id")))
                if scenario_item is not None:
                    linked_refs.append(
                        build_legacy_reference_button(
                            "scenarios",
                            scenario_item.get("id") or scenario_item.get("scenario_id"),
                            str(scenario_item.get("name") or factor.get("target_label") or "Scenario"),
                        )
                    )
            elif factor_kind in {"skill", "unique"} and factor.get("skill_id"):
                linked_refs.append(
                    build_legacy_reference_button(
                        "skills",
                        factor.get("skill_id"),
                        str(factor.get("target_label") or "Skill"),
                    )
                )
        if entry.get("scenario_id"):
            scenario_counts[str(entry["scenario_id"])] += 1
        for tag in entry.get("custom_tags") or []:
            tag_counts[str(tag)] += 1
        for flag in entry.get("status_flags") or []:
            status_counts[str(flag)] += 1

        items.append(
            {
                "id": entry["id"],
                "title": entry.get("name") or "Unknown parent",
                "subtitle": entry.get("variant") or scenario_label,
                "media": character_ref.get("media") if isinstance(character_ref, dict) else {},
                "badges": badges[:6],
                "search_text": " ".join(
                    [
                        str(entry.get("name") or ""),
                        str(entry.get("variant") or ""),
                        str(entry.get("rating") or ""),
                        scenario_label,
                        " ".join(str(factor.get("target_label") or "") for factor in factors),
                        " ".join(str(factor.get("target_label") or "") for grandparent in get_legacy_lineage_entries(entry) for factor in legacy_entry_to_factors(grandparent)),
                        " ".join(str(item.get("title") or "") for item in grandparent_items if not item.get("missing")),
                        " ".join(entry.get("custom_tags") or []),
                        " ".join(entry.get("status_flags") or []),
                        str(entry.get("note") or ""),
                        str(entry.get("source_note") or ""),
                    ]
                ).strip(),
                "filters": {
                    "scenario_id": [str(entry.get("scenario_id"))] if entry.get("scenario_id") else ["none"],
                    "factor_kind": sorted(
                        {
                            str(factor.get("kind") or "")
                            for factor in (factors + [factor for grandparent in get_legacy_lineage_entries(entry) for factor in legacy_entry_to_factors(grandparent)])
                            if str(factor.get("kind") or "")
                        }
                    ),
                    "local_tag": list(entry.get("custom_tags") or []),
                    "status_flag": list(entry.get("status_flags") or []),
                },
                "detail": {
                    "entry": entry,
                    "rating": str(entry.get("rating") or ""),
                    "character_ref": linked_refs[:1],
                    "scenario_ref": linked_refs[1:2] if scenario_ref is not None else [],
                    "spark_summary": spark_summary,
                    "factor_groups": factor_summary["groups"],
                    "factor_counts": factor_summary["counts"],
                    "factor_stars_total": factor_summary["stars_total"],
                    "lineage_factor_groups": lineage_factor_summary["combined"]["groups"],
                    "lineage_completion": lineage_completion,
                    "grandparents": grandparent_items,
                    "linked_references": linked_refs,
                    "compatibility_top_matches": compatible_matches,
                    "available_en": bool(detail.get("release", {}).get("en")) if isinstance(detail, dict) else False,
                },
            }
        )

    scenario_options = []
    if any(item.get("scenario_id") is None for item in document["entries"]):
        scenario_options.append({"value": "none", "label": "No scenario", "count": sum(1 for item in document["entries"] if not item.get("scenario_id"))})
    for scenario_id, count in sorted(scenario_counts.items(), key=lambda item: str(item[0])):
        scenario_ref = catalogs["scenarios"].get(str(scenario_id))
        scenario_options.append(
            {
                "value": str(scenario_id),
                "label": str(scenario_ref.get("name") if scenario_ref else scenario_id),
                "count": count,
            }
        )

    view = build_empty_legacy_view(profile_id, str(document.get("updated_at") or ""))
    view["items"] = items
    view["filter_options"] = {
        "scenario_id": scenario_options,
        "factor_kind": [
            {"value": kind, "label": label, "count": factor_kind_counts.get(kind, 0)}
            for kind, label in LEGACY_FACTOR_KIND_LABELS.items()
            if factor_kind_counts.get(kind, 0)
        ],
        "local_tag": [
            {"value": value, "label": value, "count": count}
            for value, count in sorted(tag_counts.items())
        ],
        "status_flag": [
            {"value": value, "label": value, "count": count}
            for value, count in sorted(status_counts.items())
        ],
    }
    return view


def build_legacy_simulator_preview(profile_id: str, payload: dict) -> dict:
    main_character_id = str(payload.get("main_character_id") or "").strip()
    parent_a_legacy_id = str(payload.get("parent_a_legacy_id") or "").strip()
    parent_b_legacy_id = str(payload.get("parent_b_legacy_id") or "").strip()
    if not main_character_id or not parent_a_legacy_id or not parent_b_legacy_id:
        raise ValueError("main_character_id, parent_a_legacy_id and parent_b_legacy_id are required.")
    if parent_a_legacy_id == parent_b_legacy_id:
        raise ValueError("Parent A and Parent B must be different saved parents.")

    roster = load_roster(profile_id)
    main_roster_entry = (roster.get("characters") or {}).get(main_character_id)
    if not isinstance(main_roster_entry, dict) or not main_roster_entry.get("owned"):
        raise ValueError("The selected main character must be owned in the active roster.")

    catalogs = build_legacy_reference_catalogs()
    main_ref = catalogs["characters"].get(main_character_id)
    if main_ref is None:
        raise ValueError("Main character reference not found.")
    main_detail = main_ref.get("detail") if isinstance(main_ref, dict) and main_ref.get("detail") else main_ref

    legacy_document = load_legacies(profile_id)
    parent_a = next((entry for entry in legacy_document["entries"] if entry["id"] == parent_a_legacy_id), None)
    parent_b = next((entry for entry in legacy_document["entries"] if entry["id"] == parent_b_legacy_id), None)
    if parent_a is None or parent_b is None:
        raise ValueError("One or more selected parents could not be found.")

    main_base_character_id = int(main_detail.get("base_character_id") or 0)
    main_to_parent_a = build_pair_compatibility(main_base_character_id, int(parent_a.get("base_character_id") or 0), catalogs)
    main_to_parent_b = build_pair_compatibility(main_base_character_id, int(parent_b.get("base_character_id") or 0), catalogs)
    parent_pair = build_pair_compatibility(int(parent_a.get("base_character_id") or 0), int(parent_b.get("base_character_id") or 0), catalogs)

    parent_a_grandparents = [
        build_legacy_grandparent_view_item("left", legacy_entry_grandparents(parent_a).get("left"), catalogs),
        build_legacy_grandparent_view_item("right", legacy_entry_grandparents(parent_a).get("right"), catalogs),
    ]
    parent_b_grandparents = [
        build_legacy_grandparent_view_item("left", legacy_entry_grandparents(parent_b).get("left"), catalogs),
        build_legacy_grandparent_view_item("right", legacy_entry_grandparents(parent_b).get("right"), catalogs),
    ]

    grandparent_pairs = []
    for branch_label, grandparent in (
        ("A-Left", legacy_entry_grandparents(parent_a).get("left")),
        ("A-Right", legacy_entry_grandparents(parent_a).get("right")),
        ("B-Left", legacy_entry_grandparents(parent_b).get("left")),
        ("B-Right", legacy_entry_grandparents(parent_b).get("right")),
    ):
        if not isinstance(grandparent, dict):
            grandparent_pairs.append(
                {
                    "label": branch_label,
                    "missing": True,
                    "score": 0,
                    "shared_group_count": 0,
                    "shared_groups": [],
                }
            )
            continue
        pair = build_pair_compatibility(main_base_character_id, int(grandparent.get("base_character_id") or 0), catalogs)
        grandparent_pairs.append(
            {
                "label": branch_label,
                "missing": False,
                "score": int(pair.get("score") or 0),
                "shared_group_count": int(pair.get("shared_group_count") or 0),
                "shared_groups": list(pair.get("shared_groups") or []),
                "grandparent_name": str(grandparent.get("name") or ""),
            }
        )

    direct_factors = legacy_entry_to_factors(parent_a) + legacy_entry_to_factors(parent_b)
    grandparent_factors: list[dict] = []
    for grandparent in get_legacy_lineage_entries(parent_a) + get_legacy_lineage_entries(parent_b):
        grandparent_factors.extend(legacy_entry_to_factors(grandparent))
    combined_factors = direct_factors + grandparent_factors

    direct_factor_summary = summarize_legacy_factors(direct_factors)
    grandparent_factor_summary = summarize_legacy_factors(grandparent_factors)
    combined_factor_summary = summarize_legacy_factors(combined_factors)
    aptitude_coverage = build_detailed_aptitude_coverage(main_detail, direct_factors, grandparent_factors)

    direct_total = int(main_to_parent_a.get("score") or 0) + int(main_to_parent_b.get("score") or 0)
    lineage_support_total = sum(int(item.get("score") or 0) for item in grandparent_pairs if not item.get("missing"))
    overall_total = direct_total + lineage_support_total

    highlights = []
    warnings = []
    if main_to_parent_a["score"] >= 20 and main_to_parent_b["score"] >= 20:
        highlights.append("Both direct parents have strong compatibility with the main candidate.")
    if parent_pair["score"] >= 20:
        highlights.append("The two direct parents also share a strong mutual compatibility basis.")
    if lineage_support_total >= 20:
        highlights.append("Grandparents add meaningful compatibility support across the two branches.")
    if combined_factor_summary["counts"].get("g1"):
        highlights.append("The lineage contributes visible G1 inheritance value.")
    if combined_factor_summary["counts"].get("scenario"):
        highlights.append("Scenario sparks are present in the lineage.")
    if combined_factor_summary["counts"].get("unique"):
        highlights.append("At least one direct parent contributes a resolved green unique spark.")
    if build_lineage_completion(parent_a)["filled_count"] < 2 or build_lineage_completion(parent_b)["filled_count"] < 2:
        warnings.append("The lineage is incomplete: one or more grandparent slots are still missing.")
    if main_to_parent_a["score"] == 0 or main_to_parent_b["score"] == 0:
        warnings.append("At least one direct parent has no resolved compatibility points with the main candidate.")
    for coverage in aptitude_coverage:
        if coverage["missing"]:
            warnings.append(f"Missing {coverage['category']} support for: {', '.join(coverage['missing'])}.")

    raw_details = {}
    if main_to_parent_a.get("shared_groups"):
        raw_details["main_to_parent_a_groups"] = build_compact_pair_summary(main_to_parent_a, "Main -> Parent A")
    if main_to_parent_b.get("shared_groups"):
        raw_details["main_to_parent_b_groups"] = build_compact_pair_summary(main_to_parent_b, "Main -> Parent B")
    if parent_pair.get("shared_groups"):
        raw_details["parent_pair_groups"] = build_compact_pair_summary(parent_pair, "Parent A -> Parent B")
    grandparent_raw_groups = [item for item in grandparent_pairs if item.get("shared_groups")]
    if grandparent_raw_groups:
        raw_details["grandparent_groups"] = grandparent_raw_groups

    return {
        "main": {
            "id": str(main_ref.get("id") or main_character_id),
            "title": str(main_detail.get("name") or main_character_id),
            "subtitle": str(main_detail.get("variant") or ""),
            "media": main_ref.get("media") if isinstance(main_ref, dict) else {},
        },
        "parent_a": parent_a,
        "parent_b": parent_b,
        "parent_a_sparks": build_legacy_spark_summary(parent_a),
        "parent_b_sparks": build_legacy_spark_summary(parent_b),
        "parent_a_grandparents": parent_a_grandparents,
        "parent_b_grandparents": parent_b_grandparents,
        "compatibility_summary": {
            "direct": {
                "parent_a": build_compact_pair_summary(main_to_parent_a, "Main -> Parent A"),
                "parent_b": build_compact_pair_summary(main_to_parent_b, "Main -> Parent B"),
                "pair_synergy": build_compact_pair_summary(parent_pair, "Parent A -> Parent B"),
                "total_score": direct_total,
            },
            "grandparent_support": {
                "slots": grandparent_pairs,
                "filled_slots": sum(1 for item in grandparent_pairs if not item.get("missing")),
                "total_score": lineage_support_total,
            },
            "overall_score": overall_total,
        },
        "spark_summary": {
            "direct": direct_factor_summary,
            "grandparents": grandparent_factor_summary,
            "combined": combined_factor_summary,
        },
        "coverage_summary": {
            "aptitude_coverage": aptitude_coverage,
            "direct_factor_groups": direct_factor_summary["groups"],
            "grandparent_factor_groups": grandparent_factor_summary["groups"],
            "combined_factor_groups": combined_factor_summary["groups"],
        },
        "scenario_summary": {
            "direct": direct_factor_summary["groups"].get("scenario") or [],
            "grandparents": grandparent_factor_summary["groups"].get("scenario") or [],
        },
        "g1_summary": {
            "direct": direct_factor_summary["groups"].get("g1") or [],
            "grandparents": grandparent_factor_summary["groups"].get("g1") or [],
        },
        "highlights": highlights,
        "warnings": warnings,
        "raw_details": raw_details,
    }


def atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temp_path.replace(path)


def normalize_profiles_index(raw_index: object) -> dict:
    default_index = default_profiles_index()
    if not isinstance(raw_index, dict):
        return default_index

    profiles = []
    for raw_profile in raw_index.get("profiles", []):
        if not isinstance(raw_profile, dict):
            continue

        profile_id = str(raw_profile.get("id") or "").strip()
        name = str(raw_profile.get("name") or "").strip()
        created_at = str(raw_profile.get("created_at") or "").strip()
        updated_at = str(raw_profile.get("updated_at") or "").strip()

        if not PROFILE_ID_PATTERN.match(profile_id) or not name:
            continue

        profiles.append(
            {
                "id": profile_id,
                "name": name,
                "created_at": created_at or utc_timestamp(),
                "updated_at": updated_at or utc_timestamp(),
            }
        )

    last_profile_id = raw_index.get("last_profile_id")
    valid_profile_ids = {profile["id"] for profile in profiles}
    if last_profile_id not in valid_profile_ids:
        last_profile_id = None

    return {
        "version": 1,
        "last_profile_id": last_profile_id,
        "profiles": profiles,
    }


def load_profiles_index() -> dict:
    ensure_user_data_roots()
    return normalize_profiles_index(read_json(PROFILES_INDEX_PATH, default_profiles_index))


def save_profiles_index(index: dict) -> dict:
    normalized = normalize_profiles_index(index)
    atomic_write_json(PROFILES_INDEX_PATH, normalized)
    return normalized


def profile_roster_path(profile_id: str) -> Path:
    return PROFILE_DATA_ROOT / profile_id / "roster.json"


def profile_builds_path(profile_id: str) -> Path:
    return PROFILE_DATA_ROOT / profile_id / "builds.json"


def profile_exists(profile_id: str) -> bool:
    return profile_id in {profile["id"] for profile in load_profiles_index()["profiles"]}


def normalize_roster(raw_roster: object) -> dict:
    roster = default_roster()
    if not isinstance(raw_roster, dict):
        return roster

    try:
        support_rarity_lookup = fetch_support_rarity_by_id(database_path=REFERENCE_DB_PATH)
    except FileNotFoundError:
        support_rarity_lookup = {}

    normalized = {
        "version": 1,
        "updated_at": str(raw_roster.get("updated_at") or roster["updated_at"]),
        "characters": {},
        "supports": {},
    }

    for entity_key in ("characters", "supports"):
        bucket = raw_roster.get(entity_key, {})
        if not isinstance(bucket, dict):
            continue

        for item_id, raw_entry in bucket.items():
            entry_id = str(item_id).strip()
            if not entry_id:
                continue

            entry = normalize_roster_entry(entity_key, raw_entry)
            if entry is not None:
                if entity_key == "supports" and "level" in entry:
                    rarity = support_rarity_lookup.get(entry_id, 0)
                    if rarity > 0:
                        support_cap = get_support_level_cap(rarity, int(entry.get("limit_break") or 0))
                        entry["level"] = min(int(entry["level"]), support_cap)
                normalized[entity_key][entry_id] = entry

    return normalized


def load_roster(profile_id: str) -> dict:
    return normalize_roster(read_json(profile_roster_path(profile_id), default_roster))


def save_roster(profile_id: str, roster: dict) -> dict:
    normalized = normalize_roster(roster)
    normalized["updated_at"] = utc_timestamp()
    atomic_write_json(profile_roster_path(profile_id), normalized)
    return normalized


def validate_build_references(profile_id: str, entry: dict) -> None:
    reference_checks = [
        ("target_id", "cm_targets"),
        ("character_id", "characters"),
        ("scenario_id", "scenarios"),
    ]
    for field_name, entity_key in reference_checks:
        ref_id = str(entry.get(field_name) or "").strip()
        if not ref_id:
            continue
        try:
            if ref_id not in existing_ids(entity_key, [ref_id], database_path=REFERENCE_DB_PATH):
                raise ValueError(f"build.{field_name} does not exist in local reference.")
        except FileNotFoundError:
            continue

    support_ids = entry.get("support_deck") or []
    if support_ids:
        try:
            has_supports = entity_has_any_rows("supports", database_path=REFERENCE_DB_PATH)
        except FileNotFoundError:
            has_supports = False
        if has_supports:
            known_support_ids = existing_ids("supports", support_ids, database_path=REFERENCE_DB_PATH)
            missing = [support_id for support_id in support_ids if support_id not in known_support_ids]
            if missing:
                raise ValueError("build.support_deck contains unknown supports.")

    skill_ids = list(entry.get("required_skills") or []) + list(entry.get("optional_skills") or [])
    if skill_ids:
        try:
            has_skills = entity_has_any_rows("skills", database_path=REFERENCE_DB_PATH)
        except FileNotFoundError:
            has_skills = False
        if has_skills:
            known_skill_ids = existing_ids("skills", skill_ids, database_path=REFERENCE_DB_PATH)
            missing = [skill_id for skill_id in skill_ids if skill_id not in known_skill_ids]
            if missing:
                raise ValueError("build skills contain unknown skill ids.")

    legacy_ids = set((entry.get("legacy_pair") or {}).values())
    if legacy_ids:
        known_legacy_ids = {legacy["id"] for legacy in load_legacies(profile_id).get("entries", [])}
        missing = sorted(legacy_ids - known_legacy_ids)
        if missing:
            raise ValueError("build.legacy_pair contains unknown legacy parents.")


def normalize_build_entry(raw_entry: object, profile_id: str, *, existing_id: str | None = None) -> dict:
    if not isinstance(raw_entry, dict):
        raise ValueError("build entry must be an object.")

    build_id = existing_id or str(raw_entry.get("id") or "").strip()
    if build_id and not BUILD_ID_PATTERN.match(build_id):
        raise ValueError("build id is invalid.")

    mode = str(raw_entry.get("mode") or "champions_meeting").strip()
    if mode not in {"champions_meeting", "freeform"}:
        raise ValueError("build.mode must be champions_meeting or freeform.")

    status = str(raw_entry.get("status") or "draft").strip()
    if status not in {"draft", "planned", "testing", "done", "archived"}:
        raise ValueError("build.status is invalid.")

    name = str(raw_entry.get("name") or "").strip()
    if len(name) > 120:
        raise ValueError("build.name is too long.")

    notes = str(raw_entry.get("notes") or "").strip()
    if len(notes) > 4000:
        raise ValueError("build.notes is too long.")

    entry = {
        "id": build_id,
        "mode": mode,
        "name": name,
        "target_id": str(raw_entry.get("target_id") or "").strip(),
        "character_id": str(raw_entry.get("character_id") or "").strip(),
        "scenario_id": str(raw_entry.get("scenario_id") or "").strip(),
        "support_deck": normalize_build_id_list(raw_entry.get("support_deck"), field_name="build.support_deck", max_items=6),
        "legacy_pair": normalize_build_legacy_pair(raw_entry.get("legacy_pair")),
        "target_stats": normalize_build_stats(raw_entry.get("target_stats")),
        "target_aptitudes": normalize_build_aptitudes(raw_entry.get("target_aptitudes")),
        "required_skills": normalize_build_id_list(raw_entry.get("required_skills"), field_name="build.required_skills"),
        "optional_skills": normalize_build_id_list(raw_entry.get("optional_skills"), field_name="build.optional_skills"),
        "status": status,
        "notes": notes,
        "custom_tags": normalize_string_list(raw_entry.get("custom_tags"), field_name="build.custom_tags"),
        "created_at": str(raw_entry.get("created_at") or utc_timestamp()),
        "updated_at": str(raw_entry.get("updated_at") or utc_timestamp()),
    }
    if not entry["name"]:
        entry["name"] = "Champions Meeting draft" if mode == "champions_meeting" else "Build draft"

    validate_build_references(profile_id, entry)
    return entry


def normalize_builds_document(raw_document: object, profile_id: str) -> dict:
    document = default_builds_document()
    if not isinstance(raw_document, dict):
        return document

    entries: list[dict] = []
    for raw_entry in raw_document.get("entries") or []:
        try:
            entry = normalize_build_entry(raw_entry, profile_id)
        except ValueError:
            continue
        if not entry["id"]:
            entry["id"] = next_build_id(entries)
        entries.append(entry)

    return {
        "version": 1,
        "updated_at": str(raw_document.get("updated_at") or document["updated_at"]),
        "entries": entries,
    }


def load_builds(profile_id: str) -> dict:
    return normalize_builds_document(read_json(profile_builds_path(profile_id), default_builds_document), profile_id)


def save_builds(profile_id: str, document: dict) -> dict:
    normalized = normalize_builds_document(document, profile_id)
    normalized["updated_at"] = utc_timestamp()
    atomic_write_json(profile_builds_path(profile_id), normalized)
    return normalized


def create_build_entry(profile_id: str, payload: dict) -> dict:
    document = load_builds(profile_id)
    entry = normalize_build_entry(payload, profile_id)
    entry["id"] = next_build_id(document["entries"])
    timestamp = utc_timestamp()
    entry["created_at"] = timestamp
    entry["updated_at"] = timestamp
    document["entries"].append(entry)
    saved_document = save_builds(profile_id, document)
    saved_entry = next(item for item in saved_document["entries"] if item["id"] == entry["id"])
    return {"document": saved_document, "entry": saved_entry}


def update_build_entry(profile_id: str, build_id: str, payload: dict) -> dict:
    if not BUILD_ID_PATTERN.match(build_id):
        raise FileNotFoundError("Build not found.")

    document = load_builds(profile_id)
    existing_entry = next((entry for entry in document["entries"] if entry["id"] == build_id), None)
    if existing_entry is None:
        raise FileNotFoundError("Build not found.")

    merged_payload = {**existing_entry, **(payload or {}), "id": build_id, "created_at": existing_entry.get("created_at")}
    entry = normalize_build_entry(merged_payload, profile_id, existing_id=build_id)
    entry["updated_at"] = utc_timestamp()
    for index, current in enumerate(document["entries"]):
        if current["id"] == build_id:
            document["entries"][index] = entry
            break
    saved_document = save_builds(profile_id, document)
    saved_entry = next(item for item in saved_document["entries"] if item["id"] == build_id)
    return {"document": saved_document, "entry": saved_entry}


def delete_build_entry(profile_id: str, build_id: str) -> dict:
    if not BUILD_ID_PATTERN.match(build_id):
        raise FileNotFoundError("Build not found.")

    document = load_builds(profile_id)
    remaining_entries = [entry for entry in document["entries"] if entry["id"] != build_id]
    if len(remaining_entries) == len(document["entries"]):
        raise FileNotFoundError("Build not found.")
    document["entries"] = remaining_entries
    return save_builds(profile_id, document)


def create_profile(name: str) -> tuple[dict, dict]:
    normalized_name = str(name or "").strip()
    if not normalized_name:
        raise ValueError("Profile name is required.")
    if len(normalized_name) > 80:
        raise ValueError("Profile name must be 80 characters or fewer.")

    index = load_profiles_index()
    timestamp = utc_timestamp()
    profile = {
        "id": next_profile_id(index["profiles"]),
        "name": normalized_name,
        "created_at": timestamp,
        "updated_at": timestamp,
    }

    index["profiles"].append(profile)
    index["last_profile_id"] = profile["id"]
    saved_index = save_profiles_index(index)
    save_roster(profile["id"], default_roster())
    save_legacies(profile["id"], default_legacy_document())
    save_builds(profile["id"], default_builds_document())
    return saved_index, profile


def set_last_profile(profile_id: str) -> dict:
    if not PROFILE_ID_PATTERN.match(profile_id) or not profile_exists(profile_id):
        raise FileNotFoundError("Profile not found.")

    index = load_profiles_index()
    index["last_profile_id"] = profile_id
    return save_profiles_index(index)


def delete_profile(profile_id: str) -> dict:
    if not PROFILE_ID_PATTERN.match(profile_id):
        raise FileNotFoundError("Profile not found.")

    index = load_profiles_index()
    profiles = [profile for profile in index["profiles"] if profile["id"] != profile_id]
    if len(profiles) == len(index["profiles"]):
        raise FileNotFoundError("Profile not found.")

    profile_dir = PROFILE_DATA_ROOT / profile_id
    if profile_dir.exists():
        shutil.rmtree(profile_dir)

    index["profiles"] = profiles
    if index.get("last_profile_id") == profile_id:
        index["last_profile_id"] = profiles[0]["id"] if profiles else None

    return save_profiles_index(index)


def rename_profile(profile_id: str, name: str) -> tuple[dict, dict]:
    normalized_name = str(name or "").strip()
    if not PROFILE_ID_PATTERN.match(profile_id):
        raise FileNotFoundError("Profile not found.")
    if not normalized_name:
        raise ValueError("Profile name is required.")
    if len(normalized_name) > 80:
        raise ValueError("Profile name must be 80 characters or fewer.")

    index = load_profiles_index()
    profile = next((entry for entry in index["profiles"] if entry["id"] == profile_id), None)
    if profile is None:
        raise FileNotFoundError("Profile not found.")

    profile["name"] = normalized_name
    profile["updated_at"] = utc_timestamp()
    saved_index = save_profiles_index(index)
    saved_profile = next(entry for entry in saved_index["profiles"] if entry["id"] == profile_id)
    return saved_index, saved_profile


def export_profile_archive_bytes(profile_id: str) -> tuple[bytes, str]:
    index = load_profiles_index()
    profile = next((entry for entry in index["profiles"] if entry["id"] == profile_id), None)
    if profile is None:
        raise FileNotFoundError("Profile not found.")

    roster = load_roster(profile_id)
    legacies = read_raw_legacies(profile_id)
    builds = load_builds(profile_id)
    manifest = {
        "kind": PROFILE_EXPORT_KIND,
        "version": 2,
        "created_at": utc_timestamp(),
        "profile_id": profile_id,
    }

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        archive.writestr("profile.json", json.dumps(profile, ensure_ascii=False, indent=2) + "\n")
        archive.writestr("roster.json", json.dumps(roster, ensure_ascii=False, indent=2) + "\n")
        archive.writestr("legacy.json", json.dumps(legacies, ensure_ascii=False, indent=2) + "\n")
        archive.writestr("builds.json", json.dumps(builds, ensure_ascii=False, indent=2) + "\n")

    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", profile["name"]).strip("-") or profile_id
    return buffer.getvalue(), f"{safe_name}.zip"


def import_profile_archive_bytes(payload: bytes, target_profile_id: str | None = None) -> tuple[dict, dict]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile as exc:
        raise ValueError("Profile import must be a valid ZIP archive.") from exc

    with archive:
        try:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            profile = json.loads(archive.read("profile.json").decode("utf-8"))
            roster = json.loads(archive.read("roster.json").decode("utf-8"))
        except KeyError as exc:
            raise ValueError("Profile archive is incomplete.") from exc
        except json.JSONDecodeError as exc:
            raise ValueError("Profile archive contains invalid JSON.") from exc
        try:
            legacy_document = json.loads(archive.read("legacy.json").decode("utf-8"))
        except KeyError:
            legacy_document = default_legacy_document()
        except json.JSONDecodeError as exc:
            raise ValueError("Profile archive contains invalid legacy JSON.") from exc
        try:
            builds_document = json.loads(archive.read("builds.json").decode("utf-8"))
        except KeyError:
            builds_document = default_builds_document()
        except json.JSONDecodeError as exc:
            raise ValueError("Profile archive contains invalid builds JSON.") from exc

    if manifest.get("kind") != PROFILE_EXPORT_KIND:
        raise ValueError("Unsupported profile archive format.")

    imported_name = str(profile.get("name") or "").strip()
    if not imported_name:
        raise ValueError("Profile archive is missing a valid profile name.")

    index = load_profiles_index()

    if target_profile_id is not None:
        target_profile = next((entry for entry in index["profiles"] if entry["id"] == target_profile_id), None)
        if target_profile is None:
            raise FileNotFoundError("Profile not found.")

        target_profile["updated_at"] = utc_timestamp()
        index["last_profile_id"] = target_profile_id
        saved_index = save_profiles_index(index)
        save_roster(target_profile_id, roster)
        legacy_report = inspect_legacy_document(legacy_document)
        if legacy_report["catalogs_ready"] and not legacy_report["unresolved_entries"]:
            save_legacies(target_profile_id, legacy_document, preserve_existing_unresolved=False)
        else:
            persist_unresolved_legacies(target_profile_id, legacy_document)
        save_builds(target_profile_id, builds_document)
        saved_profile = next(entry for entry in saved_index["profiles"] if entry["id"] == target_profile_id)
        return saved_index, saved_profile

    existing_names = {entry["name"] for entry in index["profiles"]}
    timestamp = utc_timestamp()
    profile_id = next_profile_id(index["profiles"])
    profile_name = unique_profile_name(imported_name, existing_names)
    new_profile = {
        "id": profile_id,
        "name": profile_name,
        "created_at": timestamp,
        "updated_at": timestamp,
    }

    index["profiles"].append(new_profile)
    index["last_profile_id"] = profile_id
    saved_index = save_profiles_index(index)
    save_roster(profile_id, roster)
    legacy_report = inspect_legacy_document(legacy_document)
    if legacy_report["catalogs_ready"] and not legacy_report["unresolved_entries"]:
        save_legacies(profile_id, legacy_document, preserve_existing_unresolved=False)
    else:
        persist_unresolved_legacies(profile_id, legacy_document)
    save_builds(profile_id, builds_document)
    return saved_index, new_profile


def get_bootstrap_status() -> dict:
    profiles_index = load_profiles_index()
    has_profiles = bool(profiles_index["profiles"])
    has_reference_meta = REFERENCE_META_PATH.exists()
    has_reference_db = REFERENCE_DB_PATH.exists()
    has_dist_bundle = (DIST_ROOT / "index.html").exists()
    needs_initial_update = not has_reference_meta or not has_reference_db
    reference_generated_at = None
    if has_reference_meta:
        try:
            reference_generated_at = str(load_reference_meta().get("generated_at") or "") or None
        except (FileNotFoundError, ValueError):
            reference_generated_at = None

    if not has_profiles:
        recommended_entry = "wizard"
    elif profiles_index.get("last_profile_id"):
        recommended_entry = "roster"
    else:
        recommended_entry = "profiles"

    return {
        "has_profiles": has_profiles,
        "has_reference_meta": has_reference_meta,
        "has_reference_db": has_reference_db,
        "has_dist_bundle": has_dist_bundle,
        "needs_initial_update": needs_initial_update,
        "recommended_entry": recommended_entry,
        "reference_generated_at": reference_generated_at,
    }


def admin_job_snapshot(job: dict | None) -> dict | None:
    if job is None:
        return None
    return dict(job)


def list_admin_jobs() -> dict:
    with JOB_LOCK:
        return {
            "active_job": admin_job_snapshot(ACTIVE_ADMIN_JOB),
            "recent_jobs": [admin_job_snapshot(job) for job in ADMIN_JOB_HISTORY],
        }


def _finish_admin_job(job: dict, *, status: str, message: str, result: dict | None = None) -> None:
    global ACTIVE_ADMIN_JOB
    with JOB_LOCK:
        job["status"] = status
        job["message"] = message
        job["progress"] = 100 if status == "succeeded" else job.get("progress", 0)
        if status == "succeeded":
            job["current_task"] = "Completed"
        job["finished_at"] = utc_timestamp()
        if result is not None:
            job["result"] = result
        if ACTIVE_ADMIN_JOB and ACTIVE_ADMIN_JOB["id"] == job["id"]:
            ACTIVE_ADMIN_JOB = None
        ADMIN_JOB_HISTORY.insert(0, dict(job))
        del ADMIN_JOB_HISTORY[ADMIN_JOB_HISTORY_LIMIT:]


def _update_admin_job_progress(job: dict, payload: dict | None) -> None:
    if not payload:
        return

    with JOB_LOCK:
        progress = payload.get("progress")
        if isinstance(progress, (int, float)):
            job["progress"] = max(0, min(100, int(progress)))

        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            job["message"] = message.strip()

        current_task = payload.get("current_task")
        if isinstance(current_task, str) and current_task.strip():
            current_task = current_task.strip()
            job["current_task"] = current_task
            checkpoints = list(job.get("checkpoints") or [])
            if not checkpoints or checkpoints[-1] != current_task:
                checkpoints.append(current_task)
                job["checkpoints"] = checkpoints[-6:]


def start_admin_job(job_type: str, runner) -> dict:
    global ACTIVE_ADMIN_JOB
    with JOB_LOCK:
        if ACTIVE_ADMIN_JOB is not None:
            raise RuntimeError("Another admin job is already running.")
        job = {
            "id": f"job_{uuid.uuid4().hex[:12]}",
            "type": job_type,
            "status": "running",
            "created_at": utc_timestamp(),
            "started_at": utc_timestamp(),
            "finished_at": None,
            "message": f"{job_type.capitalize()} started.",
            "progress": 0,
            "current_task": f"{job_type.capitalize()} started.",
            "checkpoints": [],
            "result": None,
        }
        ACTIVE_ADMIN_JOB = job

    def _target():
        try:
            result = runner(job)
        except Exception as exc:  # noqa: BLE001
            _finish_admin_job(job, status="failed", message=str(exc) or f"{job_type} failed.")
            return
        _finish_admin_job(job, status="succeeded", message=f"{job_type.capitalize()} completed.", result=result)

    thread = threading.Thread(target=_target, name=job["id"], daemon=True)
    thread.start()
    return dict(job)


def run_reference_update_job(job: dict, *, force: bool = False) -> dict:
    return update_umamusume_reference(
        force=force,
        progress_callback=lambda payload: _update_admin_job_progress(job, payload),
    )


def backup_id_now() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"backup_{timestamp}_{uuid.uuid4().hex[:8]}"


def get_backup_path(backup_id: str) -> Path:
    return BACKUP_ROOT / f"{backup_id}.zip"


def create_full_backup() -> dict:
    ensure_backup_root()
    backup_id = backup_id_now()
    backup_path = get_backup_path(backup_id)
    manifest = {
        "kind": FULL_BACKUP_KIND,
        "version": 1,
        "created_at": utc_timestamp(),
        "backup_id": backup_id,
    }
    include_paths = [
        USER_DATA_ROOT,
        PROJECT_ROOT / "data" / "runtime",
        PROJECT_ROOT / "data" / "raw",
        PROJECT_ROOT / "data" / "normalized",
        DIST_ROOT / "data",
        DIST_ROOT / "media",
    ]

    with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        for root_path in include_paths:
            if not root_path.exists():
                continue
            if root_path.is_file():
                archive.write(root_path, root_path.relative_to(PROJECT_ROOT).as_posix())
                continue
            for entry in root_path.rglob("*"):
                if entry.is_file():
                    archive.write(entry, entry.relative_to(PROJECT_ROOT).as_posix())

    return get_backup_info(backup_path)


def get_backup_info(backup_path: Path) -> dict:
    if not backup_path.exists():
        raise FileNotFoundError("Backup not found.")
    backup_id = backup_path.stem
    created_at = datetime.fromtimestamp(backup_path.stat().st_mtime, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    manifest = {}
    try:
        with zipfile.ZipFile(backup_path) as archive:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    except Exception:  # noqa: BLE001
        manifest = {}
    return {
        "id": backup_id,
        "filename": backup_path.name,
        "created_at": manifest.get("created_at") or created_at,
        "size_bytes": backup_path.stat().st_size,
        "kind": manifest.get("kind") or FULL_BACKUP_KIND,
    }


def list_backups() -> list[dict]:
    ensure_backup_root()
    backups = []
    for backup_path in sorted(BACKUP_ROOT.glob("backup_*.zip"), reverse=True):
        backups.append(get_backup_info(backup_path))
    return backups


def delete_backup(backup_id: str) -> list[dict]:
    if not BACKUP_ID_PATTERN.match(backup_id):
        raise FileNotFoundError("Backup not found.")
    backup_path = get_backup_path(backup_id)
    if not backup_path.exists():
        raise FileNotFoundError("Backup not found.")
    backup_path.unlink()
    return list_backups()


def restore_full_backup(backup_id: str) -> dict:
    if not BACKUP_ID_PATTERN.match(backup_id):
        raise FileNotFoundError("Backup not found.")

    backup_path = get_backup_path(backup_id)
    if not backup_path.exists():
        raise FileNotFoundError("Backup not found.")

    with zipfile.ZipFile(backup_path) as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        if manifest.get("kind") != FULL_BACKUP_KIND:
            raise ValueError("Unsupported backup format.")

        with tempfile.TemporaryDirectory(prefix="uma_restore_") as temp_dir_str:
            temp_dir = Path(temp_dir_str)
            archive.extractall(temp_dir)

            restore_roots = [
                PROJECT_ROOT / "data" / "user",
                PROJECT_ROOT / "data" / "runtime",
                PROJECT_ROOT / "data" / "raw",
                PROJECT_ROOT / "data" / "normalized",
                DIST_ROOT / "data",
                DIST_ROOT / "media",
            ]
            for destination in restore_roots:
                source = temp_dir / destination.relative_to(PROJECT_ROOT)
                if destination.exists():
                    if destination.is_dir():
                        shutil.rmtree(destination)
                    else:
                        destination.unlink()
                if source.exists():
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copytree(source, destination) if source.is_dir() else shutil.copy2(source, destination)

    return get_backup_info(backup_path)


class ReferenceRequestHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "UmamusumeReferenceHTTP/2.0"

    def end_headers(self) -> None:
        request_path = urlparse(self.path).path
        if request_path.startswith("/api/") or request_path in ("/", "/index.html", "/__health", "/__meta"):
            self.send_header("Cache-Control", "no-store")
        elif request_path.startswith("/assets/"):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        elif request_path.startswith("/media/reference/"):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        elif request_path.startswith("/data/"):
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Allow", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path

        if request_path == "/__health":
            self._send_json(
                {
                    "status": "ok",
                    "dist_exists": DIST_ROOT.exists(),
                    "reference_meta_exists": REFERENCE_META_PATH.exists(),
                    "reference_db_exists": REFERENCE_DB_PATH.exists(),
                    "user_data_exists": USER_DATA_ROOT.exists(),
                }
            )
            return

        if request_path == "/__meta":
            if not REFERENCE_META_PATH.exists():
                self._send_api_error(404, "Reference metadata not found. Run the update command first.")
                return
            meta_payload = json.loads(REFERENCE_META_PATH.read_text(encoding="utf-8-sig"))
            sqlite_meta = read_reference_database_meta(REFERENCE_DB_PATH)
            if sqlite_meta is not None:
                meta_payload["sqlite"] = sqlite_meta
            self._send_json(meta_payload)
            return

        if request_path == "/api/app/bootstrap-status":
            self._send_json(get_bootstrap_status())
            return

        if request_path == "/api/admin/jobs":
            self._send_json(list_admin_jobs())
            return

        if request_path == "/api/admin/backups":
            self._send_json({"items": list_backups()})
            return

        if request_path == "/api/profiles":
            self._send_json(load_profiles_index())
            return

        if request_path == "/api/reference":
            try:
                items = fetch_entity_listing(database_path=REFERENCE_DB_PATH)
            except FileNotFoundError:
                self._send_api_error(404, "Normalized reference data not found. Run the update command first.")
                return
            self._send_json({"items": items})
            return

        match = re.fullmatch(r"/api/reference/([a-z_]+)", request_path)
        if match:
            entity_key = match.group(1)
            try:
                self._send_json(load_reference_entity(entity_key))
            except FileNotFoundError:
                self._send_api_error(404, "Reference entity not found.")
            except ValueError:
                self._send_api_error(500, "Reference entity payload is invalid.")
            return

        match = re.fullmatch(r"/api/reference/([a-z_]+)/browse", request_path)
        if match:
            entity_key = match.group(1)
            query = parse_qs(urlparse(self.path).query)
            filters: dict[str, list[str]] = {}
            for raw_filter in query.get("filter", []):
                filter_key, separator, filter_value = raw_filter.partition(":")
                if not separator:
                    continue
                filters.setdefault(filter_key, []).append(filter_value)
            search = (query.get("q") or [None])[0]
            try:
                limit = max(1, min(200, int((query.get("limit") or ["50"])[0])))
            except ValueError:
                limit = 50
            try:
                offset = max(0, int((query.get("offset") or ["0"])[0]))
            except ValueError:
                offset = 0
            try:
                payload = fetch_browsable_entity(
                    entity_key,
                    filters=filters,
                    search=search,
                    limit=limit,
                    offset=offset,
                    database_path=REFERENCE_DB_PATH,
                )
            except KeyError:
                self._send_api_error(404, "Reference entity not found.")
                return
            except FileNotFoundError:
                self._send_api_error(404, "Normalized reference data not found. Run the update command first.")
                return
            self._send_json(payload)
            return

        match = re.fullmatch(r"/api/reference/([a-z_]+)/([^/]+)", request_path)
        if match:
            entity_key = match.group(1)
            item_id = match.group(2)
            try:
                item = fetch_reference_item(entity_key, item_id, database_path=REFERENCE_DB_PATH)
            except FileNotFoundError:
                self._send_api_error(404, "Reference entity not found.")
                return
            if item is None:
                self._send_api_error(404, "Reference item not found.")
                return
            self._send_json(item)
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/export", request_path)
        if match:
            try:
                payload, filename = export_profile_archive_bytes(match.group(1))
            except FileNotFoundError:
                self._send_api_error(404, "Profile not found.")
                return
            self._send_bytes(payload, content_type="application/zip", filename=filename)
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/legacies", request_path)
        if match:
            profile_id = match.group(1)
            if not profile_exists(profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            self._send_json(load_legacies(profile_id))
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/builds", request_path)
        if match:
            profile_id = match.group(1)
            if not profile_exists(profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            self._send_json(load_builds(profile_id))
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/legacy-view", request_path)
        if match:
            profile_id = match.group(1)
            if not profile_exists(profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            try:
                self._send_json(build_legacy_view(profile_id))
            except FileNotFoundError:
                self._send_api_error(404, "Reference data not found. Run the update command first.")
            except ValueError as exc:
                self._send_api_error(400, str(exc))
            return

        match = re.fullmatch(r"/api/admin/backups/(backup_\d{8}_\d{6}_[0-9a-f]{8})", request_path)
        if match:
            try:
                backup_path = get_backup_path(match.group(1))
                info = get_backup_info(backup_path)
                self._send_bytes(backup_path.read_bytes(), content_type="application/zip", filename=info["filename"])
            except FileNotFoundError:
                self._send_api_error(404, "Backup not found.")
            return

        roster_view_match = re.fullmatch(r"/api/profiles/(p_\d{3,})/roster-view/(characters|supports)", request_path)
        if roster_view_match:
            roster_profile_id = roster_view_match.group(1)
            entity_key = roster_view_match.group(2)
            if not profile_exists(roster_profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            try:
                self._send_json(build_roster_view(roster_profile_id, entity_key))
            except FileNotFoundError:
                self._send_api_error(404, "Reference data not found. Run the update command first.")
            except ValueError as exc:
                self._send_api_error(400, str(exc))
            return

        roster_profile_id = self._match_profile_roster_path(request_path)
        if roster_profile_id:
            if not profile_exists(roster_profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            self._send_json(load_roster(roster_profile_id))
            return

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path

        if request_path == "/api/admin/jobs/update":
            try:
                job = start_admin_job("update", lambda job: run_reference_update_job(job, force=False))
            except RuntimeError as exc:
                self._send_api_error(409, str(exc))
                return
            self._send_json(job, status=202)
            return

        if request_path == "/api/admin/jobs/backup":
            try:
                job = start_admin_job("backup", lambda _job: create_full_backup())
            except RuntimeError as exc:
                self._send_api_error(409, str(exc))
                return
            self._send_json(job, status=202)
            return

        if request_path == "/api/profiles":
            try:
                payload = self._read_json_body()
            except ValueError:
                return
            try:
                saved_index, profile = create_profile(payload.get("name"))
            except ValueError as exc:
                self._send_api_error(400, str(exc))
                return

            self._send_json(
                {
                    "profiles": saved_index,
                    "created_profile": profile,
                },
                status=201,
            )
            return

        if request_path == "/api/profiles/select":
            try:
                payload = self._read_json_body()
            except ValueError:
                return
            profile_id = str(payload.get("profile_id") or "").strip()
            try:
                index = set_last_profile(profile_id)
            except FileNotFoundError:
                self._send_api_error(404, "Profile not found.")
                return

            self._send_json(index)
            return

        if request_path == "/api/profiles/import":
            try:
                payload = self._read_binary_body()
                saved_index, profile = import_profile_archive_bytes(payload)
            except ValueError as exc:
                self._send_api_error(400, str(exc))
                return
            self._send_json(
                {
                    "profiles": saved_index,
                    "created_profile": profile,
                },
                status=201,
            )
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/legacies", request_path)
        if match:
            profile_id = match.group(1)
            if not profile_exists(profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            try:
                payload = self._read_json_body()
                result = create_legacy_entry(profile_id, payload)
            except ValueError as exc:
                self._send_api_error(400, str(exc))
                return
            self._send_json(result, status=201)
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/builds", request_path)
        if match:
            profile_id = match.group(1)
            if not profile_exists(profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            try:
                payload = self._read_json_body()
                result = create_build_entry(profile_id, payload)
            except ValueError as exc:
                self._send_api_error(400, str(exc))
                return
            self._send_json(result, status=201)
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/legacy-simulator/preview", request_path)
        if match:
            profile_id = match.group(1)
            if not profile_exists(profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            try:
                payload = self._read_json_body()
                preview = build_legacy_simulator_preview(profile_id, payload)
            except ValueError as exc:
                self._send_api_error(400, str(exc))
                return
            self._send_json(preview)
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/import", request_path)
        if match:
            try:
                payload = self._read_binary_body()
                saved_index, profile = import_profile_archive_bytes(payload, target_profile_id=match.group(1))
            except FileNotFoundError:
                self._send_api_error(404, "Profile not found.")
                return
            except ValueError as exc:
                self._send_api_error(400, str(exc))
                return
            self._send_json(
                {
                    "profiles": saved_index,
                    "profile": profile,
                },
                status=200,
            )
            return

        match = re.fullmatch(r"/api/admin/backups/(backup_\d{8}_\d{6}_[0-9a-f]{8})/restore", request_path)
        if match:
            backup_id = match.group(1)
            try:
                get_backup_info(get_backup_path(backup_id))
            except FileNotFoundError:
                self._send_api_error(404, "Backup not found.")
                return
            try:
                job = start_admin_job("restore", lambda _job: restore_full_backup(backup_id))
            except RuntimeError as exc:
                self._send_api_error(409, str(exc))
                return
            self._send_json(job, status=202)
            return

        self._send_api_error(404, "API route not found.")

    def do_PUT(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        roster_profile_id = self._match_profile_roster_path(request_path)
        if not roster_profile_id:
            self._send_api_error(404, "API route not found.")
            return

        if not profile_exists(roster_profile_id):
            self._send_api_error(404, "Profile not found.")
            return

        try:
            payload = self._read_json_body()
        except ValueError:
            return
        try:
            saved_roster = save_roster(roster_profile_id, payload)
        except ValueError as exc:
            self._send_api_error(400, str(exc))
            return

        self._send_json(saved_roster)

    def do_PATCH(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/legacies/(legacy_\d{3,})", request_path)
        if match:
            profile_id = match.group(1)
            legacy_id = match.group(2)
            if not profile_exists(profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            try:
                payload = self._read_json_body()
                result = update_legacy_entry(profile_id, legacy_id, payload)
            except FileNotFoundError:
                self._send_api_error(404, "Legacy entry not found.")
                return
            except ValueError as exc:
                self._send_api_error(400, str(exc))
                return
            self._send_json(result)
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/builds/(build_\d{3,})", request_path)
        if match:
            profile_id = match.group(1)
            build_id = match.group(2)
            if not profile_exists(profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            try:
                payload = self._read_json_body()
                result = update_build_entry(profile_id, build_id, payload)
            except FileNotFoundError:
                self._send_api_error(404, "Build not found.")
                return
            except ValueError as exc:
                self._send_api_error(400, str(exc))
                return
            self._send_json(result)
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})", request_path)
        if not match:
            self._send_api_error(404, "API route not found.")
            return

        try:
            payload = self._read_json_body()
        except ValueError:
            return

        try:
            index, profile = rename_profile(match.group(1), payload.get("name"))
        except FileNotFoundError:
            self._send_api_error(404, "Profile not found.")
            return
        except ValueError as exc:
            self._send_api_error(400, str(exc))
            return

        self._send_json({"profiles": index, "profile": profile})

    def do_DELETE(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        match = re.fullmatch(r"/api/admin/backups/(backup_\d{8}_\d{6}_[0-9a-f]{8})", request_path)
        if match:
            try:
                items = delete_backup(match.group(1))
            except FileNotFoundError:
                self._send_api_error(404, "Backup not found.")
                return
            self._send_json({"items": items})
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/legacies/(legacy_\d{3,})", request_path)
        if match:
            profile_id = match.group(1)
            legacy_id = match.group(2)
            if not profile_exists(profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            try:
                document = delete_legacy_entry(profile_id, legacy_id)
            except FileNotFoundError:
                self._send_api_error(404, "Legacy entry not found.")
                return
            self._send_json(document)
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/builds/(build_\d{3,})", request_path)
        if match:
            profile_id = match.group(1)
            build_id = match.group(2)
            if not profile_exists(profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            try:
                document = delete_build_entry(profile_id, build_id)
            except FileNotFoundError:
                self._send_api_error(404, "Build not found.")
                return
            self._send_json(document)
            return

        match = re.fullmatch(r"/api/profiles/(p_\d{3,})", request_path)
        if not match:
            self._send_api_error(404, "API route not found.")
            return

        try:
            index = delete_profile(match.group(1))
        except FileNotFoundError:
            self._send_api_error(404, "Profile not found.")
            return

        self._send_json(index)

    def list_directory(self, path: str):  # type: ignore[override]
        self.send_error(403, "Directory listing is disabled.")
        return None

    def _read_json_body(self) -> dict:
        content_length = self.headers.get("Content-Length")
        if not content_length:
            return {}

        try:
            raw_body = self.rfile.read(int(content_length))
        except (TypeError, ValueError):
            self._send_api_error(400, "Invalid request body.")
            raise ValueError("invalid-body") from None

        if not raw_body:
            return {}

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_api_error(400, "Request body must be valid JSON.")
            raise ValueError("invalid-json") from None

        if not isinstance(payload, dict):
            self._send_api_error(400, "Request body must be a JSON object.")
            raise ValueError("invalid-object") from None

        return payload

    def _read_binary_body(self) -> bytes:
        content_length = self.headers.get("Content-Length")
        if not content_length:
            self._send_api_error(400, "Request body is required.")
            raise ValueError("missing-body")

        try:
            raw_body = self.rfile.read(int(content_length))
        except (TypeError, ValueError):
            self._send_api_error(400, "Invalid request body.")
            raise ValueError("invalid-body") from None

        if not raw_body:
            self._send_api_error(400, "Request body is required.")
            raise ValueError("empty-body")

        return raw_body

    def _match_profile_roster_path(self, request_path: str) -> str | None:
        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/roster", request_path)
        if not match:
            return None
        return match.group(1)

    def _send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, payload: bytes, *, content_type: str, filename: str | None = None, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(payload)

    def _send_api_error(self, status: int, message: str) -> None:
        self._send_json({"error": message}, status=status)


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve the generated local reference bundle over HTTP for browser compatibility."
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host interface to bind. Default: 127.0.0.1",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="TCP port to bind. Default: 8000",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="Open the local reference in the default browser after the server starts.",
    )
    parser.add_argument(
        "--update-first",
        action="store_true",
        help="Run the reference update pipeline before starting the server.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.update_first:
        print("Running local reference update before starting the server...")
        summary = update_umamusume_reference(force=False)
        print("")
        print("Update complete.")
        print(f"Raw datasets synced : {summary['rawDatasetCount']}")
        print(f"Normalized entities : {summary['normalizedEntityCount']}")
        print(f"Visual assets       : {summary['assetCount']}")
        print(f"Asset failures      : {summary['assetFailureCount']}")
        print(f"Reference DB        : {summary['referenceDbPath']}")
        print(f"App output          : {summary['appEntry']}")
        print("")

    if not DIST_ROOT.exists():
        print("Missing dist/ bundle. Run `python ./scripts/update_reference.py` first.", file=sys.stderr)
        return 1

    ensure_user_data_roots()
    handler = functools.partial(ReferenceRequestHandler, directory=str(DIST_ROOT))

    try:
        httpd = ThreadingTCPServer((args.host, args.port), handler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(
                f"Port {args.port} is already in use on {args.host}. "
                "Choose another port with `--port`.",
                file=sys.stderr,
            )
            return 1
        raise

    with httpd:
        url = f"http://{args.host}:{args.port}/"
        print(f"Serving local reference at {url}")
        print(f"Health endpoint: {url}__health")
        print(f"Metadata endpoint: {url}__meta")
        print(f"Profiles endpoint: {url}api/profiles")
        print("Press Ctrl+C to stop.")

        if args.open:
            webbrowser.open(url)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
