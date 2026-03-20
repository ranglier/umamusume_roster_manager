from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

from roster_lib import load_dataset, relative_to_root

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

ENUMS = {
    "assessment_status": {"unreviewed", "potential", "to_test", "in_progress", "ready", "situational", "obsolete"},
    "power": {"high", "medium", "low"},
    "distance": {"short", "mile", "medium", "long"},
    "style": {"runner", "leader", "betweener", "chaser"},
    "surface": {"turf", "dirt"},
    "role": {"carry", "sub_carry", "speed_debuffer", "stamina_debuffer", "parent", "tech_pick", "composition_support"},
    "support_type": {"speed", "stamina", "power", "guts", "wisdom", "friend", "group"},
    "support_availability": {"available", "borrow_only", "missing"},
    "support_status": {"core", "good_replacement", "niche", "rarely_useful"},
    "interest_tag": {"stats", "skill_access", "recovery", "accel", "debuff", "utility", "scenario_link"},
    "support_restriction": {"same_character_training_lock", "same_uma_support_family_exclusive"},
    "parent_scope": {"generic", "track_specific", "style_fix", "distance_fix", "debuff", "unique_inherit"},
    "parent_ownership": {"owned", "borrowed"},
    "parent_status": {"to_do", "farming", "usable", "good", "excellent", "replace"},
    "parent_quality": {"rough", "usable", "good", "excellent"},
    "build_profile": {"optimal_theory", "realistic_account", "budget", "experimental", "debuffer"},
    "difficulty": {"low", "medium", "high", "very_high"},
    "viability": {"strong", "playable", "risky", "blocked"},
    "progress_state": {"planned", "farming", "testing", "completed", "shelved"},
    "prep_status": {"scouting", "farming", "lock_in", "ready"},
    "archetype": {"single_carry", "double_carry", "carry_plus_debuffer"},
}


class ValidationState:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def add(self, context: str, message: str) -> None:
        self.errors.append(f"{context}: {message}")


def ensure_fields(data: dict[str, Any], fields: list[str], context: str, state: ValidationState) -> None:
    for field in fields:
        if field not in data:
            state.add(context, f"missing field `{field}`")


def ensure_string_list(value: Any, field: str, context: str, state: ValidationState) -> None:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        state.add(context, f"`{field}` must be a list of strings")


def ensure_enum(value: Any, allowed: set[str], field: str, context: str, state: ValidationState) -> None:
    if not isinstance(value, str) or value not in allowed:
        allowed_text = ", ".join(sorted(allowed))
        state.add(context, f"`{field}` must be one of: {allowed_text}")


def ensure_enum_list(value: Any, allowed: set[str], field: str, context: str, state: ValidationState) -> None:
    ensure_string_list(value, field, context, state)
    if isinstance(value, list):
        for item in value:
            if item not in allowed:
                state.add(context, f"`{field}` contains invalid value `{item}`")


def ensure_date(value: Any, field: str, context: str, state: ValidationState) -> None:
    if not isinstance(value, str) or not DATE_RE.match(value):
        state.add(context, f"`{field}` must use YYYY-MM-DD")


def ensure_file_matches_id(path: Path, expected_id: str, context: str, state: ValidationState) -> None:
    if path.stem != expected_id:
        state.add(context, f"filename `{path.name}` must match id `{expected_id}`")


def ensure_reference_list(values: Any, target: dict[str, Any], field: str, context: str, state: ValidationState) -> None:
    ensure_string_list(values, field, context, state)
    if isinstance(values, list):
        for value in values:
            if value not in target:
                state.add(context, f"`{field}` references unknown id `{value}`")


def validate_account(account: dict[str, Any], cms: dict[str, Any], state: ValidationState) -> None:
    context = relative_to_root(account["_path"])
    ensure_fields(account, ["account_id", "active_cm_id", "borrow_limit_per_training", "updated_at"], context, state)
    ensure_date(account.get("updated_at"), "updated_at", context, state)
    if account.get("active_cm_id") not in cms:
        state.add(context, "`active_cm_id` must point to an existing CM")
    if not isinstance(account.get("borrow_limit_per_training"), int) or account.get("borrow_limit_per_training") < 0:
        state.add(context, "`borrow_limit_per_training` must be a non-negative integer")
    scenarios = account.get("supported_training_scenarios", [])
    ensure_string_list(scenarios, "supported_training_scenarios", context, state)


def validate_character(character: dict[str, Any], parents: dict[str, Any], supports: dict[str, Any], state: ValidationState) -> None:
    context = relative_to_root(character["_path"])
    ensure_fields(
        character,
        [
            "id",
            "uma_slug",
            "name",
            "alt",
            "owned",
            "awakening_level",
            "assessment_status",
            "theoretical_power",
            "practical_fit",
            "readiness_state",
            "playable_distances",
            "playable_styles",
            "playable_surfaces",
            "possible_roles",
            "recommended_parent_ids",
            "recommended_support_ids",
            "updated_at",
            "readiness",
        ],
        context,
        state,
    )
    ensure_file_matches_id(character["_path"], character.get("id", ""), context, state)
    ensure_enum(character.get("assessment_status"), ENUMS["assessment_status"], "assessment_status", context, state)
    ensure_enum(character.get("theoretical_power"), ENUMS["power"], "theoretical_power", context, state)
    ensure_enum(character.get("practical_fit"), ENUMS["power"], "practical_fit", context, state)
    ensure_enum(character.get("readiness_state"), {"ready_now", "farm_needed", "blocked"}, "readiness_state", context, state)
    ensure_enum_list(character.get("playable_distances"), ENUMS["distance"], "playable_distances", context, state)
    ensure_enum_list(character.get("playable_styles"), ENUMS["style"], "playable_styles", context, state)
    ensure_enum_list(character.get("playable_surfaces"), ENUMS["surface"], "playable_surfaces", context, state)
    ensure_enum_list(character.get("possible_roles"), ENUMS["role"], "possible_roles", context, state)
    ensure_reference_list(character.get("recommended_parent_ids"), parents, "recommended_parent_ids", context, state)
    ensure_reference_list(character.get("recommended_support_ids"), supports, "recommended_support_ids", context, state)
    ensure_date(character.get("updated_at"), "updated_at", context, state)

    readiness = character.get("readiness")
    if not isinstance(readiness, dict):
        state.add(context, "`readiness` must be a table")
        return
    for field in ["ready_now", "farm_required", "blocked"]:
        if not isinstance(readiness.get(field), bool):
            state.add(context, f"`readiness.{field}` must be a boolean")
    ensure_string_list(readiness.get("blockers", []), "readiness.blockers", context, state)

    readiness_state = character.get("readiness_state")
    if readiness_state == "ready_now":
        if not readiness.get("ready_now") or readiness.get("farm_required") or readiness.get("blocked"):
            state.add(context, "`readiness_state = ready_now` must align with readiness booleans")
    elif readiness_state == "farm_needed":
        if readiness.get("ready_now") or not readiness.get("farm_required") or readiness.get("blocked"):
            state.add(context, "`readiness_state = farm_needed` must align with readiness booleans")
    elif readiness_state == "blocked":
        if readiness.get("ready_now") or not readiness.get("blocked"):
            state.add(context, "`readiness_state = blocked` must align with readiness booleans")


def validate_support(support: dict[str, Any], characters: dict[str, Any], state: ValidationState) -> None:
    context = relative_to_root(support["_path"])
    ensure_fields(
        support,
        [
            "id",
            "character_slug",
            "name",
            "version",
            "support_type",
            "rarity",
            "owned",
            "availability",
            "usage_primary",
            "usage_secondary",
            "relevant_styles",
            "relevant_distances",
            "relevant_roles",
            "key_skills",
            "interest_tags",
            "candidate_ids",
            "restrictions",
            "status",
            "updated_at",
        ],
        context,
        state,
    )
    ensure_file_matches_id(support["_path"], support.get("id", ""), context, state)
    ensure_enum(support.get("support_type"), ENUMS["support_type"], "support_type", context, state)
    ensure_enum(support.get("availability"), ENUMS["support_availability"], "availability", context, state)
    ensure_enum(support.get("status"), ENUMS["support_status"], "status", context, state)
    ensure_enum_list(support.get("relevant_styles"), ENUMS["style"], "relevant_styles", context, state)
    ensure_enum_list(support.get("relevant_distances"), ENUMS["distance"], "relevant_distances", context, state)
    ensure_enum_list(support.get("relevant_roles"), ENUMS["role"], "relevant_roles", context, state)
    ensure_enum_list(support.get("interest_tags"), ENUMS["interest_tag"], "interest_tags", context, state)
    ensure_enum_list(support.get("restrictions"), ENUMS["support_restriction"], "restrictions", context, state)
    ensure_reference_list(support.get("candidate_ids"), characters, "candidate_ids", context, state)
    ensure_date(support.get("updated_at"), "updated_at", context, state)

    if not support.get("owned") and support.get("availability") == "available":
        state.add(context, "unowned support cannot use `availability = available`")


def validate_parent(parent: dict[str, Any], state: ValidationState) -> None:
    context = relative_to_root(parent["_path"])
    ensure_fields(
        parent,
        [
            "id",
            "representative_uma_slug",
            "representative_name",
            "role_summary",
            "scope",
            "ownership",
            "status",
            "quality",
            "target_surfaces",
            "target_distances",
            "target_styles",
            "role_tags",
            "blue_sparks",
            "pink_sparks",
            "green_white_sparks",
            "aptitude_fixes",
            "important_inheritables",
            "updated_at",
        ],
        context,
        state,
    )
    ensure_file_matches_id(parent["_path"], parent.get("id", ""), context, state)
    ensure_enum(parent.get("scope"), ENUMS["parent_scope"], "scope", context, state)
    ensure_enum(parent.get("ownership"), ENUMS["parent_ownership"], "ownership", context, state)
    ensure_enum(parent.get("status"), ENUMS["parent_status"], "status", context, state)
    ensure_enum(parent.get("quality"), ENUMS["parent_quality"], "quality", context, state)
    ensure_enum_list(parent.get("target_surfaces"), ENUMS["surface"], "target_surfaces", context, state)
    ensure_enum_list(parent.get("target_distances"), ENUMS["distance"], "target_distances", context, state)
    ensure_enum_list(parent.get("target_styles"), ENUMS["style"], "target_styles", context, state)
    ensure_date(parent.get("updated_at"), "updated_at", context, state)


def validate_cm(cm: dict[str, Any], characters: dict[str, Any], parents: dict[str, Any], supports: dict[str, Any], state: ValidationState) -> None:
    context = relative_to_root(cm["_path"])
    ensure_fields(
        cm,
        [
            "id",
            "name",
            "event_window",
            "prep_status",
            "surface",
            "distance",
            "distance_m",
            "turn",
            "season",
            "weather",
            "venue",
            "track_name",
            "technical_points",
            "skill_implications",
            "general_strategy",
            "playable_archetypes",
            "debuff_viability",
            "candidate_ids_considered",
            "candidate_ids_validated",
            "recommended_parent_ids",
            "important_support_ids",
            "farm_goals",
            "identified_blockers",
            "prep_plan",
            "track_features",
            "updated_at",
        ],
        context,
        state,
    )
    if cm["_dir"].name != cm.get("id"):
        state.add(context, f"CM directory `{cm['_dir'].name}` must match id `{cm.get('id')}`")
    ensure_enum(cm.get("prep_status"), ENUMS["prep_status"], "prep_status", context, state)
    ensure_enum(cm.get("surface"), ENUMS["surface"], "surface", context, state)
    ensure_enum(cm.get("distance"), ENUMS["distance"], "distance", context, state)
    ensure_enum_list(cm.get("playable_archetypes"), ENUMS["archetype"], "playable_archetypes", context, state)
    ensure_reference_list(cm.get("candidate_ids_considered"), characters, "candidate_ids_considered", context, state)
    ensure_reference_list(cm.get("candidate_ids_validated"), characters, "candidate_ids_validated", context, state)
    ensure_reference_list(cm.get("recommended_parent_ids"), parents, "recommended_parent_ids", context, state)
    ensure_reference_list(cm.get("important_support_ids"), supports, "important_support_ids", context, state)
    ensure_date(cm.get("updated_at"), "updated_at", context, state)

    track_features = cm.get("track_features")
    if not isinstance(track_features, dict):
        state.add(context, "`track_features` must be a table")
    else:
        ensure_string_list(track_features.get("relevant_green_skills", []), "track_features.relevant_green_skills", context, state)
        ensure_string_list(track_features.get("relevant_accel_skills", []), "track_features.relevant_accel_skills", context, state)

    considered = set(cm.get("candidate_ids_considered", []))
    for value in cm.get("candidate_ids_validated", []):
        if value not in considered:
            state.add(context, f"validated candidate `{value}` must also appear in candidate_ids_considered")


def validate_build(
    build: dict[str, Any],
    account: dict[str, Any],
    characters: dict[str, Any],
    supports: dict[str, Any],
    parents: dict[str, Any],
    cms: dict[str, Any],
    state: ValidationState,
) -> None:
    context = relative_to_root(build["_path"])
    ensure_fields(
        build,
        [
            "id",
            "cm_id",
            "candidate_id",
            "role_in_team",
            "chosen_style",
            "final_surface",
            "final_distance",
            "build_profile",
            "build_objective",
            "scenario",
            "difficulty",
            "viability",
            "progress_state",
            "skills_priority",
            "skills_optional",
            "skills_to_avoid",
            "critical_inheritance_targets",
            "dependencies",
            "stat_targets",
            "borrow_plan",
            "deck",
            "parent_plan",
            "updated_at",
        ],
        context,
        state,
    )
    ensure_file_matches_id(build["_path"], build.get("id", ""), context, state)
    if build.get("cm_id") not in cms:
        state.add(context, "`cm_id` must point to an existing CM")
    if build.get("candidate_id") not in characters:
        state.add(context, "`candidate_id` must point to an existing character")
        return
    if build.get("cm_id") != build["_cm_dir"].name:
        state.add(context, "build file must live inside the CM directory matching `cm_id`")

    ensure_enum(build.get("role_in_team"), ENUMS["role"], "role_in_team", context, state)
    ensure_enum(build.get("chosen_style"), ENUMS["style"], "chosen_style", context, state)
    ensure_enum(build.get("final_surface"), ENUMS["surface"], "final_surface", context, state)
    ensure_enum(build.get("final_distance"), ENUMS["distance"], "final_distance", context, state)
    ensure_enum(build.get("build_profile"), ENUMS["build_profile"], "build_profile", context, state)
    ensure_enum(build.get("difficulty"), ENUMS["difficulty"], "difficulty", context, state)
    ensure_enum(build.get("viability"), ENUMS["viability"], "viability", context, state)
    ensure_enum(build.get("progress_state"), ENUMS["progress_state"], "progress_state", context, state)
    ensure_string_list(build.get("skills_priority"), "skills_priority", context, state)
    ensure_string_list(build.get("skills_optional"), "skills_optional", context, state)
    ensure_string_list(build.get("skills_to_avoid"), "skills_to_avoid", context, state)
    ensure_string_list(build.get("critical_inheritance_targets"), "critical_inheritance_targets", context, state)
    ensure_string_list(build.get("dependencies"), "dependencies", context, state)
    ensure_date(build.get("updated_at"), "updated_at", context, state)

    candidate = characters[build["candidate_id"]]
    deck = build.get("deck")
    if not isinstance(deck, list):
        state.add(context, "`deck` must be an array of tables")
        return
    if len(deck) != 6:
        state.add(context, "`deck` must contain exactly 6 support slots")

    seen_slots: set[int] = set()
    seen_supports: set[str] = set()
    support_family_counts: dict[str, int] = {}
    borrow_count = 0

    for item in deck:
        if not isinstance(item, dict):
            state.add(context, "each `deck` item must be a table")
            continue
        slot = item.get("slot")
        support_id = item.get("support_id")
        borrow = item.get("borrow")
        if not isinstance(slot, int) or slot < 1 or slot > 6:
            state.add(context, "each deck slot must be an integer between 1 and 6")
        elif slot in seen_slots:
            state.add(context, f"duplicate deck slot `{slot}`")
        else:
            seen_slots.add(slot)
        if support_id not in supports:
            state.add(context, f"unknown support `{support_id}` in deck")
            continue
        if support_id in seen_supports:
            state.add(context, f"duplicate support `{support_id}` in deck")
        else:
            seen_supports.add(support_id)
        if not isinstance(borrow, bool):
            state.add(context, f"deck entry `{support_id}` must have boolean `borrow`")
            continue
        if borrow:
            borrow_count += 1

        support = supports[support_id]
        family = support["character_slug"]
        support_family_counts[family] = support_family_counts.get(family, 0) + 1

        if not support.get("owned") and not borrow:
            state.add(context, f"unowned support `{support_id}` must be marked `borrow = true`")
        if support.get("availability") == "missing":
            state.add(context, f"missing support `{support_id}` cannot be used in a build deck yet")
        if candidate.get("uma_slug") == support.get("character_slug") and "same_character_training_lock" in support.get("restrictions", []):
            state.add(context, f"support `{support_id}` cannot train candidate `{candidate['id']}` because of same-character lock")

    for family, count in support_family_counts.items():
        if count < 2:
            continue
        conflicting_cards = [
            item["support_id"]
            for item in deck
            if isinstance(item, dict)
            and item.get("support_id") in supports
            and supports[item["support_id"]]["character_slug"] == family
            and "same_uma_support_family_exclusive" in supports[item["support_id"]].get("restrictions", [])
        ]
        if len(conflicting_cards) > 1:
            joined = ", ".join(conflicting_cards)
            state.add(context, f"supports from family `{family}` conflict in deck: {joined}")

    borrow_limit = account.get("borrow_limit_per_training", 0)
    if borrow_count > borrow_limit:
        state.add(context, f"build uses {borrow_count} borrows but account limit is {borrow_limit}")

    borrow_plan = build.get("borrow_plan")
    if not isinstance(borrow_plan, dict):
        state.add(context, "`borrow_plan` must be a table")
    else:
        borrow_support_id = borrow_plan.get("support_id")
        if borrow_support_id not in supports:
            state.add(context, "`borrow_plan.support_id` must point to an existing support")
        elif borrow_support_id not in [item.get("support_id") for item in deck if isinstance(item, dict) and item.get("borrow")]:
            state.add(context, "`borrow_plan.support_id` must match one borrowed support from the deck")

    parent_plan = build.get("parent_plan")
    if not isinstance(parent_plan, list):
        state.add(context, "`parent_plan` must be an array of tables")
    else:
        if len(parent_plan) != 2:
            state.add(context, "`parent_plan` must contain exactly 2 parents")
        for item in parent_plan:
            if not isinstance(item, dict):
                state.add(context, "each `parent_plan` item must be a table")
                continue
            parent_id = item.get("parent_id")
            if parent_id not in parents:
                state.add(context, f"unknown parent `{parent_id}` in parent_plan")


def main() -> int:
    dataset = load_dataset()
    state = ValidationState()

    validate_account(dataset["account"], dataset["cms"], state)

    for character in dataset["characters"].values():
        validate_character(character, dataset["parents"], dataset["supports"], state)

    for support in dataset["supports"].values():
        validate_support(support, dataset["characters"], state)

    for parent in dataset["parents"].values():
        validate_parent(parent, state)

    for cm in dataset["cms"].values():
        validate_cm(cm, dataset["characters"], dataset["parents"], dataset["supports"], state)

    for build in dataset["builds"].values():
        validate_build(build, dataset["account"], dataset["characters"], dataset["supports"], dataset["parents"], dataset["cms"], state)

    if state.errors:
        print("Validation failed:\n")
        for error in state.errors:
            print(f"- {error}")
        return 1

    print("Validation passed.")
    print(f"Characters: {len(dataset['characters'])}")
    print(f"Supports: {len(dataset['supports'])}")
    print(f"Parents: {len(dataset['parents'])}")
    print(f"CMs: {len(dataset['cms'])}")
    print(f"Builds: {len(dataset['builds'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
