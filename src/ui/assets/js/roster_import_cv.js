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

export function gridCells(width, height) {
  const scale = width / SUPPORT_GRID.baseWidth;
  const cells = [];
  for (let row = 0; row < SUPPORT_GRID.maxRows; row += 1) {
    const y = Math.round((SUPPORT_GRID.originY + row * SUPPORT_GRID.pitchY) * scale);
    const cellH = Math.round(SUPPORT_GRID.cellHeight * scale);
    if (y + cellH > height) {
      break;
    }
    for (let col = 0; col < SUPPORT_GRID.columns; col += 1) {
      const x = Math.round((SUPPORT_GRID.originX + col * SUPPORT_GRID.pitchX) * scale);
      cells.push({ row, col, x, y, width: Math.round(SUPPORT_GRID.cellWidth * scale), height: cellH });
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
