from __future__ import annotations

import collections
import re

from lib.common import clamp_int, normalize_string_list, utc_timestamp


LEGACY_ID_PATTERN = re.compile(r"^legacy_\d{3,}$")


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


LEGACY_RATING_OPTIONS = {
    "",
    "G",
    "F",
    "E",
    "E+",
    "D",
    "D+",
    "C",
    "C+",
    "B",
    "B+",
    "A",
    "A+",
    "S",
    "S+",
    "SS",
    "SS+",
    "UF",
    "UG",
    "UE",
}


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


def character_supports_green_spark(character_ref: dict | None, *, stars: int | None = None) -> bool:
    detail = get_character_detail(character_ref)
    resolved_stars = int(stars if stars is not None else (detail.get("rarity") or 0))
    return resolved_stars >= 3 and get_character_unique_skill(character_ref) is not None


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
            scenario_id = str(scenario_id or target_key or "").strip()
            target_key = scenario_id
            target_label = str(target_label or target_key)
            if not target_key:
                raise ValueError("legacy scenario factor target is invalid.")
        else:
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


def default_legacy_grandparents() -> dict:
    return {
        "left": None,
        "right": None,
    }


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


def normalize_green_spark(raw_spark: object, catalogs: dict, *, character_ref: dict | None = None, stars: int | None = None) -> dict | None:
    if raw_spark in (None, ""):
        return None
    if not character_supports_green_spark(character_ref, stars=stars):
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


def migrate_legacy_sparks_from_factors(raw_factors: object, catalogs: dict, *, character_ref: dict | None = None, stars: int | None = None) -> tuple[dict | None, dict | None, dict | None, list[dict]]:
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
            and character_supports_green_spark(character_ref, stars=stars)
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


def normalize_legacy_grandparent(
    raw_entry: object,
    catalogs: dict,
    *,
    slot_name: str,
    strict_sparks: bool = True,
) -> dict | None:
    if raw_entry in (None, ""):
        return None
    if not isinstance(raw_entry, dict):
        raise ValueError(f"legacy grandparent {slot_name} must be an object.")

    character_card_id = str(raw_entry.get("character_card_id") or "").strip()
    character_ref = catalogs["characters"].get(character_card_id)
    if character_ref is None:
        raise ValueError(f"legacy grandparent {slot_name} character_card_id is invalid.")

    scenario_id = str(raw_entry.get("scenario_id") or "").strip()
    scenario_ref = catalogs["scenarios"].get(scenario_id) if scenario_id else None
    scenario_name = str(raw_entry.get("scenario_name") or "").strip()
    if scenario_ref is not None:
        scenario_id = str(scenario_ref.get("scenario_id") or scenario_ref.get("id"))
        scenario_name = str(scenario_ref.get("name") or scenario_name or scenario_id)
    else:
        scenario_id = scenario_id or ""
        scenario_name = scenario_name or scenario_id

    detail = get_character_detail(character_ref)
    stars = clamp_int(raw_entry.get("stars"), 0, 5, int(detail.get("rarity") or 0))
    green_available = character_supports_green_spark(character_ref, stars=stars)

    has_structured_sparks = any(
        key in raw_entry
        for key in ("blue_spark", "pink_spark", "green_spark", "white_sparks")
    )
    if has_structured_sparks:
        blue_spark = normalize_blue_spark(raw_entry.get("blue_spark"), catalogs, character_ref=character_ref)
        pink_spark = normalize_pink_spark(raw_entry.get("pink_spark"), catalogs, character_ref=character_ref)
        green_spark = normalize_green_spark(raw_entry.get("green_spark"), catalogs, character_ref=character_ref, stars=stars) if green_available else None
        white_sparks = normalize_white_sparks(raw_entry.get("white_sparks"), catalogs, character_ref=character_ref)
    else:
        blue_spark, pink_spark, green_spark, white_sparks = migrate_legacy_sparks_from_factors(
            raw_entry.get("factors"),
            catalogs,
            character_ref=character_ref,
            stars=stars,
        )

    rating = str(raw_entry.get("rating") or "").strip().upper()
    if rating not in LEGACY_RATING_OPTIONS:
        raise ValueError(f"legacy grandparent {slot_name} rating is invalid.")

    if strict_sparks:
        if blue_spark is None:
            raise ValueError(f"legacy grandparent {slot_name} blue spark is required.")
        if pink_spark is None:
            raise ValueError(f"legacy grandparent {slot_name} pink spark is required.")

    return {
        "character_card_id": character_card_id,
        "base_character_id": int(detail.get("base_character_id") or raw_entry.get("base_character_id") or 0),
        "name": str(detail.get("name") or raw_entry.get("name") or "").strip(),
        "variant": str(detail.get("variant") or raw_entry.get("variant") or "").strip(),
        "scenario_id": scenario_id or None,
        "scenario_name": scenario_name or None,
        "rating": rating or None,
        "source_date": str(raw_entry.get("source_date") or "").strip() or None,
        "stars": stars,
        "awakening": clamp_int(raw_entry.get("awakening"), 0, 5, 0),
        "note": str(raw_entry.get("note") or ""),
        "green_available": green_available,
        "blue_spark": blue_spark,
        "pink_spark": pink_spark,
        "green_spark": green_spark if green_available else None,
        "white_sparks": white_sparks,
        "factors": legacy_entry_to_factors(
            {
                "blue_spark": blue_spark,
                "pink_spark": pink_spark,
                "green_spark": green_spark if green_available else None,
                "white_sparks": white_sparks,
            }
        ),
    }


def normalize_legacy_grandparents(raw_grandparents: object, catalogs: dict) -> dict:
    grandparents = raw_grandparents if isinstance(raw_grandparents, dict) else {}
    return {
        "left": normalize_legacy_grandparent(grandparents.get("left"), catalogs, slot_name="left", strict_sparks=True),
        "right": normalize_legacy_grandparent(grandparents.get("right"), catalogs, slot_name="right", strict_sparks=True),
    }


def legacy_entry_grandparents(entry: dict) -> dict:
    grandparents = entry.get("grandparents")
    if isinstance(grandparents, dict):
        return {
            "left": grandparents.get("left") if isinstance(grandparents.get("left"), dict) else None,
            "right": grandparents.get("right") if isinstance(grandparents.get("right"), dict) else None,
        }
    return default_legacy_grandparents()


def get_legacy_lineage_entries(entry: dict) -> list[dict]:
    lineage = []
    for slot_name in ("left", "right"):
        grandparent = legacy_entry_grandparents(entry).get(slot_name)
        if isinstance(grandparent, dict):
            lineage.append(grandparent)
    return lineage


def build_lineage_completion(entry: dict) -> dict:
    grandparents = legacy_entry_grandparents(entry)
    filled_slots = [slot_name for slot_name in ("left", "right") if isinstance(grandparents.get(slot_name), dict)]
    return {
        "filled_count": len(filled_slots),
        "total": 2,
        "complete": len(filled_slots) == 2,
        "missing_slots": [slot_name for slot_name in ("left", "right") if slot_name not in filled_slots],
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
        scenario_id = scenario_id or ""
        scenario_name = scenario_name or scenario_id

    detail = get_character_detail(character_ref)
    name = str(detail.get("name") or raw_entry.get("name") or "").strip()
    variant = str(detail.get("variant") or raw_entry.get("variant") or "").strip()
    base_character_id = int(detail.get("base_character_id") or raw_entry.get("base_character_id") or 0)

    source_date = str(raw_entry.get("source_date") or "").strip()
    note = str(raw_entry.get("note") or "")
    source_note = str(raw_entry.get("source_note") or "")
    rating = str(raw_entry.get("rating") or "").strip().upper()
    if len(note) > 2000 or len(source_note) > 2000:
        raise ValueError("legacy notes are too long.")
    if len(source_date) > 80:
        raise ValueError("legacy source_date is too long.")
    if rating not in LEGACY_RATING_OPTIONS:
        raise ValueError("legacy rating is invalid.")

    stars = clamp_int(raw_entry.get("stars"), 0, 5, int(detail.get("rarity") or 0))
    awakening = clamp_int(raw_entry.get("awakening"), 0, 5, 0)
    green_available = character_supports_green_spark(character_ref, stars=stars)

    has_structured_sparks = any(
        key in raw_entry
        for key in ("blue_spark", "pink_spark", "green_spark", "white_sparks")
    )
    if has_structured_sparks:
        blue_spark = normalize_blue_spark(raw_entry.get("blue_spark"), catalogs, character_ref=character_ref)
        pink_spark = normalize_pink_spark(raw_entry.get("pink_spark"), catalogs, character_ref=character_ref)
        green_spark = normalize_green_spark(raw_entry.get("green_spark"), catalogs, character_ref=character_ref, stars=stars) if green_available else None
        white_sparks = normalize_white_sparks(raw_entry.get("white_sparks"), catalogs, character_ref=character_ref)
    else:
        blue_spark, pink_spark, green_spark, white_sparks = migrate_legacy_sparks_from_factors(
            raw_entry.get("factors"),
            catalogs,
            character_ref=character_ref,
            stars=stars,
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
    grandparents = normalize_legacy_grandparents(raw_entry.get("grandparents"), catalogs)

    return {
        "id": entry_id or None,
        "character_card_id": character_card_id,
        "base_character_id": base_character_id,
        "name": name,
        "variant": variant,
        "scenario_id": scenario_id or None,
        "scenario_name": scenario_name or None,
        "rating": rating or None,
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
        "grandparents": grandparents,
    }


def next_legacy_id(entries: list[dict]) -> str:
    next_number = 1
    for entry in entries:
        match = re.match(r"^legacy_(\d+)$", str(entry.get("id") or ""))
        if match:
            next_number = max(next_number, int(match.group(1)) + 1)
    return f"legacy_{next_number:03d}"


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


def build_legacy_grandparent_view_item(slot_name: str, grandparent: dict | None, catalogs: dict) -> dict:
    if not isinstance(grandparent, dict):
        return {
            "slot": slot_name,
            "slot_label": "Left Grandparent" if slot_name == "left" else "Right Grandparent",
            "missing": True,
        }

    character_ref = catalogs["characters"].get(str(grandparent.get("character_card_id") or ""))
    detail = get_character_detail(character_ref)
    spark_summary = build_legacy_spark_summary(grandparent)
    return {
        "slot": slot_name,
        "slot_label": "Left Grandparent" if slot_name == "left" else "Right Grandparent",
        "missing": False,
        "character_card_id": str(grandparent.get("character_card_id") or ""),
        "base_character_id": int(grandparent.get("base_character_id") or 0),
        "title": str(grandparent.get("name") or detail.get("name") or "Unknown grandparent"),
        "subtitle": str(grandparent.get("variant") or detail.get("variant") or ""),
        "scenario_name": str(grandparent.get("scenario_name") or ""),
        "rating": str(grandparent.get("rating") or ""),
        "media": character_ref.get("media") if isinstance(character_ref, dict) else {},
        "spark_summary": spark_summary,
    }


def build_lineage_factor_summary(entry: dict) -> dict:
    direct_factors = legacy_entry_to_factors(entry)
    grandparent_factors: list[dict] = []
    for grandparent in get_legacy_lineage_entries(entry):
        grandparent_factors.extend(legacy_entry_to_factors(grandparent))
    combined_factors = direct_factors + grandparent_factors
    return {
        "direct": summarize_legacy_factors(direct_factors),
        "grandparents": summarize_legacy_factors(grandparent_factors),
        "combined": summarize_legacy_factors(combined_factors),
    }


def build_empty_legacy_view(profile_id: str, updated_at: str = "") -> dict:
    return {
        "profile_id": profile_id,
        "updated_at": updated_at,
        "items": [],
        "filter_definitions": [
            {"key": "scenario_id", "label": "Scenario"},
            {"key": "factor_kind", "label": "Factor Type"},
            {"key": "local_tag", "label": "Tags"},
            {"key": "status_flag", "label": "Status"},
        ],
        "filter_options": {
            "scenario_id": [],
            "factor_kind": [],
            "local_tag": [],
            "status_flag": [],
        },
    }


def build_detailed_aptitude_coverage(main_detail: dict, direct_factors: list[dict], grandparent_factors: list[dict]) -> list[dict]:
    grouped_targets = {
        "surface": {
            "direct": {str(factor.get("target_key")) for factor in direct_factors if factor.get("kind") == "surface"},
            "grandparent": {str(factor.get("target_key")) for factor in grandparent_factors if factor.get("kind") == "surface"},
        },
        "distance": {
            "direct": {str(factor.get("target_key")) for factor in direct_factors if factor.get("kind") == "distance"},
            "grandparent": {str(factor.get("target_key")) for factor in grandparent_factors if factor.get("kind") == "distance"},
        },
        "style": {
            "direct": {str(factor.get("target_key")) for factor in direct_factors if factor.get("kind") == "style"},
            "grandparent": {str(factor.get("target_key")) for factor in grandparent_factors if factor.get("kind") == "style"},
        },
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
        direct_supported = [labels[category].get(value, value) for value in viable_values if value in grouped_targets[category]["direct"]]
        grandparent_supported = [
            labels[category].get(value, value)
            for value in viable_values
            if value not in grouped_targets[category]["direct"] and value in grouped_targets[category]["grandparent"]
        ]
        missing = [
            labels[category].get(value, value)
            for value in viable_values
            if value not in grouped_targets[category]["direct"] and value not in grouped_targets[category]["grandparent"]
        ]
        result.append(
            {
                "category": category,
                "direct_supported": direct_supported,
                "grandparent_supported": grandparent_supported,
                "missing": missing,
            }
        )
    return result


def build_compact_pair_summary(pair: dict, label: str) -> dict:
    return {
        "label": label,
        "score": int(pair.get("score") or 0),
        "shared_group_count": int(pair.get("shared_group_count") or 0),
        "shared_groups": list(pair.get("shared_groups") or []),
    }
