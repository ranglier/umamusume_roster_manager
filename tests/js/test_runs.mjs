import "./_domshim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRunDelta, seedRunFromBuild } from "../../src/ui/assets/js/runs.js";

const sampleBuild = {
  id: "build_003",
  target_id: "cm_001",
  character_id: "100101",
  scenario_id: "11",
  running_style: "chaser",
  support_deck: ["10001", "30137"],
  legacy_pair: { parent_a: "legacy_001", parent_b: "legacy_002" },
  target_stats: { speed: 1600, stamina: 1200, power: 1400 },
  target_aptitudes: { surface: "S", distance: "A", style: "A" },
  required_skills: ["200452", "200492"],
  optional_skills: ["201132"],
};

test("seedRunFromBuild snapshots the build's plan as the run's starting point", () => {
  const seed = seedRunFromBuild(sampleBuild);
  assert.equal(seed.build_id, "build_003");
  assert.equal(seed.outcome, "untested");
  assert.equal(seed.running_style, "chaser");
  assert.deepEqual(seed.final_stats, { speed: 1600, stamina: 1200, power: 1400 });
  assert.deepEqual(seed.final_aptitudes, { surface: "S", distance: "A", style: "A" });
  // learned = required + optional, de-facto "all planned skills learned".
  assert.deepEqual(seed.learned_skills, ["200452", "200492", "201132"]);
  assert.deepEqual(seed.support_deck, ["10001", "30137"]);
});

test("seedRunFromBuild does not alias the build's nested objects", () => {
  const seed = seedRunFromBuild(sampleBuild);
  seed.final_stats.speed = 9;
  seed.legacy_pair.parent_a = "changed";
  assert.equal(sampleBuild.target_stats.speed, 1600);
  assert.equal(sampleBuild.legacy_pair.parent_a, "legacy_001");
});

test("computeRunDelta on a freshly seeded run shows zero gaps and nothing missing", () => {
  const delta = computeRunDelta(sampleBuild, seedRunFromBuild(sampleBuild));
  assert.ok(delta.stats.every((stat) => stat.delta === 0));
  assert.deepEqual(delta.missingRequired, []);
  assert.deepEqual(delta.extraSkills, []);
  assert.ok(delta.aptitudes.every((apt) => apt.changed === false));
});

test("computeRunDelta reports signed stat deltas against the plan", () => {
  const run = { final_stats: { speed: 1650, stamina: 1100 }, learned_skills: [] };
  const delta = computeRunDelta(sampleBuild, run);
  const bykey = Object.fromEntries(delta.stats.map((stat) => [stat.key, stat]));
  assert.equal(bykey.speed.delta, 50);
  assert.equal(bykey.stamina.delta, -100);
  // power was planned but not recorded -> no delta.
  assert.equal(bykey.power.planned, 1400);
  assert.equal(bykey.power.actual, null);
  assert.equal(bykey.power.delta, null);
});

test("computeRunDelta flags unlearned required skills and unplanned extras", () => {
  const run = { final_stats: {}, learned_skills: ["200452", "999999"] };
  const delta = computeRunDelta(sampleBuild, run);
  // 200492 was required but not learned; 201132 was optional so not "missing".
  assert.deepEqual(delta.missingRequired, ["200492"]);
  // 999999 is learned but was never planned.
  assert.deepEqual(delta.extraSkills, ["999999"]);
});

test("computeRunDelta marks aptitude changes between plan and real", () => {
  const run = { final_stats: {}, final_aptitudes: { surface: "S", distance: "B", style: "A" }, learned_skills: [] };
  const delta = computeRunDelta(sampleBuild, run);
  const bykey = Object.fromEntries(delta.aptitudes.map((apt) => [apt.key, apt]));
  assert.equal(bykey.surface.changed, false);
  assert.equal(bykey.distance.changed, true);
  assert.equal(bykey.distance.planned, "A");
  assert.equal(bykey.distance.actual, "B");
});
