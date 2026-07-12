// Screenshot-based roster import: browser orchestration + reconciliation UI.
// Two modes share the same pipeline and table: "supports" (level + limit
// break, matched against the local full illustrations) and "characters"
// (stars + Potential Lvl/awakening, matched against the in-game per-variant
// icons fetched by scripts/fetch_chara_icons.py). The pure CV engine lives in
// roster_import_cv.js; this module owns file decoding (canvas), the reference
// fingerprint caches (localStorage, keyed by the reference generated_at), the
// reconciliation table rendered in place of the roster list, and applying the
// reviewed rows through the existing PUT roster flow.
// See docs/ROSTER_IMPORT_PLAN.md.
import { getEntityItems, getLoadedReferenceGeneratedAt, getSupportLevelCap, listEl, state } from "./core.js";
import { clampNumber, escapeHtml, resolveMediaAssetSrc } from "./dom-utils.js";
import {
  SUPPORT_GRID,
  UMA_GRID,
  assessMatch,
  cellFingerprint,
  deserializeFingerprint,
  detectGridOffsetY,
  cropImage,
  gridCells,
  hamming64,
  histIntersect,
  rankCandidates,
  readLevel,
  readLimitBreak,
  readUmaPotential,
  readUmaStars,
  referenceFingerprint,
  serializeFingerprint,
  umaCellFingerprint,
  umaReferenceFingerprint,
} from "./roster_import_cv.js";
import { getRosterEntry, setRosterEntry } from "./roster.js";
import { persistRosterDocument, requestRenderPreservingScroll } from "../app.js";

const FETCH_CONCURRENCY = 8;
// Level digits read below this agreement are unreliable (correct reads sit
// >= 0.96, known-bad ones ~0.5-0.6, missing 6-9 glyph reads land there too).
const LEVEL_CONFIDENCE_FLOOR = 0.9;

const IMPORT_MODES = {
  supports: {
    entityKey: "supports",
    noun: "support card",
    storageKey: "umaSupportImportFingerprints",
    learnedKey: "umaSupportImportLearned",
    grid: SUPPORT_GRID,
    intro: "Drop screenshots of the in-game Support Card List (portrait, full screen). Cards are identified locally — nothing leaves this machine.",
    referenceSrc: (item) => item?.media?.cover?.src || "",
    displaySrc: (item) => item?.media?.icon?.src || item?.media?.cover?.src || "",
    makeReferenceFingerprint: referenceFingerprint,
    makeCellFingerprint: cellFingerprint,
    readCell(cellImg) {
      const level = readLevel(cellImg);
      const limitBreak = readLimitBreak(cellImg);
      return {
        values: { level: level.level, limitBreak: limitBreak.limitBreak },
        flags: {
          levelConfident: level.level != null && level.confidence >= LEVEL_CONFIDENCE_FLOOR,
          lbConfident: limitBreak.confident,
        },
        readingConfidence: level.confidence,
      };
    },
    // [valueKey, rosterKey] pairs; getRosterEntry() merges defaults so the
    // diff never trips on pruned default values (level 1 / limit_break 0).
    diffFields: [["level", "level"], ["limitBreak", "limit_break"]],
    diffLabels: { level: "level", limit_break: "LB" },
    renderValueCells(row) {
      return `
        <td><input class="import-level-input" type="number" min="1" max="50" step="1" data-import-field="level" data-import-key="${escapeHtml(row.key)}" value="${Number.isInteger(row.values.level) ? row.values.level : ""}" placeholder="?"></td>
        <td>
          <select data-import-field="limitBreak" data-import-key="${escapeHtml(row.key)}">
            ${[0, 1, 2, 3, 4].map((lb) => `<option value="${lb}" ${row.values.limitBreak === lb ? "selected" : ""}>LB ${lb}</option>`).join("")}
          </select>
        </td>
      `;
    },
    valueHeaders: ["Level", "Limit break"],
    onFieldChange(row, field, input) {
      if (field === "level") {
        const raw = String(input.value || "").trim();
        row.values.level = raw === "" ? null : clampNumber(raw, 1, 50, 1);
        row.flags.levelConfident = raw !== "";
      } else if (field === "limitBreak") {
        row.values.limitBreak = clampNumber(input.value, 0, 4, 0);
        row.flags.lbConfident = true;
      }
    },
    warnings(row, item) {
      const notes = [];
      if (row.values.level == null) {
        notes.push("level unread");
      } else if (!row.flags.levelConfident) {
        notes.push("level to confirm");
      }
      if (!row.flags.lbConfident) {
        notes.push("LB unclear");
      }
      const rarity = item?.detail?.rarity;
      const cap = item ? getSupportLevelCap(rarity, row.values.limitBreak ?? 0) : null;
      if (item && Number.isInteger(row.values.level) && cap != null && row.values.level > cap) {
        notes.push(`level ${row.values.level} exceeds the LB${row.values.limitBreak} cap (${cap})`);
      }
      return notes;
    },
  },
  characters: {
    entityKey: "characters",
    noun: "umamusume",
    storageKey: "umaCharacterImportFingerprints",
    learnedKey: "umaCharacterImportLearned",
    grid: UMA_GRID,
    intro: "Drop screenshots of the in-game Trainee Umamusume list (portrait, full screen). Variants not covered by the icon set show as Unknown — pick them from the dropdown.",
    referenceSrc: (item) => (item?.id ? `./media/reference/characters/icons/${item.id}.png` : ""),
    displaySrc: (item) => item?.media?.icon?.src || item?.media?.portrait?.src || "",
    makeReferenceFingerprint: umaReferenceFingerprint,
    makeCellFingerprint: umaCellFingerprint,
    readCell(cellImg) {
      const stars = readUmaStars(cellImg);
      const potential = readUmaPotential(cellImg);
      return {
        values: { stars: stars.stars, potential: potential.potential },
        flags: {
          starsObscured: stars.obscured,
          starsConfident: stars.confident,
          potentialConfident: potential.confident,
        },
        readingConfidence: potential.score,
      };
    },
    // The in-game label is "Potential Lvl"; the roster field is `awakening`
    // (same thing — the app's historical name for it). The unique skill
    // level equals the star count in the game, so stars feed both fields.
    diffFields: [["stars", "stars"], ["stars", "unique_level"], ["potential", "awakening"]],
    diffLabels: { stars: "stars", unique_level: "unique", awakening: "potential" },
    renderValueCells(row) {
      return `
        <td><input class="import-level-input" type="number" min="1" max="5" step="1" data-import-field="stars" data-import-key="${escapeHtml(row.key)}" value="${Number.isInteger(row.values.stars) ? row.values.stars : ""}" placeholder="?"></td>
        <td>
          <select data-import-field="potential" data-import-key="${escapeHtml(row.key)}">
            ${[1, 2, 3, 4, 5].map((p) => `<option value="${p}" ${row.values.potential === p ? "selected" : ""}>Potential ${p}</option>`).join("")}
          </select>
        </td>
      `;
    },
    valueHeaders: ["Stars", "Potential"],
    onFieldChange(row, field, input) {
      if (field === "stars") {
        const raw = String(input.value || "").trim();
        row.values.stars = raw === "" ? null : clampNumber(raw, 1, 5, 1);
        row.flags.starsConfident = raw !== "";
        row.flags.starsObscured = false;
      } else if (field === "potential") {
        row.values.potential = clampNumber(input.value, 1, 5, 1);
        row.flags.potentialConfident = true;
      }
    },
    warnings(row) {
      const notes = [];
      if (row.flags.starsObscured) {
        notes.push("stars hidden by the overlay bar — rescroll and recapture, or type them");
      } else if (!row.flags.starsConfident) {
        notes.push("stars to confirm");
      }
      if (!row.flags.potentialConfident) {
        notes.push("potential to confirm");
      }
      return notes;
    },
  },
};

function importState(modeKey) {
  return state.rosterImport[modeKey];
}

function setImportStatus(modeKey, kind, message) {
  importState(modeKey).status = { kind, message };
}

function decodeBlobToCanvas(blob) {
  return createImageBitmap(blob).then((bitmap) => {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  });
}

function canvasImageData(canvas) {
  return canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
}

function getItemsById(mode) {
  const byId = new Map();
  for (const item of getEntityItems(mode.entityKey)) {
    byId.set(String(item.id), item);
  }
  return byId;
}

function loadFingerprintsFromStorage(mode, version) {
  try {
    const raw = window.localStorage.getItem(mode.storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed?.version !== version || !parsed.cards) {
      return null;
    }
    const map = new Map();
    for (const [id, entry] of Object.entries(parsed.cards)) {
      map.set(id, deserializeFingerprint(entry));
    }
    return map;
  } catch {
    return null;
  }
}

function saveFingerprintsToStorage(mode, version, fingerprints) {
  try {
    const cards = {};
    for (const [id, fp] of fingerprints) {
      cards[id] = serializeFingerprint(fp);
    }
    window.localStorage.setItem(mode.storageKey, JSON.stringify({ version, cards }));
  } catch {
    // Quota or private mode: the in-memory map still works for this session.
  }
}

// Learned associations: when the user manually assigns a card to a cell and
// applies it, the cell's own fingerprint (their device's exact in-game
// rendering — a better reference than any external asset) is memorized under
// that id. Unlike the reference cache this is NOT keyed by the reference
// generated_at: game renderings do not change with GameTora updates.
function ensureLearnedFingerprints(modeKey) {
  const current = importState(modeKey);
  if (current.learned) {
    return current.learned;
  }
  const mode = IMPORT_MODES[modeKey];
  const map = new Map();
  try {
    const raw = window.localStorage.getItem(mode.learnedKey);
    if (raw) {
      for (const [id, entry] of Object.entries(JSON.parse(raw).cards || {})) {
        map.set(id, deserializeFingerprint(entry));
      }
    }
  } catch {
    // Unreadable store: start fresh; the next apply rewrites it.
  }
  current.learned = map;
  return map;
}

function saveLearnedToStorage(mode, learned) {
  try {
    const cards = {};
    for (const [id, fp] of learned) {
      cards[id] = serializeFingerprint(fp);
    }
    window.localStorage.setItem(mode.learnedKey, JSON.stringify({ cards }));
  } catch {
    // Quota or private mode: the in-memory map still works for this session.
  }
}

async function ensureReferenceFingerprints(modeKey) {
  const mode = IMPORT_MODES[modeKey];
  const version = getLoadedReferenceGeneratedAt();
  const current = importState(modeKey);
  if (current.fingerprints && current.fingerprintsVersion === version) {
    return current.fingerprints;
  }

  const cached = loadFingerprintsFromStorage(mode, version);
  if (cached && cached.size) {
    current.fingerprints = cached;
    current.fingerprintsVersion = version;
    return cached;
  }

  const items = getEntityItems(mode.entityKey).filter((item) => mode.referenceSrc(item));
  const fingerprints = new Map();
  current.building = true;
  let done = 0;

  const queue = [...items];
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      try {
        const response = await fetch(resolveMediaAssetSrc(mode.referenceSrc(item)));
        if (!response.ok) {
          continue; // e.g. uma variant not covered by the icon set
        }
        const canvas = await decodeBlobToCanvas(await response.blob());
        fingerprints.set(String(item.id), mode.makeReferenceFingerprint(canvasImageData(canvas)));
      } catch {
        // A missing/corrupt reference image only removes one candidate.
      } finally {
        done += 1;
        if (done % 25 === 0 || done === items.length) {
          setImportStatus(modeKey, "saving", `Preparing fingerprints... ${done}/${items.length}`);
          requestRenderPreservingScroll();
        }
      }
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));

  current.building = false;
  current.fingerprints = fingerprints;
  current.fingerprintsVersion = version;
  saveFingerprintsToStorage(mode, version, fingerprints);
  return fingerprints;
}

// Captured at the cell's native resolution: the same data URL serves as the
// small table thumbnail (sized by CSS) and as the enlarged preview overlay
// used for visual verification.
function cellThumbnail(sourceCanvas, cell) {
  const canvas = document.createElement("canvas");
  canvas.width = cell.width;
  canvas.height = cell.height;
  canvas.getContext("2d").drawImage(sourceCanvas, cell.x, cell.y, cell.width, cell.height, 0, 0, cell.width, cell.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function betterRow(a, b) {
  if (a.matchConfident !== b.matchConfident) {
    return a.matchConfident ? a : b;
  }
  return (a.readingConfidence || 0) >= (b.readingConfidence || 0) ? a : b;
}

// Two grid cells captured on the same device showing the same card render
// with near-identical pixels; different cards sit far apart (hash distance
// >= 8 across the whole catalog, typically 15+). Used to dedupe unmatched
// rows across overlapping screenshots, where no card id is available yet.
const SAME_CELL_MAX_DISTANCE = 6;
const SAME_CELL_MIN_INTERSECT = 0.85;

function sameCellFingerprint(a, b) {
  if (!a?.hashes?.length || !b?.hashes?.length) {
    return false;
  }
  return hamming64(a.hashes[0], b.hashes[0]) <= SAME_CELL_MAX_DISTANCE
    && histIntersect(a.hist, b.hist) >= SAME_CELL_MIN_INTERSECT;
}

export async function processImportFiles(modeKey, fileList) {
  const mode = IMPORT_MODES[modeKey];
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    return;
  }
  const current = importState(modeKey);
  current.processing = true;
  setImportStatus(modeKey, "saving", "Preparing fingerprints...");
  requestRenderPreservingScroll();

  try {
    const fingerprints = await ensureReferenceFingerprints(modeKey);
    const learned = ensureLearnedFingerprints(modeKey);
    // Learned fingerprints win over the reference for the same id: they come
    // from this device's exact in-game rendering.
    const refEntries = [...new Map([...fingerprints, ...learned]).entries()];
    const rows = [];

    for (const file of files) {
      const canvas = await decodeBlobToCanvas(file);
      const imageData = canvasImageData(canvas);
      // Screenshots of a scrolled list do not land on the calibrated grid
      // origin: measure each file's vertical offset before slicing.
      const detection = detectGridOffsetY(imageData, mode.grid, refEntries, mode.makeCellFingerprint);
      const cells = gridCells(imageData.width, imageData.height, mode.grid, detection.offsetY);
      for (const cell of cells) {
        const cellImg = cropImage(imageData, cell.x, cell.y, cell.width, cell.height);
        const cellFp = mode.makeCellFingerprint(cellImg);
        const ranked = rankCandidates(cellFp, refEntries, 3);
        const verdict = assessMatch(ranked);
        const reading = mode.readCell(cellImg);
        rows.push({
          key: `${file.name}:${cell.row}:${cell.col}`,
          thumb: cellThumbnail(canvas, cell),
          fingerprint: cellFp,
          cardId: verdict.confident ? verdict.bestId : "",
          top3: ranked,
          matchConfident: verdict.confident,
          learned: verdict.confident && learned.has(verdict.bestId),
          manualMatch: false,
          distance: ranked[0]?.distance ?? Infinity,
          gap: verdict.gap,
          values: reading.values,
          flags: reading.flags,
          readingConfidence: reading.readingConfidence,
          include: false,
        });
      }
    }

    // Merge with previous results, dedup by picked id (scroll overlap between
    // screenshots); rows without a confident id all stay visible for review.
    const merged = [...current.results];
    for (const row of rows) {
      if (row.cardId) {
        const existingIndex = merged.findIndex((entry) => entry.cardId === row.cardId);
        if (existingIndex === -1) {
          merged.push(row);
        } else {
          merged[existingIndex] = betterRow(merged[existingIndex], row);
        }
        continue;
      }
      // Unmatched rows have no id to dedupe on, but overlapping screenshots
      // render the exact same cell pixels: near-identical fingerprints mean
      // "same card seen twice". Merge into the existing row (which keeps its
      // id if the user already assigned one) instead of stacking duplicates.
      const twinIndex = merged.findIndex((entry) => entry.fingerprint && sameCellFingerprint(entry.fingerprint, row.fingerprint));
      if (twinIndex === -1) {
        merged.push(row);
      } else if (!merged[twinIndex].cardId) {
        merged[twinIndex] = betterRow(merged[twinIndex], row);
      }
    }

    // Default inclusion: confident rows whose application would change the
    // roster. Unknown/unchanged rows start unchecked. Section membership is
    // FROZEN here (startedUnchanged): editing a row toward the roster values
    // must not teleport it into the collapsed "already up to date" section
    // mid-review — the status badge updates live, the row stays put.
    const itemsById = getItemsById(mode);
    for (const row of merged) {
      const status = rowDiffStatus(mode, row, itemsById);
      row.include = Boolean(row.cardId) && row.matchConfident && (status.kind === "new" || status.kind === "changed");
      row.startedUnchanged = status.kind === "unchanged";
    }

    current.results = merged;
    const uncertain = merged.filter((row) => !row.cardId).length;
    setImportStatus(
      modeKey,
      "saved",
      `Read ${rows.length} cells from ${files.length} screenshot(s) — ${merged.length} distinct ${mode.noun}s${uncertain ? `, ${uncertain} to review` : ""}.`,
    );
  } catch (error) {
    setImportStatus(modeKey, "error", error.message || "Could not process the screenshots.");
  } finally {
    current.processing = false;
    requestRenderPreservingScroll();
  }
}

// getRosterEntry merges entity defaults (supports: level 1 / limit_break 0,
// characters: stars = base rarity / awakening 0), so the diff never re-flags
// pruned default values on re-import.
function rowDiffStatus(mode, row, itemsById) {
  if (!row.cardId) {
    return { kind: "unknown", label: "Unknown card" };
  }
  const item = itemsById.get(row.cardId);
  if (!item) {
    return { kind: "unknown", label: "Not in reference" };
  }
  const current = getRosterEntry(mode.entityKey, item);
  if (current.owned !== true) {
    return { kind: "new", label: "New" };
  }
  const changes = [];
  for (const [valueKey, rosterKey] of mode.diffFields) {
    const next = row.values[valueKey];
    if (Number.isInteger(next) && current[rosterKey] !== next) {
      changes.push(`${mode.diffLabels[rosterKey]} ${current[rosterKey] ?? "-"} -> ${next}`);
    }
  }
  if (changes.length) {
    return { kind: "changed", label: changes.join(", ") };
  }
  return { kind: "unchanged", label: "Unchanged" };
}

function renderRowMatchSelect(row, itemsById, sortedItems) {
  const options = [`<option value="">— pick a card —</option>`];
  const seen = new Set();
  for (const candidate of row.top3) {
    const item = itemsById.get(candidate.id);
    if (!item || seen.has(candidate.id)) {
      continue;
    }
    seen.add(candidate.id);
    const label = `${item.title}${item.subtitle ? ` ${item.subtitle}` : ""} (d=${candidate.distance})`;
    options.push(`<option value="${escapeHtml(candidate.id)}" ${row.cardId === candidate.id ? "selected" : ""}>${escapeHtml(label)}</option>`);
  }
  // Full catalog after the candidates: uncovered variants are not in the
  // top-3 at all, and a manual pick here is what feeds the learning store.
  options.push(`<option value="" disabled>——— all cards ———</option>`);
  for (const item of sortedItems) {
    const id = String(item.id);
    if (seen.has(id)) {
      continue;
    }
    const label = `${item.title}${item.subtitle ? ` ${item.subtitle}` : ""}`;
    options.push(`<option value="${escapeHtml(id)}" ${row.cardId === id ? "selected" : ""}>${escapeHtml(label)}</option>`);
  }
  return `<select data-import-field="cardId" data-import-key="${escapeHtml(row.key)}">${options.join("")}</select>`;
}

function renderImportRow(mode, row, itemsById, sortedItems) {
  const status = rowDiffStatus(mode, row, itemsById);
  const item = row.cardId ? itemsById.get(row.cardId) : null;

  const warnings = [];
  if (!row.matchConfident && row.cardId && !row.manualMatch) {
    warnings.push(`match to confirm (d=${row.distance}, gap=${Number.isFinite(row.gap) ? row.gap.toFixed(1) : "-"})`);
  }
  warnings.push(...mode.warnings(row, item));

  return `
    <tr class="import-row import-row-${status.kind}">
      <td><input type="checkbox" data-import-field="include" data-import-key="${escapeHtml(row.key)}" ${row.include ? "checked" : ""} ${status.kind === "unknown" ? "disabled" : ""}></td>
      <td><img class="import-cell-thumb" src="${row.thumb}" alt="captured cell" title="Click to enlarge" data-import-preview="${escapeHtml(row.key)}"></td>
      <td class="import-match-cell">
        ${item ? `<img class="import-ref-thumb" src="${escapeHtml(resolveMediaAssetSrc(mode.displaySrc(item)))}" alt="">` : ""}
        ${renderRowMatchSelect(row, itemsById, sortedItems)}
      </td>
      ${mode.renderValueCells(row)}
      <td>
        <span class="import-status import-status-${status.kind}">${escapeHtml(status.label)}</span>
        ${row.learned ? `<span class="import-learned-note">matched from your earlier correction</span>` : ""}
        ${warnings.length ? `<span class="import-warnings">${escapeHtml(warnings.join(" · "))}</span>` : ""}
      </td>
    </tr>
  `;
}

export function renderRosterImportPanel(entityKey) {
  const modeKey = entityKey === "characters" ? "characters" : "supports";
  const mode = IMPORT_MODES[modeKey];
  const current = importState(modeKey);
  const itemsById = getItemsById(mode);
  const sortedItems = [...itemsById.values()].sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const learnedCount = ensureLearnedFingerprints(modeKey).size;
  const statusText = current.status.message || mode.intro;

  const rows = current.results;
  // Frozen at processing time — live status changes never move rows between
  // the main table and the collapsed section (user-reported disappearance).
  const visible = rows.filter((row) => !row.startedUnchanged);
  const unchangedRows = rows.filter((row) => row.startedUnchanged);
  const selectedCount = rows.filter((row) => row.include && row.cardId).length;

  const tableHead = `
    <tr>
      <th scope="col" title="Apply this row"></th>
      <th scope="col">Capture</th>
      <th scope="col">Matched card</th>
      ${mode.valueHeaders.map((label) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}
      <th scope="col">Status</th>
    </tr>
  `;

  listEl.innerHTML = `
    <div class="support-import">
      <div class="import-dropzone" id="importDropzone">
        <p><strong>Import ${escapeHtml(mode.noun)}s from screenshots</strong></p>
        <p class="source-note">${escapeHtml(statusText)}</p>
        <div class="roster-actions">
          <label class="button-strong import-file-label">
            Choose screenshots
            <input id="importFileInput" type="file" accept="image/*" multiple hidden>
          </label>
          ${rows.length ? `<button type="button" class="button-secondary" id="importClearButton">Clear results</button>` : ""}
          ${learnedCount ? `<button type="button" class="button-secondary" id="importForgetButton" title="Drop the fingerprints memorized from your manual corrections">Forget ${learnedCount} learned match(es)</button>` : ""}
        </div>
      </div>
      ${rows.length ? `
        <div class="import-apply-bar">
          <strong>${selectedCount}</strong> row(s) selected
          <button type="button" class="button-strong" id="importApplyButton" ${selectedCount && !current.processing ? "" : "disabled"}>Apply to my roster</button>
        </div>
        <div class="import-table-wrap">
          <table class="import-table">
            <thead>${tableHead}</thead>
            <tbody>${visible.map((row) => renderImportRow(mode, row, itemsById, sortedItems)).join("")}</tbody>
          </table>
        </div>
        ${unchangedRows.length ? `
          <details class="import-unchanged">
            <summary>${unchangedRows.length} ${escapeHtml(mode.noun)}(s) already up to date</summary>
            <div class="import-table-wrap">
              <table class="import-table">
                <thead>${tableHead}</thead>
                <tbody>${unchangedRows.map((row) => renderImportRow(mode, row, itemsById, sortedItems)).join("")}</tbody>
              </table>
            </div>
          </details>
        ` : ""}
      ` : ""}
    </div>
  `;

  attachImportListeners(modeKey);
}

function findRow(modeKey, key) {
  return importState(modeKey).results.find((row) => row.key === key) || null;
}

// --- Enlarged preview overlay (visual verification) ---
// Click a captured-cell thumbnail to see it big, side by side with the image
// of the currently matched card (the full illustration for supports, the
// in-game icon for umas when covered, the stand art otherwise).

function closeImportPreview() {
  document.getElementById("importPreviewOverlay")?.remove();
  document.removeEventListener("keydown", onImportPreviewKeydown);
}

function onImportPreviewKeydown(event) {
  if (event.key === "Escape") {
    closeImportPreview();
  }
}

function previewReferenceSrc(modeKey, item) {
  const mode = IMPORT_MODES[modeKey];
  if (modeKey === "characters") {
    const covered = importState(modeKey).fingerprints?.has(String(item.id));
    return covered ? mode.referenceSrc(item) : (item?.media?.portrait?.src || "");
  }
  return mode.referenceSrc(item);
}

function openImportPreview(modeKey, row) {
  closeImportPreview();
  const itemsById = getItemsById(IMPORT_MODES[modeKey]);
  const item = row.cardId ? itemsById.get(row.cardId) : null;
  const refSrc = item ? previewReferenceSrc(modeKey, item) : "";
  const matchLabel = item ? `${item.title}${item.subtitle ? ` ${item.subtitle}` : ""}` : "No card selected yet";

  const overlay = document.createElement("div");
  overlay.id = "importPreviewOverlay";
  overlay.className = "import-preview-overlay";
  overlay.innerHTML = `
    <div class="import-preview-panel">
      <button type="button" class="import-preview-close" aria-label="Close preview">&times;</button>
      <div class="import-preview-images">
        <figure>
          <img src="${row.thumb}" alt="captured cell">
          <figcaption>Your capture</figcaption>
        </figure>
        ${refSrc ? `
          <figure>
            <img src="${escapeHtml(resolveMediaAssetSrc(refSrc))}" alt="">
            <figcaption>${escapeHtml(matchLabel)}</figcaption>
          </figure>
        ` : `<p class="import-preview-empty">${escapeHtml(matchLabel)}</p>`}
      </div>
    </div>
  `;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".import-preview-close")) {
      closeImportPreview();
    }
  });
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onImportPreviewKeydown);
}

function attachImportListeners(modeKey) {
  const mode = IMPORT_MODES[modeKey];
  const fileInput = document.getElementById("importFileInput");
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      await processImportFiles(modeKey, fileInput.files || []);
    });
  }

  const dropzone = document.getElementById("importDropzone");
  if (dropzone) {
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("import-dropzone-active");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("import-dropzone-active"));
    dropzone.addEventListener("drop", async (event) => {
      event.preventDefault();
      dropzone.classList.remove("import-dropzone-active");
      await processImportFiles(modeKey, event.dataTransfer?.files || []);
    });
  }

  const clearButton = document.getElementById("importClearButton");
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      importState(modeKey).results = [];
      setImportStatus(modeKey, "idle", "");
      requestRenderPreservingScroll();
    });
  }

  const forgetButton = document.getElementById("importForgetButton");
  if (forgetButton) {
    forgetButton.addEventListener("click", () => {
      const emptied = new Map();
      importState(modeKey).learned = emptied;
      saveLearnedToStorage(mode, emptied);
      setImportStatus(modeKey, "saved", "Learned matches forgotten.");
      requestRenderPreservingScroll();
    });
  }

  listEl.querySelectorAll("[data-import-preview]").forEach((img) => {
    img.addEventListener("click", () => {
      const row = findRow(modeKey, img.dataset.importPreview);
      if (row) {
        openImportPreview(modeKey, row);
      }
    });
  });

  listEl.querySelectorAll("[data-import-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const row = findRow(modeKey, input.dataset.importKey);
      if (!row) {
        return;
      }
      const field = input.dataset.importField;
      if (field === "include") {
        row.include = input.checked;
      } else if (field === "cardId") {
        row.cardId = String(input.value || "");
        row.matchConfident = Boolean(row.cardId);
        // A manual pick is what feeds the learning store on apply.
        row.manualMatch = Boolean(row.cardId);
        row.learned = false;
        if (!row.cardId) {
          row.include = false;
        }
      } else {
        mode.onFieldChange(row, field, input);
      }
      requestRenderPreservingScroll();
    });
  });

  const applyButton = document.getElementById("importApplyButton");
  if (applyButton) {
    applyButton.addEventListener("click", async () => {
      await applySelectedRows(modeKey);
    });
  }
}

async function applySelectedRows(modeKey) {
  const mode = IMPORT_MODES[modeKey];
  const itemsById = getItemsById(mode);
  const selected = importState(modeKey).results.filter((row) => row.include && row.cardId && itemsById.has(row.cardId));
  if (!selected.length) {
    return;
  }
  for (const row of selected) {
    const item = itemsById.get(row.cardId);
    const entry = { ...getRosterEntry(mode.entityKey, item), owned: true };
    for (const [valueKey, rosterKey] of mode.diffFields) {
      if (Number.isInteger(row.values[valueKey])) {
        entry[rosterKey] = row.values[valueKey];
      }
    }
    setRosterEntry(mode.entityKey, item, entry);
  }

  await persistRosterDocument(`Imported ${selected.length} ${mode.noun}(s) from screenshots.`);

  // persistRosterDocument swallows its errors into rosterStatus (and now
  // resyncs the document from the server itself). A failed PUT must NOT be
  // reported as success here: the local mutations lived only in this tab
  // (phantom "owned" entries the server never saw — observed in real use).
  if (state.rosterStatus?.kind === "error") {
    setImportStatus(
      modeKey,
      "error",
      `NOT saved: ${state.rosterStatus.message || "the roster save failed."} Your rows are still selected — fix the reported value or retry once the server is reachable.`,
    );
    requestRenderPreservingScroll();
    return;
  }

  // Learn the manual associations only once the save is confirmed: the
  // cell's no-jitter hash + histogram become the reference fingerprint for
  // that id (overwriting any earlier learned entry).
  const learned = ensureLearnedFingerprints(modeKey);
  let memorized = 0;
  for (const row of selected) {
    if (row.manualMatch && row.fingerprint) {
      learned.set(row.cardId, { hash: row.fingerprint.hashes[0], hist: row.fingerprint.hist });
      memorized += 1;
    }
  }
  if (memorized) {
    saveLearnedToStorage(mode, learned);
  }

  setImportStatus(
    modeKey,
    "saved",
    `Applied ${selected.length} ${mode.noun}(s) to the roster.${memorized ? ` Memorized ${memorized} manual match(es) for next imports.` : ""}`,
  );
  requestRenderPreservingScroll();
}
