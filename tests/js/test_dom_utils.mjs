import "./_domshim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  escapeHtml,
  hashText,
  badgePalette,
  clampRatio,
  clampNumber,
  parseRosterTokenList,
  tableFromRows,
} from "../../src/ui/assets/js/dom-utils.js";

test("escapeHtml escapes the five reserved characters", () => {
  assert.equal(escapeHtml(`<a href="x">'t'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;t&#39;&lt;/a&gt;");
});

test("escapeHtml treats null/undefined as empty string", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("hashText is deterministic and non-negative", () => {
  assert.equal(hashText(""), 0);
  assert.equal(hashText("abc"), 96354);
  assert.ok(hashText("some other badge text") >= 0);
});

test("badgePalette derives its hue from hashText", () => {
  const palette = badgePalette("abc");
  assert.equal(palette.bg, "hsla(234, 78%, 58%, 0.16)");
  assert.equal(palette.border, "hsla(234, 84%, 64%, 0.3)");
  assert.equal(palette.text, "hsl(234, 92%, 78%)");
});

test("clampRatio maps current/max into [0, 1]", () => {
  assert.equal(clampRatio(5, 10), 0.5);
  assert.equal(clampRatio(15, 10), 1);
  assert.equal(clampRatio(-5, 10), 0);
});

test("clampRatio returns 0 for a non-positive or non-finite max", () => {
  assert.equal(clampRatio(5, 0), 0);
  assert.equal(clampRatio(5, -10), 0);
  assert.equal(clampRatio("not-a-number", 10), 0);
});

test("clampNumber rounds, clamps, and falls back on non-finite input", () => {
  assert.equal(clampNumber(5, 0, 10, -1), 5);
  assert.equal(clampNumber(50, 0, 10, -1), 10);
  assert.equal(clampNumber(-50, 0, 10, -1), 0);
  assert.equal(clampNumber(5.6, 0, 10, -1), 6);
  assert.equal(clampNumber("nope", 0, 10, -1), -1);
});

test("parseRosterTokenList trims, drops blanks, and dedupes preserving order", () => {
  assert.deepEqual(parseRosterTokenList(" a, b ,a,, c"), ["a", "b", "c"]);
  assert.deepEqual(parseRosterTokenList(""), []);
  assert.deepEqual(parseRosterTokenList(null), []);
});

test("tableFromRows renders a fallback message for empty input", () => {
  assert.equal(tableFromRows([]), "<p class='source-note'>No data.</p>");
  assert.equal(tableFromRows(null), "<p class='source-note'>No data.</p>");
});

test("tableFromRows drops malformed rows (not a 2+ element array)", () => {
  const html = tableFromRows([["Speed", 1200], "not-a-row", ["Stamina"]]);
  assert.match(html, /<th>Speed<\/th>/);
  assert.doesNotMatch(html, /Stamina/);
});
