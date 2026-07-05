"""Integration test for build_reference_database.

Everything else in sqlite_reference.py tests pure helpers in isolation
(tests/test_sqlite_reference.py). build_reference_database() itself and the
~20 `_insert_*` functions it calls are I/O-bound (they write real SQLite
rows) and had zero coverage - the write side of the SQLite migration
described in docs/PROJECT_STATUS.md runs in production today without a
single test ever having queried back what it wrote.

Rather than hand-build a "normalized" fixture and guess at what each
_insert_* function expects, this drives the exact same normalize_X functions
from lib.gametora_reference that the real update pipeline uses (reusing
their fixtures from tests/test_gametora_reference.py), so the shape handed
to build_reference_database() is identical to production. This is a real
sqlite3 database on a temp path - not mocked - the whole point is to prove
the write path doesn't silently drop or corrupt data.
"""

import sqlite3
import tempfile
import unittest
from pathlib import Path

from . import _pathsetup  # noqa: F401  (must run before importing lib modules)

from lib import gametora_reference as gt
from lib import sqlite_reference as sr

from .test_gametora_reference import (
    make_base_character,
    make_character_card,
    make_source_config,
    make_source_metadata,
    make_support_card,
)


def build_minimal_normalized_reference():
    metadata = make_source_metadata()
    character_card = make_character_card()
    base_character = make_base_character()
    support_card = make_support_card()

    return {
        "characters": gt.normalize_characters(make_source_config("characters"), metadata, [base_character], [character_card], []),
        "character_progression": gt.normalize_character_progression(make_source_config("character_progression"), metadata, [character_card], [], []),
        "supports": gt.normalize_supports(make_source_config("supports"), metadata, [support_card], [], []),
        "support_progression": gt.normalize_support_progression(make_source_config("support_progression"), metadata, [], [support_card]),
        "skills": gt.normalize_skills(make_source_config("skills"), metadata, [], [], [], []),
        "races": gt.normalize_races(make_source_config("races"), metadata, [], []),
        "racetracks": gt.normalize_racetracks(make_source_config("racetracks"), metadata, []),
        "g1_factors": gt.normalize_g1_factors(make_source_config("g1_factors"), metadata, {"race": []}, [], []),
        "cm_targets": gt.normalize_cm_targets(make_source_config("cm_targets"), metadata, [], [], []),
        "scenarios": gt.normalize_scenarios(make_source_config("scenarios"), metadata, [], [], []),
        "training_events": gt.normalize_training_events(make_source_config("training_events"), metadata, {}, [], [], []),
        "compatibility": gt.normalize_compatibility(make_source_config("compatibility"), metadata, [], [], [], []),
    }


class BuildReferenceDatabaseTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "reference.sqlite"

    def test_builds_a_real_database_file_and_reports_its_size(self):
        summary = sr.build_reference_database({}, build_minimal_normalized_reference(), None, target_path=self.db_path)
        self.assertEqual(summary["path"], str(self.db_path))
        self.assertTrue(self.db_path.exists())
        self.assertGreater(summary["size_bytes"], 0)

    def test_character_and_support_rows_actually_land_in_their_tables(self):
        sr.build_reference_database({}, build_minimal_normalized_reference(), None, target_path=self.db_path)
        connection = sqlite3.connect(self.db_path)
        try:
            character_count = connection.execute("SELECT COUNT(*) FROM characters").fetchone()[0]
            support_count = connection.execute("SELECT COUNT(*) FROM supports").fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(character_count, 1)
        self.assertEqual(support_count, 1)

    def test_progress_callback_is_invoked_with_increasing_progress(self):
        calls = []
        sr.build_reference_database(
            {}, build_minimal_normalized_reference(), None, target_path=self.db_path, progress_callback=calls.append
        )
        self.assertGreater(len(calls), 0)
        progress_values = [call["progress"] for call in calls]
        self.assertEqual(progress_values, sorted(progress_values))

    def test_read_reference_database_meta_round_trips_the_build_summary(self):
        sr.build_reference_database({}, build_minimal_normalized_reference(), None, target_path=self.db_path)
        meta = sr.read_reference_database_meta(self.db_path)
        self.assertEqual(meta["path"], str(self.db_path))
        self.assertEqual(meta["build"]["runtime_schema_version"], sr.SQLITE_RUNTIME_SCHEMA_VERSION)
        self.assertIn("characters", meta["entities"])
        self.assertEqual(meta["entities"]["characters"]["count"], 1)

    def test_read_reference_database_meta_is_none_when_the_file_does_not_exist(self):
        self.assertIsNone(sr.read_reference_database_meta(self.db_path))

    def test_rebuilding_replaces_the_database_rather_than_appending(self):
        sr.build_reference_database({}, build_minimal_normalized_reference(), None, target_path=self.db_path)
        sr.build_reference_database({}, build_minimal_normalized_reference(), None, target_path=self.db_path)
        connection = sqlite3.connect(self.db_path)
        try:
            character_count = connection.execute("SELECT COUNT(*) FROM characters").fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(character_count, 1)


if __name__ == "__main__":
    unittest.main()
