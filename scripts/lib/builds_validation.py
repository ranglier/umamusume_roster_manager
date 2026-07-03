from __future__ import annotations

import re

from lib.legacy_factors import LEGACY_ID_PATTERN


def normalize_build_id_list(value: object, *, field_name: str, max_items: int = 32) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list.")

    normalized: list[str] = []
    for entry in value:
        entry_id = str(entry or "").strip()
        if not entry_id:
            continue
        if len(entry_id) > 96:
            raise ValueError(f"{field_name} entries are too long.")
        if entry_id not in normalized:
            normalized.append(entry_id)
        if len(normalized) > max_items:
            raise ValueError(f"{field_name} has too many entries.")
    return normalized


def normalize_build_stats(value: object) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("build.target_stats must be an object.")

    normalized: dict[str, int] = {}
    for key in ("speed", "stamina", "power", "guts", "wit"):
        if key not in value:
            continue
        stat_value = value[key]
        if not isinstance(stat_value, int) or stat_value < 0 or stat_value > 2500:
            raise ValueError(f"build.target_stats.{key} must be an integer between 0 and 2500.")
        normalized[key] = stat_value
    return normalized


def normalize_build_aptitudes(value: object) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("build.target_aptitudes must be an object.")

    normalized: dict[str, str] = {}
    valid_grades = {"S", "A", "B", "C", "D", "E", "F", "G"}
    for key in ("surface", "distance", "style"):
        if key not in value:
            continue
        grade = str(value.get(key) or "").strip().upper()
        if grade not in valid_grades:
            raise ValueError(f"build.target_aptitudes.{key} must be a grade from S to G.")
        normalized[key] = grade
    return normalized


def normalize_build_legacy_pair(value: object) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("build.legacy_pair must be an object.")

    normalized: dict[str, str] = {}
    for key in ("parent_a", "parent_b"):
        legacy_id = str(value.get(key) or "").strip()
        if not legacy_id:
            continue
        if not LEGACY_ID_PATTERN.match(legacy_id):
            raise ValueError(f"build.legacy_pair.{key} must be a legacy id.")
        normalized[key] = legacy_id
    if normalized.get("parent_a") and normalized.get("parent_a") == normalized.get("parent_b"):
        raise ValueError("build.legacy_pair parents must be different.")
    return normalized


def next_build_id(entries: list[dict]) -> str:
    next_number = 1
    for entry in entries:
        match = re.match(r"^build_(\d+)$", str(entry.get("id") or ""))
        if match:
            next_number = max(next_number, int(match.group(1)) + 1)
    return f"build_{next_number:03d}"
