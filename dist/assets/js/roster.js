// Auto-split from app.js as part of docs/REFACTOR_PLAN.md.
import { asArray, buildsEntityKey, data, getActiveProfile, getRosterViewEntry, getRosterViewPayload, getSupportEntryLevelCap, getViewState, legacyEntityKey, listEl, rosterEntityKeys, rosterFilterDefinitionsBase, setBrowseHash, state } from "./core.js";
import { clampNumber, clampRatio, escapeHtml, parseRosterTokenList, renderLinkedSkillList, renderProgressMetric, renderStatePill, tableFromRows } from "./dom-utils.js";
import { formatSupportEffectValue } from "./catalog.js";
import { persistRosterDocument, removeItemFromRoster, resetRosterEntry, saveRosterForm, showAppToast } from "../app.js";


export function renderSupportCurrentEffects(projection) {
  const effects = asArray(projection?.effective_effects);
  if (!effects.length) {
    return "<p class='source-note'>No support bonus data.</p>";
  }

  return `
    <div class="support-effect-stack">
      ${effects
        .map((effect) => {
          const currentValue = formatSupportEffectValue(effect, effect.current_value);
          const maxValue = formatSupportEffectValue(effect, effect.max_value);
          const unlockMeta = effect.current_value == null
            ? (effect.next_unlock_level ? `Unlocks at Lv ${effect.next_unlock_level}` : "No level unlock data")
            : (effect.next_unlock_level ? `Current at Lv ${effect.current_unlock_level || 1} | Next upgrade at Lv ${effect.next_unlock_level}` : `Current at Lv ${effect.current_unlock_level || 1} | Maxed`);

          return `
            <article class="support-effect-card">
              <div class="support-effect-head">
                <strong>${escapeHtml(effect.name || `Effect #${effect.effect_id}`)}</strong>
                <span class="support-effect-values">${escapeHtml(`${currentValue} / ${maxValue}`)}</span>
              </div>
              ${effect.description ? `<p class="support-effect-description">${escapeHtml(effect.description)}</p>` : ""}
              <p class="support-effect-meta">${escapeHtml(unlockMeta)}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}


export function getCharacterProgressSummary(projection) {
  const starsRatio = clampRatio(projection.stars, 5);
  const awakeningRatio = clampRatio(projection.awakening, 5);
  const uniqueRatio = clampRatio(projection.unique_level, 6, { min: 1 });
  const overallRatio = (starsRatio + awakeningRatio + uniqueRatio) / 3;
  return {
    overallRatio,
    metrics: [
      { label: "Stars", display: `${projection.stars}/5`, ratio: starsRatio, tone: "amber" },
      { label: "Awk", display: `${projection.awakening}/5`, ratio: awakeningRatio, tone: "violet" },
      { label: "Unique", display: `U${projection.unique_level}`, ratio: uniqueRatio, tone: "green" },
    ],
  };
}

export function getSupportProgressSummary(projection) {
  const levelCap = Math.max(1, Number(projection.level_cap) || Number(projection.level) || 1);
  const levelRatio = clampRatio(projection.level, levelCap);
  const lbRatio = clampRatio(projection.limit_break, 4);
  const overallRatio = (levelRatio * 0.75) + (lbRatio * 0.25);
  return {
    overallRatio,
    metrics: [
      { label: "Level", display: `${projection.level}/${projection.level_cap || "-"}`, ratio: levelRatio, tone: "cyan" },
      { label: "LB", display: `${projection.limit_break}/4`, ratio: lbRatio, tone: "amber" },
    ],
  };
}

export function renderRosterCardProgress(entityKey, projection) {
  if (!projection) {
    return "";
  }

  const summary = entityKey === "characters"
    ? getCharacterProgressSummary(projection)
    : getSupportProgressSummary(projection);

  return `
    <div class="result-card-progress">
      <div class="result-card-progress-top">
        <div class="result-card-overall-track">
          <span style="width:${Math.round(summary.overallRatio * 100)}%"></span>
        </div>
        <span class="result-card-overall-value">${Math.round(summary.overallRatio * 100)}%</span>
      </div>
      <div class="result-card-progress-grid">
        ${summary.metrics.map((metric) => renderProgressMetric(metric.label, metric.display, metric.ratio, metric.tone)).join("")}
      </div>
    </div>
  `;
}

export function renderRosterProgressHero(entityKey, projection) {
  if (!projection) {
    return "";
  }

  const summary = entityKey === "characters"
    ? getCharacterProgressSummary(projection)
    : getSupportProgressSummary(projection);

  const statePills = entityKey === "characters"
    ? `
      ${renderStatePill("Progress", projection.progress_bucket || "-", "neutral")}
      ${renderStatePill("Unlock State", projection.unlock_state || "-", projection.unlock_state === "full" ? "green" : projection.unlock_state === "partial" ? "amber" : "neutral")}
    `
    : `
      ${renderStatePill("Progress", projection.progress_bucket || "-", "neutral")}
      ${renderStatePill("Usable", projection.usable ? "Yes" : "No", projection.usable ? "green" : "neutral")}
    `;

  return `
    <div class="roster-progress-hero">
      <div class="roster-progress-hero-top">
        <div>
          <p class="meta-eyebrow">Progress Overview</p>
          <strong>${Math.round(summary.overallRatio * 100)}% ready</strong>
        </div>
        <div class="state-pill-row">
          ${statePills}
        </div>
      </div>
      <div class="roster-progress-hero-track">
        <span style="width:${Math.round(summary.overallRatio * 100)}%"></span>
      </div>
      <div class="roster-progress-hero-grid">
        ${summary.metrics.map((metric) => renderProgressMetric(metric.label, metric.display, metric.ratio, metric.tone)).join("")}
      </div>
    </div>
  `;
}

export function renderCharacterRosterProjection(projection) {
  if (!projection) {
    return "";
  }

  return `
    <div class="detail-section roster-derived-section">
      <h3>Unlocked Awakening Skills</h3>
      ${renderLinkedSkillList(projection.unlocked_awakening_skills)}
      <h4>Locked Awakening Skills</h4>
      ${renderLinkedSkillList(projection.locked_awakening_skills)}
    </div>
  `;
}

export function renderSupportRosterProjection(projection) {
  if (!projection) {
    return "";
  }

  return `
    <div class="detail-section roster-derived-section">
      <h3>Unique Effects At Current State</h3>
      ${tableFromRows(
        asArray(projection.effective_unique_effects).map((effect) => [
          effect.name || `Effect #${effect.effect_id}`,
          escapeHtml(`${effect.unlocked ? "Unlocked" : "Locked"} | ${effect.value ?? "-"}`),
        ]),
      )}
    </div>
  `;
}


export function renderRosterLocalNotes(entry) {
  return `
    <details class="roster-collapsible">
      <summary>Local notes and organization</summary>
      <div class="roster-collapsible-body">
        <label class="field-stack field-stack-full">
          <span>Local Tags</span>
          <input name="custom_tags" type="text" placeholder="comma, separated, tags" value="${escapeHtml(asArray(entry.custom_tags).join(", "))}">
        </label>
        <label class="field-stack field-stack-full">
          <span>Status Flags</span>
          <input name="status_flags" type="text" placeholder="ready, farming, candidate" value="${escapeHtml(asArray(entry.status_flags).join(", "))}">
        </label>
        <label class="field-stack field-stack-full">
          <span>Note</span>
          <textarea name="note" rows="4" placeholder="Optional local note">${escapeHtml(entry.note || "")}</textarea>
        </label>
      </div>
    </details>
  `;
}


export function getDefaultRosterEntry(entityKey, item) {
  if (entityKey === "characters") {
    return {
      owned: false,
      favorite: false,
      note: "",
      stars: Number(item?.detail?.rarity) || 0,
      awakening: 0,
      unique_level: 1,
      custom_tags: [],
      status_flags: [],
    };
  }

  if (entityKey === "supports") {
    return {
      owned: false,
      favorite: false,
      note: "",
      level: 1,
      limit_break: 0,
      custom_tags: [],
      status_flags: [],
    };
  }

  return {
    owned: false,
    favorite: false,
    note: "",
  };
}

export function getRosterEntry(entityKey, item) {
  const defaultEntry = getDefaultRosterEntry(entityKey, item);
  const bucket = state.rosterDocument?.[entityKey] || {};
  return {
    ...defaultEntry,
    ...(bucket[item.id] || {}),
  };
}

export function pruneRosterEntry(entityKey, item, entry) {
  const defaults = getDefaultRosterEntry(entityKey, item);
  const pruned = {};

  Object.keys(defaults).forEach((key) => {
    const value = entry[key];
    const defaultValue = defaults[key];
    if (Array.isArray(value)) {
      if (JSON.stringify(value) !== JSON.stringify(defaultValue)) {
        pruned[key] = value;
      }
      return;
    }
    if (typeof value === "string") {
      if (value !== defaultValue) {
        pruned[key] = value;
      }
      return;
    }
    if (value !== defaultValue) {
      pruned[key] = value;
    }
  });

  return Object.keys(pruned).length ? pruned : null;
}

export function setRosterEntry(entityKey, item, nextEntry) {
  const bucket = { ...(state.rosterDocument[entityKey] || {}) };
  const pruned = pruneRosterEntry(entityKey, item, nextEntry);

  if (pruned) {
    bucket[item.id] = pruned;
  } else {
    delete bucket[item.id];
  }

  state.rosterDocument = {
    ...state.rosterDocument,
    [entityKey]: bucket,
  };
}

export function getRosterBadges(entityKey, item, mode) {
  if (!rosterEntityKeys.includes(entityKey) || !state.activeProfileId) {
    return [];
  }

  if (entityKey === buildsEntityKey) {
    const entry = item?.detail?.entry || {};
    const labels = item?.detail?.labels || {};
    return [labels.status, labels.mode, ...asArray(entry.custom_tags).slice(0, 3)].filter(Boolean);
  }

  if (entityKey === legacyEntityKey) {
    const entry = item?.detail?.entry || {};
    const badges = [];
    if (entry.scenario_name) {
      badges.push(entry.scenario_name);
    }
    asArray(entry.custom_tags).slice(0, 2).forEach((tag) => badges.push(tag));
    asArray(entry.status_flags).slice(0, 2).forEach((flag) => badges.push(flag));
    return badges;
  }

  const entry = getRosterEntry(entityKey, item);
  const badges = [];

  if (entry.owned) {
    badges.push("Owned");
  }
  if (entry.favorite) {
    badges.push("Favorite");
  }
  if (entry.note) {
    badges.push("Note");
  }

  if (mode === "roster") {
  }

  asArray(entry.custom_tags).slice(0, 2).forEach((tag) => badges.push(tag));
  asArray(entry.status_flags).slice(0, 2).forEach((flag) => badges.push(flag));

  return badges;
}

export function rosterCountForEntity(entityKey, predicate) {
  if (entityKey === buildsEntityKey) {
    return data.entities[entityKey].items.length;
  }
  return data.entities[entityKey].items.reduce((count, item) => {
    return predicate(getRosterEntry(entityKey, item), item) ? count + 1 : count;
  }, 0);
}

export function getRosterFilterOptions(entityKey, filterKey) {
  if (filterKey === "_roster_favorite") {
    return [{ value: "yes", label: "Only favorites", count: rosterCountForEntity(entityKey, (entry) => entry.favorite) }];
  }
  if (filterKey === "_roster_note") {
    return [{ value: "yes", label: "Has note", count: rosterCountForEntity(entityKey, (entry) => Boolean(entry.note?.trim())) }];
  }
  if (filterKey === "_roster_tag") {
    return buildRosterValueOptions(entityKey, (viewEntry) => viewEntry?.derived?.custom_tags);
  }
  if (filterKey === "_roster_status") {
    return buildRosterValueOptions(entityKey, (viewEntry) => viewEntry?.derived?.status_flags);
  }
  if (filterKey === "_roster_progress") {
    return buildRosterValueOptions(entityKey, (viewEntry) => viewEntry?.derived?.progress_bucket, {
      labelMap: {
        base: "Base",
        started: "Started",
        advanced: "Advanced",
        maxed: "Maxed",
        starter: "Starter",
        developing: "Developing",
        usable: "Usable",
      },
    });
  }
  if (filterKey === "_roster_unlock" && entityKey === "characters") {
    return buildRosterValueOptions(entityKey, (viewEntry) => viewEntry?.derived?.unlock_state, {
      labelMap: { none: "No unlock", partial: "Partial", full: "Full" },
    });
  }
  if (filterKey === "_roster_usable" && entityKey === "supports") {
    return [
      { value: "yes", label: "Usable", count: rosterCountForEntity(entityKey, (_entry, item) => Boolean(getRosterViewEntry(entityKey, item)?.derived?.usable)) },
    ];
  }
  return [];
}

export function buildRosterValueOptions(entityKey, selector, options = {}) {
  const counts = new Map();
  const payload = getRosterViewPayload(entityKey);
  Object.values(payload.entries || {}).forEach((viewEntry) => {
    asArray(selector(viewEntry)).forEach((value) => {
      const key = String(value || "").trim();
      if (!key) {
        return;
      }
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([value, count]) => ({
      value,
      label: options.labelMap?.[value] || value,
      count,
    }));
}

export function getRosterFilterDefinitions(entityKey) {
  if (entityKey === legacyEntityKey || entityKey === buildsEntityKey) {
    return [];
  }
  const definitions = [...rosterFilterDefinitionsBase];
  if (entityKey === "characters") {
    definitions.push({ key: "_roster_unlock", label: "Unlock state" });
  }
  if (entityKey === "supports") {
    definitions.push({ key: "_roster_usable", label: "Usable" });
  }
  return definitions;
}


export function renderBatchList(entityKey, filteredItems) {
  if (!filteredItems.length) {
    listEl.innerHTML = "<div class='empty-state'>No owned entry matches the current roster search and filters.</div>";
    return;
  }

  listEl.innerHTML = filteredItems.map((item) => {
    const entry = getRosterEntry(entityKey, item);
    return `
      <article class="batch-card" data-batch-row="${escapeHtml(item.id)}">
        <div class="batch-card-head">
          <button type="button" class="batch-open-button" data-open-item="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>
          <div class="batch-row-subtitle">${escapeHtml(item.subtitle || "")}</div>
        </div>
        <div class="batch-card-fields">
          ${entityKey === "characters"
            ? `
              <label><span>Stars</span><input data-batch-field="stars" type="number" min="0" max="5" value="${escapeHtml(entry.stars)}"></label>
              <label><span>Awk</span><input data-batch-field="awakening" type="number" min="0" max="5" value="${escapeHtml(entry.awakening)}"></label>
              <label><span>Unique</span><input data-batch-field="unique_level" type="number" min="1" max="6" value="${escapeHtml(entry.unique_level || 1)}"></label>
            `
            : `
              <label><span>Level</span><input data-batch-field="level" type="number" min="1" max="${escapeHtml(getSupportEntryLevelCap(item, entry.limit_break))}" value="${escapeHtml(entry.level)}"></label>
              <label><span>LB</span><input data-batch-field="limit_break" type="number" min="0" max="4" value="${escapeHtml(entry.limit_break)}"></label>
            `}
        </div>
        <div class="batch-meta-stack">
          <input data-batch-field="custom_tags" type="text" value="${escapeHtml(asArray(entry.custom_tags).join(", "))}" placeholder="tags">
          <input data-batch-field="status_flags" type="text" value="${escapeHtml(asArray(entry.status_flags).join(", "))}" placeholder="status flags">
        </div>
      </article>
    `;
  }).join("");

  listEl.querySelectorAll("[data-open-item]").forEach((button) => {
    button.addEventListener("click", () => {
      getViewState("roster", entityKey).presentation = "detail";
      setBrowseHash("roster", entityKey, button.dataset.openItem);
    });
  });

  if (entityKey === "supports") {
    listEl.querySelectorAll("[data-batch-row]").forEach((row) => {
      const item = filteredItems.find((entry) => String(entry.id) === String(row.dataset.batchRow));
      const lbInput = row.querySelector('[data-batch-field="limit_break"]');
      const levelInput = row.querySelector('[data-batch-field="level"]');
      if (!item || !lbInput || !levelInput) {
        return;
      }
      const syncLevelCap = () => {
        const limitBreak = clampNumber(lbInput.value, 0, 4, 0);
        const levelCap = getSupportEntryLevelCap(item, limitBreak);
        levelInput.max = String(levelCap);
        if (Number(levelInput.value) > levelCap) {
          levelInput.value = String(levelCap);
        }
      };
      lbInput.addEventListener("input", syncLevelCap);
      lbInput.addEventListener("change", syncLevelCap);
    });
  }
}

export function collectBatchRowData(entityKey, item, row) {
  const defaults = getDefaultRosterEntry(entityKey, item);
  const currentEntry = getRosterEntry(entityKey, item);
  const baseEntry = {
    owned: true,
    favorite: currentEntry.favorite || false,
    note: currentEntry.note || "",
    custom_tags: parseRosterTokenList(row.querySelector('[data-batch-field="custom_tags"]')?.value),
    status_flags: parseRosterTokenList(row.querySelector('[data-batch-field="status_flags"]')?.value),
  };

  if (entityKey === "characters") {
    return {
      ...baseEntry,
      stars: clampNumber(row.querySelector('[data-batch-field="stars"]')?.value, 0, 5, defaults.stars),
      awakening: clampNumber(row.querySelector('[data-batch-field="awakening"]')?.value, 0, 5, defaults.awakening),
      unique_level: clampNumber(row.querySelector('[data-batch-field="unique_level"]')?.value, 1, 6, defaults.unique_level || 1),
    };
  }

  return {
    ...baseEntry,
    limit_break: clampNumber(row.querySelector('[data-batch-field="limit_break"]')?.value, 0, 4, defaults.limit_break),
    level: clampNumber(
      row.querySelector('[data-batch-field="level"]')?.value,
      1,
      getSupportEntryLevelCap(
        item,
        clampNumber(row.querySelector('[data-batch-field="limit_break"]')?.value, 0, 4, defaults.limit_break),
      ),
      defaults.level,
    ),
  };
}

export async function saveVisibleBatchRows(entityKey, filteredItems) {
  const rows = Array.from(listEl.querySelectorAll("[data-batch-row]"));
  let savedCount = 0;
  rows.forEach((row) => {
    const item = filteredItems.find((entry) => String(entry.id) === String(row.dataset.batchRow));
    if (!item) {
      return;
    }
    setRosterEntry(entityKey, item, collectBatchRowData(entityKey, item, row));
    savedCount += 1;
  });
  if (!savedCount) {
    return;
  }
  await persistRosterDocument(`Saved ${savedCount} visible roster entries.`);
  showAppToast(`${savedCount} visible entries saved. You can leave batch mode.`, "success");
}


export function renderReferenceRosterActions(entityKey, item) {
  if (!rosterEntityKeys.includes(entityKey) || !state.activeProfileId) {
    return "";
  }

  const entry = getRosterEntry(entityKey, item);
  return `
    <div class="detail-section roster-section">
      <h3>${entry.owned ? "Owned Entry" : "Add to My Roster"}</h3>
      <p class="source-note">
        ${entry.owned
          ? "This entry is already in your roster. Remove it here if you no longer own it."
          : "Add this entry to your roster, then switch to My Roster to edit notes and progression."}
      </p>
      <div class="roster-actions">
        ${entry.owned
          ? `<button type="button" class="button-secondary" id="removeFromRosterButton">Remove from roster</button>`
          : `<button type="button" class="button-strong" id="addToRosterButton">Add to roster</button>`}
      </div>
    </div>
  `;
}

export function renderRosterEditor(entityKey, item) {
  if (!rosterEntityKeys.includes(entityKey) || !state.activeProfileId) {
    return "";
  }

  const entry = getRosterEntry(entityKey, item);
  const viewEntry = getRosterViewEntry(entityKey, item);
  const derived = viewEntry?.derived || null;
  const statusText = state.rosterStatus.message || "Changes are stored locally for the active profile.";
  const progressFields = entityKey === "characters"
    ? `
      <label class="field-stack">
        <span>Stars</span>
        <input name="stars" type="number" min="0" max="5" value="${escapeHtml(entry.stars)}">
      </label>
      <label class="field-stack">
        <span>Awakening</span>
        <input name="awakening" type="number" min="0" max="5" value="${escapeHtml(entry.awakening)}">
      </label>
      <label class="field-stack">
        <span>Unique Level</span>
        <input name="unique_level" type="number" min="1" max="6" value="${escapeHtml(entry.unique_level || 1)}">
      </label>
    `
    : `
      <label class="field-stack">
        <span>Level</span>
        <input name="level" type="number" min="1" max="${escapeHtml(getSupportEntryLevelCap(item, entry.limit_break))}" value="${escapeHtml(entry.level)}">
      </label>
      <label class="field-stack">
        <span>Limit break</span>
        <input name="limit_break" type="number" min="0" max="4" value="${escapeHtml(entry.limit_break)}">
      </label>
    `;

  return `
    <div class="detail-section roster-section">
      <h3>Roster</h3>
      <p class="source-note">Editing the owned roster entry for <strong>${escapeHtml(getActiveProfile()?.name || "selected profile")}</strong>.</p>
      ${derived ? `
        <div class="roster-editor-highlight">
          <h4>Current Progression</h4>
          ${renderRosterProgressHero(entityKey, derived)}
          <div class="roster-editor-meta-grid">
            ${entityKey === "characters"
              ? `
                <div class="admin-meta-card"><span class="meta-label">Stars</span><strong>${escapeHtml(derived.stars || 0)}</strong></div>
                <div class="admin-meta-card"><span class="meta-label">Awakening</span><strong>${escapeHtml(derived.awakening || 0)}</strong></div>
                <div class="admin-meta-card"><span class="meta-label">Unique</span><strong>${escapeHtml(`U${derived.unique_level || 1}`)}</strong></div>
              `
              : `
                <div class="admin-meta-card"><span class="meta-label">Level</span><strong>${escapeHtml(`${derived.level || 1}/${derived.level_cap || "-"}`)}</strong></div>
                <div class="admin-meta-card"><span class="meta-label">Limit Break</span><strong>${escapeHtml(`${derived.limit_break || 0}/4`)}</strong></div>
                <div class="admin-meta-card"><span class="meta-label">EXP</span><strong>${escapeHtml(`${derived.total_exp ?? "-"} / ${derived.cap_total_exp ?? "-"}`)}</strong></div>
              `}
          </div>
        </div>
      ` : ""}
      <form id="rosterForm" class="roster-form" data-item-id="${escapeHtml(item.id)}" data-entity-key="${escapeHtml(entityKey)}">
        <div class="roster-toggle-row">
          <label class="toggle-field">
            <input name="favorite" type="checkbox" ${entry.favorite ? "checked" : ""}>
            <span>Favorite</span>
          </label>
        </div>
        <div class="roster-field-grid">
          ${progressFields}
        </div>
        ${renderRosterLocalNotes(entry)}
        <div class="roster-actions">
          <button type="submit" class="button-strong">Save locally</button>
          <button type="button" class="button-secondary" id="removeFromRosterButton">Remove from roster</button>
          <button type="button" class="button-secondary" id="rosterResetButton">Reset entry</button>
        </div>
        <p id="rosterStatus" class="source-note ${state.rosterStatus.kind === "error" ? "error-text" : ""}">${escapeHtml(statusText)}</p>
      </form>
    </div>
  `;
}


export function attachRosterFormListeners(entityKey, item) {
  const rosterForm = document.getElementById("rosterForm");
  if (!rosterForm) {
    return;
  }

  rosterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveRosterForm(entityKey, item, rosterForm);
  });

  const removeButton = document.getElementById("removeFromRosterButton");
  if (removeButton) {
    removeButton.addEventListener("click", async () => {
      await removeItemFromRoster(entityKey, item);
    });
  }

  const resetButton = document.getElementById("rosterResetButton");
  if (resetButton) {
    resetButton.addEventListener("click", async () => {
      await resetRosterEntry(entityKey, item);
    });
  }
}


export function collectRosterFormData(entityKey, item, formEl) {
  const defaults = getDefaultRosterEntry(entityKey, item);
  const formData = new FormData(formEl);
  const note = String(formData.get("note") || "").trim();
  const baseEntry = {
    owned: true,
    favorite: formData.get("favorite") === "on",
    note,
    custom_tags: parseRosterTokenList(formData.get("custom_tags")),
    status_flags: parseRosterTokenList(formData.get("status_flags")),
  };

  if (entityKey === "characters") {
    return {
      ...baseEntry,
      stars: clampNumber(formData.get("stars"), 0, 5, defaults.stars),
      awakening: clampNumber(formData.get("awakening"), 0, 5, defaults.awakening),
      unique_level: clampNumber(formData.get("unique_level"), 1, 6, defaults.unique_level || 1),
    };
  }

  return {
    ...baseEntry,
    level: clampNumber(formData.get("level"), 1, 50, defaults.level),
    limit_break: clampNumber(formData.get("limit_break"), 0, 4, defaults.limit_break),
  };
}
