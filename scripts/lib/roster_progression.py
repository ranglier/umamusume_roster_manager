from __future__ import annotations

from lib.common import clamp_int, normalize_string_list


SUPPORT_STAGE_LEVELS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]


SUPPORT_BASE_CAP_BY_RARITY = {1: 20, 2: 25, 3: 30}


def get_support_level_cap(rarity: int, limit_break: int) -> int:
    base_cap = SUPPORT_BASE_CAP_BY_RARITY.get(rarity, 30)
    return min(50, base_cap + (max(0, min(4, limit_break)) * 5))


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
    stars = clamp_int(entry.get("stars"), 0, 5, int(detail.get("rarity") or 0))
    awakening_skills = list((detail.get("skill_links") or {}).get("awakening") or [])
    awakening_level = clamp_int(entry.get("awakening"), 0, 5, 0)
    unlocked_count = max(0, min(len(awakening_skills), awakening_level - 1))
    unlocked_skills = awakening_skills[:unlocked_count]
    locked_skills = awakening_skills[unlocked_count:]
    awakening_levels = list((progression or {}).get("awakening_levels") or [])
    unlocked_levels = [level for level in awakening_levels if int(level.get("awakening_level") or 0) <= awakening_level]
    locked_levels = [level for level in awakening_levels if int(level.get("awakening_level") or 0) > awakening_level]

    if awakening_level >= 5 and stars >= 5:
        progress_bucket = "maxed"
    elif awakening_level >= 4 or stars >= 4:
        progress_bucket = "advanced"
    elif awakening_level >= 2 or stars >= 3:
        progress_bucket = "started"
    else:
        progress_bucket = "base"

    unlock_state = "full" if locked_skills == [] and awakening_skills else "partial" if unlocked_skills else "none"
    return {
        "stars": stars,
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
