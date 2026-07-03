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


if __name__ == "__main__":
    unittest.main()
