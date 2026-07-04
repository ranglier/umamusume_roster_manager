"""End-to-end HTTP tests for ReferenceRequestHandler.

Before this file, the entire ~650-line request handler (all of do_GET /
do_POST / do_PUT / do_PATCH / do_DELETE route dispatch) had zero coverage:
every other test in this repo exercises the pure/domain functions directly,
never the HTTP layer that wires them to routes. This spins up a real
ThreadingTCPServer on an ephemeral port against an isolated temp user-data
root and drives it with real HTTP requests via urllib, covering the core
profile / roster / legacy / builds CRUD flows end to end.

Scope: this deliberately does not cover admin jobs, backups, or
import/export (those touch background threads and zip archives, and would
need a much larger fixture). It also monkeypatches
build_legacy_reference_catalogs the same way tests/test_legacy_view.py does,
for the same reason: NORMALIZED_ROOT is pointed at a temp directory so these
tests don't depend on a real GameTora import being present (data/normalized/
and dist/ are gitignored, see CLAUDE.md).
"""

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from functools import partial
from pathlib import Path
from unittest import mock

from . import _pathsetup  # noqa: F401  (must run before importing serve_reference)

import serve_reference as sr

from .test_legacy_view import make_full_character_ref
from .test_serve_reference import make_catalogs


class LiveServerTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        tmp_root = Path(self._tmp.name)

        for name, value in (
            ("USER_DATA_ROOT", tmp_root / "user"),
            ("PROFILE_DATA_ROOT", tmp_root / "user" / "profiles"),
            ("PROFILES_INDEX_PATH", tmp_root / "user" / "profiles.json"),
            ("NORMALIZED_ROOT", tmp_root / "normalized_missing"),
        ):
            patcher = mock.patch.object(sr, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        sr.ensure_user_data_roots()

        dist_dir = tmp_root / "dist"
        dist_dir.mkdir(parents=True, exist_ok=True)
        handler_class = partial(sr.ReferenceRequestHandler, directory=str(dist_dir))
        self.server = sr.ThreadingTCPServer(("127.0.0.1", 0), handler_class)
        self.addCleanup(self.server.server_close)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.shutdown)
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def patch_catalogs(self, **overrides):
        catalogs = make_catalogs(**overrides)
        patcher = mock.patch.object(sr, "build_legacy_reference_catalogs", return_value=catalogs)
        patcher.start()
        self.addCleanup(patcher.stop)
        return catalogs

    def request(self, method, path, body=None, expect_status=200):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data is not None else {},
        )
        try:
            with urllib.request.urlopen(req) as response:
                status = response.status
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            status = exc.code
            payload = json.loads(exc.read().decode("utf-8"))
        self.assertEqual(status, expect_status, payload)
        return payload

    def create_profile(self, name="Main"):
        return self.request("POST", "/api/profiles", {"name": name}, expect_status=201)["created_profile"]


class HealthAndProfileRouteTests(LiveServerTestCase):
    def test_health_route_reports_dist_and_user_data_state(self):
        payload = self.request("GET", "/__health")
        self.assertEqual(payload["status"], "ok")
        self.assertTrue(payload["user_data_exists"])

    def test_profiles_lifecycle_create_list_select_delete(self):
        created = self.create_profile("Trainer 1")
        profile_id = created["id"]

        index = self.request("GET", "/api/profiles")
        self.assertEqual([p["id"] for p in index["profiles"]], [profile_id])

        selected = self.request("POST", "/api/profiles/select", {"profile_id": profile_id})
        self.assertEqual(selected["last_profile_id"], profile_id)

        renamed = self.request("PATCH", f"/api/profiles/{profile_id}", {"name": "Renamed"})
        self.assertEqual(renamed["profile"]["name"], "Renamed")

        self.request("DELETE", f"/api/profiles/{profile_id}", expect_status=200)
        index_after = self.request("GET", "/api/profiles")
        self.assertEqual(index_after["profiles"], [])

    def test_creating_a_profile_without_a_name_is_rejected(self):
        self.request("POST", "/api/profiles", {"name": "  "}, expect_status=400)

    def test_selecting_an_unknown_profile_is_a_404(self):
        self.request("POST", "/api/profiles/select", {"profile_id": "p_999"}, expect_status=404)


class RosterRouteTests(LiveServerTestCase):
    def test_roster_get_defaults_to_an_empty_document_then_put_round_trips(self):
        profile_id = self.create_profile()["id"]

        empty = self.request("GET", f"/api/profiles/{profile_id}/roster")
        self.assertEqual(empty["characters"], {})

        updated = self.request(
            "PUT",
            f"/api/profiles/{profile_id}/roster",
            {"characters": {"char_1": {"owned": True, "stars": 4}}, "supports": {}},
        )
        self.assertEqual(updated["characters"]["char_1"]["owned"], True)

        reread = self.request("GET", f"/api/profiles/{profile_id}/roster")
        self.assertEqual(reread["characters"]["char_1"]["stars"], 4)

    def test_roster_routes_404_for_an_unknown_profile(self):
        self.request("GET", "/api/profiles/p_999/roster", expect_status=404)
        self.request("PUT", "/api/profiles/p_999/roster", {}, expect_status=404)


class LegacyRouteTests(LiveServerTestCase):
    def test_legacy_crud_round_trip(self):
        profile_id = self.create_profile()["id"]
        self.patch_catalogs(characters={"char_1": make_full_character_ref(char_id="char_1", name="Special Week")})

        created = self.request(
            "POST",
            f"/api/profiles/{profile_id}/legacies",
            {
                "character_card_id": "char_1",
                "blue_spark": {"kind": "stat", "target_key": "speed", "stars": 2},
                "pink_spark": {"kind": "surface", "target_key": "turf", "stars": 3},
            },
            expect_status=201,
        )
        legacy_id = created["entry"]["id"]
        self.assertEqual(created["entry"]["name"], "Special Week")

        view = self.request("GET", f"/api/profiles/{profile_id}/legacy-view")
        self.assertEqual(len(view["items"]), 1)

        updated = self.request(
            "PATCH",
            f"/api/profiles/{profile_id}/legacies/{legacy_id}",
            {"rating": "S"},
        )
        self.assertEqual(updated["entry"]["rating"], "S")

        self.request("DELETE", f"/api/profiles/{profile_id}/legacies/{legacy_id}", expect_status=200)
        after_delete = self.request("GET", f"/api/profiles/{profile_id}/legacy-view")
        self.assertEqual(after_delete["items"], [])

    def test_creating_a_legacy_entry_with_an_unknown_character_is_a_400(self):
        profile_id = self.create_profile()["id"]
        self.patch_catalogs()
        self.request(
            "POST",
            f"/api/profiles/{profile_id}/legacies",
            {"character_card_id": "does_not_exist"},
            expect_status=400,
        )

    def test_updating_an_unknown_legacy_entry_is_a_404(self):
        profile_id = self.create_profile()["id"]
        self.patch_catalogs()
        self.request(
            "PATCH",
            f"/api/profiles/{profile_id}/legacies/legacy_999",
            {"rating": "S"},
            expect_status=404,
        )


class BuildsRouteTests(LiveServerTestCase):
    def test_builds_crud_round_trip(self):
        profile_id = self.create_profile()["id"]

        created = self.request(
            "POST",
            f"/api/profiles/{profile_id}/builds",
            {"mode": "champions_meeting", "name": "Draft build"},
            expect_status=201,
        )
        build_id = created["entry"]["id"]
        self.assertEqual(created["entry"]["status"], "draft")

        listed = self.request("GET", f"/api/profiles/{profile_id}/builds")
        self.assertEqual([entry["id"] for entry in listed["entries"]], [build_id])

        updated = self.request(
            "PATCH",
            f"/api/profiles/{profile_id}/builds/{build_id}",
            {"status": "testing"},
        )
        self.assertEqual(updated["entry"]["status"], "testing")

        self.request("DELETE", f"/api/profiles/{profile_id}/builds/{build_id}", expect_status=200)
        after_delete = self.request("GET", f"/api/profiles/{profile_id}/builds")
        self.assertEqual(after_delete["entries"], [])

    def test_updating_an_unknown_build_is_a_404(self):
        profile_id = self.create_profile()["id"]
        self.request(
            "PATCH",
            f"/api/profiles/{profile_id}/builds/build_999",
            {"status": "testing"},
            expect_status=404,
        )


if __name__ == "__main__":
    unittest.main()
