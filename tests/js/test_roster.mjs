import "./_domshim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { state } from "../../src/ui/assets/js/core.js";
import {
  getCharacterProgressSummary,
  getSupportProgressSummary,
  getDefaultRosterEntry,
  pruneRosterEntry,
  getRosterBadges,
} from "../../src/ui/assets/js/roster.js";

test("getCharacterProgressSummary averages stars/awakening/unique ratios", () => {
  const summary = getCharacterProgressSummary({ stars: 5, awakening: 5, unique_level: 6 });
  assert.equal(summary.overallRatio, 1);
  assert.deepEqual(summary.metrics.map((metric) => metric.display), ["5/5", "5/5", "U6"]);
});

test("getCharacterProgressSummary treats unique_level 1 as the floor of its ratio", () => {
  const summary = getCharacterProgressSummary({ stars: 0, awakening: 0, unique_level: 1 });
  assert.equal(summary.overallRatio, 0);
});

test("getSupportProgressSummary weights level 75% and limit break 25%", () => {
  const summary = getSupportProgressSummary({ level: 30, level_cap: 30, limit_break: 4 });
  assert.equal(summary.overallRatio, 1);
});

test("getSupportProgressSummary falls back to level as its own cap when level_cap is missing", () => {
  const summary = getSupportProgressSummary({ level: 10, limit_break: 0 });
  assert.equal(summary.metrics[0].ratio, 1);
  assert.equal(summary.metrics[0].display, "10/-");
});

test("getDefaultRosterEntry builds the characters shape from the item's base rarity", () => {
  const entry = getDefaultRosterEntry("characters", { detail: { rarity: 3 } });
  assert.deepEqual(entry, {
    owned: false,
    favorite: false,
    note: "",
    stars: 3,
    awakening: 0,
    unique_level: 1,
    custom_tags: [],
    status_flags: [],
  });
});

test("getDefaultRosterEntry builds the supports shape with a base level of 1", () => {
  const entry = getDefaultRosterEntry("supports", {});
  assert.equal(entry.level, 1);
  assert.equal(entry.limit_break, 0);
});

test("getDefaultRosterEntry falls back to a bare shape for unknown entity keys", () => {
  assert.deepEqual(getDefaultRosterEntry("builds", {}), { owned: false, favorite: false, note: "" });
});

test("pruneRosterEntry drops fields that still match their defaults", () => {
  const item = { detail: { rarity: 2 } };
  const entry = { ...getDefaultRosterEntry("characters", item), owned: true, stars: 4 };
  const pruned = pruneRosterEntry("characters", item, entry);
  assert.deepEqual(pruned, { owned: true, stars: 4 });
});

test("pruneRosterEntry returns null once every field is back to its default", () => {
  const item = { detail: { rarity: 2 } };
  const entry = getDefaultRosterEntry("characters", item);
  assert.equal(pruneRosterEntry("characters", item, entry), null);
});

test("pruneRosterEntry keeps an array field only when it differs from the default", () => {
  const item = {};
  const changed = pruneRosterEntry("supports", item, { ...getDefaultRosterEntry("supports", item), custom_tags: ["farm"] });
  assert.deepEqual(changed.custom_tags, ["farm"]);
  const unchanged = pruneRosterEntry("supports", item, { ...getDefaultRosterEntry("supports", item), custom_tags: [] });
  assert.equal(unchanged, null);
});

test("getRosterBadges returns nothing without an active profile", () => {
  state.activeProfileId = null;
  assert.deepEqual(getRosterBadges("characters", { id: "c1" }, "roster"), []);
});

test("getRosterBadges reads builds entries from item.detail rather than the roster document", () => {
  state.activeProfileId = "p_001";
  const item = { detail: { entry: { custom_tags: ["a", "b", "c", "d"] }, labels: { status: "Draft", mode: "CM" } } };
  assert.deepEqual(getRosterBadges("builds", item, "roster"), ["Draft", "CM", "a", "b", "c"]);
});

test("getRosterBadges caps legacy tags/flags at two each after the scenario name", () => {
  state.activeProfileId = "p_001";
  const item = {
    detail: {
      entry: {
        scenario_name: "URA Finale",
        custom_tags: ["x", "y", "z"],
        status_flags: ["ready", "farming", "extra"],
      },
    },
  };
  assert.deepEqual(getRosterBadges("legacy", item, "roster"), ["URA Finale", "x", "y", "ready", "farming"]);
});

test("getRosterBadges reflects owned/favorite/note state for characters and supports", () => {
  state.activeProfileId = "p_001";
  state.rosterDocument = {
    ...state.rosterDocument,
    characters: { c1: { owned: true, favorite: true, note: "grinding", custom_tags: ["ace"] } },
  };
  assert.deepEqual(getRosterBadges("characters", { id: "c1", detail: { rarity: 3 } }, "roster"), ["Owned", "Favorite", "Note", "ace"]);
});
