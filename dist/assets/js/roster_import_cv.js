// Pure CV engine for the screenshot-based support roster import.
// No DOM, no fetch, no imports: everything operates on plain RGBA images of
// shape {width, height, data} (Uint8Array / Uint8ClampedArray / Buffer, RGBA
// row-major). The browser side (roster_import.js, phase B) decodes files via
// canvas and feeds ImageData-compatible objects here; tests feed raw fixtures.
//
// Method and thresholds come from the spike documented in
// docs/EXTERNAL_SOURCES_PLAN.md ("Mini-spike supports: cas resolu, 30/30"):
// identity = dHash (min over 5 art-box jitters) combined with a 6x6x6 color
// histogram, matched against the full local illustrations
// (dist/media/reference/supports/<id>.png) — NOT the icons/ subdir.
// Geometry is calibrated on the user's device captures (1080x2392).

// --- Grid geometry (base scale: 1080px-wide portrait screenshot) ---

export const SUPPORT_GRID = Object.freeze({
  baseWidth: 1080,
  originX: 45,
  originY: 295,
  cellWidth: 180,
  cellHeight: 240,
  pitchX: 202,
  pitchY: 275,
  columns: 5,
  // Row 7 exists but sits under the "Held / Filters" overlay bar on this
  // device; only 6 rows are fully readable. Partial-row handling is a later
  // concern (see docs/ROSTER_IMPORT_PLAN.md, "Risques connus").
  maxRows: 6,
});

// Art region shared by the in-game cell and the reference illustration
// (same artwork, same 3:4 ratio): fractions of the card box.
export const ART_BOX = Object.freeze({ left: 0.10, top: 0.14, right: 0.90, bottom: 0.78 });

// The cell-side hash is computed at 5 slightly shifted art boxes and matched
// by minimum distance, absorbing small grid-alignment error.
export const CELL_JITTERS = Object.freeze([
  [0, 0],
  [0.02, 0],
  [-0.02, 0],
  [0, 0.02],
  [0, -0.02],
]);

// Match confidence thresholds (see tests for the measured margins).
export const MATCH_MAX_DISTANCE = 12;
export const MATCH_MIN_GAP = 2.0;
export const HIST_WEIGHT = 10;

// --- Basic image ops ---

export function cropImage(img, x, y, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    const src = ((y + row) * img.width + x) * 4;
    out.set(img.data.subarray(src, src + w * 4), row * w * 4);
  }
  return { width: w, height: h, data: out };
}

// Deterministic box-average resize. Consistency between the two sides of a
// comparison matters more than resample quality, so references and cells must
// both go through this exact function (never mix with canvas scaling).
export function resizeImage(img, tw, th) {
  const out = new Uint8Array(tw * th * 4);
  for (let ty = 0; ty < th; ty += 1) {
    const sy0 = Math.floor((ty * img.height) / th);
    const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) * img.height) / th));
    for (let tx = 0; tx < tw; tx += 1) {
      const sx0 = Math.floor((tx * img.width) / tw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) * img.width) / tw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const i = (sy * img.width + sx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
          n += 1;
        }
      }
      const o = (ty * tw + tx) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: tw, height: th, data: out };
}

export function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// --- dHash (64 bits as two unsigned 32-bit halves — JS bitwise operators
// truncate to 32 bits, so a single number cannot hold the hash) ---

export function dhash64(img) {
  const small = resizeImage(img, 9, 8);
  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const i = (row * 9 + col) * 4;
      const left = luminance(small.data[i], small.data[i + 1], small.data[i + 2]);
      const right = luminance(small.data[i + 4], small.data[i + 5], small.data[i + 6]);
      const v = left > right ? 1 : 0;
      if (bit < 32) {
        hi = ((hi << 1) | v) >>> 0;
      } else {
        lo = ((lo << 1) | v) >>> 0;
      }
      bit += 1;
    }
  }
  return { hi, lo };
}

export function popcount32(v) {
  let x = v >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

export function hamming64(a, b) {
  return popcount32(a.hi ^ b.hi) + popcount32(a.lo ^ b.lo);
}

// --- Color histogram (6x6x6 = 216 bins, normalized) ---

export const HIST_BINS = 6;
const HIST_STEP = Math.floor(256 / HIST_BINS) + (256 % HIST_BINS ? 1 : 0);
const HIST_SIZE = 32;

export function colorHistogram(img) {
  const small = resizeImage(img, HIST_SIZE, HIST_SIZE);
  const hist = new Float64Array(HIST_BINS * HIST_BINS * HIST_BINS);
  const total = HIST_SIZE * HIST_SIZE;
  for (let i = 0; i < total; i += 1) {
    const o = i * 4;
    const r = Math.floor(small.data[o] / HIST_STEP);
    const g = Math.floor(small.data[o + 1] / HIST_STEP);
    const b = Math.floor(small.data[o + 2] / HIST_STEP);
    hist[r * HIST_BINS * HIST_BINS + g * HIST_BINS + b] += 1;
  }
  for (let i = 0; i < hist.length; i += 1) {
    hist[i] /= total;
  }
  return hist;
}

export function histIntersect(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.min(a[i], b[i]);
  }
  return sum;
}

// --- Identity fingerprints and matching ---

export function artBoxRect(width, height, dx = 0, dy = 0) {
  const x0 = Math.max(0, Math.floor(width * (ART_BOX.left + dx)));
  const y0 = Math.max(0, Math.floor(height * (ART_BOX.top + dy)));
  const x1 = Math.min(width, Math.floor(width * (ART_BOX.right + dx)));
  const y1 = Math.min(height, Math.floor(height * (ART_BOX.bottom + dy)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function referenceFingerprint(cardImg) {
  const box = artBoxRect(cardImg.width, cardImg.height);
  const art = cropImage(cardImg, box.x, box.y, box.width, box.height);
  return { hash: dhash64(art), hist: colorHistogram(art) };
}

export function cellFingerprint(cellImg) {
  const hashes = CELL_JITTERS.map(([dx, dy]) => {
    const box = artBoxRect(cellImg.width, cellImg.height, dx, dy);
    return dhash64(cropImage(cellImg, box.x, box.y, box.width, box.height));
  });
  const box = artBoxRect(cellImg.width, cellImg.height);
  const hist = colorHistogram(cropImage(cellImg, box.x, box.y, box.width, box.height));
  return { hashes, hist };
}

export function scoreCandidate(cellFp, refFp) {
  let distance = Infinity;
  for (const hash of cellFp.hashes) {
    const d = hamming64(hash, refFp.hash);
    if (d < distance) {
      distance = d;
    }
  }
  const intersection = histIntersect(cellFp.hist, refFp.hist);
  return { score: distance - HIST_WEIGHT * intersection, distance, intersection };
}

// refEntries: iterable of [id, referenceFingerprint].
export function rankCandidates(cellFp, refEntries, topN = 3) {
  const ranked = [];
  for (const [id, refFp] of refEntries) {
    const { score, distance, intersection } = scoreCandidate(cellFp, refFp);
    ranked.push({ id: String(id), score, distance, intersection });
  }
  ranked.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return ranked.slice(0, Math.max(topN, 2));
}

export function assessMatch(ranked, { maxDistance = MATCH_MAX_DISTANCE, minGap = MATCH_MIN_GAP } = {}) {
  if (!ranked.length) {
    return { confident: false, bestId: null, gap: 0 };
  }
  const best = ranked[0];
  const gap = ranked.length > 1 ? ranked[1].score - best.score : Infinity;
  return {
    confident: best.distance <= maxDistance && gap >= minGap,
    bestId: best.id,
    gap,
  };
}

// --- Grid slicing ---

export function gridCells(width, height, grid = SUPPORT_GRID) {
  const scale = width / grid.baseWidth;
  const cells = [];
  for (let row = 0; row < grid.maxRows; row += 1) {
    const y = Math.round((grid.originY + row * grid.pitchY) * scale);
    const cellH = Math.round(grid.cellHeight * scale);
    if (y + cellH > height) {
      break;
    }
    for (let col = 0; col < grid.columns; col += 1) {
      const x = Math.round((grid.originX + col * grid.pitchX) * scale);
      cells.push({ row, col, x, y, width: Math.round(grid.cellWidth * scale), height: cellH });
    }
  }
  return cells;
}

// --- Limit break (4 gem slots at the bottom-left of the cell) ---
// Filled gems are bright cyan (strong blue, low red); empty slots are flat
// gray (r ~= g ~= b ~= 160-176). Measured on real captures — see
// docs/ROSTER_IMPORT_PLAN.md.

export const GEM_CENTERS = Object.freeze([
  [17, 213],
  [39, 213],
  [61, 213],
  [83, 213],
]);
const GEM_RADIUS = 3;

function patchAverage(img, cx, cy, radius) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) {
        continue;
      }
      const i = (y * img.width + x) * 4;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n += 1;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

export function readLimitBreak(cellImg) {
  const sx = cellImg.width / SUPPORT_GRID.cellWidth;
  const sy = cellImg.height / SUPPORT_GRID.cellHeight;
  const radius = Math.max(1, Math.round(GEM_RADIUS * sx));
  const states = GEM_CENTERS.map(([cx, cy]) => {
    const { r, b } = patchAverage(cellImg, Math.round(cx * sx), Math.round(cy * sy), radius);
    return b > 185 && b - r > 40;
  });
  // Gems fill left to right; a hole (filled after empty) means a misread.
  const firstEmpty = states.indexOf(false);
  const prefixCount = firstEmpty === -1 ? states.length : firstEmpty;
  const totalFilled = states.filter(Boolean).length;
  return {
    limitBreak: prefixCount,
    states,
    confident: totalFilled === prefixCount,
  };
}

// --- Level ("Lvl XX", right-aligned brown text on the translucent band) ---
// Digit glyph templates were extracted from real captures of this device.
// Coverage: digits 0-5 only — this capture set had no level containing 6-9
// (real levels cluster on milestone values). An unknown digit scores low on
// every template and surfaces as low confidence for manual correction in the
// reconciliation UI; extend DIGIT_GLYPHS when a capture with 6-9 shows up.

export const LEVEL_TEXT_REGION = Object.freeze({ x0: 88, y0: 196, x1: 178, y1: 234 });
const LEVEL_ROWS = [6, 34];
// Full region width: the text's horizontal position varies a little from card
// to card, and a tighter limit was observed clipping a digit's right edge.
// The rounded-corner line that crosses the bottom-right of the region is
// handled by the top-row blob filter below, not by a column limit.
const LEVEL_COLS = [0, 90];
const LEVEL_LUM_THRESHOLD = 150;
const LEVEL_MIN_BLOB = 3;
const LEVEL_MAX_TOP_ROW = 14;
const LEVEL_SPLIT_GAP = 6;
// Digits are ~20 rows tall from their topmost row; anything below that inside
// the blob is pollution (the card's rounded-corner line crosses the region's
// bottom-right and can merge with the last digit's column span).
const LEVEL_MAX_DIGIT_HEIGHT = 22;
const GLYPH_W = 12;
const GLYPH_H = 18;

export const DIGIT_GLYPHS = Object.freeze({
  0: ["000011110000", "000111111000", "001111111100", "011110011110", "011100001111", "111100001111", "111000000111", "111000000111", "111000000111", "111000000111", "111000000111", "111000000111", "111100000111", "111100001111", "011100011111", "011111111110", "001111111110", "000111111000"],
  1: ["111111111111", "111111111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111", "000000111111"],
  2: ["000011111000", "001111111110", "001111111111", "001100001111", "000000000111", "000000000111", "000000000111", "000000000111", "000000001111", "000000011111", "000000111110", "000001111100", "000001111000", "000011110000", "000111100000", "001111000000", "001111111111", "111111111111"],
  3: ["001111110000", "011111111110", "011111111110", "010000001111", "000000000111", "000000000111", "000000001111", "000011111110", "000011111110", "000011111111", "000000001111", "000000000111", "000000000111", "000000000111", "100000001111", "111111111111", "111111111111", "111111111100"],
  4: ["000000011110", "000000011110", "000000111110", "000000111110", "000001111110", "000011101110", "000011101110", "000111001110", "000111001110", "000110001110", "001100001110", "011100001110", "011100011110", "111111111111", "111111111111", "111111111111", "000000011110", "000000001110"],
  5: ["001111111111", "001111111111", "001110000000", "001110000000", "011100000000", "011100000000", "011111111000", "011111111110", "011111111111", "000000000111", "000000000111", "000000000111", "000000000111", "000000000111", "100000011111", "111111111111", "111111111110", "111111111100"],
});

const GLYPH_MASKS = Object.entries(DIGIT_GLYPHS).map(([char, rows]) => ({
  char,
  mask: rows.map((row) => row.split("").map(Number)),
}));

// Same integer box mapping as resizeImage, on a binary 2D mask.
export function resizeMask(mask, tw = GLYPH_W, th = GLYPH_H) {
  const sh = mask.length;
  const sw = mask[0].length;
  const out = [];
  for (let ty = 0; ty < th; ty += 1) {
    const sy0 = Math.floor((ty * sh) / th);
    const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) * sh) / th));
    const row = [];
    for (let tx = 0; tx < tw; tx += 1) {
      const sx0 = Math.floor((tx * sw) / tw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) * sw) / tw));
      let total = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          total += 1;
          count += mask[sy][sx];
        }
      }
      row.push(count * 2 >= total ? 1 : 0);
    }
    out.push(row);
  }
  return out;
}

export function maskAgreement(a, b) {
  let same = 0;
  let total = 0;
  for (let y = 0; y < a.length; y += 1) {
    for (let x = 0; x < a[0].length; x += 1) {
      total += 1;
      if (a[y][x] === b[y][x]) {
        same += 1;
      }
    }
  }
  return same / total;
}

function classifyDigit(mask) {
  const normalized = resizeMask(mask);
  let best = { char: null, score: -1 };
  for (const glyph of GLYPH_MASKS) {
    const score = maskAgreement(normalized, glyph.mask);
    if (score > best.score) {
      best = { char: glyph.char, score };
    }
  }
  return best;
}

export function readLevel(cellImg) {
  const sx = cellImg.width / SUPPORT_GRID.cellWidth;
  const sy = cellImg.height / SUPPORT_GRID.cellHeight;
  const rx0 = Math.round(LEVEL_TEXT_REGION.x0 * sx);
  const ry0 = Math.round(LEVEL_TEXT_REGION.y0 * sy);
  const w = Math.round((LEVEL_TEXT_REGION.x1 - LEVEL_TEXT_REGION.x0) * sx);
  const h = Math.round((LEVEL_TEXT_REGION.y1 - LEVEL_TEXT_REGION.y0) * sy);
  const rowMin = Math.round(LEVEL_ROWS[0] * sy);
  const rowMax = Math.min(Math.round(LEVEL_ROWS[1] * sy), h);
  const colMax = Math.min(Math.round(LEVEL_COLS[1] * sx), w);

  // Binarize the text band (dark text on the translucent white strip).
  const grid = [];
  for (let y = 0; y < h; y += 1) {
    grid.push(new Array(w).fill(0));
  }
  for (let y = rowMin; y < rowMax; y += 1) {
    for (let x = 0; x < colMax; x += 1) {
      const i = ((ry0 + y) * cellImg.width + rx0 + x) * 4;
      if (luminance(cellImg.data[i], cellImg.data[i + 1], cellImg.data[i + 2]) < LEVEL_LUM_THRESHOLD) {
        grid[y][x] = 1;
      }
    }
  }

  // Column projection -> blobs, dropping noise: slivers narrower than
  // LEVEL_MIN_BLOB, and blobs whose topmost row is too low (the rounded card
  // corner sneaks into the bottom-right of the region; text starts high).
  const minBlob = Math.max(2, Math.round(LEVEL_MIN_BLOB * sx));
  const maxTop = Math.round(LEVEL_MAX_TOP_ROW * sy);
  const columnHasInk = [];
  for (let x = 0; x < w; x += 1) {
    let ink = false;
    for (let y = 0; y < h; y += 1) {
      if (grid[y][x]) {
        ink = true;
        break;
      }
    }
    columnHasInk.push(ink);
  }
  const blobs = [];
  let start = null;
  for (let x = 0; x <= w; x += 1) {
    const on = x < w && columnHasInk[x];
    if (on && start === null) {
      start = x;
    } else if (!on && start !== null) {
      blobs.push([start, x]);
      start = null;
    }
  }
  const kept = blobs.filter(([xs, xe]) => {
    if (xe - xs < minBlob) {
      return false;
    }
    for (let y = 0; y <= maxTop; y += 1) {
      for (let x = xs; x < xe; x += 1) {
        if (grid[y][x]) {
          return true;
        }
      }
    }
    return false;
  });
  if (!kept.length) {
    return { level: null, confidence: 0, digits: [] };
  }

  // Right-aligned "Lvl NN": the digits are the blobs after the last wide gap
  // (the space between the label and the number).
  const splitGap = Math.round(LEVEL_SPLIT_GAP * sx);
  let split = 0;
  for (let i = 1; i < kept.length; i += 1) {
    if (kept[i][0] - kept[i - 1][1] >= splitGap) {
      split = i;
    }
  }
  const digitBlobs = kept.slice(split);
  if (!digitBlobs.length || digitBlobs.length > 2) {
    return { level: null, confidence: 0, digits: [] };
  }

  const maxDigitHeight = Math.round(LEVEL_MAX_DIGIT_HEIGHT * sy);
  const digits = digitBlobs.map(([xs, xe]) => {
    let top = h;
    let bottom = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = xs; x < xe; x += 1) {
        if (grid[y][x]) {
          if (y < top) {
            top = y;
          }
          if (y > bottom) {
            bottom = y;
          }
        }
      }
    }
    bottom = Math.min(bottom, top + maxDigitHeight - 1);
    const mask = [];
    for (let y = top; y <= bottom; y += 1) {
      mask.push(grid[y].slice(xs, xe));
    }
    return classifyDigit(mask);
  });

  if (digits.some((d) => d.char === null)) {
    return { level: null, confidence: 0, digits };
  }
  const level = Number.parseInt(digits.map((d) => d.char).join(""), 10);
  if (!Number.isInteger(level) || level < 1 || level > 50) {
    return { level: null, confidence: 0, digits };
  }
  return {
    level,
    confidence: Math.min(...digits.map((d) => d.score)),
    digits,
  };
}

// --- Fingerprint (de)serialization for the localStorage cache ---
// The histogram counts 32x32 = 1024 samples; count/1024 is exact in binary
// floating point, so sparse integer counts round-trip losslessly.

const HIST_SAMPLES = HIST_SIZE * HIST_SIZE;

export function histToSparse(hist) {
  const sparse = {};
  for (let i = 0; i < hist.length; i += 1) {
    if (hist[i] > 0) {
      sparse[i] = Math.round(hist[i] * HIST_SAMPLES);
    }
  }
  return sparse;
}

export function sparseToHist(sparse) {
  const hist = new Float64Array(HIST_BINS * HIST_BINS * HIST_BINS);
  for (const [index, count] of Object.entries(sparse || {})) {
    hist[Number(index)] = count / HIST_SAMPLES;
  }
  return hist;
}

export function serializeFingerprint(fp) {
  return { h: [fp.hash.hi, fp.hash.lo], s: histToSparse(fp.hist) };
}

export function deserializeFingerprint(raw) {
  return { hash: { hi: raw.h[0] >>> 0, lo: raw.h[1] >>> 0 }, hist: sparseToHist(raw.s) };
}

// --- Reconciliation (pure diff; the import never removes ownership) ---

// Entries: [{cardId, level, limitBreak, confidence}] possibly with duplicates
// across overlapping screenshots — keep the highest-confidence reading.
export function dedupeExtracted(entries) {
  const byId = new Map();
  for (const entry of entries) {
    const key = String(entry.cardId);
    const current = byId.get(key);
    if (!current || (entry.confidence || 0) > (current.confidence || 0)) {
      byId.set(key, entry);
    }
  }
  return [...byId.values()];
}

// currentSupports: the roster document supports map (id -> {owned, level,
// limit_break, ...}). Returns proposals only — applying them is the UI's job.
export function reconcile(currentSupports, extracted) {
  const added = [];
  const changed = [];
  const unchanged = [];
  const sorted = [...extracted].sort((a, b) => String(a.cardId).localeCompare(String(b.cardId)));
  for (const entry of sorted) {
    const id = String(entry.cardId);
    const to = { owned: true };
    if (Number.isInteger(entry.level)) {
      to.level = entry.level;
    }
    if (Number.isInteger(entry.limitBreak)) {
      to.limit_break = entry.limitBreak;
    }
    const current = currentSupports?.[id];
    if (!current || current.owned !== true) {
      added.push({ id, to });
      continue;
    }
    const fields = [];
    if (to.level != null && current.level !== to.level) {
      fields.push("level");
    }
    if (to.limit_break != null && current.limit_break !== to.limit_break) {
      fields.push("limit_break");
    }
    if (fields.length) {
      changed.push({
        id,
        fields,
        from: { level: current.level, limit_break: current.limit_break },
        to,
      });
    } else {
      unchanged.push(id);
    }
  }
  return { added, changed, unchanged };
}

// Generic variant of reconcile for other entity types (uma import uses
// stars/awakening). `fields` maps extracted keys to roster entry keys, e.g.
// [["stars", "stars"], ["potential", "awakening"]]. Same contract: proposals
// only, never removes ownership; caller passes defaults-normalized entries.
export function reconcileFields(currentEntries, extracted, fields) {
  const added = [];
  const changed = [];
  const unchanged = [];
  const sorted = [...extracted].sort((a, b) => String(a.cardId).localeCompare(String(b.cardId)));
  for (const entry of sorted) {
    const id = String(entry.cardId);
    const to = { owned: true };
    for (const [fromKey, toKey] of fields) {
      if (Number.isInteger(entry[fromKey])) {
        to[toKey] = entry[fromKey];
      }
    }
    const current = currentEntries?.[id];
    if (!current || current.owned !== true) {
      added.push({ id, to });
      continue;
    }
    const diffFields = [];
    for (const [, toKey] of fields) {
      if (to[toKey] != null && current[toKey] !== to[toKey]) {
        diffFields.push(toKey);
      }
    }
    if (diffFields.length) {
      const from = {};
      for (const [, toKey] of fields) {
        from[toKey] = current[toKey];
      }
      changed.push({ id, fields: diffFields, from, to });
    } else {
      unchanged.push(id);
    }
  }
  return { added, changed, unchanged };
}

// --- Uma (trainee) grid: identity + stars + Potential Lvl -----------------
// See docs/ROSTER_IMPORT_PLAN.md phase E and EXTERNAL_SOURCES_PLAN.md ("Umas
// debloquees"). References are the in-game per-variant icons (256x280,
// fetched by scripts/fetch_chara_icons.py). The in-game grid cell renders a
// fixed zoomed crop of that icon; both boxes below were calibrated by brute
// force on a real capture (dHash distance 0 on the calibration pair).

export const UMA_GRID = Object.freeze({
  baseWidth: 1080,
  originX: 45,
  originY: 299,
  cellWidth: 180,
  cellHeight: 230,
  pitchX: 202,
  pitchY: 242,
  columns: 5,
  maxRows: 7,
});

// icon.crop(28,46,238,227) on a 256x280 icon == cell art (8,8,172,150) on a
// 180x180 art square — expressed as fractions so any input size works.
const UMA_ICON_ART = Object.freeze({ left: 28 / 256, top: 46 / 280, right: 238 / 256, bottom: 227 / 280 });
const UMA_CELL_ART = Object.freeze({ left: 8 / 180, top: 8 / 230, right: 172 / 180, bottom: 150 / 230 });
const UMA_CELL_JITTERS = Object.freeze([
  [0, 0],
  [3, 0],
  [-3, 0],
  [0, 3],
  [0, -3],
]);

function cropFractional(img, frac, dxPx = 0, dyPx = 0) {
  const x0 = Math.max(0, Math.floor(img.width * frac.left) + dxPx);
  const y0 = Math.max(0, Math.floor(img.height * frac.top) + dyPx);
  const x1 = Math.min(img.width, Math.floor(img.width * frac.right) + dxPx);
  const y1 = Math.min(img.height, Math.floor(img.height * frac.bottom) + dyPx);
  return cropImage(img, x0, y0, x1 - x0, y1 - y0);
}

// The icons have transparent rounded corners; under alpha=0 the RGB values
// are arbitrary and differ between decoders (canvas yields black, Pillow
// keeps palette remnants). Flatten deterministically before fingerprinting.
export function flattenAlpha(img, r = 255, g = 255, b = 255) {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out[i] = Math.round(img.data[i] * a + r * (1 - a));
    out[i + 1] = Math.round(img.data[i + 1] * a + g * (1 - a));
    out[i + 2] = Math.round(img.data[i + 2] * a + b * (1 - a));
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

export function umaReferenceFingerprint(iconImg) {
  const art = cropFractional(flattenAlpha(iconImg), UMA_ICON_ART);
  return { hash: dhash64(art), hist: colorHistogram(art) };
}

export function umaCellFingerprint(cellImg) {
  const sx = cellImg.width / UMA_GRID.cellWidth;
  const hashes = UMA_CELL_JITTERS.map(([dx, dy]) =>
    dhash64(cropFractional(cellImg, UMA_CELL_ART, Math.round(dx * sx), Math.round(dy * sx))));
  const hist = colorHistogram(cropFractional(cellImg, UMA_CELL_ART));
  return { hashes, hist };
}

// Stars: gold star run counting in the band under the "Potential Lvl" banner.
// Positions vary too much for fixed centers; counting runs of gold columns
// (>=10px wide at base scale) is robust and needs no empty-slot positions.
// The bottom screenshot row can be covered by the "Filters/Held" overlay bar:
// detected via the band's bright-pixel ratio and reported as obscured.

const STAR_BAND = Object.freeze({ x0: 8, x1: 175, y0: 180, y1: 202 });

export function readUmaStars(cellImg) {
  const sx = cellImg.width / UMA_GRID.cellWidth;
  const sy = cellImg.height / UMA_GRID.cellHeight;
  const x0 = Math.round(STAR_BAND.x0 * sx);
  const x1 = Math.min(Math.round(STAR_BAND.x1 * sx), cellImg.width);
  const y0 = Math.round(STAR_BAND.y0 * sy);
  const y1 = Math.min(Math.round(STAR_BAND.y1 * sy), cellImg.height);
  const minGoldPerColumn = Math.max(2, Math.round(4 * sy));
  const minRunWidth = Math.max(4, Math.round(10 * sx));

  let bright = 0;
  let total = 0;
  const goldColumns = [];
  for (let x = x0; x < x1; x += 1) {
    let gold = 0;
    for (let y = y0; y < y1; y += 1) {
      const i = (y * cellImg.width + x) * 4;
      const r = cellImg.data[i];
      const g = cellImg.data[i + 1];
      const b = cellImg.data[i + 2];
      if (luminance(r, g, b) > 170) {
        bright += 1;
      }
      total += 1;
      if (r > 220 && g > 150 && b < 130) {
        gold += 1;
      }
    }
    goldColumns.push(gold >= minGoldPerColumn);
  }

  const obscured = total > 0 && bright / total < 0.5;
  let stars = 0;
  let width = 0;
  for (const on of [...goldColumns, false]) {
    if (on) {
      width += 1;
    } else {
      if (width >= minRunWidth) {
        stars += 1;
      }
      width = 0;
    }
  }
  return { stars: obscured ? null : stars, obscured, confident: !obscured };
}

// "Potential Lvl X" (X = awakening tier 1-5): the digit sits in a fixed box
// (the label prefix is constant-width). The text tint encodes the tier family
// (orange for 3-5, blue/silver for 1-2) and is used to halve the candidate
// set; the digit itself is matched by NCC on the grayscale box against
// templates captured from a real device screenshot. Binarized masks do NOT
// work here: the banner is translucent and the art bleeds through it.

const UMA_TIER_BAND = Object.freeze({ x0: 14, y0: 148, x1: 166, y1: 170 });
const UMA_DIGIT_BOX = Object.freeze({ x0: 138, y0: 148, x1: 166, y1: 170 });
const UMA_DIGIT_W = UMA_DIGIT_BOX.x1 - UMA_DIGIT_BOX.x0;
const UMA_DIGIT_H = UMA_DIGIT_BOX.y1 - UMA_DIGIT_BOX.y0;
export const UMA_POTENTIAL_MIN_NCC = 0.6;
export const UMA_POTENTIAL_MIN_MARGIN = 0.15;

// 28x22 luminance templates, 3 digits per pixel, row-major (see
// docs/ROSTER_IMPORT_PLAN.md phase E for provenance).
const UMA_DIGIT_TEMPLATES_RAW = Object.freeze({
  1: "255250250250255254236234232230227252255255255255255255255255245233234220186153204238252203203208255255246233230228228252255253252252252252254255246234234220186153204238249168168177255255254230228226244253254220192192192192239255252241226220186151205238249165165174255255253229229228250255255205167167167167231255255244232220184147208238249162162171255255253229229228249254255206169166164164231255255244232218184147208238249159159168255255253229229228237253255234217187161161230255255244227214184147208238249155155165255255253228228229228252255255255202157157229255255241221214177142207240249152152162255255253228229229230245254255255201154154228255255240221214177142207240249149149159255255253229229229232234251255255199151151227255255239221214177142207240248146146157255255253229231232234234251255255197148148227255255238220212178141206240248143143154255255252230234234234234251255255195145145225255255239220212178140206240248140140151255255252212206207220232251255255194141141225255255239220211178140206244247137137148255255251214226226218204246255255192138138224255255239221211178140206244247134134145255255250182186201218239250255255190135135223255255239223211177140206244247131131142255255250182181180180193247255255189132132222255255239226214177140206244247128128140255255250182181180179178240255255187128128222255255240232215177140206244247125125137255255251178177176180179240255255185125125220255255243221202159168215245246122122134255255253192177176179178240255255183122122218255255243220194150180236246251197196202255255252232205181176175203250255223197197239255249235218168154211246246255253253254255255252251248227198178177247255255253253253255247224183148189236245245226250255255254254252253253253246194177226232242255255239244228187146157227245245245142189252252248248247246246246241222180178170185216230200187169144163203238245245245",
  2: "248255253250250253255251236233231232248255255255255255255255255255251237230215169167253255243203204233255253243232230235255255255251240235237246254255255252233215169167255255235168168217255255248230230245255251221193186182183190219255255255248214169167255255234165165216255255248229234255255246183167167167167167168197254255255214167168255255235162162215255255247228234255254244180168178184179166164164228255255234167168255255234159159213255255247228233249253246195218245254244196161161199254255249171168255255233155156212255255247228230237255252244255255255255244160157188252255250171163216247233152153210255255247228229236253244252255255255255251158154187252255249170163180248232149150209255255247229230234238237250249255255254215151151198254255246163163198254231146147207255255247229232233235236242253255255236158148148227255255230160162230255231143144206255255248233235234235238252255255250179145145187251255254212160161254255230140140205255255249236235234236248255255255189142141166251255255244206160161255255230137137204255255249235235234244255255252202138138153230255255252225206160161255255229134134202255255249235235240254255255220146135153225255255255248241213160161255255228131131201255255250235236250255255236149132139219255255255255255254219160161255255228128128199255255250235240255255250166128128167209207205203210252255234169161255255226125125198255255249235245255255216130125125125125125125125149248255250178184255255225122122197255255249234251255254154122122122122122122122122147248255250173205250255240197196229255253239231239246252199196197197196196197197195206252252210175229217255249253252255255250228227230250255253253253253253253253253253254255253175210241171185207255254245248243228229232247247252255255255255255255255255252232221188245245143140143198207212222222219219219221221242242244244244244243239230209156182218245245",
  3: "198255248241242249255243141107128230254255255255255255255255255255252243236217183177255255237190190226255255227149132206255255254235224219225243255255255249231217183177255255237188188226255255230194208252255245199189189189189189212249255255222206180177255255239184184224255255207153226255255240191187188190186187187210254255248191166177255255239182182223255255204095209248250239197222236238224186183184243255254227181177255255239179180222255255206093167223255252252255255255255219181181233255255213173175247253238176176221255255207090118207245234255255255255254216178178234255255197136172211248237174174219255255208089082170197210255253241237225182175180246255255239172172201253236171171218255255208089074120187241247247201184178172176223255255255255183172221255236168168217255255208092084108180251255250190169169169178233255255255252190171246255235166166216255255209094084098160232241242206193186172167167232255255254190171255255235163163214255255209094090112142214255255255255249217167164197253255255195171255255234160160214255255209094102192195231255254255255255251178161182251255255198171255255234157158213255255210096105222251251255255255255255252173158181251255255196171255255233155155211255255210103177225254211225243249251243208156155190253255254189171255255232152152210255255210101216246243189158178192196180152152152218255255244177176255255230149149209255255207088215255255191150150150150150150150194250255255216168191255255229147147208255255204070141253255229164147147147147149206253255255247177159217233255249241240249255224092059070224255255252229214212224250255255255236173148182231203249251255254255255217062063068188250255255255255255255255255255214124126154209238140140149255254181127112065063061107137209253255255255255255233141112136163208235240143154143153141116106104097090087115132154201231237238234224196148150179211243244240",
  4: "254236236238255254224235240238238237237238244255255255255255255255250230200162208232251189189196255255253217234238237237237238252255255241232232250255252235200162208233250187187193255255255217232234237237237246255255251201188188239255255241188162208234250184184191255255255230210231237237240255255255221186186186239255255241187162208234250181181189255255255245222219232239250255255244184184183183238255255241187162208234250179179186255255255249238215210218254255253211179196181180238255255241189158207235250176176184255255255251250246230248255255241185178216179177237255255239190156206236250173173181255255255249250251251255255254198174184235175174236255255239190156206236250170170178255255255249249249254255255229171172229237173171235255255239190156207236250167167176255255255250249252255255250190168190255233169169235255255241191154207236249165165174255255255250249255255255225170169224255229167166235255255251197154207236249162162171255255255250250255255249176163181250255228163163234255255255199154207236249159159169255255254246252255255205160160181196195184161160185210252253233162207236249157157166255255253226255255255186157157157157157157157157157184251255251166207236249154154164255255250187247254255197173173173173173168154155168196251252238164207236249151151161255255252197183252255243239239239239239213152152219244254255194166210238249148148159255255252214238250248253255255255255255223150149231255255254178170227239250169169177255254241216220243220232248251254255255229170170236255254240171201239239255246246245255250173215216218231209192191197245255252246246249255246180172227239239250255255253255249147170185204224229204171167217255255255255250255223165199239240240142217255250170163147153154184223225232209171162158216254255207181168195234240241241150153197195167161155135133145187187200204182151152165184176167163221232247241241242",
  5: "222255248236236246255239166140138135248255255255255255255255255255255255246225183177255255238189189226255255222140141170255255242232232232232232232232249255248229183177255255238187187225255255222139137243255255213188188188188188188188242255255232172177255255240184184224255255222140141253255254205186186186186186186186241255255231172177255255239181181223255255222141151255255252199183203226226226226226249255247226172177255255238179179222255255222142162255255248194180222255255255255255255255240220173174239251238176176221255255221143172255255245188177205220224236252255255254238219174172203249237173173219255255221139182255255242182174177177179184210254255255248220174172203255236170170218255255220135191255255238176172172171171171171193254255255224174172226255236167167217255255220135189238255237189203212208191173169169228255255241174171249255235165165216255255220133144198255250246255255255249212168166198253255251180171255255235162162214255255221132132207253244254255255255255249178163186251255252188171255255234159159213255255221136138219202222255255255255255252180160181251255252192171255255234157157212255255222137143226255253255255255255254235164157187252255252187171255255233154154211255255221141187235255223216238246241219174155155205255255245171171255255232151151210255255229133219248246198158168172169160152152158240255255197163179255255232148149209255255250182219255255199149149149149149149158233255255246137155195255255236169170218255255253250237251252215169160157157163179237255255253181142163221254255253246246251255254251252254252255254245229221223234252255255254207142151186233255239255255255255255254252252250253255255255255255255255255255252187146152174225239152140157251255254253253252252251252255254255255255255254249194152146151171226240240143166142181223219219219218215214214214214217218189179165141140152159172222241240240",
});

const UMA_DIGIT_TEMPLATES = Object.entries(UMA_DIGIT_TEMPLATES_RAW).map(([value, raw]) => {
  const pixels = new Float64Array(raw.length / 3);
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = Number(raw.slice(i * 3, i * 3 + 3));
  }
  return { value: Number(value), pixels };
});

export function nccVector(a, b) {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const denom = Math.sqrt(da) * Math.sqrt(db);
  return denom ? num / denom : 0;
}

function grayVector(img) {
  const out = new Float64Array(img.width * img.height);
  for (let i = 0; i < out.length; i += 1) {
    const o = i * 4;
    out[i] = luminance(img.data[o], img.data[o + 1], img.data[o + 2]);
  }
  return out;
}

function digitBoxVector(cellImg, dx, dy) {
  const sx = cellImg.width / UMA_GRID.cellWidth;
  const sy = cellImg.height / UMA_GRID.cellHeight;
  const x0 = Math.max(0, Math.round(UMA_DIGIT_BOX.x0 * sx) + dx);
  const y0 = Math.max(0, Math.round(UMA_DIGIT_BOX.y0 * sy) + dy);
  const w = Math.round((UMA_DIGIT_BOX.x1 - UMA_DIGIT_BOX.x0) * sx);
  const h = Math.round((UMA_DIGIT_BOX.y1 - UMA_DIGIT_BOX.y0) * sy);
  let box = cropImage(cellImg, x0, y0, Math.min(w, cellImg.width - x0), Math.min(h, cellImg.height - y0));
  if (box.width !== UMA_DIGIT_W || box.height !== UMA_DIGIT_H) {
    box = resizeImage(box, UMA_DIGIT_W, UMA_DIGIT_H);
  }
  return grayVector(box);
}

function tierIsOrange(cellImg) {
  const sx = cellImg.width / UMA_GRID.cellWidth;
  const sy = cellImg.height / UMA_GRID.cellHeight;
  const x0 = Math.round(UMA_TIER_BAND.x0 * sx);
  const x1 = Math.min(Math.round(UMA_TIER_BAND.x1 * sx), cellImg.width);
  const y0 = Math.round(UMA_TIER_BAND.y0 * sy);
  const y1 = Math.min(Math.round(UMA_TIER_BAND.y1 * sy), cellImg.height);
  let orange = 0;
  let total = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * cellImg.width + x) * 4;
      const r = cellImg.data[i];
      const g = cellImg.data[i + 1];
      const b = cellImg.data[i + 2];
      if (r > 200 && r - b > 80 && g > 100) {
        orange += 1;
      }
      total += 1;
    }
  }
  return total > 0 && orange / total > 0.09;
}

export function readUmaPotential(cellImg) {
  const family = tierIsOrange(cellImg) ? [3, 4, 5] : [1, 2];
  const sx = cellImg.width / UMA_GRID.cellWidth;
  const jitter = Math.max(1, Math.round(2 * sx));
  let best = { value: null, score: -2 };
  let second = -2;
  for (let dy = -jitter; dy <= jitter; dy += 1) {
    for (let dx = -jitter; dx <= jitter; dx += 1) {
      const vec = digitBoxVector(cellImg, dx, dy);
      for (const template of UMA_DIGIT_TEMPLATES) {
        if (!family.includes(template.value)) {
          continue;
        }
        const score = nccVector(vec, template.pixels);
        if (score > best.score) {
          if (best.value !== template.value) {
            second = best.score;
          }
          best = { value: template.value, score };
        } else if (template.value !== best.value && score > second) {
          second = score;
        }
      }
    }
  }
  const margin = best.score - second;
  return {
    potential: best.value,
    score: best.score,
    margin,
    confident: best.score >= UMA_POTENTIAL_MIN_NCC && margin >= UMA_POTENTIAL_MIN_MARGIN,
  };
}
