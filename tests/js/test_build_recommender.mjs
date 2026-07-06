import { test } from "node:test";
import assert from "node:assert/strict";

import {
  proposeTargetStats,
  rankOwnedCharactersForTarget,
  recommendBuildForTarget,
  scoreCharacterForTarget,
  targetProfileFromCmDetail,
} from "../../src/ui/assets/js/build_recommender.js";

// Tokyo 2400m Turf Medium, mirrors data/normalized/cm_targets.json cm_001.
const MEDIUM_TURF = { surfaceKey: "turf", surface: "Turf", distanceKey: "medium", distanceCategory: "Medium", distanceM: 2400 };

function makeChar(id, aptitudes, title = id) {
  return { id, title, detail: { aptitudes } };
}

// Real Special Week aptitudes (data/normalized/characters.json item 100101).
const SPECIAL_WEEK = makeChar("100101", {
  surface: { turf: "A", dirt: "G" },
  distance: { short: "F", mile: "C", medium: "A", long: "A" },
  style: { runner: "G", leader: "A", betweener: "A", chaser: "C" },
}, "Special Week");

test("targetProfileFromCmDetail reads the race profile slugs", () => {
  const profile = targetProfileFromCmDetail({
    race_profile: { surface: "Turf", surface_slug: "turf", distance_m: 2400, distance_category: "Medium", distance_category_slug: "medium" },
  });
  assert.equal(profile.surfaceKey, "turf");
  assert.equal(profile.distanceKey, "medium");
  assert.equal(profile.distanceM, 2400);
});

test("scoreCharacterForTarget picks the best style and grades the surface/distance fit", () => {
  const result = scoreCharacterForTarget(SPECIAL_WEEK, MEDIUM_TURF);
  assert.equal(result.characterId, "100101");
  assert.equal(result.surfaceGrade, "A");
  assert.equal(result.distanceGrade, "A");
  // leader and betweener are both A; leader wins the tie (earlier in order).
  assert.equal(result.bestStyle, "leader");
  assert.equal(result.styleGrade, "A");
  assert.equal(result.fitScore, 1); // all-A product = 1.0
  assert.equal(result.verdict, "useful");
});

test("scoreCharacterForTarget rewards an S-aptitude character with a higher fit score", () => {
  const sTier = makeChar("s1", {
    surface: { turf: "S", dirt: "G" },
    distance: { short: "F", mile: "C", medium: "S", long: "A" },
    style: { runner: "S", leader: "B", betweener: "C", chaser: "D" },
  });
  const result = scoreCharacterForTarget(sTier, MEDIUM_TURF);
  assert.equal(result.bestStyle, "runner");
  // 1.05 (surface S) * 1.05 (dist speed S) * 1.0 (dist accel S) * 1.1 (style S)
  assert.ok(result.fitScore > 1.2);
  assert.equal(result.verdict, "useful");
});

test("scoreCharacterForTarget flags an off-target character and never throws on missing grades", () => {
  const offTarget = makeChar("d1", {
    surface: { turf: "D", dirt: "A" },
    distance: { short: "A", mile: "B", medium: "E", long: "F" },
    style: { runner: "B", leader: "C", betweener: "D", chaser: "E" },
  });
  const result = scoreCharacterForTarget(offTarget, MEDIUM_TURF);
  assert.equal(result.verdict, "off-target");
  assert.ok(Number.isFinite(result.fitScore));
});

test("rankOwnedCharactersForTarget sorts candidates by fit score descending", () => {
  const weak = makeChar("weak", {
    surface: { turf: "C", dirt: "G" },
    distance: { short: "F", mile: "C", medium: "C", long: "A" },
    style: { runner: "G", leader: "C", betweener: "B", chaser: "C" },
  });
  const ranked = rankOwnedCharactersForTarget([weak, SPECIAL_WEEK], MEDIUM_TURF);
  assert.deepEqual(ranked.map((c) => c.characterId), ["100101", "weak"]);
});

test("proposeTargetStats grounds Stamina in the nearest reference and Guts past the crossover", () => {
  const proposal = proposeTargetStats(MEDIUM_TURF, "leader");
  // 2400m + 1 gold leader reference is 930, plus the 100 CM margin.
  assert.equal(proposal.stats.stamina, 1030);
  // medium crossover is 320, proposal nudges just past it.
  assert.equal(proposal.stats.guts, 370);
  assert.equal(proposal.stats.speed, 1150);
  assert.equal(proposal.stats.wit, 1200);
  assert.match(proposal.basis.staminaFrom, /2400m/);
});

test("proposeTargetStats falls back to defaults when no reference is close", () => {
  const proposal = proposeTargetStats({ surfaceKey: "turf", distanceKey: "unknown", distanceM: NaN }, "leader");
  assert.equal(proposal.stats.stamina, 500);
  assert.equal(proposal.stats.guts, 350);
  assert.match(proposal.basis.staminaFrom, /fallback/);
});

test("recommendBuildForTarget returns ranked candidates each with a stat proposal, capped by limit", () => {
  const chars = [SPECIAL_WEEK, makeChar("b", { surface: { turf: "B" }, distance: { medium: "B" }, style: { leader: "B" } })];
  const recos = recommendBuildForTarget(MEDIUM_TURF, chars, { limit: 1 });
  assert.equal(recos.length, 1);
  assert.equal(recos[0].characterId, "100101");
  assert.ok(recos[0].proposal.stats.stamina > 0);
});
