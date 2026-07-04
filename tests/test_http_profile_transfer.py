"""HTTP tests for profile export/import.

Covers the last previously-untested route family flagged in
docs/PROJECT_STATUS.md: GET /api/profiles/<id>/export, POST
/api/profiles/import (import as a new profile) and POST
/api/profiles/<id>/import (import into an existing profile, overwriting its
roster/legacy/builds). These return/accept a zip archive rather than JSON,
so this file adds a raw byte-level request helper on top of
LiveServerTestCase's JSON-only one instead of reusing it directly.
"""

import io
import json
import unittest
import urllib.error
import urllib.request
import zipfile

from . import _pathsetup  # noqa: F401  (must run before importing serve_reference)

from .test_http_handler import LiveServerTestCase


def build_export_archive(
    *,
    kind="umamusume-profile-export",
    profile=None,
    roster=None,
    legacy=None,
    builds=None,
    omit=(),
):
    files = {
        "manifest.json": {"kind": kind, "version": 2, "created_at": "2026-01-01T00:00:00Z", "profile_id": "p_999"},
        "profile.json": profile if profile is not None else {"id": "p_999", "name": "Imported Trainer"},
        "roster.json": roster if roster is not None else {"version": 1, "characters": {}, "supports": {}},
        "legacy.json": legacy if legacy is not None else {"version": 4, "entries": []},
        "builds.json": builds if builds is not None else {"version": 1, "entries": []},
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in files.items():
            if name in omit:
                continue
            archive.writestr(name, json.dumps(payload))
    return buffer.getvalue()


class ProfileTransferTestCase(LiveServerTestCase):
    def request_raw(self, method, path, body=None, headers=None):
        req = urllib.request.Request(f"{self.base_url}{path}", data=body, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req) as response:
                return response.status, response.read(), dict(response.headers)
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read(), dict(exc.headers)

    def request_json_body(self, method, path, body, expect_status=200):
        status, raw, _headers = self.request_raw(method, path, body=body)
        payload = json.loads(raw.decode("utf-8"))
        self.assertEqual(status, expect_status, payload)
        return payload


class ExportRouteTests(ProfileTransferTestCase):
    def test_export_returns_a_zip_archive_with_the_expected_members(self):
        profile_id = self.create_profile("Trainer One")["id"]
        self.request(
            "PUT",
            f"/api/profiles/{profile_id}/roster",
            {"characters": {"char_1": {"owned": True, "stars": 4}}, "supports": {}},
        )

        status, body, headers = self.request_raw("GET", f"/api/profiles/{profile_id}/export")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/zip")
        self.assertIn("Trainer-One.zip", headers["Content-Disposition"])

        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            names = set(archive.namelist())
            self.assertEqual(names, {"manifest.json", "profile.json", "roster.json", "legacy.json", "builds.json"})
            manifest = json.loads(archive.read("manifest.json"))
            roster = json.loads(archive.read("roster.json"))
        self.assertEqual(manifest["kind"], "umamusume-profile-export")
        self.assertEqual(manifest["profile_id"], profile_id)
        self.assertEqual(roster["characters"]["char_1"]["stars"], 4)

    def test_export_of_an_unknown_profile_is_a_404(self):
        status, _body, _headers = self.request_raw("GET", "/api/profiles/p_999/export")
        self.assertEqual(status, 404)


class ImportAsNewProfileTests(ProfileTransferTestCase):
    def test_round_trip_export_then_import_creates_an_equivalent_new_profile(self):
        original_id = self.create_profile("Trainer One")["id"]
        self.request(
            "PUT",
            f"/api/profiles/{original_id}/roster",
            {"characters": {"char_1": {"owned": True, "stars": 5}}, "supports": {}},
        )

        _status, archive_bytes, _headers = self.request_raw("GET", f"/api/profiles/{original_id}/export")

        result = self.request_json_body("POST", "/api/profiles/import", archive_bytes, expect_status=201)
        imported_id = result["created_profile"]["id"]
        self.assertNotEqual(imported_id, original_id)
        self.assertEqual(result["created_profile"]["name"], "Trainer One (imported)")

        imported_roster = self.request("GET", f"/api/profiles/{imported_id}/roster")
        self.assertEqual(imported_roster["characters"]["char_1"]["stars"], 5)

    def test_importing_the_same_name_twice_gets_an_incrementing_suffix(self):
        self.request_json_body("POST", "/api/profiles/import", build_export_archive(profile={"id": "p_1", "name": "Main"}), expect_status=201)
        first = self.request_json_body("POST", "/api/profiles/import", build_export_archive(profile={"id": "p_2", "name": "Main"}), expect_status=201)
        second = self.request_json_body("POST", "/api/profiles/import", build_export_archive(profile={"id": "p_3", "name": "Main"}), expect_status=201)
        self.assertEqual(first["created_profile"]["name"], "Main (imported)")
        self.assertEqual(second["created_profile"]["name"], "Main (imported) 2")

    def test_rejects_a_payload_that_is_not_a_zip_archive(self):
        self.request_json_body("POST", "/api/profiles/import", b"not a zip file", expect_status=400)

    def test_rejects_an_archive_with_the_wrong_manifest_kind(self):
        archive = build_export_archive(kind="some-other-export")
        self.request_json_body("POST", "/api/profiles/import", archive, expect_status=400)

    def test_rejects_an_archive_missing_a_profile_name(self):
        archive = build_export_archive(profile={"id": "p_1", "name": "   "})
        self.request_json_body("POST", "/api/profiles/import", archive, expect_status=400)

    def test_rejects_an_archive_missing_required_members(self):
        archive = build_export_archive(omit=("roster.json",))
        self.request_json_body("POST", "/api/profiles/import", archive, expect_status=400)

    def test_tolerates_a_missing_legacy_or_builds_member_with_empty_defaults(self):
        archive = build_export_archive(profile={"id": "p_1", "name": "Bare Import"}, omit=("legacy.json", "builds.json"))
        result = self.request_json_body("POST", "/api/profiles/import", archive, expect_status=201)
        imported_id = result["created_profile"]["id"]

        builds = self.request("GET", f"/api/profiles/{imported_id}/builds")
        self.assertEqual(builds["entries"], [])


class ImportIntoExistingProfileTests(ProfileTransferTestCase):
    def test_importing_into_an_existing_profile_overwrites_its_roster(self):
        target_id = self.create_profile("Target Trainer")["id"]
        self.request(
            "PUT",
            f"/api/profiles/{target_id}/roster",
            {"characters": {"stale_char": {"owned": True}}, "supports": {}},
        )

        archive = build_export_archive(
            profile={"id": "p_source", "name": "Source Trainer"},
            roster={"version": 1, "characters": {"fresh_char": {"owned": True, "stars": 3}}, "supports": {}},
        )
        result = self.request_json_body("POST", f"/api/profiles/{target_id}/import", archive, expect_status=200)
        self.assertEqual(result["profile"]["id"], target_id)

        roster = self.request("GET", f"/api/profiles/{target_id}/roster")
        self.assertNotIn("stale_char", roster["characters"])
        self.assertEqual(roster["characters"]["fresh_char"]["stars"], 3)

    def test_importing_into_an_unknown_profile_is_a_404(self):
        archive = build_export_archive()
        self.request_json_body("POST", "/api/profiles/p_999/import", archive, expect_status=404)


if __name__ == "__main__":
    unittest.main()
