from __future__ import annotations

from datetime import datetime, timezone


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_string_list(value: object, *, field_name: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list of strings.")

    normalized: list[str] = []
    for entry in value:
        if not isinstance(entry, str):
            raise ValueError(f"{field_name} must be a list of strings.")
        cleaned = entry.strip()
        if not cleaned:
            continue
        if len(cleaned) > 64:
            raise ValueError(f"{field_name} entries are too long.")
        if cleaned not in normalized:
            normalized.append(cleaned)
    return normalized


def clamp_int(value: object, minimum: int, maximum: int, fallback: int) -> int:
    if not isinstance(value, int):
        return fallback
    return max(minimum, min(maximum, value))
