import { test } from "node:test";
import assert from "node:assert/strict";

import { formatCmTargetLabel, planToBuildSeed, selectDefaultTargetId, summarizeTargetRuns } from "../../src/ui/assets/js/prep.js";

function cm(id, start, end) {
  return { id, detail: { start_ts: start, end_ts: end } };
}

test("selectDefaultTargetId picks the CM running now", () => {
  const items = [cm("past", 100, 200), cm("now", 900, 1100), cm("future", 2000, 2100)];
  assert.equal(selectDefaultTargetId(items, 1000), "now");
});

test("selectDefaultTargetId picks the next upcoming CM when none is running", () => {
  const items = [cm("past", 100, 200), cm("soon", 1500, 1600), cm("later", 3000, 3100)];
  assert.equal(selectDefaultTargetId(items, 1000), "soon");
});

test("selectDefaultTargetId falls back to the most recently finished CM (no future)", () => {
  const items = [cm("old", 100, 200), cm("recent", 500, 800), cm("older", 300, 400)];
  assert.equal(selectDefaultTargetId(items, 5000), "recent");
});

test("selectDefaultTargetId handles an empty list", () => {
  assert.equal(selectDefaultTargetId([], 1000), null);
  assert.equal(selectDefaultTargetId(null, 1000), null);
});

test("planToBuildSeed maps a plan into the build-editor seed shape", () => {
  const plan = {
    target: { name: "Japanese Derby" },
    selected: { characterId: "100101" },
    style: { key: "leader" },
    deck: { deck: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] },
    stats: { stats: { speed: 1150, stamina: 1030 } },
    skills: { required: ["a1", "a2"], optional: ["o1"] },
  };
  const seed = planToBuildSeed(plan, "cm_001");
  assert.equal(seed.name, "Auto Prep - Japanese Derby");
  assert.equal(seed.target_id, "cm_001");
  assert.equal(seed.character_id, "100101");
  assert.equal(seed.running_style, "leader");
  assert.equal(seed.support_deck.length, 6); // capped at 6
  assert.deepEqual(seed.target_stats, { speed: 1150, stamina: 1030 });
  assert.deepEqual(seed.required_skills, ["a1", "a2"]);
  assert.deepEqual(seed.optional_skills, ["o1"]);
});

test("planToBuildSeed returns null when the plan has no retained uma", () => {
  assert.equal(planToBuildSeed({ selected: null }, "cm_001"), null);
});

test("formatCmTargetLabel combines name, track, distance/surface and month/year", () => {
  // cm_043 LONG at Nakayama 2500m Turf, starts 2026-01-22.
  const item = { id: "cm_043", detail: { name: "LONG", names: { en: null, ja: "LONG" }, start_ts: 1769040000, race_profile: { track_name: "Nakayama", surface: "Turf", distance_m: 2500 } } };
  const label = formatCmTargetLabel(item);
  assert.match(label, /^LONG · Nakayama 2500m Turf · \w{3} 2026$/);
});

test("formatCmTargetLabel drops an unknown track and a missing date gracefully", () => {
  const item = { id: "cm_045", detail: { name: "DIRT", race_profile: { track_name: "Unknown racetrack", surface: "Dirt", distance_m: 2000 } } };
  assert.equal(formatCmTargetLabel(item), "DIRT · 2000m Dirt");
});

test("formatCmTargetLabel prefers the zodiac cup name when present", () => {
  const item = { id: "cm_001", detail: { name: "Taurus Cup", start_ts: 1620000000, race_profile: { track_name: "Tokyo", surface: "Turf", distance_m: 2400 } } };
  assert.match(formatCmTargetLabel(item), /^Taurus Cup · Tokyo 2400m Turf · \w{3} 2021$/);
});

test("summarizeTargetRuns sorts most-recent-first and caps the list", () => {
  const runs = [
    { id: "run_001", character_id: "c1", outcome: "loss", final_stats: { speed: 1400 }, created_at: "2026-01-01T00:00:00Z" },
    { id: "run_003", character_id: "c3", outcome: "win", final_stats: { speed: 1580 }, created_at: "2026-03-01T00:00:00Z" },
    { id: "run_002", character_id: "c2", outcome: "win", final_stats: { speed: 1500 }, created_at: "2026-02-01T00:00:00Z" },
  ];
  const summary = summarizeTargetRuns(runs, { limit: 2 });
  assert.deepEqual(summary.map((r) => r.id), ["run_003", "run_002"]);
  assert.equal(summary[0].outcome, "win");
  assert.equal(summary[0].finalStats.speed, 1580);
});

test("summarizeTargetRuns tolerates an empty or missing list", () => {
  assert.deepEqual(summarizeTargetRuns([]), []);
  assert.deepEqual(summarizeTargetRuns(null), []);
});
