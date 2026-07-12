import { test } from "node:test";
import assert from "node:assert/strict";

import { planToBuildSeed, selectDefaultTargetId } from "../../src/ui/assets/js/prep.js";

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
