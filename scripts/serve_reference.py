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
from urllib.parse import urlparse

from lib.gametora_reference import update_umamusume_reference
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
LEGACY_ID_PATTERN = re.compile(r"^legacy_\d{3,}$")
BACKUP_ID_PATTERN = re.compile(r"^backup_\d{8}_\d{6}_[0-9a-f]{8}$")
PROFILE_EXPORT_KIND = "umamusume-profile-export"
FULL_BACKUP_KIND = "umamusume-full-backup"
ADMIN_JOB_HISTORY_LIMIT = 12
SUPPORT_STAGE_LEVELS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
SUPPORT_BASE_CAP_BY_RARITY = {1: 20, 2: 25, 3: 30}
LEGACY_STAT_LABELS = {
    "speed": "Speed",
    "stamina": "Stamina",
    "power": "Power",
    "guts": "Guts",
    "wit": "Wit",
}
LEGACY_SURFACE_LABELS = {
    "turf": "Turf",
    "dirt": "Dirt",
}
LEGACY_DISTANCE_LABELS = {
    "short": "Short",
    "mile": "Mile",
    "medium": "Medium",
    "long": "Long",
}
LEGACY_STYLE_LABELS = {
    "runner": "Front",
    "leader": "Pace",
    "betweener": "Late",
    "chaser": "End",
}
LEGACY_FACTOR_KIND_LABELS = {
    "stat": "Stat",
    "surface": "Surface",
    "distance": "Distance",
    "style": "Style",
    "unique": "Unique",
    "scenario": "Scenario",
    "g1": "G1",
    "skill": "Skill",
}

JOB_LOCK = threading.Lock()
ACTIVE_ADMIN_JOB: dict | None = None
ADMIN_JOB_HISTORY: list[dict] = []


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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
        "version": 2,
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


def load_reference_items_lookup(entity_key: str) -> dict[str, dict]:
    payload = load_reference_entity(entity_key)
    return {
        str(item.get("id")): item
        for item in payload.get("items", [])
        if isinstance(item, dict) and str(item.get("id") or "").strip()
    }


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


def get_support_level_cap(rarity: int, limit_break: int) -> int:
    base_cap = SUPPORT_BASE_CAP_BY_RARITY.get(rarity, 30)
    return min(50, base_cap + (max(0, min(4, limit_break)) * 5))


def build_character_progression_lookup() -> dict[str, dict]:
    try:
        return load_reference_items_lookup("character_progression")
    except (FileNotFoundError, ValueError):
        return {}


def build_support_progression_lookup() -> dict[int, dict]:
    lookup: dict[int, dict] = {}
    try:
        items = load_reference_entity("support_progression").get("items", [])
    except (FileNotFoundError, ValueError):
        return lookup

    for item in items:
        if not isinstance(item, dict):
            continue
        rarity = int(item.get("rarity") or 0)
        if rarity > 0:
            lookup[rarity] = item
    return lookup


def get_support_curve_progress(progression_item: dict | None, level: int, cap: int) -> dict:
    levels = progression_item.get("levels") if isinstance(progression_item, dict) else []
    total_exp_by_level = {
        int(entry.get("level") or 0): int(entry.get("total_exp") or 0)
        for entry in levels or []
        if isinstance(entry, dict)
    }
    effective_level = max(1, min(level, cap))
    return {
        "level": effective_level,
        "cap": cap,
        "total_exp": total_exp_by_level.get(effective_level),
        "cap_total_exp": total_exp_by_level.get(cap),
    }


def summarize_character_progression(entry: dict, detail: dict, progression: dict | None) -> dict:
    awakening_skills = list((detail.get("skill_links") or {}).get("awakening") or [])
    awakening_level = clamp_int(entry.get("awakening"), 0, 5, 0)
    unlocked_count = max(0, min(len(awakening_skills), awakening_level - 1))
    unlocked_skills = awakening_skills[:unlocked_count]
    locked_skills = awakening_skills[unlocked_count:]
    awakening_levels = list((progression or {}).get("awakening_levels") or [])
    unlocked_levels = [level for level in awakening_levels if int(level.get("awakening_level") or 0) <= awakening_level]
    locked_levels = [level for level in awakening_levels if int(level.get("awakening_level") or 0) > awakening_level]

    if awakening_level >= 5 and int(entry.get("stars") or 0) >= 5:
        progress_bucket = "maxed"
    elif awakening_level >= 4 or int(entry.get("stars") or 0) >= 4:
        progress_bucket = "advanced"
    elif awakening_level >= 2 or int(entry.get("stars") or 0) >= 3:
        progress_bucket = "started"
    else:
        progress_bucket = "base"

    unlock_state = "full" if locked_skills == [] and awakening_skills else "partial" if unlocked_skills else "none"
    return {
        "stars": int(entry.get("stars") or 0),
        "awakening": awakening_level,
        "unique_level": int(entry.get("unique_level") or 1),
        "custom_tags": list(entry.get("custom_tags") or []),
        "status_flags": list(entry.get("status_flags") or []),
        "progress_bucket": progress_bucket,
        "unlock_state": unlock_state,
        "unlocked_skill_nodes": unlocked_count,
        "unlocked_awakening_skills": unlocked_skills,
        "locked_awakening_skills": locked_skills,
        "unlocked_awakening_levels": unlocked_levels,
        "locked_awakening_levels": locked_levels,
    }


def resolve_support_effect_value(effect: dict, effective_level: int) -> dict:
    current_value = None
    current_stage_index = 0
    max_stage_index = 0
    current_unlock_level = None
    next_unlock_level = None
    for value_entry in effect.get("values") or []:
        if not isinstance(value_entry, dict):
            continue
        stage_index = int(value_entry.get("stage_index") or 0)
        max_stage_index = max(max_stage_index, stage_index)
        threshold = SUPPORT_STAGE_LEVELS[min(max(stage_index, 1), len(SUPPORT_STAGE_LEVELS)) - 1]
        if effective_level >= threshold:
            current_value = value_entry.get("value")
            current_stage_index = stage_index
            current_unlock_level = threshold
        elif next_unlock_level is None:
            next_unlock_level = threshold
    return {
        "effect_id": effect.get("effect_id"),
        "name": effect.get("name"),
        "description": effect.get("description"),
        "symbol": effect.get("symbol"),
        "current_value": current_value,
        "max_value": effect.get("max_value"),
        "current_stage_index": current_stage_index,
        "max_stage_index": max_stage_index,
        "current_unlock_level": current_unlock_level,
        "next_unlock_level": next_unlock_level,
    }


def summarize_support_progression(entry: dict, detail: dict, progression: dict | None) -> dict:
    rarity = int(detail.get("rarity") or 0)
    limit_break = clamp_int(entry.get("limit_break"), 0, 4, 0)
    cap = get_support_level_cap(rarity, limit_break)
    level = clamp_int(entry.get("level"), 1, cap, 1)
    curve_progress = get_support_curve_progress(progression, level, cap)
    effective_effects = [resolve_support_effect_value(effect, curve_progress["level"]) for effect in (detail.get("effects") or [])]
    unique_unlock_level = detail.get("unique_effect_unlock_level")
    unique_effects = []
    for effect in detail.get("unique_effects") or []:
        unique_effects.append(
            {
                "effect_id": effect.get("effect_id"),
                "name": effect.get("name"),
                "description": effect.get("description"),
                "value": effect.get("value"),
                "unlocked": bool(unique_unlock_level is None or curve_progress["level"] >= int(unique_unlock_level)),
            }
        )

    level_ratio = curve_progress["level"] / max(1, cap)
    if curve_progress["level"] >= cap:
        progress_bucket = "maxed"
    elif level_ratio >= 0.75:
        progress_bucket = "usable"
    elif level_ratio >= 0.4:
        progress_bucket = "developing"
    else:
        progress_bucket = "starter"

    return {
        "level": curve_progress["level"],
        "limit_break": limit_break,
        "level_cap": cap,
        "rarity_max_level": int((progression or {}).get("max_level") or cap),
        "total_exp": curve_progress["total_exp"],
        "cap_total_exp": curve_progress["cap_total_exp"],
        "progress_bucket": progress_bucket,
        "usable": progress_bucket in {"usable", "maxed"},
        "custom_tags": list(entry.get("custom_tags") or []),
        "status_flags": list(entry.get("status_flags") or []),
        "effective_effects": effective_effects,
        "effective_unique_effects": unique_effects,
        "available_hint_skills": list(detail.get("hint_skills") or []),
        "available_event_skills": list(detail.get("event_skills") or []),
    }


def build_roster_view(profile_id: str, entity_key: str) -> dict:
    if entity_key not in {"characters", "supports"}:
        raise ValueError("Unsupported roster entity.")

    roster = load_roster(profile_id)
    reference_lookup = load_reference_items_lookup(entity_key)
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


def get_character_detail(character_ref: dict | None) -> dict:
    if not isinstance(character_ref, dict):
        return {}
    detail = character_ref.get("detail")
    if isinstance(detail, dict):
        return detail
    return character_ref


def get_character_unique_skill(character_ref: dict | None) -> dict | None:
    detail = get_character_detail(character_ref)
    unique_skills = (detail.get("skill_links") or {}).get("unique") or []
    unique_skill = unique_skills[0] if unique_skills else None
    if not isinstance(unique_skill, dict):
        return None

    unique_id = str(unique_skill.get("id") or "").strip()
    if not unique_id:
        return None

    return {
        "id": unique_id,
        "name": str(unique_skill.get("name") or unique_id),
        "rarity": int(unique_skill.get("rarity") or 0),
        "cost": unique_skill.get("cost"),
    }


def character_supports_green_spark(character_ref: dict | None) -> bool:
    detail = get_character_detail(character_ref)
    return int(detail.get("rarity") or 0) >= 3 and get_character_unique_skill(character_ref) is not None


def legacy_factor_label(kind: str, target_key: str, target_label: str | None = None) -> str:
    if target_label:
        return str(target_label)
    if kind == "stat":
        return LEGACY_STAT_LABELS.get(target_key, target_key)
    if kind == "surface":
        return LEGACY_SURFACE_LABELS.get(target_key, target_key)
    if kind == "distance":
        return LEGACY_DISTANCE_LABELS.get(target_key, target_key)
    if kind == "style":
        return LEGACY_STYLE_LABELS.get(target_key, target_key)
    return target_key


def build_legacy_reference_catalogs() -> dict:
    characters = load_reference_items_lookup("characters")
    scenarios = load_reference_items_lookup("scenarios")
    g1_factors = load_reference_items_lookup("g1_factors")
    skills = load_reference_items_lookup("skills")
    compatibility_items = load_reference_entity("compatibility").get("items", [])
    compatibility = {
        str(item.get("character_id")): item
        for item in compatibility_items
        if isinstance(item, dict) and str(item.get("character_id") or "").strip()
    }

    return {
        "characters": characters,
        "scenarios": scenarios,
        "g1_factors": g1_factors,
        "skills": skills,
        "compatibility": compatibility,
    }


def normalize_legacy_factor(raw_factor: object, catalogs: dict, *, character_ref: dict | None = None) -> dict:
    if not isinstance(raw_factor, dict):
        raise ValueError("legacy.factors entries must be objects.")

    kind = str(raw_factor.get("kind") or "").strip().lower()
    if kind not in LEGACY_FACTOR_KIND_LABELS:
        raise ValueError("legacy factor kind is invalid.")

    stars = raw_factor.get("stars")
    if not isinstance(stars, int) or stars < 1 or stars > 3:
        raise ValueError("legacy factor stars must be an integer between 1 and 3.")

    target_key = str(raw_factor.get("target_key") or "").strip()
    target_label = str(raw_factor.get("target_label") or "").strip()
    race_id = str(raw_factor.get("race_id") or "").strip() or None
    scenario_id = str(raw_factor.get("scenario_id") or "").strip() or None
    skill_id = str(raw_factor.get("skill_id") or "").strip() or None

    if kind == "stat":
        if target_key not in LEGACY_STAT_LABELS:
            raise ValueError("legacy stat factor target is invalid.")
        target_label = LEGACY_STAT_LABELS[target_key]
    elif kind == "surface":
        if target_key not in LEGACY_SURFACE_LABELS:
            raise ValueError("legacy surface factor target is invalid.")
        target_label = LEGACY_SURFACE_LABELS[target_key]
    elif kind == "distance":
        if target_key not in LEGACY_DISTANCE_LABELS:
            raise ValueError("legacy distance factor target is invalid.")
        target_label = LEGACY_DISTANCE_LABELS[target_key]
    elif kind == "style":
        if target_key not in LEGACY_STYLE_LABELS:
            raise ValueError("legacy style factor target is invalid.")
        target_label = LEGACY_STYLE_LABELS[target_key]
    elif kind == "unique":
        unique_skill = get_character_unique_skill(character_ref)
        if unique_skill is None:
            raise ValueError("legacy unique factor target is invalid.")
        unique_skill_id = str(unique_skill.get("id") or "")
        if (target_key and target_key != unique_skill_id) or (skill_id and skill_id != unique_skill_id):
            raise ValueError("legacy unique factor target is invalid.")
        target_key = unique_skill_id
        skill_id = unique_skill_id
        target_label = str(unique_skill.get("name") or unique_skill_id)
    elif kind == "scenario":
        scenario_ref = catalogs["scenarios"].get(scenario_id or target_key)
        if scenario_ref is None:
            raise ValueError("legacy scenario factor target is invalid.")
        target_key = str(scenario_ref.get("scenario_id") or scenario_ref.get("id"))
        scenario_id = target_key
        target_label = str(scenario_ref.get("name") or target_label or target_key)
    elif kind == "g1":
        factor_ref = catalogs["g1_factors"].get(target_key)
        if factor_ref is None and race_id:
            factor_ref = next(
                (item for item in catalogs["g1_factors"].values() if str(item.get("race_id") or "") == race_id),
                None,
            )
        if factor_ref is None:
            raise ValueError("legacy G1 factor target is invalid.")
        target_key = str(factor_ref.get("factor_id") or factor_ref.get("id"))
        target_label = str(factor_ref.get("name") or target_label or target_key)
        race_id = str(factor_ref.get("race_id") or race_id or "") or None
    elif kind == "skill":
        skill_ref = catalogs["skills"].get(skill_id or target_key)
        if skill_ref is None:
            raise ValueError("legacy skill factor target is invalid.")
        skill_id = str(skill_ref.get("skill_id") or skill_ref.get("id"))
        target_key = skill_id
        target_label = str(skill_ref.get("name") or target_label or target_key)

    if not target_key:
        raise ValueError("legacy factor target is required.")

    return {
        "kind": kind,
        "target_key": target_key,
        "target_label": legacy_factor_label(kind, target_key, target_label),
        "stars": stars,
        "race_id": race_id,
        "scenario_id": scenario_id,
        "skill_id": skill_id,
    }


def build_legacy_factor(
    kind: str,
    target_key: str,
    stars: int,
    catalogs: dict,
    *,
    character_ref: dict | None = None,
    target_label: str | None = None,
    race_id: str | None = None,
    scenario_id: str | None = None,
    skill_id: str | None = None,
) -> dict:
    return normalize_legacy_factor(
        {
            "kind": kind,
            "target_key": target_key,
            "target_label": target_label,
            "stars": stars,
            "race_id": race_id,
            "scenario_id": scenario_id,
            "skill_id": skill_id,
        },
        catalogs,
        character_ref=character_ref,
    )


def dedupe_legacy_factors(factors: list[dict]) -> list[dict]:
    deduped: dict[tuple[str, str], dict] = {}
    for factor in factors:
        factor_key = (str(factor.get("kind") or ""), str(factor.get("target_key") or ""))
        current = deduped.get(factor_key)
        if current is None or int(factor.get("stars") or 0) > int(current.get("stars") or 0):
            deduped[factor_key] = factor
    return sorted(
        deduped.values(),
        key=lambda factor: (
            str(factor.get("kind") or ""),
            str(factor.get("target_label") or factor.get("target_key") or ""),
        ),
    )


def dedupe_legacy_white_sparks(sparks: list[dict]) -> list[dict]:
    return dedupe_legacy_factors(
        [
            spark
            for spark in sparks
            if str(spark.get("kind") or "") in {"scenario", "g1", "skill"}
        ]
    )


def normalize_blue_spark(raw_spark: object, catalogs: dict, *, character_ref: dict | None = None) -> dict | None:
    if raw_spark in (None, ""):
        return None
    spark = normalize_legacy_factor(raw_spark, catalogs, character_ref=character_ref)
    if spark.get("kind") != "stat":
        raise ValueError("legacy blue spark must be a stat spark.")
    return spark


def normalize_pink_spark(raw_spark: object, catalogs: dict, *, character_ref: dict | None = None) -> dict | None:
    if raw_spark in (None, ""):
        return None
    spark = normalize_legacy_factor(raw_spark, catalogs, character_ref=character_ref)
    if spark.get("kind") not in {"surface", "distance", "style"}:
        raise ValueError("legacy pink spark must be a surface, distance or style spark.")
    return spark


def normalize_green_spark(raw_spark: object, catalogs: dict, *, character_ref: dict | None = None) -> dict | None:
    if raw_spark in (None, ""):
        return None
    if not character_supports_green_spark(character_ref):
        raise ValueError("legacy green spark is unavailable for this parent.")
    spark = normalize_legacy_factor(raw_spark, catalogs, character_ref=character_ref)
    if spark.get("kind") != "unique":
        raise ValueError("legacy green spark must be the parent unique skill.")
    return spark


def normalize_white_sparks(raw_sparks: object, catalogs: dict, *, character_ref: dict | None = None) -> list[dict]:
    if raw_sparks in (None, ""):
        return []
    if not isinstance(raw_sparks, list):
        raise ValueError("legacy.white_sparks must be a list.")

    normalized = []
    for raw_spark in raw_sparks:
        spark = normalize_legacy_factor(raw_spark, catalogs, character_ref=character_ref)
        if spark.get("kind") not in {"scenario", "g1", "skill"}:
            raise ValueError("legacy white sparks only support scenario, G1 or skill sparks.")
        normalized.append(spark)
    return dedupe_legacy_white_sparks(normalized)


def migrate_legacy_sparks_from_factors(raw_factors: object, catalogs: dict, *, character_ref: dict | None = None) -> tuple[dict | None, dict | None, dict | None, list[dict]]:
    normalized_factors = dedupe_legacy_factors(
        [
            normalize_legacy_factor(raw_factor, catalogs, character_ref=character_ref)
            for raw_factor in (raw_factors or [])
        ]
    )

    blue_spark = next((factor for factor in normalized_factors if factor.get("kind") == "stat"), None)
    pink_spark = next((factor for factor in normalized_factors if factor.get("kind") in {"surface", "distance", "style"}), None)

    unique_skill = get_character_unique_skill(character_ref)
    green_spark = None
    white_sparks: list[dict] = []
    for factor in normalized_factors:
        kind = str(factor.get("kind") or "")
        if blue_spark is not None and factor is blue_spark:
            continue
        if pink_spark is not None and factor is pink_spark:
            continue
        if (
            kind == "skill"
            and unique_skill is not None
            and character_supports_green_spark(character_ref)
            and str(factor.get("target_key") or factor.get("skill_id") or "") == str(unique_skill.get("id") or "")
            and green_spark is None
        ):
            green_spark = build_legacy_factor(
                "unique",
                str(unique_skill.get("id") or ""),
                int(factor.get("stars") or 3),
                catalogs,
                character_ref=character_ref,
            )
            continue
        if kind in {"scenario", "g1", "skill"}:
            white_sparks.append(factor)

    return blue_spark, pink_spark, green_spark, dedupe_legacy_white_sparks(white_sparks)


def legacy_entry_to_factors(entry: dict) -> list[dict]:
    factors = []
    for key in ("blue_spark", "pink_spark", "green_spark"):
        spark = entry.get(key)
        if isinstance(spark, dict):
            factors.append(spark)
    factors.extend([spark for spark in (entry.get("white_sparks") or []) if isinstance(spark, dict)])
    return dedupe_legacy_factors(factors)


def build_legacy_spark_summary(entry: dict) -> dict:
    blue_spark = entry.get("blue_spark") if isinstance(entry.get("blue_spark"), dict) else None
    pink_spark = entry.get("pink_spark") if isinstance(entry.get("pink_spark"), dict) else None
    green_spark = entry.get("green_spark") if isinstance(entry.get("green_spark"), dict) else None
    white_sparks = [spark for spark in (entry.get("white_sparks") or []) if isinstance(spark, dict)]
    return {
        "blue": blue_spark,
        "pink": pink_spark,
        "green": green_spark,
        "white": white_sparks,
        "white_count": len(white_sparks),
        "green_available": bool(entry.get("green_available")),
    }


def normalize_legacy_entry(raw_entry: object, catalogs: dict, *, existing_id: str | None = None, strict_sparks: bool = False) -> dict:
    if not isinstance(raw_entry, dict):
        raise ValueError("legacy entry must be an object.")

    entry_id = str(raw_entry.get("id") or existing_id or "").strip()
    if entry_id and not LEGACY_ID_PATTERN.match(entry_id):
        raise ValueError("legacy id is invalid.")

    character_card_id = str(raw_entry.get("character_card_id") or "").strip()
    character_ref = catalogs["characters"].get(character_card_id)
    if character_ref is None:
        raise ValueError("legacy character_card_id is invalid.")

    scenario_id = str(raw_entry.get("scenario_id") or "").strip()
    scenario_ref = catalogs["scenarios"].get(scenario_id) if scenario_id else None
    scenario_name = str(raw_entry.get("scenario_name") or "").strip()
    if scenario_ref is not None:
        scenario_id = str(scenario_ref.get("scenario_id") or scenario_ref.get("id"))
        scenario_name = str(scenario_ref.get("name") or scenario_name or scenario_id)
    else:
        scenario_id = ""
        scenario_name = ""

    detail = get_character_detail(character_ref)
    name = str(detail.get("name") or raw_entry.get("name") or "").strip()
    variant = str(detail.get("variant") or raw_entry.get("variant") or "").strip()
    base_character_id = int(detail.get("base_character_id") or raw_entry.get("base_character_id") or 0)

    source_date = str(raw_entry.get("source_date") or "").strip()
    note = str(raw_entry.get("note") or "")
    source_note = str(raw_entry.get("source_note") or "")
    if len(note) > 2000 or len(source_note) > 2000:
        raise ValueError("legacy notes are too long.")
    if len(source_date) > 80:
        raise ValueError("legacy source_date is too long.")

    stars = clamp_int(raw_entry.get("stars"), 0, 5, int(detail.get("rarity") or 0))
    awakening = clamp_int(raw_entry.get("awakening"), 0, 5, 0)
    green_available = character_supports_green_spark(character_ref)

    has_structured_sparks = any(
        key in raw_entry
        for key in ("blue_spark", "pink_spark", "green_spark", "white_sparks")
    )
    if has_structured_sparks:
        blue_spark = normalize_blue_spark(raw_entry.get("blue_spark"), catalogs, character_ref=character_ref)
        pink_spark = normalize_pink_spark(raw_entry.get("pink_spark"), catalogs, character_ref=character_ref)
        green_spark = normalize_green_spark(raw_entry.get("green_spark"), catalogs, character_ref=character_ref) if green_available else None
        white_sparks = normalize_white_sparks(raw_entry.get("white_sparks"), catalogs, character_ref=character_ref)
    else:
        blue_spark, pink_spark, green_spark, white_sparks = migrate_legacy_sparks_from_factors(
            raw_entry.get("factors"),
            catalogs,
            character_ref=character_ref,
        )

    if strict_sparks:
        if blue_spark is None:
            raise ValueError("legacy blue spark is required.")
        if pink_spark is None:
            raise ValueError("legacy pink spark is required.")

    factors = legacy_entry_to_factors(
        {
            "blue_spark": blue_spark,
            "pink_spark": pink_spark,
            "green_spark": green_spark if green_available else None,
            "white_sparks": white_sparks,
        }
    )

    return {
        "id": entry_id or None,
        "character_card_id": character_card_id,
        "base_character_id": base_character_id,
        "name": name,
        "variant": variant,
        "scenario_id": scenario_id or None,
        "scenario_name": scenario_name or None,
        "source_date": source_date or None,
        "created_at": str(raw_entry.get("created_at") or utc_timestamp()),
        "updated_at": utc_timestamp(),
        "stars": stars,
        "awakening": awakening,
        "custom_tags": normalize_string_list(raw_entry.get("custom_tags"), field_name="legacy.custom_tags"),
        "status_flags": normalize_string_list(raw_entry.get("status_flags"), field_name="legacy.status_flags"),
        "note": note,
        "source_note": source_note,
        "green_available": green_available,
        "blue_spark": blue_spark,
        "pink_spark": pink_spark,
        "green_spark": green_spark if green_available else None,
        "white_sparks": white_sparks,
        "factors": factors,
    }


def next_legacy_id(entries: list[dict]) -> str:
    next_number = 1
    for entry in entries:
        match = re.match(r"^legacy_(\d+)$", str(entry.get("id") or ""))
        if match:
            next_number = max(next_number, int(match.group(1)) + 1)
    return f"legacy_{next_number:03d}"


def normalize_legacy_document(raw_document: object) -> dict:
    document = default_legacy_document()
    if not isinstance(raw_document, dict):
        return document

    try:
        catalogs = build_legacy_reference_catalogs()
    except (FileNotFoundError, ValueError):
        return document

    entries: list[dict] = []
    for raw_entry in raw_document.get("entries") or []:
        try:
            entry = normalize_legacy_entry(
                raw_entry,
                catalogs,
                existing_id=str(raw_entry.get("id") or "").strip() or None,
                strict_sparks=False,
            )
        except ValueError:
            continue
        if not entry.get("id"):
            entry["id"] = next_legacy_id(entries)
        entries.append(entry)

    return {
        "version": 2,
        "updated_at": str(raw_document.get("updated_at") or document["updated_at"]),
        "entries": sorted(entries, key=lambda entry: str(entry.get("updated_at") or entry.get("created_at") or ""), reverse=True),
    }


def load_legacies(profile_id: str) -> dict:
    return normalize_legacy_document(read_json(profile_legacy_path(profile_id), default_legacy_document))


def save_legacies(profile_id: str, document: dict) -> dict:
    normalized = normalize_legacy_document(document)
    normalized["updated_at"] = utc_timestamp()
    atomic_write_json(profile_legacy_path(profile_id), normalized)
    return normalized


def persist_unresolved_legacies(profile_id: str, document: object) -> dict:
    raw_document = document if isinstance(document, dict) else {}
    preserved = {
        "version": 2,
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


def build_pair_compatibility(left_base_character_id: int, right_base_character_id: int, catalogs: dict) -> dict:
    compatibility_item = catalogs["compatibility"].get(str(left_base_character_id)) or {}
    shared_groups = []
    score = 0
    for group in compatibility_item.get("relation_groups") or []:
        if right_base_character_id in (group.get("other_character_ids") or []):
            relation_point = int(group.get("relation_point") or 0)
            score += relation_point
            shared_groups.append(
                {
                    "relation_type": str(group.get("relation_type") or ""),
                    "relation_point": relation_point,
                    "member_count": int(group.get("member_count") or 0),
                }
            )

    top_match = next(
        (
            match
            for match in (compatibility_item.get("top_matches") or [])
            if int(match.get("character_id") or 0) == right_base_character_id
        ),
        None,
    )
    return {
        "score": score,
        "shared_group_count": len(shared_groups),
        "shared_groups": shared_groups,
        "shared_relation_types": [group["relation_type"] for group in shared_groups],
        "shared_relation_count": int(top_match.get("shared_relation_count") or len(shared_groups)) if top_match else len(shared_groups),
    }


def summarize_legacy_factors(factors: list[dict]) -> dict:
    grouped: dict[str, list[dict]] = collections.OrderedDict()
    counts: dict[str, int] = {}
    stars_total: dict[str, int] = {}
    for kind in ("stat", "surface", "distance", "style", "unique", "scenario", "g1", "skill"):
        grouped[kind] = []

    deduped: dict[tuple[str, str], dict] = {}
    for factor in factors:
        factor_key = (str(factor.get("kind") or ""), str(factor.get("target_key") or ""))
        current = deduped.get(factor_key)
        if current is None:
            deduped[factor_key] = {**factor, "stars_total": int(factor.get("stars") or 0), "parent_ids": []}
        else:
            current["stars_total"] = int(current.get("stars_total") or 0) + int(factor.get("stars") or 0)
    for item in deduped.values():
        grouped.setdefault(item["kind"], []).append(item)

    for kind, values in grouped.items():
        values.sort(key=lambda entry: (-int(entry.get("stars_total") or 0), str(entry.get("target_label") or "")))
        counts[kind] = len(values)
        stars_total[kind] = sum(int(entry.get("stars_total") or 0) for entry in values)

    return {
        "groups": grouped,
        "counts": counts,
        "stars_total": stars_total,
    }


def build_legacy_reference_button(entity_key: str, ref_id: str | int, title: str, subtitle: str = "") -> dict:
    return {
        "entityKey": entity_key,
        "id": str(ref_id),
        "title": title,
        "subtitle": subtitle,
        "availabilityEn": "available",
    }


def build_legacy_view(profile_id: str) -> dict:
    document = load_legacies(profile_id)
    catalogs = build_legacy_reference_catalogs()
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
        scenario_label = (
            str(entry.get("scenario_name") or (scenario_ref.get("name") if scenario_ref else "") or "Unknown scenario")
            if entry.get("scenario_id")
            else "No scenario"
        )
        badges = []
        if entry.get("scenario_name"):
            badges.append(entry["scenario_name"])
        if spark_summary["blue"]:
            badges.append(f"Blue {spark_summary['blue']['target_label']} {int(spark_summary['blue'].get('stars') or 0)}\u2605")
        if spark_summary["pink"]:
            badges.append(f"Pink {spark_summary['pink']['target_label']} {int(spark_summary['pink'].get('stars') or 0)}\u2605")
        if spark_summary["green"]:
            badges.append(f"Green {spark_summary['green']['target_label']} {int(spark_summary['green'].get('stars') or 0)}\u2605")
        if spark_summary["white_count"]:
            badges.append(f"{spark_summary['white_count']} white")

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

        for factor in factors:
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
                        scenario_label,
                        " ".join(str(factor.get("target_label") or "") for factor in factors),
                        " ".join(entry.get("custom_tags") or []),
                        " ".join(entry.get("status_flags") or []),
                        str(entry.get("note") or ""),
                        str(entry.get("source_note") or ""),
                    ]
                ).strip(),
                "filters": {
                    "scenario_id": [str(entry.get("scenario_id"))] if entry.get("scenario_id") else ["none"],
                    "factor_kind": sorted({str(factor.get("kind") or "") for factor in (entry.get("factors") or []) if str(factor.get("kind") or "")}),
                    "local_tag": list(entry.get("custom_tags") or []),
                    "status_flag": list(entry.get("status_flags") or []),
                },
                "detail": {
                    "entry": entry,
                    "character_ref": linked_refs[:1],
                    "scenario_ref": linked_refs[1:2] if scenario_ref is not None else [],
                    "spark_summary": spark_summary,
                    "factor_groups": factor_summary["groups"],
                    "factor_counts": factor_summary["counts"],
                    "factor_stars_total": factor_summary["stars_total"],
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

    return {
        "profile_id": profile_id,
        "updated_at": document.get("updated_at"),
        "items": items,
        "filter_definitions": [
            {"key": "scenario_id", "label": "Scenario"},
            {"key": "factor_kind", "label": "Factor Type"},
            {"key": "local_tag", "label": "Tags"},
            {"key": "status_flag", "label": "Status"},
        ],
        "filter_options": {
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
        },
    }


def build_aptitude_coverage(main_detail: dict, factors: list[dict]) -> list[dict]:
    grouped_targets = {
        "surface": {str(factor.get("target_key")) for factor in factors if factor.get("kind") == "surface"},
        "distance": {str(factor.get("target_key")) for factor in factors if factor.get("kind") == "distance"},
        "style": {str(factor.get("target_key")) for factor in factors if factor.get("kind") == "style"},
    }
    labels = {
        "surface": LEGACY_SURFACE_LABELS,
        "distance": LEGACY_DISTANCE_LABELS,
        "style": LEGACY_STYLE_LABELS,
    }
    result = []
    viable = main_detail.get("viable_aptitudes") or {}
    for category in ("surface", "distance", "style"):
        viable_values = [str(value) for value in (viable.get(category) or [])]
        supported = [labels[category].get(value, value) for value in viable_values if value in grouped_targets[category]]
        missing = [labels[category].get(value, value) for value in viable_values if value not in grouped_targets[category]]
        result.append(
            {
                "category": category,
                "supported": supported,
                "missing": missing,
            }
        )
    return result


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

    main_to_parent_a = build_pair_compatibility(int(main_detail.get("base_character_id") or 0), int(parent_a.get("base_character_id") or 0), catalogs)
    main_to_parent_b = build_pair_compatibility(int(main_detail.get("base_character_id") or 0), int(parent_b.get("base_character_id") or 0), catalogs)
    parent_pair = build_pair_compatibility(int(parent_a.get("base_character_id") or 0), int(parent_b.get("base_character_id") or 0), catalogs)

    combined_factors = legacy_entry_to_factors(parent_a) + legacy_entry_to_factors(parent_b)
    factor_summary = summarize_legacy_factors(combined_factors)
    aptitude_coverage = build_aptitude_coverage(main_detail, combined_factors)

    highlights = []
    warnings = []
    if main_to_parent_a["score"] >= 20 and main_to_parent_b["score"] >= 20:
        highlights.append("Both parents have strong base compatibility with the main candidate.")
    if parent_pair["score"] >= 20:
        highlights.append("The two parents also share a strong compatibility basis.")
    if factor_summary["counts"].get("g1"):
        highlights.append("The pair contributes visible G1 inheritance value.")
    if factor_summary["counts"].get("scenario"):
        highlights.append("Scenario factors are present in the pair.")
    if factor_summary["counts"].get("unique"):
        highlights.append("At least one parent contributes a resolved green unique spark.")
    for coverage in aptitude_coverage:
        if coverage["missing"]:
            warnings.append(f"Missing {coverage['category']} support for: {', '.join(coverage['missing'])}.")
    if main_to_parent_a["score"] == 0 or main_to_parent_b["score"] == 0:
        warnings.append("At least one parent has no resolved compatibility points with the main candidate.")

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
        "compatibility": {
            "main_to_parent_a": main_to_parent_a,
            "main_to_parent_b": main_to_parent_b,
            "parent_pair": parent_pair,
            "main_total": int(main_to_parent_a["score"]) + int(main_to_parent_b["score"]),
        },
        "factor_summary": factor_summary,
        "aptitude_coverage": aptitude_coverage,
        "scenario_summary": factor_summary["groups"].get("scenario") or [],
        "g1_summary": factor_summary["groups"].get("g1") or [],
        "highlights": highlights,
        "warnings": warnings,
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


def profile_exists(profile_id: str) -> bool:
    return profile_id in {profile["id"] for profile in load_profiles_index()["profiles"]}


def normalize_roster_entry(entity_key: str, raw_entry: object) -> dict | None:
    if not isinstance(raw_entry, dict):
        return None

    normalized: dict[str, object] = {}

    if "owned" in raw_entry:
        if not isinstance(raw_entry["owned"], bool):
            raise ValueError(f"{entity_key}.owned must be a boolean.")
        normalized["owned"] = raw_entry["owned"]

    if "favorite" in raw_entry:
        if not isinstance(raw_entry["favorite"], bool):
            raise ValueError(f"{entity_key}.favorite must be a boolean.")
        normalized["favorite"] = raw_entry["favorite"]

    if "note" in raw_entry:
        note = raw_entry["note"]
        if not isinstance(note, str):
            raise ValueError(f"{entity_key}.note must be a string.")
        if len(note) > 2000:
            raise ValueError(f"{entity_key}.note is too long.")
        normalized["note"] = note

    if "custom_tags" in raw_entry:
        normalized["custom_tags"] = normalize_string_list(raw_entry["custom_tags"], field_name=f"{entity_key}.custom_tags")

    if "status_flags" in raw_entry:
        normalized["status_flags"] = normalize_string_list(raw_entry["status_flags"], field_name=f"{entity_key}.status_flags")

    if entity_key == "characters":
        if "stars" in raw_entry:
            stars = raw_entry["stars"]
            if not isinstance(stars, int) or stars < 0 or stars > 5:
                raise ValueError("characters.stars must be an integer between 0 and 5.")
            normalized["stars"] = stars
        if "awakening" in raw_entry:
            awakening = raw_entry["awakening"]
            if not isinstance(awakening, int) or awakening < 0 or awakening > 5:
                raise ValueError("characters.awakening must be an integer between 0 and 5.")
            normalized["awakening"] = awakening
        if "unique_level" in raw_entry:
            unique_level = raw_entry["unique_level"]
            if not isinstance(unique_level, int) or unique_level < 1 or unique_level > 6:
                raise ValueError("characters.unique_level must be an integer between 1 and 6.")
            normalized["unique_level"] = unique_level

    if entity_key == "supports":
        if "level" in raw_entry:
            level = raw_entry["level"]
            if not isinstance(level, int) or level < 1 or level > 50:
                raise ValueError("supports.level must be an integer between 1 and 50.")
            normalized["level"] = level
        if "limit_break" in raw_entry:
            limit_break = raw_entry["limit_break"]
            if not isinstance(limit_break, int) or limit_break < 0 or limit_break > 4:
                raise ValueError("supports.limit_break must be an integer between 0 and 4.")
            normalized["limit_break"] = limit_break

    return normalized or None


def normalize_roster(raw_roster: object) -> dict:
    roster = default_roster()
    if not isinstance(raw_roster, dict):
        return roster

    support_rarity_lookup: dict[str, int] = {}
    try:
        for item_id, item in load_reference_items_lookup("supports").items():
            detail = item.get("detail") if isinstance(item, dict) and item.get("detail") else item
            rarity = int(detail.get("rarity") or 0)
            if rarity > 0:
                support_rarity_lookup[item_id] = rarity
    except (FileNotFoundError, ValueError):
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


def next_profile_id(profiles: list[dict]) -> str:
    next_number = 1
    for profile in profiles:
        match = re.match(r"^p_(\d+)$", profile["id"])
        if match:
            next_number = max(next_number, int(match.group(1)) + 1)
    return f"p_{next_number:03d}"


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


def unique_profile_name(base_name: str, existing_names: set[str]) -> str:
    if base_name not in existing_names:
        return base_name

    suffix = " (imported)"
    candidate = f"{base_name}{suffix}"
    if candidate not in existing_names:
        return candidate

    index = 2
    while True:
        candidate = f"{base_name}{suffix} {index}"
        if candidate not in existing_names:
            return candidate
        index += 1


def export_profile_archive_bytes(profile_id: str) -> tuple[bytes, str]:
    index = load_profiles_index()
    profile = next((entry for entry in index["profiles"] if entry["id"] == profile_id), None)
    if profile is None:
        raise FileNotFoundError("Profile not found.")

    roster = load_roster(profile_id)
    legacies = load_legacies(profile_id)
    manifest = {
        "kind": PROFILE_EXPORT_KIND,
        "version": 1,
        "created_at": utc_timestamp(),
        "profile_id": profile_id,
    }

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        archive.writestr("profile.json", json.dumps(profile, ensure_ascii=False, indent=2) + "\n")
        archive.writestr("roster.json", json.dumps(roster, ensure_ascii=False, indent=2) + "\n")
        archive.writestr("legacy.json", json.dumps(legacies, ensure_ascii=False, indent=2) + "\n")

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
        try:
            save_legacies(target_profile_id, legacy_document)
        except (FileNotFoundError, ValueError):
            persist_unresolved_legacies(target_profile_id, legacy_document)
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
    try:
        save_legacies(profile_id, legacy_document)
    except (FileNotFoundError, ValueError):
        persist_unresolved_legacies(profile_id, legacy_document)
    return saved_index, new_profile


def get_bootstrap_status() -> dict:
    profiles_index = load_profiles_index()
    has_profiles = bool(profiles_index["profiles"])
    has_reference_meta = REFERENCE_META_PATH.exists()
    has_reference_db = REFERENCE_DB_PATH.exists()
    has_dist_bundle = (DIST_ROOT / "index.html").exists()
    needs_initial_update = not has_reference_meta or not has_reference_db

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
            if not NORMALIZED_ROOT.exists():
                self._send_api_error(404, "Normalized reference data not found. Run the update command first.")
                return

            items = []
            for path in sorted(NORMALIZED_ROOT.glob("*.json")):
                if path.name == "reference-meta.json":
                    continue
                try:
                    payload = json.loads(path.read_text(encoding="utf-8-sig"))
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict):
                    continue
                items.append(
                    {
                        "entity": path.stem,
                        "count": len(payload.get("items") or []),
                        "generated_at": payload.get("generated_at"),
                        "source": payload.get("source"),
                    }
                )
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

        match = re.fullmatch(r"/api/reference/([a-z_]+)/([^/]+)", request_path)
        if match:
            entity_key = match.group(1)
            item_id = match.group(2)
            try:
                payload = load_reference_entity(entity_key)
            except FileNotFoundError:
                self._send_api_error(404, "Reference entity not found.")
                return
            except ValueError:
                self._send_api_error(500, "Reference entity payload is invalid.")
                return

            item = next((entry for entry in payload.get("items") or [] if str(entry.get("id")) == item_id), None)
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
