import "./_domshim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { state } from "../../src/ui/assets/js/core.js";
import { wizardNeedsReferenceBuild, getWizardProgress, getTimedProgress, getUpdateProgress } from "../../src/ui/assets/js/admin.js";

test("wizardNeedsReferenceBuild is true when the bootstrap status flags an initial update or a missing bundle", () => {
  state.bootstrapStatus = { needs_initial_update: true, has_dist_bundle: true };
  assert.equal(wizardNeedsReferenceBuild(), true);
  state.bootstrapStatus = { needs_initial_update: false, has_dist_bundle: false };
  assert.equal(wizardNeedsReferenceBuild(), true);
  state.bootstrapStatus = { needs_initial_update: false, has_dist_bundle: true };
  assert.equal(wizardNeedsReferenceBuild(), false);
});

test("getWizardProgress reports 100 once the reference build is no longer needed", () => {
  state.bootstrapStatus = { needs_initial_update: false, has_dist_bundle: true };
  state.adminJobs = { active_job: null, recent_jobs: [] };
  assert.equal(getWizardProgress(), 100);
});

test("getWizardProgress reports 100 once a running update job succeeds", () => {
  state.bootstrapStatus = { needs_initial_update: true, has_dist_bundle: false };
  state.adminJobs = { active_job: { type: "update", status: "succeeded" }, recent_jobs: [] };
  assert.equal(getWizardProgress(), 100);
});

test("getWizardProgress clamps an explicit job progress between 8 and 99", () => {
  state.bootstrapStatus = { needs_initial_update: true, has_dist_bundle: false };
  state.adminJobs = { active_job: { type: "update", status: "running", progress: 150 }, recent_jobs: [] };
  assert.equal(getWizardProgress(), 99);
  state.adminJobs = { active_job: { type: "update", status: "running", progress: 2 }, recent_jobs: [] };
  assert.equal(getWizardProgress(), 8);
});

test("getWizardProgress defaults to 8 when nothing is running yet", () => {
  state.bootstrapStatus = { needs_initial_update: true, has_dist_bundle: false };
  state.adminJobs = { active_job: null, recent_jobs: [] };
  state.wizardBuildStartedAt = null;
  assert.equal(getWizardProgress(), 8);
});

test("getTimedProgress returns the floor immediately after starting", () => {
  assert.equal(getTimedProgress(new Date().toISOString(), 10, 92, 9), 10);
});

test("getTimedProgress clamps to the cap once enough time has passed", () => {
  const longAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal(getTimedProgress(longAgo, 10, 92, 9), 92);
});

test("getUpdateProgress reflects the bootstrap reference db state when there is no job", () => {
  state.bootstrapStatus = { has_reference_db: true };
  assert.equal(getUpdateProgress(null), 100);
  state.bootstrapStatus = { has_reference_db: false };
  assert.equal(getUpdateProgress(null), 0);
});

test("getUpdateProgress ignores jobs that aren't of type 'update'", () => {
  state.bootstrapStatus = { has_reference_db: true };
  assert.equal(getUpdateProgress({ type: "backup", status: "running" }), 100);
});

test("getUpdateProgress prefers an explicit numeric progress, clamped to [0, 100]", () => {
  assert.equal(getUpdateProgress({ type: "update", progress: 150 }), 100);
  assert.equal(getUpdateProgress({ type: "update", progress: -5 }), 0);
});

test("getUpdateProgress reports 100 for a succeeded job and 0 for anything else", () => {
  assert.equal(getUpdateProgress({ type: "update", status: "succeeded" }), 100);
  assert.equal(getUpdateProgress({ type: "update", status: "failed" }), 0);
});
