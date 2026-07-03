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


if __name__ == "__main__":
    unittest.main()
