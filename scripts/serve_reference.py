#!/usr/bin/env python3

from __future__ import annotations

import argparse
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
BACKUP_ID_PATTERN = re.compile(r"^backup_\d{8}_\d{6}_[0-9a-f]{8}$")
PROFILE_EXPORT_KIND = "umamusume-profile-export"
FULL_BACKUP_KIND = "umamusume-full-backup"
ADMIN_JOB_HISTORY_LIMIT = 12
SUPPORT_STAGE_LEVELS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
SUPPORT_BASE_CAP_BY_RARITY = {1: 20, 2: 25, 3: 30}

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
    return load_reference_items_lookup("character_progression")


def build_support_progression_lookup() -> dict[int, dict]:
    lookup: dict[int, dict] = {}
    for item in load_reference_entity("support_progression").get("items", []):
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
    for value_entry in effect.get("values") or []:
        if not isinstance(value_entry, dict):
            continue
        stage_index = int(value_entry.get("stage_index") or 0)
        max_stage_index = max(max_stage_index, stage_index)
        threshold = SUPPORT_STAGE_LEVELS[min(max(stage_index, 1), len(SUPPORT_STAGE_LEVELS)) - 1]
        if effective_level >= threshold:
            current_value = value_entry.get("value")
            current_stage_index = stage_index
    return {
        "effect_id": effect.get("effect_id"),
        "name": effect.get("name"),
        "description": effect.get("description"),
        "symbol": effect.get("symbol"),
        "current_value": current_value,
        "max_value": effect.get("max_value"),
        "current_stage_index": current_stage_index,
        "max_stage_index": max_stage_index,
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
