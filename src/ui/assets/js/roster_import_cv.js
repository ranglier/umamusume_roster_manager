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

// Above this line (base scale) sits the fixed UI header; cards never render there.
const GRID_TOP_SAFE = 235;

// offsetY (image pixels) shifts every row: screenshots of a scrolled list do
// not land on the calibrated origin. Use detectGridOffsetY to measure it.
export function gridCells(width, height, grid = SUPPORT_GRID, offsetY = 0) {
  const scale = width / grid.baseWidth;
  const topSafe = Math.round(GRID_TOP_SAFE * scale);
  const cells = [];
  let row = 0;
  for (let k = 0; k < grid.maxRows + 2 && row < grid.maxRows; k += 1) {
    const y = Math.round((grid.originY + k * grid.pitchY) * scale + offsetY);
    const cellH = Math.round(grid.cellHeight * scale);
    if (y < topSafe) {
      continue;
    }
    if (y + cellH > height) {
      break;
    }
    for (let col = 0; col < grid.columns; col += 1) {
      const x = Math.round((grid.originX + col * grid.pitchX) * scale);
      cells.push({ row, col, x, y, width: Math.round(grid.cellWidth * scale), height: cellH });
    }
    row += 1;
  }
  return cells;
}

// Finds the vertical scroll offset of a screenshot by minimizing the identity
// distance of first-row cells against the reference fingerprints — correct by
// construction (aligned cells match at small dHash distance, misaligned ones
// do not). Returns an image-pixel offset; falls back to 0 when nothing
// matches (e.g. a screenshot that is not the expected list at all).
export function detectGridOffsetY(img, grid, refEntries, makeCellFp) {
  const scale = img.width / grid.baseWidth;
  const pitch = grid.pitchY * scale;
  const cellW = Math.round(grid.cellWidth * scale);
  const cellH = Math.round(grid.cellHeight * scale);
  const topSafe = Math.round(GRID_TOP_SAFE * scale);

  const score = (offset) => {
    let y = grid.originY * scale + offset;
    while (y < topSafe) {
      y += pitch;
    }
    y = Math.round(y);
    if (y + cellH > img.height) {
      return Infinity;
    }
    let sum = 0;
    let cells = 0;
    for (const col of [0, 2, 4]) {
      if (col >= grid.columns) {
        continue;
      }
      const x = Math.round((grid.originX + col * grid.pitchX) * scale);
      const hash = makeCellFp(cropImage(img, x, y, cellW, cellH)).hashes[0];
      let best = Infinity;
      for (const [, fp] of refEntries) {
        const d = hamming64(hash, fp.hash);
        if (d < best) {
          best = d;
        }
      }
      sum += best;
      cells += 1;
    }
    return cells ? sum / cells : Infinity;
  };

  const half = Math.floor(pitch / 2);
  let best = { offset: 0, distance: Infinity };
  for (let offset = -half; offset <= half; offset += 4) {
    const d = score(offset);
    if (d < best.distance) {
      best = { offset, distance: d };
    }
  }
  for (let offset = best.offset - 3; offset <= best.offset + 3; offset += 1) {
    const d = score(offset);
    if (d < best.distance) {
      best = { offset, distance: d };
    }
  }
  const confident = best.distance <= 16;
  return { offsetY: confident ? best.offset : 0, distance: best.distance, confident };
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

const UMA_TIER_BAND = Object.freeze({ x0: 14, y0: 146, x1: 166, y1: 174 });
const UMA_DIGIT_BOX = Object.freeze({ x0: 136, y0: 146, x1: 170, y1: 172 });
const UMA_DIGIT_W = UMA_DIGIT_BOX.x1 - UMA_DIGIT_BOX.x0;
const UMA_DIGIT_H = UMA_DIGIT_BOX.y1 - UMA_DIGIT_BOX.y0;
export const UMA_POTENTIAL_MIN_SCORE = 0.75;
export const UMA_POTENTIAL_MIN_MARGIN = 0.08;

// Template-masked NCC: the "Potential Lvl" banner is translucent and the art
// bleeds through it, so whole-box comparisons are dominated by the variable
// background (measured: the same digit swings +/-0.3 of NCC depending on the
// art behind it). Each template therefore carries a mask of its TEXT pixels
// only (opaque white contour + family-tinted fill) and the comparison runs on
// those pixels alone. Measured on two full real captures: 66/68 top-1, zero
// confident errors, every miss gated for review.
// f = tint family ("o" = orange, tiers 3-5; "b" = blue/silver, tiers 1-2);
// v = luminance, 3 digits per pixel, 34x26 row-major; m = text mask (0/1).
const UMA_DIGIT_TEMPLATES_RAW = Object.freeze({
  1: { f: "b", v: "233232241248249255255252249247237236235233229229228246247247247247230229228231229213171170232239239239233234246255254255255255255251235234232229230248249254255255255255250250236233230215169167233238240240234239250255247221221239255252240232230228230254255254253253253253254255238233230215169167233238240240235245255255235169169218255255249230227226241253254218214214214215250255247236230215169167233238240240238246255255235165165216255255247229228228253255255177168168168171244255255237229211167168233238240240243251255255235162162215255255247229228228253255255174164164164168244255255237229211167168233238241240253255255255234159159213255255247229228228244254255203198164161165244255255236224210167168233239242241255255255255234156156212255255247228227228231254255255255165158161243255255233221207162164231240243243238226227249233153153210255255248228228229232249255255255162155158243255255231221206160163231241243243193170181246232150150209255255248229229230232234254255255159152155242255255229221206160163234241243243167162191255231147147208255255248229231232234235254255255156149152242255255229221206160162234241243243158158223255231144144207255255248232235234235234254255255153146149241255255229221206160161234241243243153162250255230141141205255255249235235234235234254255255150142146241255255229221206160161234245243243149187255255230138138204255255249236235234235234254255255147139143241255255229221206160161234245243243145218255255229135135203255255249235235236236234254255255144135140241255255229220205160161234246244244151236255255228132132201255255250235235235234231254255255141132137240255255230222206160161234246244244163249255255228129129200255255250235235234231229254255255138129133240255255231226206160161234246245245192255255255226125126198255255249235234231227226254255255135126130239255255234222184157179237244245245231255255255225122123197255255249233231228226226254255255132123127239255255235220179149198241243245245254255255255234166167216255254244231228227226226244255255172166170244255249232202155161226243243245245255255251255252248248252255251232229228227226226229254255246248247254255240216175146199239244244245245254253247232253255255254253248228229229228227228227252253254255255253253220183149165238244245245245245240237150140151248252243229228225224225224224223224229230250252249222199162139162208245245245245245245199161142178142163198195190189188187186185185184184184185190185184169148144187234245245245245245245245171144162232158143165165164162161159158157156154154153152150147154174194212234247246246247247247247246183143214232199141184228228227227226226226225225225224224223221231230242247247247246246247247247247246", m: "00111111110000000111110000011101110011111111000001111111110011110111011110011110000111111111001111011101110110111000111000001110111101110111011011100011111111111111110111111101101110001111111111111111011111110111111000111111111110111101111111011111100001111111111011110111000101111110000111111111101111011111110111111000001111111110111101111111011111100000111111111011110111110101111110000011111111101111011111110111111000001111111110111101111111011111100000111111111011110111111101111110000011111111101111011110110111111000001111111110111101111111011111100000111111111011110111111111111110000011111111101110111101110111111000001111111110110011111111011111100000111111111011101111111111111100011101111111101101111111101111110111111111111101110111111100011100111111100111111110111111000000001111111111001111100111111100000001111111111111110000111111110000000000000000000000011111111111" },
  2: { f: "b", v: "244247253253255255248241236168164128081100173199246252253252251226138080065056055095157220239239240239244248255255250250250255249172169161127186253255255255255255255255255239116060057092157220240240240240246252255250204204220255252216169168178240255255253243236236244254255255241116067101157220240241240240246255255247168168196255255247169172210252250225194185182183187210249255255218068103156219240241240240246255255247165165194255255248167175242255255197168167167167167168190254255255096108152218240241240240252255255246162162191255255248167176241251246191167178184180167164164215255255198109152218240242241241255255255246159159190255255248166174227244254205211241254247206161161178252255252138152218240242242241255255255246155155188255255248167168187246255244254255255255249162157170244255255148152218240243243243212212241246152152185255255248167165177240220232255255255255255160154168245255255117152220240243243243166167243245149149183255255248167165173186168223233251255255226151151174252255249151152220240243243243161183255245146146182255255247168168166159152184236255255245173148148213255255244185151220240243243243157220255245143143179255255247166155142149171228255255255194147145176249255255242184150220240243243243160248255245140140177255255245148169206223248255255255204143141153234255255252239184150220246243243243178252255244137137175255255249225239239246255255255218145138148216255255254242238183151220246243243243198255255244134134173255255254245243244254255255234154135145210255255255253248241181155221246244243243223255255244131131171255255254241241249255255243160132133204251255255255255255245181155221246245244243250255255243128128168255255254241242254255255191129128157208208206204205243255249194155221246245244244255255255243125125167255255253241246254255241135125125125125125125125136229255255200175226246245245245255255255243122122164255255253241252255255166122122122122122122122122132228255255184192240246245245245255254255249196197215255254247241246249254201196197197196197197196195199237248213171220246246245245245255252255255253253254255254241241241251255253253253253253253253253253254254255189198239245245245245245251234209230253255253251250242242242250251251255255255255255255255255253233224208237245245245245245245235144140143217248245237236235235234235225232226222221225230230230223216168184230238245245245246246246162141197142146188187183182181180179178172152145146150159148154167160165189230242242245245245246246246146161232191141166178177175174173171170169168168167166165160170184207224236247246246246246246246246246142200231223148163243244244243243243243243243242242242242241243240245248248247247247247246246246246246", m: "11111111000000001111101000001011111111111110000011111111110000101111111100011000011111001111110010111111111111110001101111101110001011111111111111001111111111111100101111111111111100111111111110110010111111111111110001111111111111111011111111111111000111111111111111101111001111111100010011111111111010111111111111110000000111011111101011111111111111000000011111111110101111101111111100000011111111111010111111111111110000111111110111001011111111111111000111111111111100001111111111111111111101111111111000111101111111110011111111111111100011111111111111001111111111111110001111111111111101111111111111011000111111111111110111111111111101100111111111111111011111111111111101011111111111111100111111111111110011111110001111110111111111111100011111110000011000000000000000000001111111000000000000000000000000001111111100000011111111111111110011111111110000001111111111111111111111111111" },
  3: { f: "o", v: "093160255253255255254255255174131094178244255255255255255255255253248244242236223190169218232233233233113167255252242241244255251150108123216253255255255255255255255255255253245237223190169218232233233233147255255248190190210255255247150137181253255254238226219223239255255255251234221190169218232233233233152255255248188188208255255247191201246255255205189189189189189204242255255231205187169218234234234234168255255248184184208255255240137211252255254194187188190186187186203253255251201168169218235234234234244255255248182182206255255239090178248247253197217234239230193183185237255255230188169218235235235235255255255248179179203255255240090149213252255250255255255255228181181221255255223177168217234235235235247247253248176176202255255240091111182246229255255255255255225178178225255255219131164214234236235235205205243248174174200255255240089083152200194254255244237228190175178243255255245179164216236237236235185190251247171171198255255240092078107174228246250214184180173173212254255255255193163217237237236236181211255247168168196255255240093086094169234255255206169169169174220255255255253201163219236236236236179239255247166166195255255240095087087149219237242217193188174167168220255255254201163219236236236236185251255247163163192255255241095089103136203245255255255251224169164178249255255209163219236237237237201254255247160160191255255241095091175196220255254255255255254186161169238255255214163218237238238238218255255246157157189255255241096093196252249255255255255255255181158167239255255213163217237238238238239255255246155155187255255241097165211254214217241248251246217155155170246255255203163217237239239239253255255246152152185255255241096192248241202155175189197184158152152201255255249182168218238239239239255255255245149149182255255240082187255255205150150150150150150149182248255255227168181228239240240240255255255244147147180255255239072110246255240173147147147147147191248255255251186150205238239240240240255233255251241241243255243100062054196255255253232218211222245255255255244188148170226239239240240240254199249253255255251255240062064061163245255255255255255255255255255227134122150200238240240240240240149137140143246255212128120067064061100135195251255255255255255243162110131159198233240240240240240240124143154143151147124107105100091088109133148193229236238235226210149148176203239245240240240240240240149145222150141160160163161160158157156152151152151149149145144160170182224241242242242242242240240240143177232219142172206201201200199198197202201200198197197202201201230239244242242243242242242240242243142219228232158142237242242242242242242242242242242242242242242242243243243242242242242242242242242240", m: "00111111100001111111111000001000000011000110000111111111111000100000011111011100011100000111100010000001111101110011101111100110001000000111110111001111111111011100100000111111011100111100001110110010000011111101110001111111011011001000001111111111000101111101101100100000000111111100000110001110111010000011111111110000011011110111101000001011111111000001101111011110100000101111111100000110111110111010000011111111110000011111011111101000001111111111000001111111110110100000011111111100011111111111011010000001111111110001000111011111101000001111111111001101110111101110100000111111111100110111111111110110000011111111110011011111101111000000001011001110000111000011111001000000101111111000011111111110001000000000001100000000011111110000000000000000000000000000000000001000000000000001111111111111100111000000000000000000000000001110000000000000000000000000000000000000000000000000" },
  4: { f: "o", v: "250255255255255255255253233242241241238238238237238248249254255255251250249230200162208232233233233232248255254237237238255254224235240238238237237238244255255255254254255255250230200162208232233233233232255255251189189196255255253217234238237237237238252255255241233233250255252235200162208233234233233232255255250187187193255255255217232234237237237246255255251202188188239255255241188162208234234234234233255255250184184191255255255230210231237237240255255255222186186186239255255241187162208234234234234233255255250181181189255255255245222219232239250255255245184184183183238255255241187162208234235235235233255255250179179186255255255249238215210218254255253211180196181180238255255241189158207235235236236235238247250176176184255255255251250246230248255255242185178216179177237255255239190156206236235236237237195238250173173181255255255249250251251255255254198174184235175174236255255239190156206236236236237237189254250170170178255255255249249249254255255228171172229237173171235255255239190156207236236236237237206255250167167176255255255250249252255255250190168190255233169169235255255241191154207236237237237237226255249165165174255255255250249255255255225170169224255229167166235255255251197154207236237237237237239255249162162171255255255250250255255249176163181250255228163163234255255255199154207236237237237237251255249159159169255255254246252255255205160160181196195184161160185210252253233162207236238238238238255255249157157166255255253226255255255186157157157157157157157157157184251255251166207236238238238238255255249154154164255255250187247254255197173173173173173168154155168196251252238164207236239239239238255255249151151161255255252197183252255243239239239239239213152152219244254255194166210238240240240239255255249148148159255255252214238250248253255255255255255223150149231255255254178170227239240240240240255255250169169177255254241216220243220232248251254255255229170170236255254240171201239239240240240240247255255246246245255250173215216218231209192191197245255252246246249255246180172227239239240240240240237241250255255253255249147170185204224229204171167217255255255255250255223165199239240240240240240242164140142217255250170163147153154184223225232209171162158216254255207181168195234240241241240240241242143163150153197195167161155135133145187187200204182151152165184176167163221232247241241242240241242242142223181141161168167165165165163162159158157156155155158159161182190223242242242242242242242242242234163231223147154217217216216216216215214213213212212212210213219234238244242242243242242242242242242233220228231189141219242242242242242242242242242242242242242242242243243243242243243242242242242242241211", m: "11111111000000000111111110010000001110001100000000011111111001000000111111111000000011100011100100000011111111100000011110110111010000001111111110000001110111011101000000111111111100001110111101110100000011111111111000111011110110010000000111111111110111011011011001000000101111111111111111101101100100000011111111111111101100110110010000000111111111111111111011011001000000011111111111110110101101110100000001111111111111111110110111010000001111111111111011101111101101000000111111111011111111111111111100000011111111101110111111111011110000001111111110011100000011011101000000111111111001111111101101111100000011111111100100111110110110100000001111111100000000011111111010000000011111110000000000111111010000000000001100000000000000110010000000000000000000000000000001110000000000000001111111111111111110000000000000000000000000000000000000000000000000000000000000000000000000000000" },
  5: { f: "o", v: "156151208255252255255255255231140138133156237249253255255255255255255255251250243225183177228232232232157168222255248237236247255239165140138134248255255254254254254254254254255255246225183177228232233233156202255255238189189226255255222140141170255255242233233233233233232233250255248229183177228232233233154201255255238187187225255255222139137243255255213188188188188188188188242255255232172177228235234234178224255255240184184224255255222140141253255254205186186186186186186186241255255231172177228235234234240255255255239181181223255255222141151255255252199183202226226226226226249255247226172177228235235235254255255255238179179222255255222142161255255248194180221255255255255255255255240220173174225234235236245238239251238176176221255255221143172255255245189177206220225236252255255254238219174172223234236236213195203249237173173219255255221139182255255242182174177177179184210254255255248220174172229237236236188184203255236170170218255255220135191255255238176172171171171171171194255255255224174172229236236236180180226255236167167217255255220135189238255237188202213207191173169169228255255241174171231235236236176181249255235165165216255255220133144198255250246255255255249212168166198253255251180171231236237237172199255255235162162214255255221132132207253244254255255255255249178163186251255252188171231236237237168223255255234159159213255255221136138219202222255255255255255252180160181251255252192171229237238238173239255255234157157212255255222137143226255253255255255255254236164157187252255252187171229237238238180250255255233154154211255255221141187235255223216238246241219174155155205255255245171171229237238239201255255255232151151210255255229133219248246198158168172169160152152158240255255197163179228239239240233255255255232148149209255255250182219255255199149149149149149149157233255255246137155195236239240240254255255255236169170218255255253250237251252215169160157157163179237255255253181142163221239239240240255255254255253246246251255254251252254252255254245229221223234252255255254207142151186233240240240240255255255239255255255255255254252252250253255255255255255255255255255252187146152174225239240240240240220223152140157251255254253253252252251252255254255255255255254249194152146151171226240240240240240240150150143166142181223219219219218215214214214214217218189179165141140152159172222241240240240240240240176143156231151143167168166165164162161160159158157156155156158160176182199232242242241241241241240240185143208232198141186217217216216215214214214213213212212211209218222234243243242242242242241241241241142149227228228150143234242242242242242242242242242242242242242242243243243243242242242242242242242242", m: "00011111100000011111111111001100000001100111000011111111111110110000001101101100001100000000111011000000110110110001110111111101101100000011011011000111011111110110110000111101101100011111000000111011000011110110110001111101111111001100000001011011000111110000111100110000010101101100011011111101111011000011010110110001101111111111101100001101011011000110100011110111110000111101101100001111111011111111000011110110110000111111111111110100001011011011000000111111111111010000101101101100001111111011111101000011110110110000100010011101111100000111011011000110111111110110110000011101101110011011111110111010000011110110111111101111110111001000001111111111111111100001111000100000111111111111111111111111000100000000000111111111111111110001100000000000000000000000000000011100000000100000111111111111111111000000000000000000000000000000000000000000000000000000000000000000000000000000" }
});

const UMA_DIGIT_TEMPLATES = Object.entries(UMA_DIGIT_TEMPLATES_RAW).map(([value, raw]) => {
  const values = new Float64Array(raw.v.length / 3);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = Number(raw.v.slice(i * 3, i * 3 + 3));
  }
  const maskIdx = [];
  for (let i = 0; i < raw.m.length; i += 1) {
    if (raw.m[i] === "1") {
      maskIdx.push(i);
    }
  }
  return { value: Number(value), family: raw.f, values, maskIdx };
});

function tierIsOrange(cellImg) {
  const sx = cellImg.width / UMA_GRID.cellWidth;
  const sy = cellImg.height / UMA_GRID.cellHeight;
  const x0 = Math.round(UMA_TIER_BAND.x0 * sx);
  const x1 = Math.min(Math.round(UMA_TIER_BAND.x1 * sx), cellImg.width);
  const y0 = Math.round(UMA_TIER_BAND.y0 * sy);
  const y1 = Math.min(Math.round(UMA_TIER_BAND.y1 * sy), cellImg.height);
  let orange = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * cellImg.width + x) * 4;
      const r = cellImg.data[i];
      const g = cellImg.data[i + 1];
      const b = cellImg.data[i + 2];
      if (r > 190 && g > 60 && g < 190 && b < 90) {
        orange += 1;
      }
    }
  }
  return orange > 100 * sx * sy;
}

function digitWindowLum(cellImg, dx, dy) {
  const sx = cellImg.width / UMA_GRID.cellWidth;
  const sy = cellImg.height / UMA_GRID.cellHeight;
  const x0 = Math.max(0, Math.round(UMA_DIGIT_BOX.x0 * sx) + dx);
  const y0 = Math.max(0, Math.round(UMA_DIGIT_BOX.y0 * sy) + dy);
  const w = Math.round(UMA_DIGIT_W * sx);
  const h = Math.round(UMA_DIGIT_H * sy);
  let box = cropImage(cellImg, x0, y0, Math.min(w, cellImg.width - x0), Math.min(h, cellImg.height - y0));
  if (box.width !== UMA_DIGIT_W || box.height !== UMA_DIGIT_H) {
    box = resizeImage(box, UMA_DIGIT_W, UMA_DIGIT_H);
  }
  const out = new Float64Array(UMA_DIGIT_W * UMA_DIGIT_H);
  for (let i = 0; i < out.length; i += 1) {
    const o = i * 4;
    out[i] = luminance(box.data[o], box.data[o + 1], box.data[o + 2]);
  }
  return out;
}

function maskedNcc(template, candidate) {
  const idx = template.maskIdx;
  const n = idx.length;
  if (n < 40) {
    return -1;
  }
  let ma = 0;
  let mb = 0;
  for (let k = 0; k < n; k += 1) {
    ma += template.values[idx[k]];
    mb += candidate[idx[k]];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let k = 0; k < n; k += 1) {
    const x = template.values[idx[k]] - ma;
    const y = candidate[idx[k]] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const denom = Math.sqrt(da) * Math.sqrt(db);
  return denom ? num / denom : 0;
}

export function readUmaPotential(cellImg) {
  const family = tierIsOrange(cellImg) ? "o" : "b";
  const candidates = UMA_DIGIT_TEMPLATES.filter((t) => t.family === family);
  const sx = cellImg.width / UMA_GRID.cellWidth;
  const jy = Math.max(3, Math.round(7 * sx));
  const jx = Math.max(2, Math.round(5 * sx));
  let best = { value: null, score: -2 };
  let second = -2;
  for (let dy = -jy; dy <= jy; dy += 1) {
    for (let dx = -jx; dx <= jx; dx += 1) {
      const vec = digitWindowLum(cellImg, dx, dy);
      for (const template of candidates) {
        const score = maskedNcc(template, vec);
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
    confident: best.score >= UMA_POTENTIAL_MIN_SCORE && margin >= UMA_POTENTIAL_MIN_MARGIN,
  };
}

