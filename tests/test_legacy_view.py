"""Integration tests for build_legacy_view / build_legacy_simulator_preview.

Both functions are I/O-bound orchestration per docs/REFACTOR_PLAN.md's own
pure/I-O boundary (they read/write data/user/profiles/<id>/legacy.json and
call build_legacy_reference_catalogs()), which is exactly why they were left
untested when the pure legacy_factors helpers were unit-tested directly.

To keep these deterministic and CI-safe regardless of whether a real
GameTora import has been run (data/normalized/*.json and dist/ are
gitignored, see CLAUDE.md), every test here isolates PROFILE_DATA_ROOT /
USER_DATA_ROOT / NORMALIZED_ROOT to a temp directory and monkeypatches
build_legacy_reference_catalogs() to return a fixed fake catalog, the same
approach the existing normalize_legacy_factor tests use via make_catalogs().
"""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from . import _pathsetup  # noqa: F401  (must run before importing serve_reference)

import serve_reference as sr
from lib import gametora_reference as gt
from lib import sqlite_reference as sqlite_sr

from .test_gametora_reference import make_base_character, make_character_card, make_source_config, make_source_metadata
from .test_serve_reference import make_catalogs
from .test_sqlite_reference_build import build_minimal_normalized_reference


def make_full_character_ref(
    *,
    char_id="char_1",
    name="Special Week",
    variant="",
    rarity=3,
    base_character_id=101,
    unique_id="unique_1",
    unique_name="Uma Stan",
):
    unique_skills = [{"id": unique_id, "name": unique_name, "rarity": 1, "cost": 100}] if unique_id else []
    return {
        "id": char_id,
        "media": {"portrait": f"/media/characters/{char_id}.png"},
        "detail": {
            "name": name,
            "variant": variant,
            "rarity": rarity,
            "base_character_id": base_character_id,
            "skill_links": {"unique": unique_skills},
        },
    }


def make_legacy_payload(character_card_id, **overrides):
    payload = {
        "character_card_id": character_card_id,
        "blue_spark": {"kind": "stat", "target_key": "speed", "stars": 2},
        "pink_spark": {"kind": "surface", "target_key": "turf", "stars": 3},
    }
    payload.update(overrides)
    return payload


class LegacyIntegrationTestCase(unittest.TestCase):
    """Isolates user-data paths and reference catalogs for one profile."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        tmp_root = Path(self._tmp.name)

        for name, value in (
            ("USER_DATA_ROOT", tmp_root / "user"),
            ("PROFILE_DATA_ROOT", tmp_root / "user" / "profiles"),
            ("PROFILES_INDEX_PATH", tmp_root / "user" / "profiles.json"),
            ("NORMALIZED_ROOT", tmp_root / "normalized_missing"),
            ("REFERENCE_DB_PATH", tmp_root / "reference_missing.sqlite"),
        ):
            patcher = mock.patch.object(sr, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

        self.profile_id = "p_001"
        sr.ensure_user_data_roots()
        (sr.PROFILE_DATA_ROOT / self.profile_id).mkdir(parents=True, exist_ok=True)

    def patch_catalogs(self, **overrides):
        catalogs = make_catalogs(**overrides)
        patcher = mock.patch.object(sr, "build_legacy_reference_catalogs", return_value=catalogs)
        patcher.start()
        self.addCleanup(patcher.stop)
        return catalogs


class BuildLegacyViewTests(LegacyIntegrationTestCase):
    def test_empty_document_returns_empty_view_with_zero_counts(self):
        self.patch_catalogs()
        view = sr.build_legacy_view(self.profile_id)
        self.assertEqual(view["profile_id"], self.profile_id)
        self.assertEqual(view["items"], [])

    def test_falls_back_to_empty_view_when_reference_catalogs_are_unavailable(self):
        patcher = mock.patch.object(sr, "build_legacy_reference_catalogs", side_effect=FileNotFoundError("characters"))
        patcher.start()
        self.addCleanup(patcher.stop)
        view = sr.build_legacy_view(self.profile_id)
        self.assertEqual(view["items"], [])

    def test_one_entry_produces_a_populated_item_with_lineage_and_scenario_badges(self):
        catalogs = self.patch_catalogs(
            characters={"char_1": make_full_character_ref()},
            scenarios={"scn_1": {"scenario_id": "scn_1", "id": "scn_1", "name": "URA Finale"}},
        )
        sr.create_legacy_entry(self.profile_id, make_legacy_payload("char_1", scenario_id="scn_1"))

        view = sr.build_legacy_view(self.profile_id)
        self.assertEqual(len(view["items"]), 1)
        item = view["items"][0]
        self.assertEqual(item["title"], "Special Week")
        self.assertIn("0/2 lineage", item["badges"])
        self.assertIn("Blue Speed 2★", item["badges"])
        self.assertIn("Pink Turf 3★", item["badges"])

        scenario_options = {option["value"]: option for option in view["filter_options"]["scenario_id"]}
        self.assertEqual(scenario_options["scn_1"]["label"], "URA Finale")
        self.assertEqual(scenario_options["scn_1"]["count"], 1)
        self.assertEqual(catalogs["characters"]["char_1"]["detail"]["name"], "Special Week")


class BuildLegacySimulatorPreviewTests(LegacyIntegrationTestCase):
    def seed_two_parents_and_owned_main(self):
        self.patch_catalogs(
            characters={
                "char_main": make_full_character_ref(char_id="char_main", name="Main Candidate", base_character_id=1),
                "char_a": make_full_character_ref(char_id="char_a", name="Parent A", base_character_id=2, unique_id=None),
                "char_b": make_full_character_ref(char_id="char_b", name="Parent B", base_character_id=3, unique_id=None),
            }
        )
        sr.save_roster(self.profile_id, {"characters": {"char_main": {"owned": True}}})
        parent_a = sr.create_legacy_entry(self.profile_id, make_legacy_payload("char_a"))["entry"]
        parent_b = sr.create_legacy_entry(self.profile_id, make_legacy_payload("char_b"))["entry"]
        return parent_a, parent_b

    def test_requires_all_three_ids(self):
        with self.assertRaises(ValueError):
            sr.build_legacy_simulator_preview(self.profile_id, {"main_character_id": "char_main"})

    def test_rejects_the_same_parent_twice(self):
        with self.assertRaises(ValueError):
            sr.build_legacy_simulator_preview(
                self.profile_id,
                {"main_character_id": "char_main", "parent_a_legacy_id": "legacy_001", "parent_b_legacy_id": "legacy_001"},
            )

    def test_rejects_a_main_character_that_is_not_owned(self):
        self.patch_catalogs(characters={"char_main": make_full_character_ref(char_id="char_main")})
        with self.assertRaises(ValueError):
            sr.build_legacy_simulator_preview(
                self.profile_id,
                {"main_character_id": "char_main", "parent_a_legacy_id": "legacy_001", "parent_b_legacy_id": "legacy_002"},
            )

    def test_rejects_an_unknown_parent_legacy_id(self):
        parent_a, _ = self.seed_two_parents_and_owned_main()
        with self.assertRaises(ValueError):
            sr.build_legacy_simulator_preview(
                self.profile_id,
                {"main_character_id": "char_main", "parent_a_legacy_id": parent_a["id"], "parent_b_legacy_id": "legacy_999"},
            )

    def test_happy_path_computes_compatibility_and_spark_summaries(self):
        parent_a, parent_b = self.seed_two_parents_and_owned_main()
        self.patch_catalogs(
            characters={
                "char_main": make_full_character_ref(char_id="char_main", name="Main Candidate", base_character_id=1),
                "char_a": make_full_character_ref(char_id="char_a", base_character_id=2, unique_id=None),
                "char_b": make_full_character_ref(char_id="char_b", base_character_id=3, unique_id=None),
            },
            compatibility={
                "1": {
                    "relation_groups": [
                        {"relation_type": "classmate", "relation_point": 25, "other_character_ids": [2, 3], "member_count": 3},
                    ],
                },
            },
        )

        preview = sr.build_legacy_simulator_preview(
            self.profile_id,
            {"main_character_id": "char_main", "parent_a_legacy_id": parent_a["id"], "parent_b_legacy_id": parent_b["id"]},
        )

        self.assertEqual(preview["main"]["title"], "Main Candidate")
        self.assertEqual(preview["compatibility_summary"]["direct"]["total_score"], 50)
        self.assertEqual(preview["compatibility_summary"]["overall_score"], 50)
        self.assertIn(
            "Both direct parents have strong compatibility with the main candidate.",
            preview["highlights"],
        )
        self.assertIn(
            "The lineage is incomplete: one or more grandparent slots are still missing.",
            preview["warnings"],
        )


class BuildLegacyReferenceCatalogsFromSqliteTests(LegacyIntegrationTestCase):
    """Exercises build_legacy_reference_catalogs() for real (not the
    patch_catalogs() bypass every other test in this file uses on purpose),
    against a real temp SQLite database - this is the only place that
    actually verifies the SQL-backed rewrite of that function.
    """

    def build_database(self, *, with_characters=True):
        normalized = build_minimal_normalized_reference()
        if with_characters:
            normalized["characters"] = gt.normalize_characters(
                make_source_config("characters"), make_source_metadata(), [make_base_character()], [make_character_card()], []
            )
        normalized["scenarios"] = gt.normalize_scenarios(
            make_source_config("scenarios"), make_source_metadata(), [{"id": "10", "order": 1}], [{"id": "10", "str": "scenario_ura", "factors": []}], []
        )
        normalized["g1_factors"] = gt.normalize_g1_factors(
            make_source_config("g1_factors"),
            make_source_metadata(),
            {"race": [{"id": 900, "race_id": 42, "name_en": "Tokyo Yushun Aptitude", "type": 1, "effects": []}]},
            [],
            [],
        )
        normalized["skills"] = gt.normalize_skills(
            make_source_config("skills"), make_source_metadata(), [{"id": 200452, "rarity": 1, "name_en": "Corner Recovery"}], [], [], []
        )
        normalized["compatibility"] = gt.normalize_compatibility(
            make_source_config("compatibility"),
            make_source_metadata(),
            [{"relation_type": "classmate", "relation_point": 10}],
            [{"relation_type": "classmate", "chara_id": 1001}, {"relation_type": "classmate", "chara_id": 1002}],
            [{"char_id": 1001, "en_name": "Special Week"}, {"char_id": 1002, "en_name": "Silence Suzuka"}],
            [],
        )
        sqlite_sr.build_reference_database({}, normalized, None, target_path=sr.REFERENCE_DB_PATH)

    def test_all_five_catalogs_are_loaded_from_the_real_database(self):
        self.build_database()
        catalogs = sr.build_legacy_reference_catalogs()
        self.assertEqual(catalogs["characters"]["100101"]["name"], "Special Week")
        self.assertEqual(catalogs["scenarios"]["10"]["key"], "scenario_ura")
        self.assertEqual(catalogs["g1_factors"]["900"]["name"], "Tokyo Yushun Aptitude")
        self.assertEqual(catalogs["skills"]["200452"]["name"], "Corner Recovery")
        self.assertEqual(catalogs["compatibility"]["1001"]["top_matches"][0]["character_id"], 1002)

    def test_missing_database_raises_uncaught_file_not_found_error(self):
        # build_legacy_reference_catalogs() has never wrapped its characters
        # fetch in a try/except (only scenarios/g1_factors/skills/
        # compatibility are individually tolerant of a missing table) - a
        # missing database must still propagate uncaught here, exactly like
        # the original load_reference_items_lookup("characters") JSON call did.
        with self.assertRaises(FileNotFoundError):
            sr.build_legacy_reference_catalogs()


if __name__ == "__main__":
    unittest.main()
