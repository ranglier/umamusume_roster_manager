import "./_domshim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatSupportEffectValue, formatTrainingEventChoiceLabel, getBuildSkillIds } from "../../src/ui/assets/js/catalog.js";

test("formatSupportEffectValue returns 'Locked' for null, undefined, or empty string", () => {
  assert.equal(formatSupportEffectValue({}, null), "Locked");
  assert.equal(formatSupportEffectValue({}, undefined), "Locked");
  assert.equal(formatSupportEffectValue({}, ""), "Locked");
});

test("formatSupportEffectValue appends % for percent-symbol effects", () => {
  assert.equal(formatSupportEffectValue({ symbol: "percent" }, 12), "12%");
});

test("formatSupportEffectValue prefixes Lv for level-symbol effects", () => {
  assert.equal(formatSupportEffectValue({ symbol: "level" }, 3), "Lv 3");
});

test("formatSupportEffectValue falls back to the plain value without a known symbol", () => {
  assert.equal(formatSupportEffectValue({}, 7), "7");
});

test("formatSupportEffectValue keeps one decimal place for non-integer numbers", () => {
  assert.equal(formatSupportEffectValue({ symbol: "percent" }, 12.5), "12.5%");
});

test("formatSupportEffectValue passes through non-numeric values as-is", () => {
  assert.equal(formatSupportEffectValue({}, "n/a"), "n/a");
});

test("formatTrainingEventChoiceLabel falls back to 'Choice N' for a purely numeric label", () => {
  assert.equal(formatTrainingEventChoiceLabel({ choice_label: "2", index: 2 }), "Choice 2");
});

test("formatTrainingEventChoiceLabel falls back to 'Choice ?' for a missing label and index", () => {
  assert.equal(formatTrainingEventChoiceLabel({}), "Choice ?");
});

test("formatTrainingEventChoiceLabel returns the trimmed label when it isn't purely numeric", () => {
  assert.equal(formatTrainingEventChoiceLabel({ choice_label: "  Go all out  " }), "Go all out");
});

test("getBuildSkillIds merges required and optional skills, deduped and stringified", () => {
  const buildItem = { detail: { entry: { required_skills: [1, 2], optional_skills: [2, 3] } } };
  assert.deepEqual(getBuildSkillIds(buildItem), ["1", "2", "3"]);
});

test("getBuildSkillIds returns an empty list for a missing item or entry", () => {
  assert.deepEqual(getBuildSkillIds(null), []);
  assert.deepEqual(getBuildSkillIds(undefined), []);
  assert.deepEqual(getBuildSkillIds({ detail: {} }), []);
  assert.deepEqual(getBuildSkillIds({}), []);
});
