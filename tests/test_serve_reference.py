import unittest

from . import _pathsetup  # noqa: F401  (must run before importing serve_reference)

import serve_reference as sr
from lib import common, legacy_factors, roster_progression


def make_catalogs(**overrides):
    catalogs = {
        "characters": {},
        "scenarios": {
            "scn_1": {"scenario_id": "scn_1", "id": "scn_1", "name": "URA Finale"},
        },
        "g1_factors": {
            "g1_1": {"factor_id": "g1_1", "id": "g1_1", "name": "Tokyo Yushun", "race_id": "race_1"},
        },
        "skills": {
            "skill_1": {"skill_id": "skill_1", "id": "skill_1", "name": "Corner Recovery"},
        },
        "compatibility": {},
    }
    catalogs.update(overrides)
    return catalogs


def make_character_ref(*, rarity=3, unique_id="unique_1", unique_name="Special Skill"):
    unique_skills = []
    if unique_id:
        unique_skills = [{"id": unique_id, "name": unique_name, "rarity": 1, "cost": 100}]
    return {
        "detail": {
            "rarity": rarity,
            "skill_links": {"unique": unique_skills},
        }
    }


class ClampIntTests(unittest.TestCase):
    def test_within_range_is_unchanged(self):
        self.assertEqual(common.clamp_int(3, 0, 5, 0), 3)

    def test_below_minimum_is_clamped(self):
        self.assertEqual(common.clamp_int(-1, 0, 5, 0), 0)

    def test_above_maximum_is_clamped(self):
        self.assertEqual(common.clamp_int(99, 0, 5, 0), 5)

    def test_non_int_uses_fallback(self):
        self.assertEqual(common.clamp_int("3", 0, 5, 2), 2)
        self.assertEqual(common.clamp_int(None, 0, 5, 2), 2)

    def test_bool_is_treated_as_int_by_python(self):
        # bool is a subclass of int; documenting existing behavior rather than asserting a "should".
        self.assertEqual(common.clamp_int(True, 0, 5, 0), 1)


class NormalizeStringListTests(unittest.TestCase):
    def test_none_returns_empty_list(self):
        self.assertEqual(sr.normalize_string_list(None, field_name="tags"), [])

    def test_non_list_raises(self):
        with self.assertRaises(ValueError):
            sr.normalize_string_list("not-a-list", field_name="tags")

    def test_non_string_entry_raises(self):
        with self.assertRaises(ValueError):
            sr.normalize_string_list([1, 2], field_name="tags")

    def test_strips_and_drops_blank_entries(self):
        self.assertEqual(sr.normalize_string_list(["  a  ", "", "   "], field_name="tags"), ["a"])

    def test_dedupes_preserving_order(self):
        self.assertEqual(sr.normalize_string_list(["a", "b", "a"], field_name="tags"), ["a", "b"])

    def test_entry_too_long_raises(self):
        with self.assertRaises(ValueError):
            sr.normalize_string_list(["x" * 65], field_name="tags")


class SupportLevelCapTests(unittest.TestCase):
    def test_known_rarities_at_zero_limit_break(self):
        self.assertEqual(sr.get_support_level_cap(1, 0), 20)
        self.assertEqual(sr.get_support_level_cap(2, 0), 25)
        self.assertEqual(sr.get_support_level_cap(3, 0), 30)

    def test_limit_break_raises_cap_by_five_per_level(self):
        self.assertEqual(sr.get_support_level_cap(3, 1), 35)
        self.assertEqual(sr.get_support_level_cap(3, 2), 40)

    def test_cap_never_exceeds_fifty(self):
        self.assertEqual(sr.get_support_level_cap(3, 4), 50)
        self.assertEqual(sr.get_support_level_cap(3, 10), 50)  # out-of-range limit_break clamped internally

    def test_unknown_rarity_defaults_to_base_thirty(self):
        self.assertEqual(sr.get_support_level_cap(99, 0), 30)


class SupportCurveProgressTests(unittest.TestCase):
    def setUp(self):
        self.progression_item = {
            "levels": [
                {"level": 1, "total_exp": 0},
                {"level": 30, "total_exp": 12000},
                {"level": 50, "total_exp": 40000},
            ]
        }

    def test_level_is_clamped_to_cap(self):
        result = roster_progression.get_support_curve_progress(self.progression_item, level=999, cap=30)
        self.assertEqual(result["level"], 30)
        self.assertEqual(result["total_exp"], 12000)
        self.assertEqual(result["cap_total_exp"], 12000)

    def test_level_is_clamped_to_at_least_one(self):
        result = roster_progression.get_support_curve_progress(self.progression_item, level=0, cap=30)
        self.assertEqual(result["level"], 1)
        self.assertEqual(result["total_exp"], 0)

    def test_missing_level_in_curve_yields_none_total_exp(self):
        result = roster_progression.get_support_curve_progress(self.progression_item, level=15, cap=30)
        self.assertIsNone(result["total_exp"])

    def test_none_progression_item_does_not_crash(self):
        result = roster_progression.get_support_curve_progress(None, level=10, cap=30)
        self.assertEqual(result["level"], 10)
        self.assertIsNone(result["total_exp"])


class ResolveSupportEffectValueTests(unittest.TestCase):
    def test_picks_highest_unlocked_stage(self):
        effect = {
            "effect_id": "eff_1",
            "name": "Friendship Bonus",
            "values": [
                {"stage_index": 1, "value": 10},
                {"stage_index": 2, "value": 20},
                {"stage_index": 3, "value": 30},
            ],
        }
        # Stage thresholds come from SUPPORT_STAGE_LEVELS = [1, 5, 10, ...]
        result = roster_progression.resolve_support_effect_value(effect, effective_level=10)
        self.assertEqual(result["current_value"], 30)
        self.assertEqual(result["current_stage_index"], 3)
        self.assertEqual(result["current_unlock_level"], 10)
        self.assertIsNone(result["next_unlock_level"])

    def test_below_first_threshold_has_no_current_value(self):
        effect = {"values": [{"stage_index": 2, "value": 20}]}
        result = roster_progression.resolve_support_effect_value(effect, effective_level=1)
        self.assertIsNone(result["current_value"])
        self.assertEqual(result["next_unlock_level"], 5)


class CharacterProgressionSummaryTests(unittest.TestCase):
    def test_base_bucket_for_fresh_character(self):
        entry = {"stars": 1, "awakening": 0}
        detail = {"rarity": 1, "skill_links": {"awakening": []}}
        summary = sr.summarize_character_progression(entry, detail, None)
        self.assertEqual(summary["progress_bucket"], "base")
        self.assertEqual(summary["unlock_state"], "none")

    def test_maxed_bucket_when_fully_awakened(self):
        entry = {"stars": 5, "awakening": 5}
        detail = {"rarity": 5, "skill_links": {"awakening": ["a", "b", "c", "d"]}}
        summary = sr.summarize_character_progression(entry, detail, None)
        self.assertEqual(summary["progress_bucket"], "maxed")
        self.assertEqual(summary["unlock_state"], "full")

    def test_partial_unlock_state(self):
        entry = {"stars": 3, "awakening": 2}
        detail = {"rarity": 3, "skill_links": {"awakening": ["a", "b", "c"]}}
        summary = sr.summarize_character_progression(entry, detail, None)
        self.assertEqual(summary["unlocked_skill_nodes"], 1)
        self.assertEqual(summary["unlock_state"], "partial")


class SupportProgressionSummaryTests(unittest.TestCase):
    def test_starter_bucket_at_low_level(self):
        entry = {"level": 1, "limit_break": 0}
        detail = {"rarity": 1, "effects": [], "unique_effects": []}
        summary = sr.summarize_support_progression(entry, detail, None)
        self.assertEqual(summary["level_cap"], 20)
        self.assertEqual(summary["progress_bucket"], "starter")
        self.assertFalse(summary["usable"])

    def test_maxed_bucket_at_cap(self):
        entry = {"level": 20, "limit_break": 0}
        detail = {"rarity": 1, "effects": [], "unique_effects": []}
        summary = sr.summarize_support_progression(entry, detail, None)
        self.assertEqual(summary["progress_bucket"], "maxed")
        self.assertTrue(summary["usable"])

    def test_level_is_clamped_to_computed_cap_not_raw_input(self):
        # rarity 1 + limit_break 0 caps at 20, even if the roster entry claims level 45.
        entry = {"level": 45, "limit_break": 0}
        detail = {"rarity": 1, "effects": [], "unique_effects": []}
        summary = sr.summarize_support_progression(entry, detail, None)
        self.assertEqual(summary["level"], 20)


class LegacyFactorNormalizationTests(unittest.TestCase):
    def test_stat_factor(self):
        factor = legacy_factors.normalize_legacy_factor(
            {"kind": "stat", "target_key": "speed", "stars": 2}, make_catalogs()
        )
        self.assertEqual(factor["target_label"], "Speed")
        self.assertEqual(factor["stars"], 2)

    def test_invalid_kind_raises(self):
        with self.assertRaises(ValueError):
            legacy_factors.normalize_legacy_factor({"kind": "bogus", "target_key": "x", "stars": 1}, make_catalogs())

    def test_stars_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            legacy_factors.normalize_legacy_factor({"kind": "stat", "target_key": "speed", "stars": 4}, make_catalogs())

    def test_unknown_stat_target_raises(self):
        with self.assertRaises(ValueError):
            legacy_factors.normalize_legacy_factor({"kind": "stat", "target_key": "luck", "stars": 1}, make_catalogs())

    def test_scenario_factor_resolves_against_catalog(self):
        factor = legacy_factors.normalize_legacy_factor(
            {"kind": "scenario", "target_key": "scn_1", "stars": 3}, make_catalogs()
        )
        self.assertEqual(factor["target_label"], "URA Finale")
        self.assertEqual(factor["scenario_id"], "scn_1")

    def test_g1_factor_resolves_by_race_id_fallback(self):
        factor = legacy_factors.normalize_legacy_factor(
            {"kind": "g1", "target_key": "", "race_id": "race_1", "stars": 1}, make_catalogs()
        )
        self.assertEqual(factor["target_key"], "g1_1")
        self.assertEqual(factor["target_label"], "Tokyo Yushun")

    def test_skill_factor_resolves_against_catalog(self):
        factor = legacy_factors.normalize_legacy_factor(
            {"kind": "skill", "skill_id": "skill_1", "target_key": "", "stars": 1}, make_catalogs()
        )
        self.assertEqual(factor["target_label"], "Corner Recovery")

    def test_unique_factor_requires_character_unique_skill(self):
        character_ref = make_character_ref(unique_id="unique_1", unique_name="Uma Stan")
        factor = legacy_factors.normalize_legacy_factor(
            {"kind": "unique", "target_key": "", "stars": 1},
            make_catalogs(),
            character_ref=character_ref,
        )
        self.assertEqual(factor["target_key"], "unique_1")
        self.assertEqual(factor["target_label"], "Uma Stan")

    def test_unique_factor_without_character_unique_skill_raises(self):
        character_ref = make_character_ref(unique_id=None)
        with self.assertRaises(ValueError):
            legacy_factors.normalize_legacy_factor(
                {"kind": "unique", "target_key": "", "stars": 1},
                make_catalogs(),
                character_ref=character_ref,
            )


class DedupeLegacyFactorsTests(unittest.TestCase):
    def test_keeps_highest_star_duplicate(self):
        factors = [
            {"kind": "stat", "target_key": "speed", "target_label": "Speed", "stars": 1},
            {"kind": "stat", "target_key": "speed", "target_label": "Speed", "stars": 3},
        ]
        deduped = legacy_factors.dedupe_legacy_factors(factors)
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["stars"], 3)

    def test_sorts_by_kind_then_label(self):
        factors = [
            {"kind": "stat", "target_key": "wit", "target_label": "Wit", "stars": 1},
            {"kind": "stat", "target_key": "speed", "target_label": "Speed", "stars": 1},
        ]
        deduped = legacy_factors.dedupe_legacy_factors(factors)
        self.assertEqual([f["target_label"] for f in deduped], ["Speed", "Wit"])

    def test_white_sparks_only_keep_scenario_g1_skill(self):
        sparks = [
            {"kind": "stat", "target_key": "speed", "target_label": "Speed", "stars": 1},
            {"kind": "scenario", "target_key": "scn_1", "target_label": "URA Finale", "stars": 2},
        ]
        deduped = legacy_factors.dedupe_legacy_white_sparks(sparks)
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["kind"], "scenario")


class SparkTypeValidationTests(unittest.TestCase):
    def test_blue_spark_accepts_stat_only(self):
        catalogs = make_catalogs()
        spark = legacy_factors.normalize_blue_spark({"kind": "stat", "target_key": "speed", "stars": 2}, catalogs)
        self.assertEqual(spark["kind"], "stat")
        with self.assertRaises(ValueError):
            legacy_factors.normalize_blue_spark({"kind": "surface", "target_key": "turf", "stars": 2}, catalogs)

    def test_blue_spark_none_or_empty_is_none(self):
        catalogs = make_catalogs()
        self.assertIsNone(legacy_factors.normalize_blue_spark(None, catalogs))
        self.assertIsNone(legacy_factors.normalize_blue_spark("", catalogs))

    def test_pink_spark_accepts_surface_distance_or_style(self):
        catalogs = make_catalogs()
        spark = legacy_factors.normalize_pink_spark({"kind": "surface", "target_key": "turf", "stars": 1}, catalogs)
        self.assertEqual(spark["kind"], "surface")
        with self.assertRaises(ValueError):
            legacy_factors.normalize_pink_spark({"kind": "stat", "target_key": "speed", "stars": 1}, catalogs)

    def test_green_spark_requires_character_that_supports_it(self):
        catalogs = make_catalogs()
        eligible_character = make_character_ref(rarity=3, unique_id="unique_1")
        spark = legacy_factors.normalize_green_spark(
            {"kind": "unique", "target_key": "", "stars": 1},
            catalogs,
            character_ref=eligible_character,
            stars=3,
        )
        self.assertEqual(spark["kind"], "unique")

    def test_green_spark_rejected_below_three_stars(self):
        catalogs = make_catalogs()
        character_ref = make_character_ref(rarity=3, unique_id="unique_1")
        with self.assertRaises(ValueError):
            legacy_factors.normalize_green_spark(
                {"kind": "unique", "target_key": "", "stars": 1},
                catalogs,
                character_ref=character_ref,
                stars=2,
            )

    def test_white_sparks_rejects_non_white_kinds(self):
        catalogs = make_catalogs()
        with self.assertRaises(ValueError):
            legacy_factors.normalize_white_sparks(
                [{"kind": "stat", "target_key": "speed", "stars": 1}], catalogs
            )


class CharacterSupportsGreenSparkTests(unittest.TestCase):
    def test_true_when_three_stars_and_unique_skill(self):
        character_ref = make_character_ref(rarity=3, unique_id="unique_1")
        self.assertTrue(legacy_factors.character_supports_green_spark(character_ref, stars=3))

    def test_false_below_three_stars(self):
        character_ref = make_character_ref(rarity=3, unique_id="unique_1")
        self.assertFalse(legacy_factors.character_supports_green_spark(character_ref, stars=2))

    def test_false_without_unique_skill(self):
        character_ref = make_character_ref(rarity=3, unique_id=None)
        self.assertFalse(legacy_factors.character_supports_green_spark(character_ref, stars=5))


class BuildPairCompatibilityTests(unittest.TestCase):
    def test_sums_relation_points_for_shared_groups(self):
        catalogs = make_catalogs(
            compatibility={
                "10": {
                    "relation_groups": [
                        {"relation_type": "classmate", "relation_point": 10, "other_character_ids": [20, 30], "member_count": 3},
                        {"relation_type": "rival", "relation_point": 5, "other_character_ids": [99], "member_count": 2},
                    ],
                    "top_matches": [{"character_id": 20, "shared_relation_count": 4}],
                }
            }
        )
        result = sr.build_pair_compatibility(10, 20, catalogs)
        self.assertEqual(result["score"], 10)
        self.assertEqual(result["shared_group_count"], 1)
        self.assertEqual(result["shared_relation_count"], 4)

    def test_no_relation_yields_zero_score(self):
        catalogs = make_catalogs(compatibility={})
        result = sr.build_pair_compatibility(1, 2, catalogs)
        self.assertEqual(result["score"], 0)
        self.assertEqual(result["shared_groups"], [])


class RosterEntryNormalizationTests(unittest.TestCase):
    def test_empty_dict_normalizes_to_none(self):
        self.assertIsNone(sr.normalize_roster_entry("characters", {}))

    def test_non_dict_normalizes_to_none(self):
        self.assertIsNone(sr.normalize_roster_entry("characters", "nope"))

    def test_character_fields_are_validated(self):
        entry = sr.normalize_roster_entry(
            "characters", {"owned": True, "stars": 5, "awakening": 3, "unique_level": 4}
        )
        self.assertEqual(entry, {"owned": True, "stars": 5, "awakening": 3, "unique_level": 4})

    def test_character_stars_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            sr.normalize_roster_entry("characters", {"stars": 6})

    def test_support_level_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            sr.normalize_roster_entry("supports", {"level": 51})

    def test_support_limit_break_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            sr.normalize_roster_entry("supports", {"limit_break": 5})

    def test_owned_must_be_bool(self):
        with self.assertRaises(ValueError):
            sr.normalize_roster_entry("characters", {"owned": "yes"})


class BuildFieldNormalizationTests(unittest.TestCase):
    def test_build_stats_accepts_known_keys_in_range(self):
        stats = sr.normalize_build_stats({"speed": 1200, "stamina": 800})
        self.assertEqual(stats, {"speed": 1200, "stamina": 800})

    def test_build_stats_rejects_out_of_range(self):
        with self.assertRaises(ValueError):
            sr.normalize_build_stats({"speed": 5000})

    def test_build_aptitudes_normalizes_case_and_validates_grade(self):
        aptitudes = sr.normalize_build_aptitudes({"surface": "s", "distance": "A"})
        self.assertEqual(aptitudes, {"surface": "S", "distance": "A"})

    def test_build_aptitudes_rejects_invalid_grade(self):
        with self.assertRaises(ValueError):
            sr.normalize_build_aptitudes({"surface": "Z"})

    def test_build_id_list_dedupes_and_strips(self):
        ids = sr.normalize_build_id_list([" a ", "b", "a"], field_name="build.support_deck")
        self.assertEqual(ids, ["a", "b"])

    def test_build_id_list_enforces_max_items(self):
        with self.assertRaises(ValueError):
            sr.normalize_build_id_list(["a", "b", "c"], field_name="build.support_deck", max_items=2)

    def test_legacy_pair_rejects_identical_parents(self):
        with self.assertRaises(ValueError):
            sr.normalize_build_legacy_pair({"parent_a": "legacy_001", "parent_b": "legacy_001"})

    def test_legacy_pair_rejects_malformed_id(self):
        with self.assertRaises(ValueError):
            sr.normalize_build_legacy_pair({"parent_a": "not-a-legacy-id"})


class SequentialIdTests(unittest.TestCase):
    def test_next_build_id_starts_at_one(self):
        self.assertEqual(sr.next_build_id([]), "build_001")

    def test_next_build_id_increments_past_highest_existing(self):
        entries = [{"id": "build_001"}, {"id": "build_004"}]
        self.assertEqual(sr.next_build_id(entries), "build_005")

    def test_next_legacy_id_ignores_malformed_ids(self):
        entries = [{"id": "legacy_002"}, {"id": "not-an-id"}]
        self.assertEqual(sr.next_legacy_id(entries), "legacy_003")

    def test_next_profile_id_increments(self):
        profiles = [{"id": "p_001"}, {"id": "p_002"}]
        self.assertEqual(sr.next_profile_id(profiles), "p_003")


class UniqueProfileNameTests(unittest.TestCase):
    def test_returns_base_name_when_unique(self):
        self.assertEqual(sr.unique_profile_name("Main", set()), "Main")

    def test_appends_imported_suffix_on_collision(self):
        self.assertEqual(sr.unique_profile_name("Main", {"Main"}), "Main (imported)")

    def test_appends_incrementing_index_on_further_collision(self):
        existing = {"Main", "Main (imported)"}
        self.assertEqual(sr.unique_profile_name("Main", existing), "Main (imported) 2")


if __name__ == "__main__":
    unittest.main()
