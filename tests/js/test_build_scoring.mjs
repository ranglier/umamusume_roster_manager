import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareAptitudeModifiers,
  computeMaxHp,
  computeRushedChance,
  computeSkillActivationChance,
  computeStatThresholdBonus,
  getAptitudeModifier,
  getGutsStaminaCrossoverThreshold,
  getNearestStaminaReferences,
  getRequiredStaminaEstimate,
} from "../../src/ui/assets/js/build_scoring.js";

test("getAptitudeModifier returns the exact game coefficient per grade and kind", () => {
  assert.equal(getAptitudeModifier("surfaceAccel", "S"), 1.05);
  assert.equal(getAptitudeModifier("surfaceAccel", "G"), 0.1);
  assert.equal(getAptitudeModifier("distanceSpeed", "B"), 0.9);
  assert.equal(getAptitudeModifier("distanceAccel", "D"), 1.0);
  assert.equal(getAptitudeModifier("distanceAccel", "E"), 0.6);
  assert.equal(getAptitudeModifier("styleWiz", "S"), 1.1);
});

test("getAptitudeModifier is case-insensitive and returns null for unknown grades or kinds", () => {
  assert.equal(getAptitudeModifier("surfaceAccel", "s"), 1.05);
  assert.equal(getAptitudeModifier("surfaceAccel", ""), null);
  assert.equal(getAptitudeModifier("surfaceAccel", "Z"), null);
  assert.equal(getAptitudeModifier("notAKind", "S"), null);
});

test("compareAptitudeModifiers reports the gain between current and planned (post-inheritance) grade", () => {
  const result = compareAptitudeModifiers("distanceSpeed", "B", "S");
  assert.equal(result.current, 0.9);
  assert.equal(result.target, 1.05);
  assert.equal(result.gain, 0.15);
});

test("compareAptitudeModifiers returns a null gain when either grade is unknown", () => {
  const result = compareAptitudeModifiers("distanceSpeed", "", "S");
  assert.equal(result.current, null);
  assert.equal(result.gain, null);
});

test("computeMaxHp matches the documented formula per style", () => {
  assert.equal(computeMaxHp(1200, 2000, "runner"), 2000 + 0.8 * 0.95 * 1200);
  assert.equal(computeMaxHp(1200, 2000, "betweener"), 2000 + 0.8 * 1.0 * 1200);
});

test("computeMaxHp returns null for an unknown style or non-finite inputs", () => {
  assert.equal(computeMaxHp(1200, 2000, "oonige_typo"), null);
  assert.equal(computeMaxHp(NaN, 2000, "runner"), null);
});

test("getRequiredStaminaEstimate only returns a value for an exact (distance, recoveries) match", () => {
  assert.equal(getRequiredStaminaEstimate(2400, 2, "runner"), 710);
  assert.equal(getRequiredStaminaEstimate(2400, 2, "leader"), 720);
  assert.equal(getRequiredStaminaEstimate(2400, 0, "runner"), null);
  assert.equal(getRequiredStaminaEstimate(1999, 2, "runner"), null);
});

test("getNearestStaminaReferences sorts reference rows by distance proximity", () => {
  const nearest = getNearestStaminaReferences(2500, 2);
  assert.equal(nearest.length, 2);
  assert.equal(nearest[0].distanceM, 2400);
});

test("computeStatThresholdBonus averages the tier bonus of each threshold stat", () => {
  // stat id 2 = stamina, 3 = power
  const bonus = computeStatThresholdBonus({ stamina: 1000, power: 500 }, [2, 3]);
  assert.equal(bonus, (0.2 + 0.1) / 2);
});

test("computeStatThresholdBonus returns null when the course has no threshold stats", () => {
  assert.equal(computeStatThresholdBonus({ stamina: 1000 }, []), null);
  assert.equal(computeStatThresholdBonus({ stamina: 1000 }, null), null);
});

test("computeSkillActivationChance matches the documented examples", () => {
  assert.equal(computeSkillActivationChance(300), 70);
  assert.equal(computeSkillActivationChance(600), 85);
  assert.equal(computeSkillActivationChance(900), 90);
  assert.equal(computeSkillActivationChance(1200), 92.5);
});

test("computeSkillActivationChance floors at 20% and handles missing input", () => {
  assert.equal(computeSkillActivationChance(50), 20);
  assert.equal(computeSkillActivationChance(0), null);
  assert.equal(computeSkillActivationChance(NaN), null);
});

test("computeRushedChance matches the documented examples within rounding", () => {
  assert.ok(Math.abs(computeRushedChance(300) - 19.0) < 0.1);
  assert.ok(Math.abs(computeRushedChance(900) - 11.01) < 0.1);
  assert.ok(Math.abs(computeRushedChance(1200) - 9.74) < 0.1);
});

test("getGutsStaminaCrossoverThreshold looks up by distance category, with a Long split and a Dirt override", () => {
  assert.equal(getGutsStaminaCrossoverThreshold("short", 1400, "turf"), 210);
  assert.equal(getGutsStaminaCrossoverThreshold("mile", 1600, "turf"), 260);
  assert.equal(getGutsStaminaCrossoverThreshold("medium", 2400, "turf"), 320);
  assert.equal(getGutsStaminaCrossoverThreshold("long", 3000, "turf"), 380);
  assert.equal(getGutsStaminaCrossoverThreshold("long", 3600, "turf"), 440);
  assert.equal(getGutsStaminaCrossoverThreshold("short", 1200, "dirt"), 260);
});

test("getGutsStaminaCrossoverThreshold returns null for an unknown category or a Long distance without a value", () => {
  assert.equal(getGutsStaminaCrossoverThreshold("unknown", 2000, "turf"), null);
  assert.equal(getGutsStaminaCrossoverThreshold("long", NaN, "turf"), null);
});
