import "./_domshim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { data, state } from "../../src/ui/assets/js/core.js";
import {
  getCharacterBaseRarity,
  getCharacterRosterDefaults,
  getCharacterUniqueSkill,
  characterSupportsGreenSpark,
  getLegacyScenarioLabel,
  formatLegacyFactorLabel,
  deriveLegacyWhiteSparks,
} from "../../src/ui/assets/js/legacy.js";

test("getCharacterBaseRarity reads the reference item's rarity and defaults to 0 when unknown", () => {
  data.entities.characters.items = [{ id: "char_001", detail: { rarity: 3 } }];
  assert.equal(getCharacterBaseRarity("char_001"), 3);
  assert.equal(getCharacterBaseRarity("missing"), 0);
});

test("getCharacterRosterDefaults falls back to the base rarity and 0 awakening when not owned", () => {
  data.entities.characters.items = [{ id: "char_002", detail: { rarity: 4 } }];
  state.rosterDocument = { ...state.rosterDocument, characters: {} };
  assert.deepEqual(getCharacterRosterDefaults("char_002"), { stars: 4, awakening: 0 });
});

test("getCharacterRosterDefaults reads clamped owned stars/awakening from the roster entry", () => {
  data.entities.characters.items = [{ id: "char_003", detail: { rarity: 2 } }];
  state.rosterDocument = { ...state.rosterDocument, characters: { char_003: { owned: true, stars: 5, awakening: 9 } } };
  assert.deepEqual(getCharacterRosterDefaults("char_003"), { stars: 5, awakening: 5 });
});

test("getCharacterUniqueSkill returns the first unique skill or null", () => {
  data.entities.characters.items = [
    { id: "char_004", detail: { skill_links: { unique: [{ id: "sk_1" }] } } },
    { id: "char_005", detail: { skill_links: {} } },
  ];
  assert.deepEqual(getCharacterUniqueSkill("char_004"), { id: "sk_1" });
  assert.equal(getCharacterUniqueSkill("char_005"), null);
});

test("characterSupportsGreenSpark requires both 3+ stars and a unique skill", () => {
  data.entities.characters.items = [
    { id: "char_006", detail: { rarity: 3, skill_links: { unique: [{ id: "sk_2" }] } } },
    { id: "char_007", detail: { rarity: 2, skill_links: { unique: [{ id: "sk_3" }] } } },
    { id: "char_008", detail: { rarity: 3, skill_links: {} } },
  ];
  assert.equal(characterSupportsGreenSpark("char_006"), true);
  assert.equal(characterSupportsGreenSpark("char_007"), false);
  assert.equal(characterSupportsGreenSpark("char_008"), false);
});

test("characterSupportsGreenSpark honors an explicit stars override instead of the base rarity", () => {
  data.entities.characters.items = [{ id: "char_009", detail: { rarity: 1, skill_links: { unique: [{ id: "sk_4" }] } } }];
  assert.equal(characterSupportsGreenSpark("char_009", 3), true);
});

test("getLegacyScenarioLabel resolves a known scenario id to its label and echoes back unknown ids", () => {
  data.entities.scenarios.items = [{ id: "scn_1", detail: { scenario_id: "ura" }, title: "URA Finale" }];
  assert.equal(getLegacyScenarioLabel("ura"), "URA Finale");
  assert.equal(getLegacyScenarioLabel("unknown_scenario"), "unknown_scenario");
  assert.equal(getLegacyScenarioLabel(""), "");
});

test("formatLegacyFactorLabel renders '-' for a missing factor and clamps stars to 3", () => {
  assert.equal(formatLegacyFactorLabel(null), "-");
  assert.equal(formatLegacyFactorLabel({ target_label: "Speed", stars: 3 }), "Speed ★★★");
  assert.equal(formatLegacyFactorLabel({ target_label: "Speed", stars: 9 }), "Speed ★★★");
  assert.equal(formatLegacyFactorLabel({ target_key: "speed", stars: 0 }), "speed ");
});

test("deriveLegacyWhiteSparks prefers structured white_sparks over the legacy factors list", () => {
  const entry = {
    white_sparks: [{ kind: "skill", target_key: "sk_1" }],
    factors: [{ kind: "skill", target_key: "sk_2" }],
  };
  assert.deepEqual(deriveLegacyWhiteSparks(entry), [{ kind: "skill", target_key: "sk_1" }]);
});

test("deriveLegacyWhiteSparks falls back to scenario/g1/skill factors when no structured sparks exist", () => {
  const entry = {
    factors: [
      { kind: "stat", target_key: "speed" },
      { kind: "scenario", target_key: "ura" },
      { kind: "g1", target_key: "g1_1" },
      { kind: "skill", target_key: "sk_1" },
    ],
  };
  assert.deepEqual(deriveLegacyWhiteSparks(entry), [
    { kind: "scenario", target_key: "ura" },
    { kind: "g1", target_key: "g1_1" },
    { kind: "skill", target_key: "sk_1" },
  ]);
});
