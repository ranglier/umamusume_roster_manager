"""HTTP tests for the read-only reference/bootstrap routes.

The last blind spot on ReferenceRequestHandler after profiles / roster /
legacy / builds / admin jobs / backups / export-import: GET /api/reference,
GET /api/reference/<entity>, GET /api/reference/<entity>/<id>,
GET /api/app/bootstrap-status, GET /__meta, and
GET /api/profiles/<id>/roster-view/<characters|supports>. Lower risk than
what came before (mostly thin reads over NORMALIZED_ROOT), but previously
untested at the HTTP layer.

These write directly into the sandboxed NORMALIZED_ROOT/REFERENCE_META_PATH
that LiveServerTestCase sets up, rather than going through
update_reference.py, since that needs real network access to GameTora.
"""

import json
import unittest

from . import _pathsetup  # noqa: F401  (must run before importing serve_reference)

import serve_reference as sr
from lib import gametora_reference as gt
from lib import sqlite_reference as sqlite_sr
from lib.sqlite_queries import ENTITY_TABLES

from .test_gametora_reference import make_base_character, make_character_card, make_source_config, make_source_metadata
from .test_http_handler import LiveServerTestCase
from .test_sqlite_reference_build import build_minimal_normalized_reference


def write_reference_entity(normalized_root, entity_key, items, *, generated_at="2026-01-01T00:00:00Z", source=None):
    normalized_root.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": generated_at,
        "source": source or {"imported_at": generated_at, "page_urls": []},
        "items": items,
    }
    (normalized_root / f"{entity_key}.json").write_text(json.dumps(payload), encoding="utf-8")
    return payload


def write_reference_database(*, characters=None, database_path=None):
    """Build a real temp SQLite reference DB (not JSON) for routes already swapped to SQL.

    Reuses build_minimal_normalized_reference()'s full 12-entity fixture and
    replaces the "characters" slot with real normalize_characters() output
    for the given raw character cards, so the payload_json each route reads
    back is byte-identical in shape to what the real pipeline would produce.
    """
    normalized = build_minimal_normalized_reference()
    if characters is not None:
        normalized["characters"] = gt.normalize_characters(
            make_source_config("characters"), make_source_metadata(), [make_base_character()], characters, []
        )
    sqlite_sr.build_reference_database({}, normalized, None, target_path=database_path or sr.REFERENCE_DB_PATH)


class ReferenceListingRouteTests(LiveServerTestCase):
    def test_reference_listing_is_a_404_before_any_import(self):
        self.request("GET", "/api/reference", expect_status=404)

    def test_reference_listing_reports_entity_counts_for_every_entity(self):
        write_reference_database(characters=[make_character_card(), make_character_card(card_id=100102, char_id=1002)])

        payload = self.request("GET", "/api/reference")
        by_entity = {entry["entity"]: entry for entry in payload["items"]}
        self.assertEqual(set(by_entity), set(ENTITY_TABLES))
        self.assertEqual(by_entity["characters"]["count"], 2)
        self.assertEqual(by_entity["races"]["count"], 0)
        self.assertIn("source", by_entity["characters"])


class ReferenceEntityRouteTests(LiveServerTestCase):
    def test_unknown_entity_is_a_404(self):
        self.request("GET", "/api/reference/characters", expect_status=404)

    def test_known_entity_returns_its_full_payload(self):
        write_reference_entity(sr.NORMALIZED_ROOT, "characters", [{"id": "char_1", "title": "Special Week"}])
        payload = self.request("GET", "/api/reference/characters")
        self.assertEqual(payload["items"][0]["title"], "Special Week")

    def test_a_non_object_payload_is_a_500(self):
        sr.NORMALIZED_ROOT.mkdir(parents=True, exist_ok=True)
        (sr.NORMALIZED_ROOT / "characters.json").write_text("[]", encoding="utf-8")
        self.request("GET", "/api/reference/characters", expect_status=500)

    def test_known_item_id_is_returned_and_unknown_id_is_a_404(self):
        write_reference_database(characters=[make_character_card()])
        item = self.request("GET", "/api/reference/characters/100101")
        self.assertEqual(item["name"], "Special Week")
        self.request("GET", "/api/reference/characters/char_999", expect_status=404)

    def test_unknown_entity_key_on_the_item_route_is_also_a_404(self):
        write_reference_database()
        self.request("GET", "/api/reference/not_a_real_entity/100101", expect_status=404)


class BrowseRouteTests(LiveServerTestCase):
    def write_three_characters(self):
        write_reference_database(
            characters=[
                make_character_card(card_id=100101, char_id=1001, name_en="Special Week", rarity=3),
                make_character_card(card_id=100201, char_id=1002, name_en="Silence Suzuka", rarity=3),
                make_character_card(card_id=100301, char_id=1003, name_en="Tokai Teio", rarity=2),
            ]
        )

    def test_browse_is_a_404_before_any_import(self):
        self.request("GET", "/api/reference/characters/browse", expect_status=404)

    def test_unknown_entity_key_is_a_404(self):
        write_reference_database()
        self.request("GET", "/api/reference/not_a_real_entity/browse", expect_status=404)

    def test_returns_every_item_paginated(self):
        self.write_three_characters()
        page = self.request("GET", "/api/reference/characters/browse?limit=2&offset=0")
        self.assertEqual(page["total"], 3)
        self.assertEqual(len(page["items"]), 2)
        self.assertEqual(page["limit"], 2)

    def test_filters_by_facet(self):
        self.write_three_characters()
        page = self.request("GET", "/api/reference/characters/browse?filter=rarity:3")
        self.assertEqual(page["total"], 2)
        self.assertEqual({item["id"] for item in page["items"]}, {"100101", "100201"})

    def test_search_query_param_matches_search_text(self):
        self.write_three_characters()
        page = self.request("GET", "/api/reference/characters/browse?q=Suzuka")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["items"][0]["id"], "100201")

    def test_limit_is_clamped_to_a_sane_maximum(self):
        self.write_three_characters()
        page = self.request("GET", "/api/reference/characters/browse?limit=99999")
        self.assertEqual(page["limit"], 200)


class BootstrapStatusRouteTests(LiveServerTestCase):
    def test_recommends_the_wizard_when_there_are_no_profiles(self):
        payload = self.request("GET", "/api/app/bootstrap-status")
        self.assertFalse(payload["has_profiles"])
        self.assertEqual(payload["recommended_entry"], "wizard")
        self.assertTrue(payload["needs_initial_update"])

    def test_recommends_the_profile_picker_when_profiles_exist_but_none_selected(self):
        self.create_profile("Trainer 1")
        # last_profile_id was set by create_profile()'s own select side effect,
        # so explicitly clear it to exercise the "profiles exist, none active" branch.
        index = sr.load_profiles_index()
        index["last_profile_id"] = None
        sr.save_profiles_index(index)

        payload = self.request("GET", "/api/app/bootstrap-status")
        self.assertTrue(payload["has_profiles"])
        self.assertEqual(payload["recommended_entry"], "profiles")

    def test_recommends_the_roster_when_a_profile_is_already_selected(self):
        self.create_profile("Trainer 1")
        payload = self.request("GET", "/api/app/bootstrap-status")
        self.assertEqual(payload["recommended_entry"], "roster")

    def test_needs_initial_update_clears_once_reference_meta_and_db_exist(self):
        sr.REFERENCE_META_PATH.parent.mkdir(parents=True, exist_ok=True)
        sr.REFERENCE_META_PATH.write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z"}), encoding="utf-8")
        sr.REFERENCE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        sr.REFERENCE_DB_PATH.write_bytes(b"")

        payload = self.request("GET", "/api/app/bootstrap-status")
        self.assertFalse(payload["needs_initial_update"])
        self.assertEqual(payload["reference_generated_at"], "2026-01-01T00:00:00Z")


class MetaRouteTests(LiveServerTestCase):
    def test_meta_is_a_404_before_any_import(self):
        self.request("GET", "/__meta", expect_status=404)

    def test_meta_returns_the_reference_meta_file_without_a_sqlite_section_when_no_db_exists(self):
        sr.REFERENCE_META_PATH.parent.mkdir(parents=True, exist_ok=True)
        sr.REFERENCE_META_PATH.write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "rawDatasetCount": 3}), encoding="utf-8")

        payload = self.request("GET", "/__meta")
        self.assertEqual(payload["rawDatasetCount"], 3)
        self.assertNotIn("sqlite", payload)


class RosterViewRouteTests(LiveServerTestCase):
    def test_roster_view_is_a_404_when_reference_data_is_missing(self):
        profile_id = self.create_profile()["id"]
        self.request("GET", f"/api/profiles/{profile_id}/roster-view/characters", expect_status=404)

    def test_roster_view_is_a_404_for_an_unknown_profile(self):
        self.request("GET", "/api/profiles/p_999/roster-view/characters", expect_status=404)

    def test_roster_view_returns_derived_data_only_for_owned_items(self):
        profile_id = self.create_profile()["id"]
        write_reference_database(
            characters=[make_character_card(), make_character_card(card_id=100102, char_id=1002, rarity=2)]
        )
        self.request(
            "PUT",
            f"/api/profiles/{profile_id}/roster",
            {
                "characters": {
                    "100101": {"owned": True, "stars": 4, "awakening": 2, "unique_level": 3},
                    "100102": {"owned": False},
                },
                "supports": {},
            },
        )

        view = self.request("GET", f"/api/profiles/{profile_id}/roster-view/characters")
        self.assertEqual(view["entity"], "characters")
        self.assertEqual(set(view["entries"]), {"100101"})
        self.assertEqual(view["entries"]["100101"]["roster"]["stars"], 4)


if __name__ == "__main__":
    unittest.main()
