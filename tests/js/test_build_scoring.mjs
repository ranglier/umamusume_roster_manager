import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareAptitudeModifiers,
  computeBaseSpeed,
  computeLastSpurtSpeedMax,
  computeMaxHp,
  computeRushedChance,
  computeSkillActivationChance,
  computeStatThresholdBonus,
  findTrackZoneAtDistance,
  getAptitudeModifier,
  getGutsStaminaCrossoverThreshold,
  getLastSpurtStartDistance,
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

test("computeBaseSpeed matches the documented examples", () => {
  assert.equal(computeBaseSpeed(2000), 20.0);
  assert.ok(Math.abs(computeBaseSpeed(1200) - 20.8) < 1e-9);
  assert.ok(Math.abs(computeBaseSpeed(2500) - 19.5) < 1e-9);
});

test("computeLastSpurtSpeedMax matches a hand-checked reference value", () => {
  const result = computeLastSpurtSpeedMax({ distanceM: 2000, speedStat: 1200, distanceProficiency: 1.0, gutsStat: 600, styleKey: "leader" });
  assert.ok(Math.abs(result - 22.408986391170362) < 1e-9);
});

test("computeLastSpurtSpeedMax returns null for an unknown style or non-finite stats", () => {
  assert.equal(computeLastSpurtSpeedMax({ distanceM: 2000, speedStat: 1200, distanceProficiency: 1.0, gutsStat: 600, styleKey: "oonige" }), null);
  assert.equal(computeLastSpurtSpeedMax({ distanceM: 2000, speedStat: NaN, distanceProficiency: 1.0, gutsStat: 600, styleKey: "leader" }), null);
});

test("getLastSpurtStartDistance places the spurt start at 16/24 of the course (phase 2 entry)", () => {
  assert.equal(getLastSpurtStartDistance(2400), 1600);
  assert.equal(getLastSpurtStartDistance(1200), 800);
  assert.equal(getLastSpurtStartDistance(NaN), null);
});

test("findTrackZoneAtDistance locates the corner/straight/slope/phase containing a given distance", () => {
  const course = {
    corners: [{ start: 1100, end: 1350, number: 4 }],
    straights: [{ start: 1350, end: 1500 }],
    slopes: [{ start: 700, end: 900, slope: 15 }],
    phases: [{ start: 1000, end: 1500, id: 2 }],
  };
  assert.deepEqual(findTrackZoneAtDistance(course, 1200), { phaseId: 2, cornerNumber: 4, onStraight: false, slope: null });
  assert.deepEqual(findTrackZoneAtDistance(course, 1400), { phaseId: 2, cornerNumber: null, onStraight: true, slope: null });
  assert.deepEqual(findTrackZoneAtDistance(course, 800), { phaseId: null, cornerNumber: null, onStraight: false, slope: "uphill" });
});

test("findTrackZoneAtDistance returns null for a non-finite distance", () => {
  assert.equal(findTrackZoneAtDistance({}, NaN), null);
});
