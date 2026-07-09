// Tests of the pure CV engine for the screenshot-based support import.
// Fixtures are raw RGBA crops extracted from a real 1080x2392 device capture
// (cells) and from the local reference illustrations (refs, LANCZOS 90x120):
// see tests/js/fixtures/roster-import/manifest.json. The module is pure (no
// DOM), so no domshim is needed here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MATCH_MAX_DISTANCE,
  MATCH_MIN_GAP,
  assessMatch,
  cellFingerprint,
  colorHistogram,
  cropImage,
  dedupeExtracted,
  deserializeFingerprint,
  dhash64,
  gridCells,
  hamming64,
  histIntersect,
  popcount32,
  rankCandidates,
  readLevel,
  readLimitBreak,
  reconcile,
  referenceFingerprint,
  resizeImage,
  serializeFingerprint,
} from "../../src/ui/assets/js/roster_import_cv.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "roster-import");
const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf-8"));

function loadRgba(entry) {
  const data = readFileSync(join(FIXTURES, entry.file));
  assert.equal(data.length, entry.width * entry.height * 4, `taille RGBA de ${entry.file}`);
  return { width: entry.width, height: entry.height, data };
}

const cells = manifest.cells.map((entry) => ({ ...entry, img: loadRgba(entry) }));
const refFingerprints = manifest.refs.map((entry) => [entry.id, referenceFingerprint(loadRgba(entry))]);

// --- primitives ---

test("popcount32 counts bits including the sign bit", () => {
  assert.equal(popcount32(0), 0);
  assert.equal(popcount32(1), 1);
  assert.equal(popcount32(0x80000000), 1);
  assert.equal(popcount32(0xffffffff), 32);
});

test("hamming64 is zero on identical hashes and symmetric", () => {
  const img = cells[0].img;
  const h = dhash64(img);
  assert.equal(hamming64(h, h), 0);
  const h2 = dhash64(cells[1].img);
  assert.equal(hamming64(h, h2), hamming64(h2, h));
});

test("colorHistogram is normalized and self-intersects at 1", () => {
  const hist = colorHistogram(cells[0].img);
  const sum = hist.reduce((acc, v) => acc + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(Math.abs(histIntersect(hist, hist) - 1) < 1e-9);
});

test("cropImage and resizeImage keep dimensions coherent", () => {
  const img = cells[0].img;
  const crop = cropImage(img, 10, 20, 50, 40);
  assert.equal(crop.width, 50);
  assert.equal(crop.height, 40);
  const small = resizeImage(crop, 9, 8);
  assert.equal(small.width, 9);
  assert.equal(small.data.length, 9 * 8 * 4);
});

// --- grid ---

test("gridCells at the native capture size yields the 30 calibrated cells", () => {
  const grid = gridCells(1080, 2392);
  assert.equal(grid.length, 30);
  assert.deepEqual(
    { x: grid[0].x, y: grid[0].y, width: grid[0].width, height: grid[0].height },
    { x: 45, y: 295, width: 180, height: 240 },
  );
  const last = grid[grid.length - 1];
  assert.equal(last.row, 5);
  assert.equal(last.col, 4);
  assert.equal(last.x, 45 + 4 * 202);
  assert.equal(last.y, 295 + 5 * 275);
});

test("gridCells scales proportionally with the capture width", () => {
  const grid = gridCells(540, 1196);
  assert.equal(grid.length, 30);
  assert.equal(grid[0].x, Math.round(45 * 0.5));
  assert.equal(grid[0].width, 90);
});

test("gridCells drops rows that fall outside the image", () => {
  const grid = gridCells(1080, 800);
  // Only row 0 fits (295 + 240 <= 800; row 1 starts at 570, 570+240 > 800).
  assert.equal(grid.length, 5);
});

// --- identity matching on real fixtures ---

test("every fixture cell matches its expected card, confidently", () => {
  for (const cell of cells) {
    const ranked = rankCandidates(cellFingerprint(cell.img), refFingerprints, 3);
    assert.equal(ranked[0].id, cell.card_id, `cellule (${cell.row},${cell.col})`);
    const verdict = assessMatch(ranked);
    assert.ok(
      verdict.confident,
      `(${cell.row},${cell.col}) devrait etre confiant: d=${ranked[0].distance} gap=${verdict.gap.toFixed(2)} (seuils d<=${MATCH_MAX_DISTANCE}, gap>=${MATCH_MIN_GAP})`,
    );
  }
});

test("same-character different-card pairs do not cross (Suzuka SSR/R, Teio SSR/R)", () => {
  const byCell = new Map(cells.map((cell) => [cell.card_id, cell]));
  // Cell of SSR Suzuka 30002 must beat the R Suzuka 10002, and vice-versa
  // context: 10002/10003 are distractor refs in the fixture set.
  const suzuka = byCell.get("30002");
  const rankedSuzuka = rankCandidates(cellFingerprint(suzuka.img), refFingerprints, 9);
  const posSSR = rankedSuzuka.findIndex((c) => c.id === "30002");
  const posR = rankedSuzuka.findIndex((c) => c.id === "10002");
  assert.ok(posSSR < posR, `30002 (rang ${posSSR}) doit battre 10002 (rang ${posR})`);

  const teio = byCell.get("30003");
  const rankedTeio = rankCandidates(cellFingerprint(teio.img), refFingerprints, 9);
  const posTeioSSR = rankedTeio.findIndex((c) => c.id === "30003");
  const posTeioR = rankedTeio.findIndex((c) => c.id === "10003");
  assert.ok(posTeioSSR < posTeioR, `30003 (rang ${posTeioSSR}) doit battre 10003 (rang ${posTeioR})`);
});

test("assessMatch flags an empty or ambiguous ranking as not confident", () => {
  assert.equal(assessMatch([]).confident, false);
  const ambiguous = [
    { id: "a", score: 5, distance: 5, intersection: 0.5 },
    { id: "b", score: 5.5, distance: 6, intersection: 0.5 },
  ];
  assert.equal(assessMatch(ambiguous).confident, false);
});

// --- user-state reading on real fixtures ---

test("readLimitBreak reads the expected gem count on every fixture cell", () => {
  for (const cell of cells) {
    const result = readLimitBreak(cell.img);
    assert.equal(result.limitBreak, cell.limit_break, `cellule (${cell.row},${cell.col})`);
    assert.ok(result.confident, `(${cell.row},${cell.col}) lecture LB incoherente: ${result.states}`);
  }
});

test("readLevel reads the expected level on every fixture cell", () => {
  for (const cell of cells) {
    const result = readLevel(cell.img);
    assert.equal(result.level, cell.level, `cellule (${cell.row},${cell.col})`);
    assert.ok(result.confidence > 0.85, `(${cell.row},${cell.col}) confiance faible: ${result.confidence.toFixed(2)}`);
  }
});

// --- fingerprint cache serialization ---

test("fingerprints round-trip losslessly through serialization", () => {
  for (const [id, fp] of refFingerprints) {
    const restored = deserializeFingerprint(JSON.parse(JSON.stringify(serializeFingerprint(fp))));
    assert.equal(hamming64(fp.hash, restored.hash), 0, `hash de ${id}`);
    assert.ok(Math.abs(histIntersect(fp.hist, restored.hist) - 1) < 1e-12, `histogramme de ${id}`);
  }
});

// --- reconciliation (synthetic) ---

test("dedupeExtracted keeps the highest-confidence reading per card", () => {
  const deduped = dedupeExtracted([
    { cardId: "30002", level: 35, limitBreak: 1, confidence: 0.7 },
    { cardId: "30002", level: 30, limitBreak: 1, confidence: 0.95 },
    { cardId: "10072", level: 1, limitBreak: 4, confidence: 0.9 },
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped.find((e) => e.cardId === "30002").level, 30);
});

test("reconcile classifies added, changed and unchanged entries", () => {
  const current = {
    30002: { owned: true, level: 30, limit_break: 1 },
    10072: { owned: true, level: 1, limit_break: 4 },
    20044: { owned: false },
  };
  const { added, changed, unchanged } = reconcile(current, [
    { cardId: "30002", level: 35, limitBreak: 1 }, // level up -> changed
    { cardId: "10072", level: 1, limitBreak: 4 }, // identical -> unchanged
    { cardId: "20044", level: 25, limitBreak: 2 }, // owned:false -> added
    { cardId: "30084", level: 50, limitBreak: 4 }, // absent -> added
  ]);
  assert.deepEqual(unchanged, ["10072"]);
  assert.deepEqual(added.map((e) => e.id), ["20044", "30084"]);
  assert.equal(added[0].to.owned, true);
  assert.equal(added[0].to.level, 25);
  assert.equal(changed.length, 1);
  assert.deepEqual(changed[0].fields, ["level"]);
  assert.equal(changed[0].from.level, 30);
  assert.equal(changed[0].to.level, 35);
});

test("reconcile never removes ownership: cards absent from captures are untouched", () => {
  const current = { 30002: { owned: true, level: 35, limit_break: 1 } };
  const { added, changed, unchanged } = reconcile(current, [
    { cardId: "10072", level: 1, limitBreak: 4 },
  ]);
  assert.deepEqual(added.map((e) => e.id), ["10072"]);
  assert.equal(changed.length, 0);
  assert.equal(unchanged.length, 0);
  // 30002 does not appear anywhere -> the caller has no reason to touch it.
});

test("reconcile skips level/limit_break when the reading is missing", () => {
  const current = {};
  const { added } = reconcile(current, [{ cardId: "30002", level: null, limitBreak: 2 }]);
  assert.equal(added[0].to.level, undefined);
  assert.equal(added[0].to.limit_break, 2);
});
