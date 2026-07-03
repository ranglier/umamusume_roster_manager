import unittest

from . import _pathsetup  # noqa: F401  (must run before importing lib.gametora_reference)

from lib import gametora_reference as gt


class DistanceCategoryTests(unittest.TestCase):
    def test_short_boundary(self):
        self.assertEqual(gt.get_distance_category_label(1400), "Short")
        self.assertEqual(gt.get_distance_category_label(1401), "Mile")

    def test_mile_boundary(self):
        self.assertEqual(gt.get_distance_category_label(1800), "Mile")
        self.assertEqual(gt.get_distance_category_label(1801), "Medium")

    def test_medium_boundary(self):
        self.assertEqual(gt.get_distance_category_label(2400), "Medium")
        self.assertEqual(gt.get_distance_category_label(2401), "Long")

    def test_varies_sentinel(self):
        self.assertEqual(gt.get_distance_category_label(99999), "Varies")

    def test_slug_matches_label_casing(self):
        self.assertEqual(gt.get_distance_category_slug(1200), "short")
        self.assertEqual(gt.get_distance_category_slug(99999), "varies")

    def test_from_code_mapping(self):
        self.assertEqual(gt.get_distance_category_from_code(1), "Short")
        self.assertEqual(gt.get_distance_category_from_code(4), "Long")
        self.assertEqual(gt.get_distance_category_from_code(999), "Unknown")

    def test_slug_from_code_mapping(self):
        self.assertEqual(gt.get_distance_category_slug_from_code(2), "mile")
        self.assertEqual(gt.get_distance_category_slug_from_code(999), "unknown")


class CourseLayoutSlugTests(unittest.TestCase):
    def test_known_codes(self):
        self.assertEqual(gt.get_course_layout_slug(1), "main")
        self.assertEqual(gt.get_course_layout_slug(4), "outer-to-inner")
        self.assertEqual(gt.get_course_layout_slug(99999), "varies")

    def test_unknown_code_falls_back(self):
        self.assertEqual(gt.get_course_layout_slug(12345), "unknown")


class RaceGradeLabelTests(unittest.TestCase):
    def test_known_group_and_grade(self):
        self.assertEqual(gt.get_race_grade_label(1, 100), "G1")
        self.assertEqual(gt.get_race_grade_label(1, 400), "OP")

    def test_unknown_grade_in_known_group_falls_back(self):
        self.assertEqual(gt.get_race_grade_label(1, 999), "Unknown grade")


def make_source_config(entity_key="supports"):
    return {
        "sourceSite": "GameTora",
        "entities": [{"key": entity_key, "label": "Supports", "datasetKeys": [], "pageUrls": []}],
        "assets": {},
    }


def make_source_metadata():
    return {"datasets": {}}


def make_support_card(**overrides):
    card = {
        "support_id": 30098,
        "char_id": 1001,
        "char_name": "Special Week",
        "rarity": 3,
        "type": "speed",
        "hints": {},
    }
    card.update(overrides)
    return card


class NormalizeSupportsTests(unittest.TestCase):
    # GameTora started returning some cards' hint_others as a mix of flat hint
    # objects and nested lists of hint objects (e.g. support 30098) instead of
    # always-flat objects, which crashed normalize_supports with
    # AttributeError: 'list' object has no attribute 'get'. This pins the fix.
    def test_grouped_hint_others_are_flattened(self):
        card = make_support_card(
            hints={
                "hint_others": [
                    {"hint_type": 1, "hint_value": 5},
                    [{"hint_type": 2, "hint_value": 2}, {"hint_type": 3, "hint_value": 6}],
                ]
            }
        )
        result = gt.normalize_supports(make_source_config(), make_source_metadata(), [card], [], [])
        hint_effects = result["items"][0]["hint_other_effects"]
        self.assertEqual(
            hint_effects,
            [
                {"hint_type": 1, "hint_value": 5},
                {"hint_type": 2, "hint_value": 2},
                {"hint_type": 3, "hint_value": 6},
            ],
        )

    def test_non_dict_hint_entries_are_skipped(self):
        card = make_support_card(hints={"hint_others": [{"hint_type": 1, "hint_value": 5}, "garbage", 42, None]})
        result = gt.normalize_supports(make_source_config(), make_source_metadata(), [card], [], [])
        self.assertEqual(result["items"][0]["hint_other_effects"], [{"hint_type": 1, "hint_value": 5}])

    def test_missing_hints_produce_no_hint_effects(self):
        card = make_support_card(hints=None)
        result = gt.normalize_supports(make_source_config(), make_source_metadata(), [card], [], [])
        self.assertEqual(result["items"][0]["hint_other_effects"], [])

    def test_basic_item_shape_and_name_fallback(self):
        card = make_support_card(char_name=None, name_jp="スペシャルウィーク")
        result = gt.normalize_supports(make_source_config(), make_source_metadata(), [card], [], [])
        item = result["items"][0]
        self.assertEqual(item["id"], "30098")
        self.assertEqual(item["support_id"], 30098)
        self.assertEqual(item["character_id"], 1001)
        self.assertEqual(item["rarity"], 3)
        self.assertEqual(item["name"], "スペシャルウィーク")


def make_character_card(**overrides):
    card = {
        "card_id": 100101,
        "char_id": 1001,
        "name_en": "Special Week",
        "title_en_gl": "[Special Dreamer]",
        "rarity": 3,
        # turf, dirt, short, mile, medium, long, runner, leader, betweener, chaser
        "aptitude": ["A", "G", "B", "A", "A", "C", "A", "B", "C", "D"],
        "stat_bonus": [10, 10, 5, 5, 0],
        "base_stats": [90, 80, 70, 60, 50],
        "four_star_stats": [100, 90, 80, 70, 60],
        "five_star_stats": [110, 100, 90, 80, 70],
    }
    card.update(overrides)
    return card


def make_base_character(**overrides):
    base = {
        "char_id": 1001,
        "url_name": "special-week",
        "sex": 2,
        "birth_month": 3,
        "birth_day": 2,
        "playable": True,
    }
    base.update(overrides)
    return base


class NormalizeCharactersTests(unittest.TestCase):
    def test_basic_item_shape(self):
        card = make_character_card()
        base = make_base_character()
        result = gt.normalize_characters(make_source_config("characters"), make_source_metadata(), [base], [card], [])
        item = result["items"][0]
        self.assertEqual(item["id"], "100101")
        self.assertEqual(item["card_id"], 100101)
        self.assertEqual(item["base_character_id"], 1001)
        self.assertEqual(item["base_url_name"], "special-week")
        self.assertEqual(item["rarity"], 3)
        self.assertEqual(item["name"], "Special Week")

    def test_aptitude_grades_map_to_named_slots(self):
        card = make_character_card()
        result = gt.normalize_characters(make_source_config("characters"), make_source_metadata(), [make_base_character()], [card], [])
        aptitudes = result["items"][0]["aptitudes"]
        self.assertEqual(aptitudes["surface"], {"turf": "A", "dirt": "G"})
        self.assertEqual(aptitudes["distance"], {"short": "B", "mile": "A", "medium": "A", "long": "C"})
        self.assertEqual(aptitudes["style"], {"runner": "A", "leader": "B", "betweener": "C", "chaser": "D"})

    def test_viable_aptitudes_keep_only_a_grade_and_above(self):
        card = make_character_card()
        result = gt.normalize_characters(make_source_config("characters"), make_source_metadata(), [make_base_character()], [card], [])
        viable = result["items"][0]["viable_aptitudes"]
        self.assertEqual(viable["surface"], ["turf"])
        self.assertEqual(viable["distance"], ["mile", "medium"])
        self.assertEqual(viable["style"], ["runner"])

    # A card can reference a base_character_id that isn't in the base
    # characters dataset (e.g. datasets fetched slightly out of sync) — the
    # profile section must degrade to None fields instead of crashing.
    def test_missing_base_character_leaves_profile_fields_none(self):
        card = make_character_card(char_id=9999)
        result = gt.normalize_characters(make_source_config("characters"), make_source_metadata(), [make_base_character()], [card], [])
        item = result["items"][0]
        self.assertIsNone(item["base_url_name"])
        self.assertEqual(
            item["profile"],
            {
                "birthday": None,
                "height_cm": None,
                "measurements": None,
                "sex": None,
                "race": None,
                "playable": None,
                "active": None,
                "voice_actor": None,
                "real_life": None,
            },
        )

    def test_profile_resolves_sex_and_birthday_from_base_character(self):
        card = make_character_card()
        result = gt.normalize_characters(make_source_config("characters"), make_source_metadata(), [make_base_character()], [card], [])
        profile = result["items"][0]["profile"]
        self.assertEqual(profile["sex"], "Stallion")
        self.assertEqual(profile["birthday"], "03-02")


if __name__ == "__main__":
    unittest.main()
