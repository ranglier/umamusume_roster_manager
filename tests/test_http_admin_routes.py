"""HTTP tests for the admin jobs and backup routes.

Split out from tests/test_http_handler.py because these routes have sharper
edges than plain CRUD:

- start_admin_job() runs its work on a background daemon thread and tracks
  a single ACTIVE_ADMIN_JOB / ADMIN_JOB_HISTORY pair as *process-global*
  mutable state (not per-profile, not per-request) - tests must reset it and
  must wait for any job they start to actually finish before the test ends,
  or a lingering thread can mutate that global state during a later test.
- the "update" job runs the real GameTora import pipeline
  (update_umamusume_reference), which needs network access and takes
  minutes. Every test here monkeypatches it to a fast fake so the suite
  stays instant and offline.
- create_full_backup() / restore_full_backup() read/write data/runtime,
  data/raw, data/normalized and data/user by rebuilding paths from the bare
  PROJECT_ROOT constant (not from the overridable USER_DATA_ROOT /
  NORMALIZED_ROOT module globals used elsewhere), and restore does an
  rmtree on those paths. LiveServerTestCase (tests/test_http_handler.py)
  sandboxes PROJECT_ROOT and DIST_ROOT for exactly this reason - do not
  add a backup/restore test anywhere that skips that sandbox.
"""

import threading
import time
import unittest
from unittest import mock

from . import _pathsetup  # noqa: F401  (must run before importing serve_reference)

import serve_reference as sr

from .test_http_handler import LiveServerTestCase


def fake_update_summary():
    return {
        "rawDatasetCount": 1,
        "normalizedEntityCount": 1,
        "assetCount": 0,
        "assetFailureCount": 0,
        "referenceDbPath": "fake.sqlite",
        "appEntry": "fake/index.html",
    }


class AdminRouteTestCase(LiveServerTestCase):
    def setUp(self):
        super().setUp()
        sr.ACTIVE_ADMIN_JOB = None
        sr.ADMIN_JOB_HISTORY.clear()
        self.addCleanup(self.wait_for_active_job_to_finish)

    def wait_for_active_job_to_finish(self, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if sr.list_admin_jobs()["active_job"] is None:
                return
            time.sleep(0.02)
        sr.ACTIVE_ADMIN_JOB = None


class AdminJobsRouteTests(AdminRouteTestCase):
    def test_jobs_list_starts_empty(self):
        payload = self.request("GET", "/api/admin/jobs")
        self.assertIsNone(payload["active_job"])
        self.assertEqual(payload["recent_jobs"], [])

    def test_update_job_runs_to_completion_and_lands_in_history(self):
        # The fake update below is deliberately gated on an Event: an
        # ungated fake can finish (and flip ACTIVE_ADMIN_JOB to None) before
        # the client even reads the 202 response, since real updates take
        # minutes but this fake takes microseconds - that race is only a
        # property of the test double, not of start_admin_job() itself.
        release = threading.Event()
        self.addCleanup(release.set)

        def gated_update(*, force, progress_callback=None):
            release.wait(timeout=5)
            if progress_callback:
                progress_callback({"progress": 50, "message": "Halfway", "current_task": "Fake step"})
            return fake_update_summary()

        patcher = mock.patch.object(sr, "update_umamusume_reference", side_effect=gated_update)
        patcher.start()
        self.addCleanup(patcher.stop)

        started = self.request("POST", "/api/admin/jobs/update", expect_status=202)
        self.assertEqual(started["type"], "update")
        self.assertEqual(started["status"], "running")

        release.set()
        self.wait_for_active_job_to_finish()

        jobs = self.request("GET", "/api/admin/jobs")
        self.assertIsNone(jobs["active_job"])
        self.assertEqual(len(jobs["recent_jobs"]), 1)
        finished = jobs["recent_jobs"][0]
        self.assertEqual(finished["status"], "succeeded")
        self.assertEqual(finished["result"]["rawDatasetCount"], 1)

    def test_update_job_failure_is_recorded_as_failed_with_the_error_message(self):
        def boom(*, force, progress_callback=None):
            raise RuntimeError("network is unreachable")

        patcher = mock.patch.object(sr, "update_umamusume_reference", side_effect=boom)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.request("POST", "/api/admin/jobs/update", expect_status=202)
        self.wait_for_active_job_to_finish()

        jobs = self.request("GET", "/api/admin/jobs")
        finished = jobs["recent_jobs"][0]
        self.assertEqual(finished["status"], "failed")
        self.assertEqual(finished["message"], "network is unreachable")

    def test_starting_a_second_job_while_one_is_running_is_a_409(self):
        release = threading.Event()
        self.addCleanup(release.set)

        def blocking_update(*, force, progress_callback=None):
            release.wait(timeout=5)
            return fake_update_summary()

        patcher = mock.patch.object(sr, "update_umamusume_reference", side_effect=blocking_update)
        patcher.start()
        self.addCleanup(patcher.stop)

        first = self.request("POST", "/api/admin/jobs/update", expect_status=202)
        self.assertEqual(first["status"], "running")

        self.request("POST", "/api/admin/jobs/update", expect_status=409)
        self.request("POST", "/api/admin/jobs/backup", expect_status=409)

        release.set()
        self.wait_for_active_job_to_finish()


class BackupRouteTests(AdminRouteTestCase):
    def test_backups_list_starts_empty(self):
        payload = self.request("GET", "/api/admin/backups")
        self.assertEqual(payload["items"], [])

    def test_backup_job_creates_a_listed_backup_archive(self):
        profile_id = self.create_profile("Trainer 1")["id"]

        self.request("POST", "/api/admin/jobs/backup", expect_status=202)
        self.wait_for_active_job_to_finish()

        backups = self.request("GET", "/api/admin/backups")
        self.assertEqual(len(backups["items"]), 1)
        backup = backups["items"][0]
        self.assertEqual(backup["kind"], "umamusume-full-backup")
        self.assertGreater(backup["size_bytes"], 0)

        import zipfile

        backup_path = sr.get_backup_path(backup["id"])
        with zipfile.ZipFile(backup_path) as archive:
            names = archive.namelist()
        self.assertIn("data/user/profiles.json", names)
        self.assertTrue(any(name.startswith(f"data/user/profiles/{profile_id}/") for name in names))

    def test_deleting_a_backup_removes_it_from_the_list(self):
        self.request("POST", "/api/admin/jobs/backup", expect_status=202)
        self.wait_for_active_job_to_finish()
        backup_id = self.request("GET", "/api/admin/backups")["items"][0]["id"]

        remaining = self.request("DELETE", f"/api/admin/backups/{backup_id}")
        self.assertEqual(remaining["items"], [])
        self.assertFalse(sr.get_backup_path(backup_id).exists())

    def test_deleting_an_unknown_backup_is_a_404(self):
        self.request("DELETE", "/api/admin/backups/backup_20260101_000000_deadbeef", expect_status=404)

    def test_restoring_an_unknown_backup_is_a_404(self):
        self.request("POST", "/api/admin/backups/backup_20260101_000000_deadbeef/restore", expect_status=404)

    def test_restore_job_brings_back_a_deleted_profile(self):
        profile_id = self.create_profile("Trainer 1")["id"]

        self.request("POST", "/api/admin/jobs/backup", expect_status=202)
        self.wait_for_active_job_to_finish()
        backup_id = self.request("GET", "/api/admin/backups")["items"][0]["id"]

        self.request("DELETE", f"/api/profiles/{profile_id}", expect_status=200)
        self.assertEqual(self.request("GET", "/api/profiles")["profiles"], [])

        self.request("POST", f"/api/admin/backups/{backup_id}/restore", expect_status=202)
        self.wait_for_active_job_to_finish()

        restored = self.request("GET", "/api/profiles")["profiles"]
        self.assertEqual([profile["id"] for profile in restored], [profile_id])


if __name__ == "__main__":
    unittest.main()
