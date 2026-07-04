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

from .test_http_handler import LiveServerTestCase


def write_reference_entity(normalized_root, entity_key, items, *, generated_at="2026-01-01T00:00:00Z", source=None):
    normalized_root.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": generated_at,
        "source": source or {"imported_at": generated_at, "page_urls": []},
        "items": items,
    }
    (normalized_root / f"{entity_key}.json").write_text(json.dumps(payload), encoding="utf-8")
    return payload


class ReferenceListingRouteTests(LiveServerTestCase):
    def test_reference_listing_is_a_404_before_any_import(self):
        self.request("GET", "/api/reference", expect_status=404)

    def test_reference_listing_reports_entity_counts_and_skips_the_meta_file(self):
        write_reference_entity(sr.NORMALIZED_ROOT, "characters", [{"id": "char_1"}, {"id": "char_2"}])
        write_reference_entity(sr.NORMALIZED_ROOT, "skills", [{"id": "skill_1"}])
        (sr.NORMALIZED_ROOT / "reference-meta.json").write_text(json.dumps({"generated_at": "x"}), encoding="utf-8")

        payload = self.request("GET", "/api/reference")
        by_entity = {entry["entity"]: entry for entry in payload["items"]}
        self.assertEqual(set(by_entity), {"characters", "skills"})
        self.assertEqual(by_entity["characters"]["count"], 2)
        self.assertEqual(by_entity["skills"]["count"], 1)


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
        write_reference_entity(sr.NORMALIZED_ROOT, "characters", [{"id": "char_1", "title": "Special Week"}])
        item = self.request("GET", "/api/reference/characters/char_1")
        self.assertEqual(item["title"], "Special Week")
        self.request("GET", "/api/reference/characters/char_999", expect_status=404)


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
        write_reference_entity(
            sr.NORMALIZED_ROOT,
            "characters",
            [{"id": "char_1", "detail": {"rarity": 3}}, {"id": "char_2", "detail": {"rarity": 2}}],
        )
        self.request(
            "PUT",
            f"/api/profiles/{profile_id}/roster",
            {
                "characters": {
                    "char_1": {"owned": True, "stars": 4, "awakening": 2, "unique_level": 3},
                    "char_2": {"owned": False},
                },
                "supports": {},
            },
        )

        view = self.request("GET", f"/api/profiles/{profile_id}/roster-view/characters")
        self.assertEqual(view["entity"], "characters")
        self.assertEqual(set(view["entries"]), {"char_1"})
        self.assertEqual(view["entries"]["char_1"]["roster"]["stars"], 4)


if __name__ == "__main__":
    unittest.main()
