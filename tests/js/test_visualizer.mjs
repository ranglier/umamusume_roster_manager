import "./_domshim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTrackSvg,
  describeDynamicTermHuman,
  getFilteredSkillPickerOptions,
  MAX_VISUALIZER_SKILLS,
  parseConditionString,
  resolveStaticZones,
  SKILL_HIGHLIGHT_CLASSES,
  STATIC_ZONE_VARIABLES,
} from "../../src/ui/assets/js/visualizer.js";

// Real condition strings pulled directly from this project's own imported
// reference.sqlite this session - not HTML-escaped, literal & and @.
const CERTAIN_VICTORY_PRECONDITION = "is_finalcorner==1&is_overtake==1&order<=5&order_rate<=50&overtake_target_time>=1";
const CERTAIN_VICTORY_CONDITION = "is_last_straight==1";
const CLEAR_HEART_CONDITION = "phase_random==1&order>=2&order_rate<=40";
const XCELERATION_CONDITION =
  "order>=3&order_rate<=50&remain_distance<=200&bashin_diff_infront<=1@order>=3&order_rate<=50&remain_distance<=200&bashin_diff_behind<=1";

function makeCourse(overrides = {}) {
  return {
    length_m: 1500,
    corners: [
      { start: 150, end: 425, number: 2 },
      { start: 1100, end: 1350, number: 4 },
    ],
    straights: [
      { start: 0, end: 150, frontType: 1 },
      { start: 1350, end: 1500, frontType: 2 },
    ],
    phases: [{ start: 250, end: 1000, id: 1 }],
    slopes: [],
    ...overrides,
  };
}

test("parseConditionString splits Certain Victory's precondition into one AND-group of 5 terms", () => {
  const result = parseConditionString(CERTAIN_VICTORY_PRECONDITION);
  assert.equal(result.orGroups.length, 1);
  assert.equal(result.orGroups[0].length, 5);
  assert.deepEqual(result.orGroups[0][0], { variable: "is_finalcorner", operator: "==", value: 1 });
  assert.deepEqual(result.orGroups[0][2], { variable: "order", operator: "<=", value: 5 });
});

test("parseConditionString splits Clear Heart's condition into one AND-group of 3 terms", () => {
  const result = parseConditionString(CLEAR_HEART_CONDITION);
  assert.equal(result.orGroups.length, 1);
  assert.equal(result.orGroups[0].length, 3);
  assert.deepEqual(result.orGroups[0][0], { variable: "phase_random", operator: "==", value: 1 });
});

test("parseConditionString splits Xceleration's condition into two OR-alternatives of 4 terms each", () => {
  const result = parseConditionString(XCELERATION_CONDITION);
  assert.equal(result.orGroups.length, 2);
  assert.equal(result.orGroups[0].length, 4);
  assert.equal(result.orGroups[1].length, 4);
  assert.deepEqual(result.orGroups[0][3], { variable: "bashin_diff_infront", operator: "<=", value: 1 });
  assert.deepEqual(result.orGroups[1][3], { variable: "bashin_diff_behind", operator: "<=", value: 1 });
});

test("parseConditionString treats null or empty input as no conditions", () => {
  assert.deepEqual(parseConditionString(null), { orGroups: [] });
  assert.deepEqual(parseConditionString(""), { orGroups: [] });
  assert.deepEqual(parseConditionString(undefined), { orGroups: [] });
});

test("parseConditionString keeps a malformed term instead of dropping or throwing", () => {
  const result = parseConditionString("phase==1&this is not a term");
  assert.equal(result.orGroups[0].length, 2);
  assert.deepEqual(result.orGroups[0][1], { variable: null, raw: "this is not a term" });
});

test("STATIC_ZONE_VARIABLES contains exactly the documented MVP allowlist", () => {
  assert.deepEqual(
    [...STATIC_ZONE_VARIABLES].sort(),
    ["is_finalcorner", "is_last_straight", "is_lastcorner", "is_laststraight", "phase", "phase_random", "remain_distance", "slope"].sort(),
  );
});

test("resolveStaticZones places Certain Victory on the final corner and last straight, with dynamic terms as badges", () => {
  const course = makeCourse();
  const result = resolveStaticZones(CERTAIN_VICTORY_CONDITION, CERTAIN_VICTORY_PRECONDITION, course);

  assert.equal(result.zones.length, 2);
  const bySource = Object.fromEntries(result.zones.map((zone) => [zone.source, zone]));
  assert.deepEqual(bySource.is_finalcorner, { start: 1100, end: 1350, approximate: false, source: "is_finalcorner", dynamicBadges: ["is_overtake==1", "order<=5", "order_rate<=50", "overtake_target_time>=1"] });
  assert.deepEqual(bySource.is_last_straight, { start: 1350, end: 1500, approximate: false, source: "is_last_straight", dynamicBadges: [] });
  assert.deepEqual(result.unplacedDynamicOnly, []);
});

test("resolveStaticZones flags a phase_random match as approximate", () => {
  const course = makeCourse();
  const result = resolveStaticZones(CLEAR_HEART_CONDITION, null, course);

  assert.equal(result.zones.length, 1);
  assert.equal(result.zones[0].approximate, true);
  assert.deepEqual(result.zones[0].dynamicBadges, ["order>=2", "order_rate<=40"]);
});

test("resolveStaticZones anchors remain_distance to the finish and keeps the two OR-alternatives' badges distinct", () => {
  const course = makeCourse();
  const result = resolveStaticZones(XCELERATION_CONDITION, null, course);

  assert.equal(result.zones.length, 2);
  assert.equal(result.zones[0].start, 1300);
  assert.equal(result.zones[0].end, 1500);
  assert.deepEqual(result.zones[0].dynamicBadges, ["order>=3", "order_rate<=50", "bashin_diff_infront<=1"]);
  assert.deepEqual(result.zones[1].dynamicBadges, ["order>=3", "order_rate<=50", "bashin_diff_behind<=1"]);
});

test("resolveStaticZones produces no slope zone when the course has no slope data", () => {
  const course = makeCourse({ slopes: [] });
  const result = resolveStaticZones("slope>=1", null, course);
  assert.equal(result.zones.length, 0);
});

test("resolveStaticZones produces a slope zone when the course has matching slope data", () => {
  const course = makeCourse({ slopes: [{ start: 700, end: 900, slope: 15 }] });
  const result = resolveStaticZones("slope>=1", null, course);
  assert.equal(result.zones.length, 1);
  assert.equal(result.zones[0].uphill, true);
  assert.equal(result.zones[0].start, 700);
});

test("resolveStaticZones puts fully-dynamic AND-groups in unplacedDynamicOnly, never fabricating a zone", () => {
  const course = makeCourse();
  const result = resolveStaticZones("order>=2&order_rate<=40", null, course);
  assert.equal(result.zones.length, 0);
  assert.deepEqual(result.unplacedDynamicOnly, ["order>=2 & order_rate<=40"]);
});

test("buildTrackSvg renders an svg with the expected viewBox and one rect per corner/straight", () => {
  const course = makeCourse();
  const svg = buildTrackSvg(course);
  assert.match(svg, /<svg class="track-svg" viewBox="0 0 1000 130"/);
  assert.equal((svg.match(/track-zone-corner/g) || []).length, course.corners.length);
  assert.equal((svg.match(/track-zone-straight/g) || []).length, course.straights.length);
  assert.match(svg, /Finish/);
});

test("buildTrackSvg draws no slope rects when the course has none, and one per slope when present", () => {
  const withoutSlopes = buildTrackSvg(makeCourse({ slopes: [] }));
  assert.doesNotMatch(withoutSlopes, /track-zone-(uphill|downhill)/);

  const withSlopes = buildTrackSvg(makeCourse({ slopes: [{ start: 700, end: 900, slope: 12 }] }));
  assert.match(withSlopes, /track-zone-uphill/);
});

test("buildTrackSvg renders one lane per highlight group, tagged with that group's color class", () => {
  const course = makeCourse();
  const svg = buildTrackSvg(course, {
    highlightGroups: [
      { className: "track-skill-1", zones: [{ start: 1100, end: 1350, approximate: false }] },
      { className: "track-skill-2", zones: [{ start: 250, end: 1000, approximate: true }] },
    ],
  });
  assert.match(svg, /class="track-zone-skill-highlight track-skill-1"/);
  assert.match(svg, /class="track-zone-skill-highlight track-skill-2 track-zone-skill-approx"/);
});

test("buildTrackSvg grows the viewBox height as more skill lanes are added, and stays at the single-skill baseline with none", () => {
  const course = makeCourse();
  const noSkills = buildTrackSvg(course);
  const oneSkill = buildTrackSvg(course, { highlightGroups: [{ className: "track-skill-1", zones: [] }] });
  const twoSkills = buildTrackSvg(course, {
    highlightGroups: [
      { className: "track-skill-1", zones: [] },
      { className: "track-skill-2", zones: [] },
    ],
  });

  const heightOf = (svg) => Number(svg.match(/viewBox="0 0 1000 (\d+)"/)[1]);
  assert.equal(heightOf(noSkills), 130);
  assert.ok(heightOf(oneSkill) > heightOf(noSkills));
  assert.ok(heightOf(twoSkills) > heightOf(oneSkill));
});

test("SKILL_HIGHLIGHT_CLASSES has exactly MAX_VISUALIZER_SKILLS entries", () => {
  assert.equal(SKILL_HIGHLIGHT_CLASSES.length, MAX_VISUALIZER_SKILLS);
  assert.ok(MAX_VISUALIZER_SKILLS >= 2);
});

test("describeDynamicTermHuman glosses known variables without discarding the operator/value", () => {
  assert.equal(describeDynamicTermHuman("order<=5"), "Rank <= 5");
  assert.equal(describeDynamicTermHuman("order_rate<=40"), "~ top 40% of the field by rank");
  assert.equal(describeDynamicTermHuman("order_rate>=60"), "~ back 40% of the field by rank");
  assert.equal(describeDynamicTermHuman("bashin_diff_infront<=1"), "<= 1 body from the horse ahead");
  assert.equal(describeDynamicTermHuman("bashin_diff_behind<=2"), "<= 2 bodies from the horse behind");
  assert.equal(describeDynamicTermHuman("is_overtake==1"), "Currently overtaking another horse");
  assert.equal(describeDynamicTermHuman("is_overtake==0"), "Not currently overtaking");
  assert.equal(describeDynamicTermHuman("always==1"), "Always active");
});

test("describeDynamicTermHuman glosses enum-coded variables confirmed by GameTora's own static/skill_conditions dataset", () => {
  assert.equal(describeDynamicTermHuman("running_style==2"), "Pace Chaser");
  assert.equal(describeDynamicTermHuman("season==1"), "Spring");
  assert.equal(describeDynamicTermHuman("season==5"), "Cherry blossom season");
  assert.equal(describeDynamicTermHuman("weather==4"), "Snowy");
  assert.equal(describeDynamicTermHuman("distance_type==4"), "Long race");
  assert.equal(describeDynamicTermHuman("ground_type==2"), "Dirt track");
  assert.equal(describeDynamicTermHuman("ground_condition==1"), "Track condition: good");
});

test("describeDynamicTermHuman returns null instead of guessing for out-of-range enum values or unknown variables", () => {
  assert.equal(describeDynamicTermHuman("running_style==9"), null);
  assert.equal(describeDynamicTermHuman("season==9"), null);
  assert.equal(describeDynamicTermHuman("blocked_side_continuetime>=2"), null);
  assert.equal(describeDynamicTermHuman("this is not a term"), null);
  assert.equal(describeDynamicTermHuman(""), null);
});

function makeSkillOptions(count) {
  return Array.from({ length: count }, (_, index) => ({ value: `skill_${index}`, label: `Skill ${index}` }));
}

test("getFilteredSkillPickerOptions filters by a case-insensitive substring on label or value", () => {
  const options = [
    { value: "110031", label: "Certain Victory" },
    { value: "10451", label: "Clear Heart" },
    { value: "10081", label: "Xceleration" },
  ];
  const result = getFilteredSkillPickerOptions(options, "victory", []);
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].value, "110031");
  assert.equal(result.hasQuery, true);
});

test("getFilteredSkillPickerOptions caps unfiltered results at 100 and flags isLimited", () => {
  const options = makeSkillOptions(150);
  const result = getFilteredSkillPickerOptions(options, "", []);
  assert.equal(result.options.length, 100);
  assert.equal(result.totalCount, 150);
  assert.equal(result.isLimited, true);
});

test("getFilteredSkillPickerOptions does not limit when a query is present", () => {
  const options = makeSkillOptions(150).map((option) => ({ ...option, label: `Zzz ${option.label}` }));
  const result = getFilteredSkillPickerOptions(options, "zzz", []);
  assert.equal(result.options.length, 150);
  assert.equal(result.isLimited, false);
});

test("getFilteredSkillPickerOptions keeps a selected skill visible even if the query filters it out", () => {
  const options = [
    { value: "110031", label: "Certain Victory" },
    { value: "10451", label: "Clear Heart" },
  ];
  const result = getFilteredSkillPickerOptions(options, "heart", ["110031"]);
  assert.equal(result.options[0].value, "110031");
  assert.equal(result.options.some((option) => option.value === "10451"), true);
});

test("getFilteredSkillPickerOptions pins multiple filtered-out selections, in selection order", () => {
  const options = [
    { value: "110031", label: "Certain Victory" },
    { value: "10451", label: "Clear Heart" },
    { value: "10081", label: "Xceleration" },
  ];
  const result = getFilteredSkillPickerOptions(options, "xcel", ["10451", "110031"]);
  assert.deepEqual(
    result.options.map((option) => option.value),
    ["10451", "110031", "10081"],
  );
});

test("getFilteredSkillPickerOptions defaults to no selection when the third argument is omitted", () => {
  const options = [{ value: "110031", label: "Certain Victory" }];
  const result = getFilteredSkillPickerOptions(options, "");
  assert.equal(result.options.length, 1);
});
