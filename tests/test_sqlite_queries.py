import sqlite3
import tempfile
import unittest
from pathlib import Path

from . import _pathsetup  # noqa: F401  (must run before importing lib modules)

from lib import gametora_reference as gt
from lib import sqlite_queries as sq
from lib import sqlite_reference as sr

from .test_gametora_reference import make_character_card, make_source_config, make_source_metadata, make_support_card
from .test_sqlite_reference_build import build_minimal_normalized_reference


class ConnectTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "reference.sqlite"

    def test_raises_file_not_found_when_the_database_does_not_exist(self):
        with self.assertRaises(FileNotFoundError):
            sq._connect(self.db_path)

    def test_opens_a_row_factory_connection_for_an_existing_database(self):
        sr.build_reference_database({}, build_minimal_normalized_reference(), None, target_path=self.db_path)
        connection = sq._connect(self.db_path)
        try:
            row = connection.execute("SELECT COUNT(*) AS n FROM characters").fetchone()
            self.assertEqual(row["n"], 1)
        finally:
            connection.close()

    def test_query_only_pragma_blocks_write_attempts(self):
        sr.build_reference_database({}, build_minimal_normalized_reference(), None, target_path=self.db_path)
        connection = sq._connect(self.db_path)
        try:
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute("DELETE FROM characters")
        finally:
            connection.close()


class PopulatedDatabaseTestCase(unittest.TestCase):
    """Base class for tests against a real temp DB built from the standard
    build_minimal_normalized_reference() fixture: one character (id 100101,
    name "Special Week"), one support (id 30098), everything else empty.
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "reference.sqlite"
        sr.build_reference_database({}, build_minimal_normalized_reference(), None, target_path=self.db_path)


class FetchReferenceItemTests(PopulatedDatabaseTestCase):
    def test_known_id_returns_the_decoded_payload(self):
        item = sq.fetch_reference_item("characters", "100101", database_path=self.db_path)
        self.assertEqual(item["name"], "Special Week")

    def test_unknown_id_returns_none(self):
        self.assertIsNone(sq.fetch_reference_item("characters", "999999", database_path=self.db_path))

    def test_unknown_entity_key_returns_none(self):
        self.assertIsNone(sq.fetch_reference_item("not_a_real_entity", "100101", database_path=self.db_path))


class FetchReferenceItemsByIdTests(PopulatedDatabaseTestCase):
    def test_returns_only_the_requested_ids_that_exist(self):
        result = sq.fetch_reference_items_by_id("characters", ["100101", "999999"], database_path=self.db_path)
        self.assertEqual(set(result), {"100101"})
        self.assertEqual(result["100101"]["name"], "Special Week")

    def test_empty_id_list_returns_empty_dict_when_the_database_exists(self):
        self.assertEqual(sq.fetch_reference_items_by_id("characters", [], database_path=self.db_path), {})

    # An empty roster must still 404 as "reference not imported yet" rather
    # than silently succeed with an empty result - so this must raise even
    # with an empty id list, matching build_roster_view()'s expectations.
    def test_empty_id_list_against_a_missing_database_still_raises(self):
        missing_path = self.db_path.with_name("does-not-exist.sqlite")
        with self.assertRaises(FileNotFoundError):
            sq.fetch_reference_items_by_id("characters", [], database_path=missing_path)


class FetchAllReferenceItemsTests(PopulatedDatabaseTestCase):
    def test_returns_every_row_keyed_by_id(self):
        result = sq.fetch_all_reference_items("characters", database_path=self.db_path)
        self.assertEqual(set(result), {"100101"})

    def test_empty_entity_returns_empty_dict(self):
        self.assertEqual(sq.fetch_all_reference_items("races", database_path=self.db_path), {})

    def test_unknown_entity_key_returns_empty_dict(self):
        self.assertEqual(sq.fetch_all_reference_items("not_a_real_entity", database_path=self.db_path), {})


class FetchCompatibilityByCharacterIdTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "reference.sqlite"

        normalized = build_minimal_normalized_reference()
        normalized["compatibility"] = gt.normalize_compatibility(
            make_source_config("compatibility"),
            make_source_metadata(),
            [{"relation_type": "classmate", "relation_point": 10}],
            [{"relation_type": "classmate", "chara_id": 1001}, {"relation_type": "classmate", "chara_id": 1002}],
            [{"char_id": 1001, "en_name": "Special Week"}, {"char_id": 1002, "en_name": "Silence Suzuka"}],
            [],
        )
        sr.build_reference_database({}, normalized, None, target_path=self.db_path)

    def test_keyed_by_character_id_not_row_id(self):
        lookup = sq.fetch_compatibility_by_character_id(database_path=self.db_path)
        self.assertEqual(set(lookup), {"1001", "1002"})
        self.assertEqual(lookup["1001"]["top_matches"][0]["character_id"], 1002)


class ExistingIdsTests(PopulatedDatabaseTestCase):
    def test_returns_only_the_ids_that_exist(self):
        result = sq.existing_ids("characters", ["100101", "999999"], database_path=self.db_path)
        self.assertEqual(result, {"100101"})

    def test_empty_id_list_returns_empty_set(self):
        self.assertEqual(sq.existing_ids("characters", [], database_path=self.db_path), set())

    def test_unknown_entity_key_returns_empty_set(self):
        self.assertEqual(sq.existing_ids("not_a_real_entity", ["100101"], database_path=self.db_path), set())


class ProgressionLookupTests(PopulatedDatabaseTestCase):
    def test_character_progression_lookup_is_keyed_by_card_id(self):
        lookup = sq.fetch_character_progression_lookup(database_path=self.db_path)
        self.assertEqual(set(lookup), {"100101"})
        self.assertEqual(lookup["100101"]["card_id"], 100101)

    def test_support_progression_lookup_is_empty_when_the_fixture_has_no_level_curve_rows(self):
        # build_minimal_normalized_reference() passes an empty support_card_level
        # list, so normalize_support_progression produces zero items regardless
        # of the one support card present - nothing to key by rarity here.
        lookup = sq.fetch_support_progression_lookup(database_path=self.db_path)
        self.assertEqual(lookup, {})

    def test_support_progression_lookup_is_keyed_by_rarity_when_populated(self):
        normalized = build_minimal_normalized_reference()
        normalized["support_progression"] = gt.normalize_support_progression(
            make_source_config("support_progression"),
            make_source_metadata(),
            [{"id": 301, "rarity": 3, "level": 1, "total_exp": 1000}],
            [make_support_card()],
        )
        db_path = self.db_path.with_name("populated.sqlite")
        sr.build_reference_database({}, normalized, None, target_path=db_path)

        lookup = sq.fetch_support_progression_lookup(database_path=db_path)
        self.assertEqual(set(lookup), {3})
        self.assertEqual(lookup[3]["rarity"], 3)


class EntityListingTests(PopulatedDatabaseTestCase):
    def test_lists_every_entity_with_its_item_count(self):
        items = sq.fetch_entity_listing(database_path=self.db_path)
        by_entity = {entry["entity"]: entry for entry in items}
        self.assertEqual(by_entity["characters"]["count"], 1)
        self.assertEqual(by_entity["races"]["count"], 0)
        self.assertIn("source", by_entity["characters"])


class SupportRarityByIdTests(PopulatedDatabaseTestCase):
    def test_returns_rarity_keyed_by_support_id(self):
        lookup = sq.fetch_support_rarity_by_id(database_path=self.db_path)
        self.assertEqual(lookup, {"30098": 3})


class FetchBrowsableEntityTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "reference.sqlite"

        normalized = build_minimal_normalized_reference()
        cards = [
            make_character_card(card_id=100101, char_id=1001, name_en="Special Week", rarity=3),
            make_character_card(card_id=100201, char_id=1002, name_en="Silence Suzuka", rarity=3),
            make_character_card(card_id=100301, char_id=1003, name_en="Tokai Teio", rarity=2),
        ]
        normalized["characters"] = gt.normalize_characters(
            make_source_config("characters"), make_source_metadata(), [], cards, []
        )
        sr.build_reference_database({}, normalized, None, target_path=self.db_path)

    def test_no_filters_returns_every_row_and_respects_pagination(self):
        page = sq.fetch_browsable_entity("characters", limit=2, offset=0, database_path=self.db_path)
        self.assertEqual(page["total"], 3)
        self.assertEqual(len(page["items"]), 2)

        next_page = sq.fetch_browsable_entity("characters", limit=2, offset=2, database_path=self.db_path)
        self.assertEqual(len(next_page["items"]), 1)

    def test_filters_by_a_single_facet(self):
        page = sq.fetch_browsable_entity("characters", filters={"rarity": ["3"]}, database_path=self.db_path)
        self.assertEqual(page["total"], 2)
        self.assertEqual({item["id"] for item in page["items"]}, {"100101", "100201"})

    def test_search_matches_against_search_text(self):
        page = sq.fetch_browsable_entity("characters", search="Suzuka", database_path=self.db_path)
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["items"][0]["id"], "100201")

    def test_badges_and_media_json_columns_are_decoded(self):
        page = sq.fetch_browsable_entity("characters", limit=1, database_path=self.db_path)
        item = page["items"][0]
        self.assertIsInstance(item["badges"], list)
        self.assertIsInstance(item["media"], dict)
        self.assertNotIn("badges_json", item)

    def test_unknown_entity_key_raises_key_error(self):
        with self.assertRaises(KeyError):
            sq.fetch_browsable_entity("not_a_real_entity", database_path=self.db_path)

    def test_missing_database_raises_file_not_found(self):
        missing_path = self.db_path.with_name("does-not-exist.sqlite")
        with self.assertRaises(FileNotFoundError):
            sq.fetch_browsable_entity("characters", database_path=missing_path)


class EntityHasAnyRowsTests(PopulatedDatabaseTestCase):
    def test_true_for_a_populated_entity(self):
        self.assertTrue(sq.entity_has_any_rows("characters", database_path=self.db_path))

    def test_false_for_an_empty_entity(self):
        self.assertFalse(sq.entity_has_any_rows("races", database_path=self.db_path))

    def test_false_for_an_unknown_entity_key(self):
        self.assertFalse(sq.entity_has_any_rows("not_a_real_entity", database_path=self.db_path))


if __name__ == "__main__":
    unittest.main()
