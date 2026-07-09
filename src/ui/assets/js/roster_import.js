// Screenshot-based support import: browser orchestration + reconciliation UI.
// The pure CV engine lives in roster_import_cv.js; this module owns file
// decoding (canvas), the reference fingerprint cache (localStorage, keyed by
// the reference generated_at), the reconciliation table rendered in place of
// the roster/supports list, and applying the reviewed rows to the roster via
// the existing PUT flow. See docs/ROSTER_IMPORT_PLAN.md.
import { getEntityItems, getLoadedReferenceGeneratedAt, getSupportLevelCap, listEl, state } from "./core.js";
import { clampNumber, escapeHtml, resolveMediaAssetSrc } from "./dom-utils.js";
import {
  assessMatch,
  cellFingerprint,
  cropImage,
  deserializeFingerprint,
  gridCells,
  rankCandidates,
  readLevel,
  readLimitBreak,
  reconcile,
  referenceFingerprint,
  serializeFingerprint,
} from "./roster_import_cv.js";
import { getRosterEntry, setRosterEntry } from "./roster.js";
import { persistRosterDocument, requestRenderPreservingScroll } from "../app.js";

const FINGERPRINT_STORAGE_KEY = "umaSupportImportFingerprints";
const FETCH_CONCURRENCY = 8;
const THUMB_WIDTH = 66;
const THUMB_HEIGHT = 88;
// A digit read below this agreement score is treated as unreliable; the level
// field stays editable either way (measured: correct reads >= 0.96, the known
// bad reads sit at ~0.5-0.6, and missing 6-9 glyphs surface down there too).
const LEVEL_CONFIDENCE_FLOOR = 0.9;

function setImportStatus(kind, message) {
  state.supportImport.status = { kind, message };
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

function supportCoverSrc(item) {
  return item?.media?.cover?.src || "";
}

function supportIconSrc(item) {
  return item?.media?.icon?.src || supportCoverSrc(item);
}

function getSupportItemsById() {
  const byId = new Map();
  for (const item of getEntityItems("supports")) {
    byId.set(String(item.id), item);
  }
  return byId;
}

function loadFingerprintsFromStorage(version) {
  try {
    const raw = window.localStorage.getItem(FINGERPRINT_STORAGE_KEY);
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

function saveFingerprintsToStorage(version, fingerprints) {
  try {
    const cards = {};
    for (const [id, fp] of fingerprints) {
      cards[id] = serializeFingerprint(fp);
    }
    window.localStorage.setItem(FINGERPRINT_STORAGE_KEY, JSON.stringify({ version, cards }));
  } catch {
    // Quota or private mode: the in-memory map still works for this session.
  }
}

async function ensureReferenceFingerprints() {
  const version = getLoadedReferenceGeneratedAt();
  const current = state.supportImport;
  if (current.fingerprints && current.fingerprintsVersion === version) {
    return current.fingerprints;
  }

  const cached = loadFingerprintsFromStorage(version);
  if (cached && cached.size) {
    current.fingerprints = cached;
    current.fingerprintsVersion = version;
    return cached;
  }

  const items = getEntityItems("supports").filter((item) => supportCoverSrc(item));
  const fingerprints = new Map();
  current.building = true;
  let done = 0;

  const queue = [...items];
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      try {
        const response = await fetch(resolveMediaAssetSrc(supportCoverSrc(item)));
        if (!response.ok) {
          continue;
        }
        const canvas = await decodeBlobToCanvas(await response.blob());
        fingerprints.set(String(item.id), referenceFingerprint(canvasImageData(canvas)));
      } catch {
        // A missing/corrupt illustration only removes one candidate.
      } finally {
        done += 1;
        if (done % 25 === 0 || done === items.length) {
          setImportStatus("saving", `Preparing card fingerprints... ${done}/${items.length}`);
          requestRenderPreservingScroll();
        }
      }
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));

  current.building = false;
  current.fingerprints = fingerprints;
  current.fingerprintsVersion = version;
  saveFingerprintsToStorage(version, fingerprints);
  return fingerprints;
}

function cellThumbnail(sourceCanvas, cell) {
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  canvas.getContext("2d").drawImage(sourceCanvas, cell.x, cell.y, cell.width, cell.height, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  return canvas.toDataURL("image/jpeg", 0.75);
}

function betterRow(a, b) {
  if (a.matchConfident !== b.matchConfident) {
    return a.matchConfident ? a : b;
  }
  return (a.levelConfidence || 0) >= (b.levelConfidence || 0) ? a : b;
}

export async function processImportFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    return;
  }
  const importState = state.supportImport;
  importState.processing = true;
  setImportStatus("saving", "Preparing card fingerprints...");
  requestRenderPreservingScroll();

  try {
    const fingerprints = await ensureReferenceFingerprints();
    const refEntries = [...fingerprints.entries()];
    const rows = [];

    for (const file of files) {
      const canvas = await decodeBlobToCanvas(file);
      const imageData = canvasImageData(canvas);
      const cells = gridCells(imageData.width, imageData.height);
      for (const cell of cells) {
        const cellImg = cropImage(imageData, cell.x, cell.y, cell.width, cell.height);
        const ranked = rankCandidates(cellFingerprint(cellImg), refEntries, 3);
        const verdict = assessMatch(ranked);
        const level = readLevel(cellImg);
        const limitBreak = readLimitBreak(cellImg);
        rows.push({
          key: `${file.name}:${cell.row}:${cell.col}`,
          thumb: cellThumbnail(canvas, cell),
          cardId: verdict.confident ? verdict.bestId : "",
          top3: ranked,
          matchConfident: verdict.confident,
          distance: ranked[0]?.distance ?? Infinity,
          gap: verdict.gap,
          level: level.level,
          levelConfidence: level.confidence,
          levelConfident: level.level != null && level.confidence >= LEVEL_CONFIDENCE_FLOOR,
          limitBreak: limitBreak.limitBreak,
          lbConfident: limitBreak.confident,
          include: false,
        });
      }
    }

    // Merge with previous results, dedup by picked card id (scroll overlap
    // between screenshots); rows without a confident id all stay visible.
    const merged = [...importState.results];
    for (const row of rows) {
      if (!row.cardId) {
        merged.push(row);
        continue;
      }
      const existingIndex = merged.findIndex((entry) => entry.cardId === row.cardId);
      if (existingIndex === -1) {
        merged.push(row);
      } else {
        merged[existingIndex] = betterRow(merged[existingIndex], row);
      }
    }

    // Default inclusion: confident rows whose application would change the
    // roster. Unknown/unchanged rows start unchecked. reconcile() compares
    // raw values, so feed it defaults-normalized entries (pruned roster
    // entries omit level 1 / limit_break 0).
    const currentSupports = state.rosterDocument?.supports || {};
    const normalizedCurrent = {};
    for (const [id, entry] of Object.entries(currentSupports)) {
      normalizedCurrent[id] = normalizedSupportEntry(entry);
    }
    const diff = reconcile(
      normalizedCurrent,
      merged.filter((row) => row.cardId).map((row) => ({ cardId: row.cardId, level: row.level, limitBreak: row.limitBreak })),
    );
    const actionable = new Set([...diff.added.map((entry) => entry.id), ...diff.changed.map((entry) => entry.id)]);
    for (const row of merged) {
      row.include = Boolean(row.cardId) && row.matchConfident && actionable.has(row.cardId);
    }

    importState.results = merged;
    const uncertain = merged.filter((row) => !row.cardId).length;
    setImportStatus(
      "saved",
      `Read ${rows.length} cells from ${files.length} screenshot(s) — ${merged.length} distinct cards${uncertain ? `, ${uncertain} to review` : ""}.`,
    );
  } catch (error) {
    setImportStatus("error", error.message || "Could not process the screenshots.");
  } finally {
    importState.processing = false;
    requestRenderPreservingScroll();
  }
}

// The persisted roster prunes fields equal to their defaults (supports:
// level 1, limit_break 0 — see pruneRosterEntry), so a stored entry may omit
// them. Diffing against the raw entry would flag every default-valued card as
// changed on re-import; normalize first.
function normalizedSupportEntry(entry) {
  return {
    owned: entry?.owned === true,
    level: Number.isInteger(entry?.level) ? entry.level : 1,
    limit_break: Number.isInteger(entry?.limit_break) ? entry.limit_break : 0,
  };
}

function rowDiffStatus(row, currentSupports) {
  if (!row.cardId) {
    return { kind: "unknown", label: "Unknown card" };
  }
  const current = normalizedSupportEntry(currentSupports[row.cardId]);
  if (!current.owned) {
    return { kind: "new", label: "New" };
  }
  const changes = [];
  if (Number.isInteger(row.level) && current.level !== row.level) {
    changes.push(`level ${current.level} -> ${row.level}`);
  }
  if (Number.isInteger(row.limitBreak) && current.limit_break !== row.limitBreak) {
    changes.push(`LB ${current.limit_break} -> ${row.limitBreak}`);
  }
  if (changes.length) {
    return { kind: "changed", label: changes.join(", ") };
  }
  return { kind: "unchanged", label: "Unchanged" };
}

function renderRowMatchSelect(row, itemsById) {
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
  if (row.cardId && !seen.has(row.cardId)) {
    const item = itemsById.get(row.cardId);
    options.push(`<option value="${escapeHtml(row.cardId)}" selected>${escapeHtml(item ? item.title : row.cardId)}</option>`);
  }
  return `<select data-import-field="cardId" data-import-key="${escapeHtml(row.key)}">${options.join("")}</select>`;
}

function renderImportRow(row, itemsById, currentSupports) {
  const status = rowDiffStatus(row, currentSupports);
  const item = row.cardId ? itemsById.get(row.cardId) : null;
  const rarity = item?.detail?.rarity;
  const cap = item ? getSupportLevelCap(rarity, row.limitBreak ?? 0) : null;
  const overCap = item && Number.isInteger(row.level) && cap != null && row.level > cap;

  const warnings = [];
  if (!row.matchConfident && row.cardId) {
    warnings.push(`match to confirm (d=${row.distance}, gap=${Number.isFinite(row.gap) ? row.gap.toFixed(1) : "-"})`);
  }
  if (row.level == null) {
    warnings.push("level unread");
  } else if (!row.levelConfident) {
    warnings.push(`level to confirm (${Math.round((row.levelConfidence || 0) * 100)}%)`);
  }
  if (!row.lbConfident) {
    warnings.push("LB unclear");
  }
  if (overCap) {
    warnings.push(`level ${row.level} exceeds the LB${row.limitBreak} cap (${cap})`);
  }

  return `
    <tr class="import-row import-row-${status.kind}">
      <td><input type="checkbox" data-import-field="include" data-import-key="${escapeHtml(row.key)}" ${row.include ? "checked" : ""} ${status.kind === "unknown" ? "disabled" : ""}></td>
      <td><img class="import-cell-thumb" src="${row.thumb}" alt="captured cell"></td>
      <td class="import-match-cell">
        ${item ? `<img class="import-ref-thumb" src="${escapeHtml(resolveMediaAssetSrc(supportIconSrc(item)))}" alt="">` : ""}
        ${renderRowMatchSelect(row, itemsById)}
      </td>
      <td><input class="import-level-input" type="number" min="1" max="50" step="1" data-import-field="level" data-import-key="${escapeHtml(row.key)}" value="${Number.isInteger(row.level) ? row.level : ""}" placeholder="?"></td>
      <td>
        <select data-import-field="limitBreak" data-import-key="${escapeHtml(row.key)}">
          ${[0, 1, 2, 3, 4].map((lb) => `<option value="${lb}" ${row.limitBreak === lb ? "selected" : ""}>LB ${lb}</option>`).join("")}
        </select>
      </td>
      <td>
        <span class="import-status import-status-${status.kind}">${escapeHtml(status.label)}</span>
        ${warnings.length ? `<span class="import-warnings">${escapeHtml(warnings.join(" · "))}</span>` : ""}
      </td>
    </tr>
  `;
}

export function renderSupportImportPanel() {
  const importState = state.supportImport;
  const itemsById = getSupportItemsById();
  const currentSupports = state.rosterDocument?.supports || {};
  const statusText = importState.status.message
    || "Drop screenshots of the in-game Support Card List (portrait, full screen). Cards are identified locally — nothing leaves this machine.";

  const rows = importState.results;
  const visible = rows.filter((row) => rowDiffStatus(row, currentSupports).kind !== "unchanged");
  const unchangedRows = rows.filter((row) => rowDiffStatus(row, currentSupports).kind === "unchanged");
  const selectedCount = rows.filter((row) => row.include && row.cardId).length;

  const tableHead = `
    <tr>
      <th scope="col" title="Apply this row"></th>
      <th scope="col">Capture</th>
      <th scope="col">Matched card</th>
      <th scope="col">Level</th>
      <th scope="col">Limit break</th>
      <th scope="col">Status</th>
    </tr>
  `;

  listEl.innerHTML = `
    <div class="support-import">
      <div class="import-dropzone" id="importDropzone">
        <p><strong>Import support cards from screenshots</strong></p>
        <p class="source-note">${escapeHtml(statusText)}</p>
        <div class="roster-actions">
          <label class="button-strong import-file-label">
            Choose screenshots
            <input id="importFileInput" type="file" accept="image/*" multiple hidden>
          </label>
          ${rows.length ? `<button type="button" class="button-secondary" id="importClearButton">Clear results</button>` : ""}
        </div>
      </div>
      ${rows.length ? `
        <div class="import-apply-bar">
          <strong>${selectedCount}</strong> row(s) selected
          <button type="button" class="button-strong" id="importApplyButton" ${selectedCount && !importState.processing ? "" : "disabled"}>Apply to my roster</button>
        </div>
        <div class="import-table-wrap">
          <table class="import-table">
            <thead>${tableHead}</thead>
            <tbody>${visible.map((row) => renderImportRow(row, itemsById, currentSupports)).join("")}</tbody>
          </table>
        </div>
        ${unchangedRows.length ? `
          <details class="import-unchanged">
            <summary>${unchangedRows.length} card(s) already up to date</summary>
            <div class="import-table-wrap">
              <table class="import-table">
                <thead>${tableHead}</thead>
                <tbody>${unchangedRows.map((row) => renderImportRow(row, itemsById, currentSupports)).join("")}</tbody>
              </table>
            </div>
          </details>
        ` : ""}
      ` : ""}
    </div>
  `;

  attachImportListeners();
}

function findRow(key) {
  return state.supportImport.results.find((row) => row.key === key) || null;
}

function attachImportListeners() {
  const fileInput = document.getElementById("importFileInput");
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      await processImportFiles(fileInput.files || []);
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
      await processImportFiles(event.dataTransfer?.files || []);
    });
  }

  const clearButton = document.getElementById("importClearButton");
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      state.supportImport.results = [];
      setImportStatus("idle", "");
      requestRenderPreservingScroll();
    });
  }

  listEl.querySelectorAll("[data-import-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const row = findRow(input.dataset.importKey);
      if (!row) {
        return;
      }
      const field = input.dataset.importField;
      if (field === "include") {
        row.include = input.checked;
      } else if (field === "cardId") {
        row.cardId = String(input.value || "");
        row.matchConfident = Boolean(row.cardId);
        if (!row.cardId) {
          row.include = false;
        }
      } else if (field === "level") {
        const raw = String(input.value || "").trim();
        row.level = raw === "" ? null : clampNumber(raw, 1, 50, 1);
        row.levelConfident = raw !== "";
        row.levelConfidence = raw === "" ? 0 : 1;
      } else if (field === "limitBreak") {
        row.limitBreak = clampNumber(input.value, 0, 4, 0);
        row.lbConfident = true;
      }
      requestRenderPreservingScroll();
    });
  });

  const applyButton = document.getElementById("importApplyButton");
  if (applyButton) {
    applyButton.addEventListener("click", async () => {
      await applySelectedRows();
    });
  }
}

async function applySelectedRows() {
  const itemsById = getSupportItemsById();
  const selected = state.supportImport.results.filter((row) => row.include && row.cardId && itemsById.has(row.cardId));
  if (!selected.length) {
    return;
  }
  for (const row of selected) {
    const item = itemsById.get(row.cardId);
    const entry = { ...getRosterEntry("supports", item), owned: true };
    if (Number.isInteger(row.level)) {
      entry.level = row.level;
    }
    if (Number.isInteger(row.limitBreak)) {
      entry.limit_break = row.limitBreak;
    }
    setRosterEntry("supports", item, entry);
  }
  await persistRosterDocument(`Imported ${selected.length} support card(s) from screenshots.`);
  setImportStatus("saved", `Applied ${selected.length} card(s) to the roster.`);
  requestRenderPreservingScroll();
}
