import "./_domshim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { data, state } from "../../src/ui/assets/js/core.js";
import {
  getBuildEditorKey,
  getAptitudeTone,
  getAptitudeHint,
  getCharacterAptitudeForTarget,
  getCharacterAptitudeFit,
  getBuildTargetProfile,
  getBuildTargetRacetrack,
  getLegacySparkSummaryText,
  legacyMatchesBuildTarget,
  createEmptyBuildEntry,
} from "../../src/ui/assets/js/builds.js";

test("getBuildEditorKey returns the '__new__' sentinel in create mode regardless of id", () => {
  assert.equal(getBuildEditorKey(true, "build_001"), "__new__");
});

test("getBuildEditorKey returns the stringified build id outside create mode", () => {
  assert.equal(getBuildEditorKey(false, "build_001"), "build_001");
  assert.equal(getBuildEditorKey(false, null), "");
});

test("getAptitudeTone maps S/A to ok, B/C to warn, other grades to bad, and empty to neutral", () => {
  assert.equal(getAptitudeTone("s"), "ok");
  assert.equal(getAptitudeTone("A"), "ok");
  assert.equal(getAptitudeTone("b"), "warn");
  assert.equal(getAptitudeTone("C"), "warn");
  assert.equal(getAptitudeTone("F"), "bad");
  assert.equal(getAptitudeTone(""), "neutral");
});

test("getAptitudeHint pairs each tone with its label", () => {
  assert.deepEqual(getAptitudeHint("S"), { label: "Matches target", tone: "ok" });
  assert.deepEqual(getAptitudeHint("B"), { label: "Needs inheritance", tone: "warn" });
  assert.deepEqual(getAptitudeHint("F"), { label: "Off target", tone: "bad" });
  assert.deepEqual(getAptitudeHint(""), { label: "No target data", tone: "neutral" });
});

test("getCharacterAptitudeForTarget grades surface/distance and flags useful vs merely workable", () => {
  const item = { detail: { aptitudes: { surface: { turf: "S" }, distance: { mile: "B" } } } };
  const targetProfile = { surfaceKey: "turf", distanceKey: "mile" };
  const result = getCharacterAptitudeForTarget(item, targetProfile);
  assert.equal(result.surfaceGrade, "S");
  assert.equal(result.distanceGrade, "B");
  assert.equal(result.useful, false);
  assert.equal(result.workable, true);
});

test("getCharacterAptitudeForTarget is useful when both surface and distance are S/A", () => {
  const item = { detail: { aptitudes: { surface: { turf: "A" }, distance: { mile: "S" } } } };
  const result = getCharacterAptitudeForTarget(item, { surfaceKey: "turf", distanceKey: "mile" });
  assert.equal(result.useful, true);
  assert.equal(result.workable, true);
});

test("getCharacterAptitudeFit compares the character's current grade against the build's planned target grade", () => {
  const item = { detail: { aptitudes: { surface: { turf: "B" }, distance: { mile: "A" }, style: { leader: "S" } } } };
  const targetProfile = { surfaceKey: "turf", distanceKey: "mile", surface: "Turf", distanceCategory: "Mile" };
  const entry = { target_aptitudes: { surface: "S", distance: "A", style: "A" }, running_style: "leader" };
  const fit = getCharacterAptitudeFit(item, targetProfile, entry);
  assert.equal(fit.surfaceAccel.currentGrade, "B");
  assert.equal(fit.surfaceAccel.current, 0.9);
  assert.equal(fit.surfaceAccel.target, 1.05);
  assert.equal(fit.distanceAccel.current, 1.0);
  assert.equal(fit.style.currentGrade, "S");
  assert.equal(fit.style.gain, -0.1);
});

test("getCharacterAptitudeFit omits the style fit entirely when no running style is chosen", () => {
  const item = { detail: { aptitudes: { surface: {}, distance: {}, style: {} } } };
  const fit = getCharacterAptitudeFit(item, { surfaceKey: "turf", distanceKey: "mile" }, { target_aptitudes: {}, running_style: "" });
  assert.equal(fit.style, null);
});

test("getBuildTargetRacetrack resolves only when the cm_target has exactly one related racetrack", () => {
  data.entities.racetracks.items = [{ id: "10611", title: "Tokyo #10611" }];
  const unique = getBuildTargetRacetrack({ detail: { related_racetracks: [{ id: "10611" }] } });
  assert.equal(unique?.id, "10611");

  const ambiguous = getBuildTargetRacetrack({ detail: { related_racetracks: [{ id: "10611" }, { id: "10612" }] } });
  assert.equal(ambiguous, null);

  const none = getBuildTargetRacetrack({ detail: { related_racetracks: [] } });
  assert.equal(none, null);
});

test("getBuildTargetProfile falls back to empty strings when the target id doesn't resolve", () => {
  data.entities.cm_targets.items = [];
  const profile = getBuildTargetProfile({ target_id: "missing" });
  assert.equal(profile.item, null);
  assert.equal(profile.track, "");
  assert.equal(profile.surfaceKey, "");
});

test("getBuildTargetProfile reads the race profile off the matched cm_target item", () => {
  data.entities.cm_targets.items = [
    {
      id: "cmt_001",
      detail: {
        race_profile: {
          track_name: "Tokyo",
          surface: "Turf",
          surface_slug: "turf",
          distance_m: 2400,
          distance_category: "Long",
          distance_category_slug: "long",
        },
      },
    },
  ];
  const profile = getBuildTargetProfile({ target_id: "cmt_001" });
  assert.equal(profile.track, "Tokyo");
  assert.equal(profile.surfaceKey, "turf");
  assert.equal(profile.distanceKey, "long");
});

test("getLegacySparkSummaryText joins the known spark pieces with a pipe", () => {
  const item = {
    detail: {
      spark_summary: {
        blue: { target_label: "Speed", stars: 3 },
        pink: { target_label: "Turf", stars: 2 },
        white_count: 4,
      },
    },
  };
  assert.equal(getLegacySparkSummaryText(item), "Blue Speed ★★★ | Pink Turf ★★ | 4 white");
});

test("getLegacySparkSummaryText returns an empty string when there is no spark summary", () => {
  assert.equal(getLegacySparkSummaryText({}), "");
});

test("legacyMatchesBuildTarget matches a surface pink spark against the target's surface key", () => {
  const item = { detail: { spark_summary: { pink: { kind: "surface", target_key: "turf" } } } };
  assert.equal(legacyMatchesBuildTarget(item, { item: {}, surfaceKey: "turf" }), true);
  assert.equal(legacyMatchesBuildTarget(item, { item: {}, surfaceKey: "dirt" }), false);
});

test("legacyMatchesBuildTarget is false without a pink spark or without a resolved target", () => {
  assert.equal(legacyMatchesBuildTarget({}, { item: {}, surfaceKey: "turf" }), false);
  const item = { detail: { spark_summary: { pink: { kind: "surface", target_key: "turf" } } } };
  assert.equal(legacyMatchesBuildTarget(item, { item: null, surfaceKey: "turf" }), false);
});

test("createEmptyBuildEntry seeds defaults from the first available reference options", () => {
  data.entities.cm_targets.items = [{ id: "cmt_001", title: "Target One" }];
  data.entities.scenarios.items = [{ id: "scn_001", title: "Scenario One" }];
  data.entities.characters.items = [{ id: "char_001", title: "Character One" }];
  state.rosterDocument = { ...state.rosterDocument, characters: { char_001: { owned: true } } };
  state.legacyView = { ...state.legacyView, items: [{ id: "legacy_001" }, { id: "legacy_002" }] };

  state.pendingBuildSeed = null;
  const entry = createEmptyBuildEntry();
  assert.equal(entry.target_id, "cmt_001");
  assert.equal(entry.scenario_id, "scn_001");
  assert.equal(entry.character_id, "char_001");
  assert.deepEqual(entry.legacy_pair, { parent_a: "legacy_001", parent_b: "legacy_002" });
  assert.equal(entry.status, "draft");
  assert.equal(entry.running_style, "");
});

test("createEmptyBuildEntry consumes a pending build seed and clears it", () => {
  data.entities.cm_targets.items = [{ id: "cmt_001", title: "Target One" }];
  data.entities.characters.items = [{ id: "char_001", title: "Character One" }];
  state.rosterDocument = { ...state.rosterDocument, characters: { char_001: { owned: true } } };
  state.pendingBuildSeed = {
    target_id: "cmt_009",
    character_id: "char_seeded",
    running_style: "chaser",
    target_stats: { speed: 1150, stamina: 1030 },
    name: "Capricorn — Seeded",
  };

  const entry = createEmptyBuildEntry();
  assert.equal(entry.target_id, "cmt_009");
  assert.equal(entry.character_id, "char_seeded");
  assert.equal(entry.running_style, "chaser");
  assert.deepEqual(entry.target_stats, { speed: 1150, stamina: 1030 });
  assert.equal(entry.name, "Capricorn — Seeded");
  // The seed is one-shot: a second call falls back to defaults.
  assert.equal(state.pendingBuildSeed, null);
  assert.equal(createEmptyBuildEntry().character_id, "char_001");
});
