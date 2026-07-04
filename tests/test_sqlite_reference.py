import tempfile
import unittest
from pathlib import Path

from . import _pathsetup  # noqa: F401  (must run before importing lib.sqlite_reference)

from lib import sqlite_reference as sr


class AsArrayTests(unittest.TestCase):
    def test_none_becomes_empty_list(self):
        self.assertEqual(sr.as_array(None), [])

    def test_list_passes_through_unchanged(self):
        value = [1, 2, 3]
        self.assertIs(sr.as_array(value), value)

    def test_scalar_is_wrapped(self):
        self.assertEqual(sr.as_array("x"), ["x"])


class CoalesceTests(unittest.TestCase):
    def test_returns_first_non_none_value(self):
        self.assertEqual(sr.coalesce(None, None, "third"), "third")

    def test_skips_blank_strings(self):
        self.assertEqual(sr.coalesce("   ", "", "value"), "value")

    def test_returns_non_string_falsy_values_without_skipping(self):
        self.assertEqual(sr.coalesce(None, 0, "fallback"), 0)
        self.assertEqual(sr.coalesce(None, False, "fallback"), False)

    def test_all_none_or_blank_returns_none(self):
        self.assertIsNone(sr.coalesce(None, "", "   "))


class EncodeJsonTests(unittest.TestCase):
    def test_encodes_without_ascii_escaping_or_extra_whitespace(self):
        self.assertEqual(sr.encode_json({"name": "スペシャルウィーク", "n": 1}), '{"name":"スペシャルウィーク","n":1}')


class JoinSearchTextTests(unittest.TestCase):
    def test_flattens_lists_and_scalars_into_a_single_string(self):
        self.assertEqual(sr.join_search_text(["Special Week", ["Silence Suzuka", "Tokai Teio"]]), "Special Week Silence Suzuka Tokai Teio")

    def test_drops_blank_strings_and_none_but_keeps_other_falsy_scalars(self):
        self.assertEqual(sr.join_search_text(["  ", None, 0, "Speed"]), "0 Speed")

    def test_deduplicates_while_preserving_first_occurrence_order(self):
        self.assertEqual(sr.join_search_text(["Speed", "Stamina", "Speed"]), "Speed Stamina")


class ConvertDisplayLabelTests(unittest.TestCase):
    def test_underscore_and_hyphen_separated_values_are_title_cased(self):
        self.assertEqual(sr.convert_display_label("speed_up", None), "Speed Up")
        self.assertEqual(sr.convert_display_label("speed-up", None), "Speed Up")

    def test_mapping_takes_priority_over_the_generic_conversion(self):
        self.assertEqual(sr.convert_display_label("spd", {"spd": "Speed"}), "Speed")

    def test_none_or_blank_value_passes_through_unchanged(self):
        self.assertIsNone(sr.convert_display_label(None, None))
        self.assertEqual(sr.convert_display_label("   ", None), "   ")


class ConvertDisplayLabelListTests(unittest.TestCase):
    def test_converts_each_value_and_deduplicates_labels(self):
        result = sr.convert_display_label_list(["speed_up", "speed-up", "stamina_up"], None)
        self.assertEqual(result, ["Speed Up", "Stamina Up"])

    def test_wraps_a_bare_scalar_in_a_list(self):
        self.assertEqual(sr.convert_display_label_list("speed_up", None), ["Speed Up"])


class GetAssetEntriesTests(unittest.TestCase):
    def test_none_yields_no_entries(self):
        self.assertEqual(sr.get_asset_entries(None), [])

    def test_dict_yields_its_items(self):
        self.assertEqual(sr.get_asset_entries({"icon": "a.png"}), [("icon", "a.png")])

    def test_object_without_items_yields_no_entries(self):
        self.assertEqual(sr.get_asset_entries(42), [])


class EnsureDirectoryTests(unittest.TestCase):
    def test_creates_missing_nested_directories(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "a" / "b" / "c"
            sr.ensure_directory(target)
            self.assertTrue(target.is_dir())

    def test_is_idempotent_for_an_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            sr.ensure_directory(tmp_dir)
            sr.ensure_directory(tmp_dir)
            self.assertTrue(Path(tmp_dir).is_dir())

    def test_none_or_empty_path_is_a_no_op(self):
        sr.ensure_directory(None)
        sr.ensure_directory("")


class BoolIntTests(unittest.TestCase):
    def test_truthy_and_falsy_values_map_to_one_and_zero(self):
        self.assertEqual(sr.bool_int(True), 1)
        self.assertEqual(sr.bool_int("non-empty"), 1)
        self.assertEqual(sr.bool_int(False), 0)
        self.assertEqual(sr.bool_int(None), 0)
        self.assertEqual(sr.bool_int(0), 0)


class AvailabilityIntTests(unittest.TestCase):
    def test_none_and_false_are_unavailable(self):
        self.assertEqual(sr.availability_int(None), 0)
        self.assertEqual(sr.availability_int(False), 0)

    def test_anything_else_including_zero_is_available(self):
        self.assertEqual(sr.availability_int(0), 1)
        self.assertEqual(sr.availability_int(""), 1)
        self.assertEqual(sr.availability_int(True), 1)


class ScoreBandForValueTests(unittest.TestCase):
    def test_boundaries_map_to_the_expected_bands(self):
        self.assertEqual(sr.score_band_for_value(0), "0-9")
        self.assertEqual(sr.score_band_for_value(9), "0-9")
        self.assertEqual(sr.score_band_for_value(10), "10-14")
        self.assertEqual(sr.score_band_for_value(14), "10-14")
        self.assertEqual(sr.score_band_for_value(15), "15-19")
        self.assertEqual(sr.score_band_for_value(19), "15-19")
        self.assertEqual(sr.score_band_for_value(20), "20+")
        self.assertEqual(sr.score_band_for_value(999), "20+")


if __name__ == "__main__":
    unittest.main()
