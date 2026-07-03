// Auto-split from app.js as part of docs/REFACTOR_PLAN.md.
import { LEGACY_DISTANCE_OPTIONS, LEGACY_KIND_LABELS, LEGACY_PINK_KIND_OPTIONS, LEGACY_RATING_OPTIONS, LEGACY_SCENARIO_FALLBACK_OPTIONS, LEGACY_STAT_OPTIONS, LEGACY_STYLE_OPTIONS, LEGACY_SURFACE_OPTIONS, LEGACY_WHITE_KIND_OPTIONS, asArray, buildsEntityKey, createEmptyLegacyEditorState, createEmptyLegacyRelativeState, data, detailEl, getAllCharacterOptions, getEntityItems, getOwnedCharacterOptions, legacyEntityKey, listEl, setBrowseHash, state } from "./core.js";
import { clampNumber, escapeHtml, getPrimaryMedia, parseRosterTokenList, renderBadge, renderImageAsset, renderReferenceList, renderSimpleList, tableFromRows } from "./dom-utils.js";
import { getRosterEntry } from "./roster.js";
import { collectBuildPayload } from "./builds.js";
import { loadBuildsForProfile, loadLegacyForProfile } from "./admin.js";
import { apiJson, requestRender, requestRenderPreservingScroll, requestRenderPreservingScrollAndFocus } from "../app.js";


export function getLegacyCharacterOptions(selectedCharacterCardId) {
  const optionsById = new Map(
    getAllCharacterOptions()
      .filter((option) => option.availabilityEn === "available")
      .map((option) => [String(option.value), option]),
  );
  const selectedId = String(selectedCharacterCardId || "").trim();
  if (selectedId && !optionsById.has(selectedId)) {
    const item = getCharacterReferenceItem(selectedId);
    if (item) {
      const label = item.subtitle ? `${item.title} ${item.subtitle}` : item.title;
      optionsById.set(selectedId, {
        value: selectedId,
        label,
        availabilityEn: String(item.filters?.availability_en || "").toLowerCase(),
        owned: false,
      });
    }
  }
  return Array.from(optionsById.values()).sort((left, right) => left.label.localeCompare(right.label));
}

export function getCharacterReferenceItem(characterCardId) {
  return getEntityItems("characters").find((item) => String(item.id) === String(characterCardId)) || null;
}

export function getCharacterBaseRarity(characterCardId) {
  return Number(getCharacterReferenceItem(characterCardId)?.detail?.rarity) || 0;
}

export function getCharacterRosterDefaults(characterCardId) {
  const item = getCharacterReferenceItem(characterCardId);
  const entry = item ? getRosterEntry("characters", item) : null;
  const isOwned = Boolean(entry?.owned);
  return {
    stars: isOwned
      ? clampNumber(entry?.stars, 0, 5, Number(item?.detail?.rarity) || 0)
      : (Number(item?.detail?.rarity) || 0),
    awakening: isOwned ? clampNumber(entry?.awakening, 0, 5, 0) : 0,
  };
}

export function getCharacterUniqueSkill(characterCardId) {
  const item = getCharacterReferenceItem(characterCardId);
  const uniqueSkill = asArray(item?.detail?.skill_links?.unique)[0];
  return uniqueSkill && uniqueSkill.id ? uniqueSkill : null;
}

export function characterSupportsGreenSpark(characterCardId, starsOverride = null) {
  const resolvedStars = starsOverride == null
    ? getCharacterBaseRarity(characterCardId)
    : clampNumber(starsOverride, 0, 5, 0);
  return resolvedStars >= 3 && Boolean(getCharacterUniqueSkill(characterCardId));
}

export function getLegacyScenarioOptions() {
  const dynamicOptions = getEntityItems("scenarios").map((item) => ({
    value: String(item.detail?.scenario_id || item.id),
    label: item.title,
  }));
  return dynamicOptions.length ? dynamicOptions : LEGACY_SCENARIO_FALLBACK_OPTIONS;
}

export function getLegacyScenarioLabel(scenarioId) {
  const selectedId = String(scenarioId || "").trim();
  if (!selectedId) {
    return "";
  }
  return getLegacyScenarioOptions().find((option) => option.value === selectedId)?.label || selectedId;
}

export function getLegacyFactorTargetOptions(kind) {
  if (kind === "stat") return LEGACY_STAT_OPTIONS;
  if (kind === "surface") return LEGACY_SURFACE_OPTIONS;
  if (kind === "distance") return LEGACY_DISTANCE_OPTIONS;
  if (kind === "style") return LEGACY_STYLE_OPTIONS;
  if (kind === "scenario") {
    return getLegacyScenarioOptions();
  }
  if (kind === "g1") {
    return getEntityItems("g1_factors").map((item) => ({
      value: String(item.detail?.factor_id || item.id),
      label: item.title,
    }));
  }
  if (kind === "skill") {
    return getEntityItems("skills")
      .filter((item) => {
        const title = String(item.title || "").trim();
        const rarity = String(item.detail?.rarity || "").toLowerCase();
        const isUnique =
          rarity === "unique" ||
          Boolean(item.detail?.is_unique) ||
          asArray(item.badges).some((badge) => String(badge || "").toLowerCase() === "unique");
        const isNegative = /[×◎]$/i.test(title);
        const isTechnicalSkillFactor = /^skill\s*:/i.test(title);
        return !isUnique && !isNegative && !isTechnicalSkillFactor;
      })
      .map((item) => ({
        value: String(item.detail?.skill_id || item.id),
        label: item.title,
      }));
  }
  return [];
}

export function getFilteredLegacyTargetOptions(kind, query, selectedValue) {
  const allOptions = getLegacyFactorTargetOptions(kind);
  const normalizedQuery = String(query || "").trim().toLowerCase();
  let visibleOptions = normalizedQuery
    ? allOptions.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery))
    : allOptions;

  const defaultLimit = kind === "skill" ? 120 : kind === "g1" ? 150 : null;
  const isLimited = !normalizedQuery && defaultLimit && visibleOptions.length > defaultLimit;
  if (isLimited) {
    visibleOptions = visibleOptions.slice(0, defaultLimit);
  }

  if (selectedValue && !visibleOptions.some((option) => option.value === selectedValue)) {
    const selectedOption = allOptions.find((option) => option.value === selectedValue);
    if (selectedOption) {
      visibleOptions = [selectedOption, ...visibleOptions];
    }
  }

  return {
    allOptions,
    options: visibleOptions,
    totalCount: allOptions.length,
    visibleCount: visibleOptions.length,
    isLimited: Boolean(isLimited),
    hasQuery: Boolean(normalizedQuery),
  };
}

export function renderLegacyTargetOptions(options, selectedValue) {
  return options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}" ${option.value === selectedValue ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");
}

export function formatLegacyFactorLabel(factor) {
  if (!factor) {
    return "-";
  }
  const stars = Number(factor.stars) || 0;
  return `${factor.target_label || factor.target_key} ${"\u2605".repeat(Math.max(0, Math.min(3, stars)))}`;
}


export function deriveLegacyWhiteSparks(entry) {
  const structuredWhiteSparks = asArray(entry?.white_sparks).filter((spark) => spark && spark.kind);
  if (structuredWhiteSparks.length) {
    return structuredWhiteSparks.map((spark) => ({ ...spark }));
  }
  return asArray(entry?.factors)
    .filter((factor) => factor && ["scenario", "g1", "skill"].includes(factor.kind))
    .map((factor) => ({ ...factor }));
}

export function deriveLegacyGrandparentEntry(entry, slotKey) {
  const grandparents = entry?.grandparents;
  if (!grandparents || typeof grandparents !== "object") {
    return null;
  }
  const grandparent = grandparents[slotKey];
  return grandparent && typeof grandparent === "object" ? grandparent : null;
}

export function createLegacyRelativeStateFromEntry(entry) {
  const nextState = createEmptyLegacyRelativeState();
  const characterCardId = String(entry?.character_card_id || "");
  const blueSpark = entry?.blue_spark || asArray(entry?.factors).find((factor) => factor?.kind === "stat") || null;
  const pinkSpark = entry?.pink_spark || asArray(entry?.factors).find((factor) => ["surface", "distance", "style"].includes(factor?.kind)) || null;
  const greenSpark = entry?.green_spark || null;
  const whiteSparks = deriveLegacyWhiteSparks(entry);

  nextState.characterCardId = characterCardId;
  nextState.blueTargetKey = blueSpark?.target_key || "speed";
  nextState.blueStars = clampNumber(blueSpark?.stars, 1, 3, 3);
  nextState.pinkKind = pinkSpark?.kind || "surface";
  nextState.pinkTargetKey = pinkSpark?.target_key || (nextState.pinkKind === "distance" ? "mile" : nextState.pinkKind === "style" ? "leader" : "turf");
  nextState.pinkQuery = "";
  nextState.pinkStars = clampNumber(pinkSpark?.stars, 1, 3, 3);
  nextState.greenEnabled = Boolean(greenSpark);
  nextState.greenStars = clampNumber(greenSpark?.stars, 1, 3, 3);
  nextState.whiteSparks = whiteSparks;
  nextState.whiteKind = whiteSparks[0]?.kind || "skill";
  nextState.whiteStars = clampNumber(whiteSparks[0]?.stars, 1, 3, 3);
  const whiteOptions = getLegacyFactorTargetOptions(nextState.whiteKind);
  nextState.whiteTargetKey = whiteSparks[0]?.target_key && whiteOptions.some((option) => option.value === whiteSparks[0].target_key)
    ? whiteSparks[0].target_key
    : (whiteOptions[0]?.value || "");
  nextState.whiteQuery = "";
  return nextState;
}

export function getLegacyEditorSparkState(slotKey) {
  if (slotKey === "left" || slotKey === "right") {
    return state.legacyEditor.grandparents?.[slotKey] || createEmptyLegacyRelativeState();
  }
  return state.legacyEditor;
}

export function updateLegacyEditorSparkState(slotKey, updater) {
  if (slotKey === "left" || slotKey === "right") {
    const currentState = state.legacyEditor.grandparents?.[slotKey] || createEmptyLegacyRelativeState();
    const nextState = typeof updater === "function" ? updater({ ...currentState }) : currentState;
    state.legacyEditor.grandparents = {
      ...(state.legacyEditor.grandparents || {}),
      [slotKey]: nextState,
    };
    return;
  }
  state.legacyEditor = typeof updater === "function" ? updater(state.legacyEditor) : state.legacyEditor;
}

export function createLegacyEditorStateFromEntry(entry, targetKey) {
  const nextState = createEmptyLegacyEditorState();
  const fallbackCharacterId = getLegacyCharacterOptions("")[0]?.value || "";
  const characterCardId = String(entry?.character_card_id || fallbackCharacterId || "");
  const blueSpark = entry?.blue_spark || asArray(entry?.factors).find((factor) => factor?.kind === "stat") || null;
  const pinkSpark = entry?.pink_spark || asArray(entry?.factors).find((factor) => ["surface", "distance", "style"].includes(factor?.kind)) || null;
  const greenSpark = entry?.green_spark || null;
  const whiteSparks = deriveLegacyWhiteSparks(entry);

  nextState.targetKey = targetKey;
  nextState.characterCardId = characterCardId;
  nextState.blueTargetKey = blueSpark?.target_key || "speed";
  nextState.blueStars = clampNumber(blueSpark?.stars, 1, 3, 3);
  nextState.pinkKind = pinkSpark?.kind || "surface";
  nextState.pinkTargetKey = pinkSpark?.target_key || (nextState.pinkKind === "distance" ? "mile" : nextState.pinkKind === "style" ? "leader" : "turf");
  nextState.pinkQuery = "";
  nextState.pinkStars = clampNumber(pinkSpark?.stars, 1, 3, 3);
  nextState.greenEnabled = Boolean(greenSpark);
  nextState.greenStars = clampNumber(greenSpark?.stars, 1, 3, 3);
  nextState.whiteSparks = whiteSparks;
  nextState.whiteKind = whiteSparks[0]?.kind || "skill";
  nextState.whiteStars = clampNumber(whiteSparks[0]?.stars, 1, 3, 3);
  const whiteOptions = getLegacyFactorTargetOptions(nextState.whiteKind);
  nextState.whiteTargetKey = whiteSparks[0]?.target_key && whiteOptions.some((option) => option.value === whiteSparks[0].target_key)
    ? whiteSparks[0].target_key
    : (whiteOptions[0]?.value || "");
  nextState.whiteQuery = "";
  nextState.grandparents = {
    left: createLegacyRelativeStateFromEntry(deriveLegacyGrandparentEntry(entry, "left")),
    right: createLegacyRelativeStateFromEntry(deriveLegacyGrandparentEntry(entry, "right")),
  };
  return nextState;
}

export function ensureLegacyEditorState(entry, targetKey) {
  if (state.legacyEditor.targetKey === targetKey) {
    return;
  }
  state.legacyEditor = createLegacyEditorStateFromEntry(entry, targetKey);
  if (targetKey === "__new__") {
    state.legacyCreateStep = 1;
  }
  state.legacyFormDraft = null;
}

export function captureLegacyFormDraft() {
  const legacyForm = document.getElementById("legacyForm");
  if (!legacyForm) {
    return;
  }
  const formData = new FormData(legacyForm);
  const previousDraft = state.legacyFormDraft || {};
  const readField = (name) => (
    formData.has(name)
      ? String(formData.get(name) || "").trim()
      : String(previousDraft[name] || "")
  );
  state.legacyFormDraft = {
    scenario_id: readField("scenario_id"),
    rating: readField("rating"),
    custom_tags: readField("custom_tags"),
    status_flags: readField("status_flags"),
    gp_left_scenario_id: readField("gp_left_scenario_id"),
    gp_left_rating: readField("gp_left_rating"),
    gp_right_scenario_id: readField("gp_right_scenario_id"),
    gp_right_rating: readField("gp_right_rating"),
  };
}

export function renderLegacySparkList(sparks, emptyText, removable, slotKey = "main") {
  const items = asArray(sparks).filter((spark) => spark && spark.kind);
  if (!items.length) {
    return `<p class="source-note">${escapeHtml(emptyText)}</p>`;
  }
  return `
    <div class="legacy-factor-editor-list">
      ${items.map((spark, index) => `
        <div class="legacy-factor-chip-row">
          <span>${escapeHtml(LEGACY_KIND_LABELS[spark.kind] || spark.kind)}</span>
          ${renderBadge(formatLegacyFactorLabel(spark))}
          ${removable ? `<button type="button" class="button-secondary button-compact" data-legacy-white-remove="${escapeHtml(index)}" data-legacy-slot="${escapeHtml(slotKey)}">Remove</button>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

export function renderLegacySparkEditor(slotKey, currentCharacterStars) {
  const sparkState = getLegacyEditorSparkState(slotKey);
  const idPrefix = slotKey === "left" ? "legacyGpLeft" : slotKey === "right" ? "legacyGpRight" : "legacyMain";
  const pinkTargetOptions = getFilteredLegacyTargetOptions(
    sparkState.pinkKind,
    sparkState.pinkQuery,
    sparkState.pinkTargetKey,
  );
  const whiteTargetOptions = getFilteredLegacyTargetOptions(
    sparkState.whiteKind,
    sparkState.whiteQuery,
    sparkState.whiteTargetKey,
  );
  const greenAvailable = characterSupportsGreenSpark(sparkState.characterCardId, currentCharacterStars);
  const uniqueSkill = getCharacterUniqueSkill(sparkState.characterCardId);

  return `
    <div class="legacy-factor-editor">
      <div class="legacy-spark-card">
        <h4>Blue Spark</h4>
        <p class="source-note">Exactly one blue spark. This should be a stat spark.</p>
        <div class="legacy-factor-adder">
          <label class="field-stack">
            <span>Stat</span>
            <select id="${idPrefix}BlueTarget">
              ${LEGACY_STAT_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === sparkState.blueTargetKey ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
          <label class="field-stack">
            <span>Stars</span>
            <select id="${idPrefix}BlueStars">
              ${[1, 2, 3].map((value) => `<option value="${value}" ${value === sparkState.blueStars ? "selected" : ""}>${value}\u2605</option>`).join("")}
            </select>
          </label>
        </div>
      </div>
      <div class="legacy-spark-card">
        <h4>Pink Spark</h4>
        <p class="source-note">Exactly one pink spark. It can be a surface, distance or strategy spark.</p>
        <div class="legacy-factor-adder">
          <label class="field-stack">
            <span>Category</span>
            <select id="${idPrefix}PinkKind">
              ${LEGACY_PINK_KIND_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === sparkState.pinkKind ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
          <label class="field-stack field-stack-search">
            <span>Spark</span>
            <select id="${idPrefix}PinkTarget" class="legacy-themed-select">
              ${renderLegacyTargetOptions(pinkTargetOptions.options, sparkState.pinkTargetKey)}
            </select>
            <small class="legacy-select-meta">${escapeHtml(
              `${pinkTargetOptions.totalCount} option(s)`,
            )}</small>
          </label>
          <label class="field-stack">
            <span>Stars</span>
            <select id="${idPrefix}PinkStars">
              ${[1, 2, 3].map((value) => `<option value="${value}" ${value === sparkState.pinkStars ? "selected" : ""}>${value}\u2605</option>`).join("")}
            </select>
          </label>
        </div>
      </div>
      <div class="legacy-spark-card">
        <h4>Green Spark</h4>
        <p class="source-note">Available only when this lineage slot starts at 3-star or higher.</p>
        ${greenAvailable && uniqueSkill
          ? `
            <div class="legacy-factor-adder legacy-factor-adder-green">
              <div class="field-stack legacy-static-field">
                <span>Spark</span>
                <div class="legacy-static-value">
                  ${renderBadge(uniqueSkill.name)}
                </div>
              </div>
              <label class="field-stack">
                <span>Stars</span>
                <select id="${idPrefix}GreenStars">
                  ${[1, 2, 3].map((value) => `<option value="${value}" ${value === sparkState.greenStars ? "selected" : ""}>${value}\u2605</option>`).join("")}
                </select>
              </label>
            </div>
          `
          : "<p class='source-note'>Green spark unavailable for the currently selected character and star level.</p>"}
      </div>
      <div class="legacy-spark-card">
        <h4>White Sparks</h4>
        <p class="source-note">Optional. Use these for scenario, G1/race and general skill sparks.</p>
        ${renderLegacySparkList(sparkState.whiteSparks, "No local white sparks recorded yet.", true, slotKey)}
        <div class="legacy-factor-adder">
          <label class="field-stack">
            <span>Category</span>
            <select id="${idPrefix}WhiteKind">
              ${LEGACY_WHITE_KIND_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === sparkState.whiteKind ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
          <label class="field-stack field-stack-search">
            <span>Search Spark</span>
            <input id="${idPrefix}WhiteQuery" class="legacy-search-input" type="search" placeholder="Search spark..." value="${escapeHtml(sparkState.whiteQuery || "")}">
            <small class="legacy-select-meta">${escapeHtml(
              whiteTargetOptions.hasQuery
                ? `${whiteTargetOptions.visibleCount} result(s)`
                : whiteTargetOptions.isLimited
                  ? `${whiteTargetOptions.visibleCount}/${whiteTargetOptions.totalCount} shown. Type to narrow.`
                  : `${whiteTargetOptions.totalCount} option(s)`,
            )}</small>
          </label>
          <label class="field-stack field-stack-search">
            <span>Spark</span>
            <select id="${idPrefix}WhiteTarget" class="legacy-themed-select">
              ${renderLegacyTargetOptions(whiteTargetOptions.options, sparkState.whiteTargetKey)}
            </select>
          </label>
          <label class="field-stack">
            <span>Stars</span>
            <select id="${idPrefix}WhiteStars">
              ${[1, 2, 3].map((value) => `<option value="${value}" ${value === sparkState.whiteStars ? "selected" : ""}>${value}\u2605</option>`).join("")}
            </select>
          </label>
          <div class="legacy-factor-add-action">
            <button type="button" class="button-secondary" data-add-legacy-white="${escapeHtml(slotKey)}">Add white spark</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderLegacyGrandparentEditor(slotKey, entry, formDraft) {
  const slotLabel = slotKey === "left" ? "Left Grandparent" : "Right Grandparent";
  const sparkState = getLegacyEditorSparkState(slotKey);
  const currentCharacterId = sparkState.characterCardId || String(entry?.character_card_id || "");
  const currentStars = getCharacterBaseRarity(currentCharacterId);
  const characterOptions = getLegacyCharacterOptions(currentCharacterId);
  const scenarioOptions = getLegacyScenarioOptions();

  return `
    <details class="legacy-grandparent-panel" open>
      <summary>${escapeHtml(slotLabel)}</summary>
      <div class="legacy-grandparent-body">
        <div class="roster-field-grid">
          <label class="field-stack">
            <span>Character</span>
            <select name="gp_${slotKey}_character_card_id" class="roster-themed-select">
              <option value="">Unknown</option>
              ${characterOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(currentCharacterId || "") ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
          <label class="field-stack">
            <span>Scenario</span>
            <select name="gp_${slotKey}_scenario_id" class="roster-themed-select">
              <option value="">Unknown</option>
              ${scenarioOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(formDraft?.[`${slotKey}_scenario_id`] ?? entry?.scenario_id ?? "") ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
          <label class="field-stack">
            <span>Rating</span>
            <select name="gp_${slotKey}_rating" class="roster-themed-select">
              ${LEGACY_RATING_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(formDraft?.[`${slotKey}_rating`] ?? entry?.rating ?? "") ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
        </div>
        ${renderLegacySparkEditor(slotKey, currentStars)}
      </div>
    </details>
  `;
}

export function renderLegacyWizardStepNav(currentStep) {
  const steps = [
    { step: 1, label: "Parent identity" },
    { step: 2, label: "Direct sparks" },
    { step: 3, label: "Grandparents" },
  ];
  return `
    <div class="legacy-wizard-steps" aria-label="Parent creation steps">
      ${steps.map(({ step, label }) => `
        <div class="legacy-wizard-step ${step === currentStep ? "is-active" : step < currentStep ? "is-complete" : ""}">
          <span class="legacy-wizard-step-index">${step}</span>
          <span>${escapeHtml(label)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

export function renderLegacyWizardSummary(entry, draft, selectedCharacterCardId, lineageCount) {
  const selectedItem = getCharacterReferenceItem(selectedCharacterCardId);
  const characterLabel = selectedItem
    ? (selectedItem.subtitle ? `${selectedItem.title} ${selectedItem.subtitle}` : selectedItem.title)
    : "Select a parent";
  const scenarioLabel = getLegacyScenarioLabel(draft.scenario_id || entry.scenario_id || "") || "Unknown";
  const directBlue = buildLegacyFactorPayload("stat", state.legacyEditor.blueTargetKey, state.legacyEditor.blueStars, {
    characterCardId: selectedCharacterCardId,
  });
  const directPink = buildLegacyFactorPayload(state.legacyEditor.pinkKind, state.legacyEditor.pinkTargetKey, state.legacyEditor.pinkStars, {
    characterCardId: selectedCharacterCardId,
  });
  const greenAvailable = characterSupportsGreenSpark(selectedCharacterCardId);
  const leftGrandparent = getLegacyEditorSparkState("left").characterCardId || deriveLegacyGrandparentEntry(entry, "left");
  const rightGrandparent = getLegacyEditorSparkState("right").characterCardId || deriveLegacyGrandparentEntry(entry, "right");
  return `
    <aside class="legacy-wizard-summary">
      <div class="legacy-wizard-summary-card">
        <span class="eyebrow">Parent Summary</span>
        <h4>${escapeHtml(characterLabel)}</h4>
        <div class="legacy-wizard-summary-grid">
          <div>
            <span>Scenario</span>
            <strong>${escapeHtml(scenarioLabel)}</strong>
          </div>
          <div>
            <span>Rating</span>
            <strong>${escapeHtml(draft.rating ?? entry.rating ?? "-")}</strong>
          </div>
          <div>
            <span>Blue spark</span>
            <strong>${escapeHtml(directBlue ? formatLegacyFactorLabel(directBlue) : "Missing")}</strong>
          </div>
          <div>
            <span>Pink spark</span>
            <strong>${escapeHtml(directPink ? formatLegacyFactorLabel(directPink) : "Missing")}</strong>
          </div>
          <div>
            <span>Green spark</span>
            <strong>${escapeHtml(
              greenAvailable
                ? (getCharacterUniqueSkill(selectedCharacterCardId)?.name || "Eligible")
                : "Unavailable",
            )}</strong>
          </div>
          <div>
            <span>White sparks</span>
            <strong>${escapeHtml(String(state.legacyEditor.whiteSparks.length))}</strong>
          </div>
          <div>
            <span>Grandparents</span>
            <strong>${escapeHtml(`${lineageCount}/2 configured`)}</strong>
          </div>
          <div>
            <span>Lineage state</span>
            <strong>${escapeHtml(
              lineageCount === 2 ? "Complete" : lineageCount === 1 ? "Partial" : "Direct only",
            )}</strong>
          </div>
        </div>
        <div class="legacy-wizard-summary-lineage">
          <div>${renderBadge(leftGrandparent ? "Left ready" : "Left missing", leftGrandparent ? "good" : "muted")}</div>
          <div>${renderBadge(rightGrandparent ? "Right ready" : "Right missing", rightGrandparent ? "good" : "muted")}</div>
        </div>
      </div>
    </aside>
  `;
}

export function renderLegacyWizardIdentityStep(entry, draft, characterOptions, scenarioOptions, selectedCharacterCardId) {
  const canSelectCharacter = characterOptions.length > 0;
  return `
    <div class="detail-section">
      <h4>Parent identity</h4>
      <p class="source-note">Pick an EN-available Uma, set its run scenario and keep only the rating plus spark structure needed for inheritance planning.</p>
      <div class="roster-field-grid">
        <label class="field-stack">
          <span>Parent Character</span>
          <select name="character_card_id" class="roster-themed-select">
            ${canSelectCharacter
              ? characterOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(selectedCharacterCardId || "") ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")
              : `<option value="">No EN character available</option>`}
          </select>
        </label>
        <label class="field-stack">
          <span>Run Scenario</span>
          <select name="scenario_id" class="roster-themed-select">
            <option value="">Unknown</option>
            ${scenarioOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(draft.scenario_id ?? entry.scenario_id ?? "") ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
        <label class="field-stack">
          <span>Rating</span>
          <select name="rating" class="roster-themed-select">
            ${LEGACY_RATING_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(draft.rating ?? entry.rating ?? "") ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
      </div>
    </div>
  `;
}

export function renderLegacyWizardDirectSparksStep(currentCharacterStars) {
  return `
    <div class="detail-section">
      <h4>Direct sparks</h4>
      <p class="source-note">Configure the direct inheritance payload of the parent. Blue and pink sparks are required. White sparks remain optional.</p>
      ${renderLegacySparkEditor("main", currentCharacterStars)}
    </div>
  `;
}

export function renderLegacyWizardGrandparentsStep(entry, draft, leftGrandparent, rightGrandparent, lineageCount) {
  return `
    <div class="detail-section">
      <div class="legacy-section-heading">
        <h4>Grandparents</h4>
        <span class="source-note">${escapeHtml(`${lineageCount}/2 configured`)}</span>
      </div>
      <p class="source-note">Grandparents are optional, but they make the lineage much more representative for the simulator.</p>
      <div class="legacy-grandparent-grid">
        ${renderLegacyGrandparentEditor("left", leftGrandparent, {
          left_scenario_id: draft.gp_left_scenario_id,
          left_rating: draft.gp_left_rating,
        })}
        ${renderLegacyGrandparentEditor("right", rightGrandparent, {
          right_scenario_id: draft.gp_right_scenario_id,
          right_rating: draft.gp_right_rating,
        })}
      </div>
    </div>
  `;
}

export function renderLegacyCreateWizard(entry, draft, selectedCharacterCardId, characterOptions, scenarioOptions, currentCharacterStars) {
  const currentStep = clampNumber(state.legacyCreateStep, 1, 3, 1);
  const leftGrandparent = deriveLegacyGrandparentEntry(entry, "left");
  const rightGrandparent = deriveLegacyGrandparentEntry(entry, "right");
  const lineageCount = ["left", "right"].filter((slotKey) => {
    const sparkState = getLegacyEditorSparkState(slotKey);
    return Boolean(sparkState.characterCardId || deriveLegacyGrandparentEntry(entry, slotKey));
  }).length;
  const canSelectCharacter = characterOptions.length > 0;
  const stepBody = currentStep === 1
    ? renderLegacyWizardIdentityStep(entry, draft, characterOptions, scenarioOptions, selectedCharacterCardId)
    : currentStep === 2
      ? renderLegacyWizardDirectSparksStep(currentCharacterStars)
      : renderLegacyWizardGrandparentsStep(entry, draft, leftGrandparent, rightGrandparent, lineageCount);

  return `
    <div class="detail-section roster-section legacy-create-wizard">
      <h3>Create Parent</h3>
      <p class="source-note">Create a reusable legacy parent in three compact steps. The simulator still uses only owned mains, but parent sheets can reference any EN-available Uma.</p>
      ${renderLegacyWizardStepNav(currentStep)}
      <form id="legacyForm" class="roster-form" data-legacy-mode="create">
        <div class="legacy-wizard-layout">
          <div class="legacy-wizard-main">
            ${stepBody}
            <div class="legacy-wizard-actions">
              ${currentStep > 1 ? `<button type="button" class="button-secondary" id="legacyWizardPrev">Previous</button>` : `<span></span>`}
              ${currentStep < 3
                ? `<button type="button" class="button-strong" id="legacyWizardNext" ${canSelectCharacter ? "" : "disabled"}>Next step</button>`
                : `<button type="submit" class="button-strong" ${canSelectCharacter ? "" : "disabled"}>Create parent</button>`}
            </div>
            <p id="legacyStatus" class="source-note ${state.legacyStatus.kind === "error" ? "error-text" : ""}">${escapeHtml(
              state.legacyStatus.message || "Changes are stored locally for the active profile.",
            )}</p>
          </div>
          ${renderLegacyWizardSummary(entry, draft, selectedCharacterCardId, lineageCount)}
        </div>
      </form>
    </div>
  `;
}

export function renderLegacyDetailedEditor(entry, draft, selectedCharacterCardId, characterOptions, scenarioOptions, currentCharacterStars) {
  const statusText = state.legacyStatus.message || "Changes are stored locally for the active profile.";
  const canSelectCharacter = characterOptions.length > 0;
  const leftGrandparent = deriveLegacyGrandparentEntry(entry, "left");
  const rightGrandparent = deriveLegacyGrandparentEntry(entry, "right");
  const lineageCount = ["left", "right"].filter((slotKey) => {
    const sparkState = getLegacyEditorSparkState(slotKey);
    return Boolean(sparkState.characterCardId || deriveLegacyGrandparentEntry(entry, slotKey));
  }).length;

  return `
    <div class="detail-section roster-section">
      <h3>Legacy Parent</h3>
      <p class="source-note">Store the reusable inheritance data in a single local sheet, with a compact rating-based summary instead of run progression details.</p>
      <form id="legacyForm" class="roster-form" data-legacy-mode="edit" data-legacy-id="${escapeHtml(entry.id || "")}">
        <div class="roster-field-grid">
          <label class="field-stack">
            <span>Parent Character</span>
            <select name="character_card_id" class="roster-themed-select">
              ${canSelectCharacter
                ? characterOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(selectedCharacterCardId || "") ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")
                : `<option value="">No EN character available</option>`}
            </select>
          </label>
          <label class="field-stack">
            <span>Run Scenario</span>
            <select name="scenario_id" class="roster-themed-select">
              <option value="">Unknown</option>
              ${scenarioOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(draft.scenario_id ?? entry.scenario_id ?? "") ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
          <label class="field-stack">
            <span>Rating</span>
            <select name="rating" class="roster-themed-select">
              ${LEGACY_RATING_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === String(draft.rating ?? entry.rating ?? "") ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="detail-section">
          <h4>Direct Sparks</h4>
          ${renderLegacySparkEditor("main", currentCharacterStars)}
        </div>
        <div class="detail-section">
          <div class="legacy-section-heading">
            <h4>Grandparents</h4>
            <span class="source-note">${escapeHtml(`${lineageCount}/2 grandparents configured`)}</span>
          </div>
          <div class="legacy-grandparent-grid">
            ${renderLegacyGrandparentEditor("left", leftGrandparent, {
              left_scenario_id: draft.gp_left_scenario_id,
              left_rating: draft.gp_left_rating,
            })}
            ${renderLegacyGrandparentEditor("right", rightGrandparent, {
              right_scenario_id: draft.gp_right_scenario_id,
              right_rating: draft.gp_right_rating,
            })}
          </div>
        </div>
        <div class="roster-actions">
          <button type="submit" class="button-strong" ${canSelectCharacter ? "" : "disabled"}>Save parent</button>
          <button type="button" class="button-secondary" id="deleteLegacyButton">Delete parent</button>
        </div>
        <p id="legacyStatus" class="source-note ${state.legacyStatus.kind === "error" ? "error-text" : ""}">${escapeHtml(statusText)}</p>
      </form>
    </div>
  `;
}

export function renderLegacyEditor(entry, isCreateMode) {
  ensureLegacyEditorState(entry, isCreateMode ? "__new__" : entry.id);
  const draft = state.legacyFormDraft || {};
  const currentCharacterStars = getCharacterBaseRarity(state.legacyEditor.characterCardId || entry.character_card_id);
  const characterOptions = getLegacyCharacterOptions(state.legacyEditor.characterCardId || entry.character_card_id);
  const scenarioOptions = getLegacyScenarioOptions();
  const selectedCharacterCardId = state.legacyEditor.characterCardId || String(entry.character_card_id || "") || characterOptions[0]?.value || "";
  return isCreateMode
    ? renderLegacyCreateWizard(entry, draft, selectedCharacterCardId, characterOptions, scenarioOptions, currentCharacterStars)
    : renderLegacyDetailedEditor(entry, draft, selectedCharacterCardId, characterOptions, scenarioOptions, currentCharacterStars);
}

export function renderLegacyDetailBody(detail) {
  const entry = detail?.entry || {};
  const sparks = detail?.spark_summary || {};
  const lineage = detail?.lineage_completion || {};
  const grandparents = asArray(detail?.grandparents);
  return `
    <div class="detail-section">
      <h3>Parent Overview</h3>
      ${tableFromRows([
        ["Scenario", escapeHtml(entry.scenario_name || "Unknown")],
        ["Rating", escapeHtml(entry.rating || "-")],
        ["Lineage", escapeHtml(`${lineage.filled_count || 0}/${lineage.total || 2} grandparents`)],
      ])}
    </div>
    <div class="detail-section">
      <h3>Spark Structure</h3>
      ${tableFromRows([
        ["Blue Spark", escapeHtml(sparks.blue ? formatLegacyFactorLabel(sparks.blue) : "Missing")],
        ["Pink Spark", escapeHtml(sparks.pink ? formatLegacyFactorLabel(sparks.pink) : "Missing")],
        ["Green Spark", escapeHtml(sparks.green ? formatLegacyFactorLabel(sparks.green) : (sparks.green_available ? "Not saved" : "Unavailable"))],
        ["White Sparks", escapeHtml(String(sparks.white_count || 0))],
      ])}
    </div>
    ${sparks.blue ? `
      <div class="detail-section">
        <h3>Blue Spark</h3>
        <div class="badge-row">${renderBadge(formatLegacyFactorLabel(sparks.blue))}</div>
      </div>
    ` : ""}
    ${sparks.pink ? `
      <div class="detail-section">
        <h3>Pink Spark</h3>
        <div class="badge-row">${renderBadge(formatLegacyFactorLabel(sparks.pink))}</div>
      </div>
    ` : ""}
    <div class="detail-section">
      <h3>Green Spark</h3>
      ${sparks.green
        ? `<div class="badge-row">${renderBadge(formatLegacyFactorLabel(sparks.green))}</div>`
        : `<p class="source-note">${escapeHtml(sparks.green_available ? "Not saved on this parent sheet." : "Unavailable for this parent.")}</p>`}
    </div>
    <div class="detail-section">
      <h3>White Sparks</h3>
      ${renderLegacySparkList(sparks.white, "No local white sparks saved.", false)}
    </div>
    <div class="detail-section">
      <h3>Grandparents</h3>
      ${grandparents.length
        ? `
          <div class="legacy-preview-ancestor-grid">
            ${grandparents.map((grandparent) => grandparent.missing
              ? `
                <div class="legacy-preview-ancestor-card is-empty">
                  <span class="legacy-simulator-slot">${escapeHtml(grandparent.slot_label)}</span>
                  <p class="source-note">Missing</p>
                </div>
              `
              : `
                <div class="legacy-preview-ancestor-card">
                  <span class="legacy-simulator-slot">${escapeHtml(grandparent.slot_label)}</span>
                  <strong>${escapeHtml(grandparent.title || "Unknown grandparent")}</strong>
                  <p>${escapeHtml(grandparent.subtitle || grandparent.scenario_name || "")}</p>
                  ${grandparent.rating ? `<div class="badge-row">${renderBadge(`Rating ${grandparent.rating}`)}</div>` : ""}
                  <div class="badge-row">
                    ${renderLegacySimulatorSparkBadges({ detail: { spark_summary: grandparent.spark_summary } }).map((badge) => renderBadge(badge)).join("")}
                  </div>
                </div>
              `).join("")}
          </div>
        `
        : "<p class='source-note'>No grandparent data saved yet.</p>"}
    </div>
    <div class="detail-section">
      <h3>Reference Links</h3>
      ${renderReferenceList(detail.linked_references)}
    </div>
    <div class="detail-section">
      <h3>Compatibility Snapshot</h3>
      ${renderReferenceList(detail.compatibility_top_matches)}
    </div>
  `;
}

export function renderLegacyPreview(preview) {
  if (!preview) {
    return "<div class='detail-empty'>Select a main candidate and two saved parents, then run the simulator preview.</div>";
  }
  const compatibility = preview.compatibility_summary || {};
  const direct = compatibility.direct || {};
  const grandparentSupport = compatibility.grandparent_support || {};
  const coverage = preview.coverage_summary || {};
  const directFactorGroups = coverage.direct_factor_groups || {};
  const grandparentFactorGroups = coverage.grandparent_factor_groups || {};
  const rawDetails = preview.raw_details || {};
  const directScenarioCount = asArray(preview.scenario_summary?.direct).length;
  const grandparentScenarioCount = asArray(preview.scenario_summary?.grandparents).length;
  const directG1Count = asArray(preview.g1_summary?.direct).length;
  const grandparentG1Count = asArray(preview.g1_summary?.grandparents).length;
  const renderCompatibilityRow = (label, pair) => {
    if (!pair) {
      return null;
    }
    return [label, escapeHtml(`${pair.score || 0} pts | ${pair.shared_group_count || 0} groups`)];
  };
  const renderFactorBadgeBlock = (entries) => {
    if (!asArray(entries).length) {
      return "<p class='source-note'>None</p>";
    }
    return `
      <div class="badge-row">
        ${asArray(entries).map((factor) => renderBadge(`${factor.target_label || factor.target_key} (${factor.stars_total || factor.stars}\u2605)`)).join("")}
      </div>
    `;
  };

  return `
    <div class="detail-section">
      <h3>Compatibility Overview</h3>
      ${tableFromRows([
        ["Main Candidate", escapeHtml(preview.main?.title || "-")],
        ["Parent A", escapeHtml(preview.parent_a?.name || "-")],
        ["Parent B", escapeHtml(preview.parent_b?.name || "-")],
        renderCompatibilityRow("Main -> Parent A", direct.parent_a),
        renderCompatibilityRow("Main -> Parent B", direct.parent_b),
        renderCompatibilityRow("Parent Pair Synergy", direct.pair_synergy),
        ["Grandparent Support", escapeHtml(`${grandparentSupport.total_score || 0} pts | ${grandparentSupport.filled_slots || 0}/4 slots filled`)],
        ["Overall Lineage Score", escapeHtml(compatibility.overall_score || 0)],
      ].filter(Boolean))}
    </div>
    <div class="detail-section">
      <h3>Why this pair works / does not work</h3>
      ${preview.highlights?.length ? `
        <h4>Highlights</h4>
        ${renderSimpleList(preview.highlights, (entry) => entry)}
      ` : ""}
      ${preview.warnings?.length ? `
        <h4>Warnings</h4>
        ${renderSimpleList(preview.warnings, (entry) => entry)}
      ` : ""}
      ${!preview.highlights?.length && !preview.warnings?.length ? "<p class='source-note'>No strong signal detected yet.</p>" : ""}
    </div>
    <div class="detail-section">
      <h3>Inheritance Coverage</h3>
      ${tableFromRows(asArray(coverage.aptitude_coverage).map((entry) => [
        LEGACY_KIND_LABELS[entry.category] || entry.category,
        escapeHtml(
          `Direct: ${asArray(entry.direct_supported).join(", ") || "-"} | Grandparents: ${asArray(entry.grandparent_supported).join(", ") || "-"} | Missing: ${asArray(entry.missing).join(", ") || "-"}`
        ),
      ]))}
    </div>
    <div class="detail-section">
      <h3>Direct Sparks</h3>
      ${Object.entries(directFactorGroups)
        .filter(([, entries]) => asArray(entries).length)
        .map(([kind, entries]) => `
          <h4>${escapeHtml(LEGACY_KIND_LABELS[kind] || kind)}</h4>
          ${renderFactorBadgeBlock(entries)}
        `)
        .join("") || "<p class='source-note'>No direct spark data.</p>"}
    </div>
    <div class="detail-section">
      <h3>Grandparent Support</h3>
      ${tableFromRows(asArray(grandparentSupport.slots).map((slot) => [
        slot.label,
        escapeHtml(slot.missing ? "Missing slot" : `${slot.grandparent_name || "Grandparent"} | ${slot.score || 0} pts | ${slot.shared_group_count || 0} groups`),
      ]))}
      ${Object.entries(grandparentFactorGroups)
        .filter(([, entries]) => asArray(entries).length)
        .map(([kind, entries]) => `
          <h4>${escapeHtml(LEGACY_KIND_LABELS[kind] || kind)}</h4>
          ${renderFactorBadgeBlock(entries)}
        `)
        .join("") || "<p class='source-note'>No grandparent spark data.</p>"}
    </div>
    ${directScenarioCount || grandparentScenarioCount || directG1Count || grandparentG1Count ? `
      <div class="detail-section">
        <h3>Scenario / G1 Support</h3>
        ${tableFromRows([
          directScenarioCount || grandparentScenarioCount
            ? ["Scenario Sparks", escapeHtml(`Direct: ${directScenarioCount} | Grandparents: ${grandparentScenarioCount}`)]
            : null,
          directG1Count || grandparentG1Count
            ? ["G1 Sparks", escapeHtml(`Direct: ${directG1Count} | Grandparents: ${grandparentG1Count}`)]
            : null,
        ].filter(Boolean))}
      </div>
    ` : ""}
    ${Object.keys(rawDetails).length ? `
      <details class="roster-collapsible">
        <summary>Lineage Details</summary>
        <div class="roster-collapsible-body">
          ${rawDetails.main_to_parent_a_groups ? `
            <div class="detail-section">
              <h4>${escapeHtml(rawDetails.main_to_parent_a_groups.label)}</h4>
              ${renderSimpleList(rawDetails.main_to_parent_a_groups.shared_groups, (group) => `${group.relation_type || "group"} | ${group.relation_point || 0} pts | ${group.member_count || 0} members`)}
            </div>
          ` : ""}
          ${rawDetails.main_to_parent_b_groups ? `
            <div class="detail-section">
              <h4>${escapeHtml(rawDetails.main_to_parent_b_groups.label)}</h4>
              ${renderSimpleList(rawDetails.main_to_parent_b_groups.shared_groups, (group) => `${group.relation_type || "group"} | ${group.relation_point || 0} pts | ${group.member_count || 0} members`)}
            </div>
          ` : ""}
          ${rawDetails.parent_pair_groups ? `
            <div class="detail-section">
              <h4>${escapeHtml(rawDetails.parent_pair_groups.label)}</h4>
              ${renderSimpleList(rawDetails.parent_pair_groups.shared_groups, (group) => `${group.relation_type || "group"} | ${group.relation_point || 0} pts | ${group.member_count || 0} members`)}
            </div>
          ` : ""}
          ${rawDetails.grandparent_groups?.length ? `
            <div class="detail-section">
              <h4>Grandparent Branch Groups</h4>
              ${renderSimpleList(rawDetails.grandparent_groups, (group) => `${group.label}: ${group.score || 0} pts | ${group.shared_group_count || 0} groups`)}
            </div>
          ` : ""}
        </div>
      </details>
    ` : ""}
  `;
}


export function getLegacySimulatorParentById(legacyId) {
  return state.legacyView.items.find((item) => item.id === legacyId) || null;
}

export function renderLegacySimulatorSparkBadges(item) {
  const sparkSummary = item?.detail?.spark_summary || {};
  const badges = [];
  if (sparkSummary.blue) {
    badges.push(`Blue ${formatLegacyFactorLabel(sparkSummary.blue)}`);
  }
  if (sparkSummary.pink) {
    badges.push(`Pink ${formatLegacyFactorLabel(sparkSummary.pink)}`);
  }
  if (sparkSummary.green) {
    badges.push(`Green ${formatLegacyFactorLabel(sparkSummary.green)}`);
  }
  if (sparkSummary.white_count) {
    badges.push(`${sparkSummary.white_count} white`);
  }
  return badges;
}

export function renderLegacySimulatorParentCard(slotLabel, tone, item) {
  if (!item) {
    return `
      <div class="legacy-simulator-parent-card legacy-simulator-parent-card-${tone} is-empty">
        <div class="legacy-simulator-parent-head">
          <span class="legacy-simulator-slot">${escapeHtml(slotLabel)}</span>
        </div>
        <p class="source-note">Select a saved parent to inspect its scenario and sparks here.</p>
      </div>
    `;
  }

  const media = getPrimaryMedia(item.media, ["portrait", "icon"]);
  const sparkBadges = renderLegacySimulatorSparkBadges(item);
  return `
    <div class="legacy-simulator-parent-card legacy-simulator-parent-card-${tone}">
      <div class="legacy-simulator-parent-head">
        <span class="legacy-simulator-slot">${escapeHtml(slotLabel)}</span>
        ${item.detail?.entry?.scenario_name ? renderBadge(item.detail.entry.scenario_name) : ""}
      </div>
      <div class="legacy-simulator-parent-body">
        ${media ? `<div class="legacy-simulator-parent-media">${renderImageAsset(media, "legacy-simulator-parent-image", "lazy")}</div>` : ""}
        <div class="legacy-simulator-parent-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.subtitle || "Saved parent")}</p>
          <div class="badge-row">
            ${item.detail?.entry?.rating ? renderBadge(`Rating ${item.detail.entry.rating}`) : ""}
            ${sparkBadges.map((badge) => renderBadge(badge)).join("") || renderBadge("No sparks summary")}
            ${item.detail?.lineage_completion ? renderBadge(`${item.detail.lineage_completion.filled_count || 0}/2 lineage`) : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderLegacySimulatorMainCard() {
  const selectedMain = getOwnedCharacterOptions().find((option) => option.value === state.legacySimulator.main_character_id);
  return `
    <div class="legacy-simulator-main-card">
      <div class="legacy-simulator-parent-head">
        <span class="legacy-simulator-slot">Main</span>
      </div>
      <div class="field-stack field-stack-full">
        <span>Main Candidate</span>
        <select name="main_character_id" class="roster-themed-select">
          <option value="">Select an owned character</option>
          ${getOwnedCharacterOptions().map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === state.legacySimulator.main_character_id ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
        <small class="legacy-select-meta">${escapeHtml(selectedMain?.label || "Choose the owned main you want to evaluate against the selected lineage.")}</small>
      </div>
    </div>
  `;
}

export function renderLegacySimulatorGrandparentCard(slotLabel, item, tone) {
  if (!item || item.missing) {
    return `
      <div class="legacy-simulator-ancestor-card legacy-simulator-ancestor-card-${tone} is-empty">
        <span class="legacy-simulator-slot">${escapeHtml(slotLabel)}</span>
        <p class="source-note">Missing</p>
      </div>
    `;
  }

  const media = getPrimaryMedia(item.media, ["portrait", "icon"]);
  const sparkBadges = renderLegacySimulatorSparkBadges({ detail: { spark_summary: item.spark_summary } });
  return `
    <div class="legacy-simulator-ancestor-card legacy-simulator-ancestor-card-${tone}">
      <span class="legacy-simulator-slot">${escapeHtml(slotLabel)}</span>
      ${media ? `<div class="legacy-simulator-ancestor-media">${renderImageAsset(media, "legacy-simulator-choice-image", "lazy")}</div>` : ""}
      <strong>${escapeHtml(item.title || "Unknown grandparent")}</strong>
      <p>${escapeHtml(item.subtitle || item.scenario_name || "")}</p>
      <div class="badge-row">
        ${item.rating ? renderBadge(`Rating ${item.rating}`) : ""}
        ${sparkBadges.map((badge) => renderBadge(badge)).join("") || renderBadge("No sparks summary")}
      </div>
    </div>
  `;
}

export function renderLegacySimulatorParentChoiceCard(item, activeSlot) {
  const media = getPrimaryMedia(item.media, ["portrait", "icon"]);
  const sparkBadges = renderLegacySimulatorSparkBadges(item);
  const isParentA = item.id === state.legacySimulator.parent_a_legacy_id;
  const isParentB = item.id === state.legacySimulator.parent_b_legacy_id;
  return `
    <article class="legacy-simulator-choice-card ${isParentA ? "is-parent-a" : ""} ${isParentB ? "is-parent-b" : ""}" data-legacy-id="${escapeHtml(item.id)}">
      <div class="legacy-simulator-choice-top">
        ${media ? `<div class="legacy-simulator-choice-media">${renderImageAsset(media, "legacy-simulator-choice-image", "lazy")}</div>` : ""}
        <div class="legacy-simulator-choice-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.subtitle || "Saved parent")}</p>
          <div class="badge-row">
            ${item.detail?.entry?.scenario_name ? renderBadge(item.detail.entry.scenario_name) : ""}
            ${item.detail?.entry?.rating ? renderBadge(`Rating ${item.detail.entry.rating}`) : ""}
            ${sparkBadges.map((badge) => renderBadge(badge)).join("")}
            ${item.detail?.lineage_completion ? renderBadge(`${item.detail.lineage_completion.filled_count || 0}/2 lineage`) : ""}
          </div>
        </div>
      </div>
      <div class="legacy-simulator-choice-actions">
        <button
          type="button"
          class="${activeSlot === "parent_a" ? "button-strong" : "button-secondary"}"
          data-simulator-assign="parent_a"
          data-legacy-id="${escapeHtml(item.id)}"
        >
          ${isParentA ? "Assigned to A" : "Set as Parent A"}
        </button>
        <button
          type="button"
          class="${activeSlot === "parent_b" ? "button-strong" : "button-secondary"}"
          data-simulator-assign="parent_b"
          data-legacy-id="${escapeHtml(item.id)}"
        >
          ${isParentB ? "Assigned to B" : "Set as Parent B"}
        </button>
      </div>
    </article>
  `;
}

export function renderLegacySimulatorList() {
  const mainOptions = getOwnedCharacterOptions();
  const parentItems = state.legacyView.items;
  const parentA = getLegacySimulatorParentById(state.legacySimulator.parent_a_legacy_id);
  const parentB = getLegacySimulatorParentById(state.legacySimulator.parent_b_legacy_id);
  const parentAGrandparents = asArray(parentA?.detail?.grandparents);
  const parentBGrandparents = asArray(parentB?.detail?.grandparents);
  const activeSlot = state.legacySimulator.active_slot === "parent_b" ? "parent_b" : "parent_a";
  const canRunPreview = mainOptions.length > 0 && parentItems.length >= 2;
  listEl.innerHTML = `
    <div class="legacy-simulator-card">
      <h3>Inheritance Simulator</h3>
      <p class="source-note">Select one owned main candidate and two saved parents from the local legacy inventory.${canRunPreview ? "" : " You need at least one owned character and two saved parents to run the preview."}</p>
      <form id="legacySimulatorForm" class="roster-form">
        <div class="legacy-simulator-lineage-grid">
          ${renderLegacySimulatorGrandparentCard("A-Left", parentAGrandparents.find((item) => item.slot === "left"), "left")}
          ${renderLegacySimulatorGrandparentCard("A-Right", parentAGrandparents.find((item) => item.slot === "right"), "left")}
          ${renderLegacySimulatorGrandparentCard("B-Left", parentBGrandparents.find((item) => item.slot === "left"), "right")}
          ${renderLegacySimulatorGrandparentCard("B-Right", parentBGrandparents.find((item) => item.slot === "right"), "right")}
        </div>
        <input type="hidden" name="parent_a_legacy_id" value="${escapeHtml(state.legacySimulator.parent_a_legacy_id || "")}">
        <input type="hidden" name="parent_b_legacy_id" value="${escapeHtml(state.legacySimulator.parent_b_legacy_id || "")}">
        <div class="legacy-simulator-parent-grid">
          ${renderLegacySimulatorParentCard("Parent A", "left", parentA)}
          ${renderLegacySimulatorParentCard("Parent B", "right", parentB)}
        </div>
        <div class="legacy-simulator-main-shell">
          ${renderLegacySimulatorMainCard()}
        </div>
        <div class="legacy-simulator-picker">
          <div class="legacy-simulator-picker-head">
            <div>
              <h4>Choose Saved Parent</h4>
              <p class="source-note">Click a card to assign it to the active slot, or use the explicit A/B buttons.</p>
            </div>
            <div class="mode-nav legacy-simulator-slot-tabs" aria-label="Simulator slot">
              <button type="button" class="${activeSlot === "parent_a" ? "active" : ""}" data-simulator-slot="parent_a">Picking for Parent A</button>
              <button type="button" class="${activeSlot === "parent_b" ? "active" : ""}" data-simulator-slot="parent_b">Picking for Parent B</button>
            </div>
          </div>
          <div class="legacy-simulator-choice-grid">
            ${parentItems.map((item) => renderLegacySimulatorParentChoiceCard(item, activeSlot)).join("")}
          </div>
        </div>
        <div class="roster-actions">
          <button type="submit" class="button-strong" ${canRunPreview ? "" : "disabled"}>Run preview</button>
        </div>
        <p class="source-note ${state.legacySimulator.status.kind === "error" ? "error-text" : ""}">${escapeHtml(state.legacySimulator.status.message || "The preview is deterministic and based on local compatibility plus saved sparks.")}</p>
      </form>
    </div>
  `;

  const simulatorForm = document.getElementById("legacySimulatorForm");
  if (simulatorForm) {
    simulatorForm.querySelectorAll("[data-simulator-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        state.legacySimulator.active_slot = button.dataset.simulatorSlot === "parent_b" ? "parent_b" : "parent_a";
        requestRenderPreservingScroll();
      });
    });
    simulatorForm.querySelectorAll("[data-simulator-assign]").forEach((button) => {
      button.addEventListener("click", () => {
        const targetSlot = button.dataset.simulatorAssign === "parent_b" ? "parent_b" : "parent_a";
        const legacyId = String(button.dataset.legacyId || "");
        if (!legacyId) {
          return;
        }
        if (targetSlot === "parent_a") {
          state.legacySimulator.parent_a_legacy_id = legacyId;
        } else {
          state.legacySimulator.parent_b_legacy_id = legacyId;
        }
        state.legacySimulator.active_slot = targetSlot;
        requestRenderPreservingScroll();
      });
    });
    simulatorForm.querySelectorAll(".legacy-simulator-choice-card").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("button")) {
          return;
        }
        const legacyId = String(card.dataset.legacyId || "");
        if (!legacyId) {
          return;
        }
        if (state.legacySimulator.active_slot === "parent_b") {
          state.legacySimulator.parent_b_legacy_id = legacyId;
        } else {
          state.legacySimulator.parent_a_legacy_id = legacyId;
        }
        requestRenderPreservingScroll();
      });
    });
    simulatorForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await runLegacySimulatorPreview(new FormData(simulatorForm));
    });
  }
}


export function buildLegacyFactorPayload(kind, targetKey, stars, options = {}) {
  if (kind === "unique") {
    const uniqueSkill = getCharacterUniqueSkill(options.characterCardId);
    if (!uniqueSkill) {
      return null;
    }
    return {
      kind: "unique",
      target_key: String(uniqueSkill.id),
      target_label: uniqueSkill.name,
      skill_id: String(uniqueSkill.id),
      stars: clampNumber(stars, 1, 3, 3),
    };
  }
  const targetOptions = getLegacyFactorTargetOptions(kind);
  const target = targetOptions.find((option) => option.value === targetKey);
  if (!target) {
    return null;
  }
  const payload = {
    kind,
    target_key: target.value,
    target_label: target.label,
    stars: clampNumber(stars, 1, 3, 3),
  };
  if (kind === "scenario") {
    payload.scenario_id = target.value;
  }
  if (kind === "g1") {
    const g1Item = getEntityItems("g1_factors").find((item) => String(item.detail?.factor_id || item.id) === target.value);
    if (g1Item?.detail?.race_id) {
      payload.race_id = String(g1Item.detail.race_id);
    }
  }
  return payload;
}

export function attachLegacyFormListeners(isCreateMode, legacyId) {
  const legacyForm = document.getElementById("legacyForm");
  const slotPrefixes = {
    main: "legacyMain",
    left: "legacyGpLeft",
    right: "legacyGpRight",
  };
  const readSparkState = (slotKey) => getLegacyEditorSparkState(slotKey);
  const getSparkElement = (slotKey, suffix) => document.getElementById(`${slotPrefixes[slotKey]}${suffix}`);
  const bindSparkSlot = (slotKey) => {
    const blueTargetSelect = getSparkElement(slotKey, "BlueTarget");
    const blueStarsSelect = getSparkElement(slotKey, "BlueStars");
    const pinkKindSelect = getSparkElement(slotKey, "PinkKind");
    const pinkTargetSelect = getSparkElement(slotKey, "PinkTarget");
    const pinkStarsSelect = getSparkElement(slotKey, "PinkStars");
    const greenStarsSelect = getSparkElement(slotKey, "GreenStars");
    const whiteKindSelect = getSparkElement(slotKey, "WhiteKind");
    const whiteQueryInput = getSparkElement(slotKey, "WhiteQuery");
    const whiteTargetSelect = getSparkElement(slotKey, "WhiteTarget");
    const whiteStarsSelect = getSparkElement(slotKey, "WhiteStars");

    if (blueTargetSelect) {
      blueTargetSelect.addEventListener("change", () => {
        updateLegacyEditorSparkState(slotKey, (sparkState) => ({
          ...sparkState,
          blueTargetKey: blueTargetSelect.value,
        }));
      });
    }
    if (blueStarsSelect) {
      blueStarsSelect.addEventListener("change", () => {
        updateLegacyEditorSparkState(slotKey, (sparkState) => ({
          ...sparkState,
          blueStars: clampNumber(blueStarsSelect.value, 1, 3, 3),
        }));
      });
    }
    if (pinkKindSelect) {
      pinkKindSelect.addEventListener("change", () => {
        captureLegacyFormDraft();
        updateLegacyEditorSparkState(slotKey, (sparkState) => {
          const nextKind = pinkKindSelect.value;
          const options = getLegacyFactorTargetOptions(nextKind);
          return {
            ...sparkState,
            pinkKind: nextKind,
            pinkTargetKey: options[0]?.value || "",
            pinkQuery: "",
          };
        });
        requestRenderPreservingScroll();
      });
    }
    if (pinkTargetSelect) {
      pinkTargetSelect.addEventListener("change", () => {
        updateLegacyEditorSparkState(slotKey, (sparkState) => ({
          ...sparkState,
          pinkTargetKey: pinkTargetSelect.value,
        }));
      });
    }
    if (pinkStarsSelect) {
      pinkStarsSelect.addEventListener("change", () => {
        updateLegacyEditorSparkState(slotKey, (sparkState) => ({
          ...sparkState,
          pinkStars: clampNumber(pinkStarsSelect.value, 1, 3, 3),
        }));
      });
    }
    if (greenStarsSelect) {
      greenStarsSelect.addEventListener("change", () => {
        updateLegacyEditorSparkState(slotKey, (sparkState) => ({
          ...sparkState,
          greenStars: clampNumber(greenStarsSelect.value, 1, 3, 3),
        }));
      });
    }
    if (whiteKindSelect) {
      whiteKindSelect.addEventListener("change", () => {
        captureLegacyFormDraft();
        updateLegacyEditorSparkState(slotKey, (sparkState) => {
          const nextKind = whiteKindSelect.value;
          const options = getLegacyFactorTargetOptions(nextKind);
          return {
            ...sparkState,
            whiteKind: nextKind,
            whiteTargetKey: options[0]?.value || "",
            whiteQuery: "",
          };
        });
        requestRenderPreservingScroll();
      });
    }
    if (whiteQueryInput) {
      whiteQueryInput.addEventListener("input", () => {
        captureLegacyFormDraft();
        updateLegacyEditorSparkState(slotKey, (sparkState) => ({
          ...sparkState,
          whiteQuery: whiteQueryInput.value,
        }));
        requestRenderPreservingScrollAndFocus(`${slotPrefixes[slotKey]}WhiteQuery`);
      });
    }
    if (whiteTargetSelect) {
      whiteTargetSelect.addEventListener("change", () => {
        updateLegacyEditorSparkState(slotKey, (sparkState) => ({
          ...sparkState,
          whiteTargetKey: whiteTargetSelect.value,
        }));
      });
    }
    if (whiteStarsSelect) {
      whiteStarsSelect.addEventListener("change", () => {
        updateLegacyEditorSparkState(slotKey, (sparkState) => ({
          ...sparkState,
          whiteStars: clampNumber(whiteStarsSelect.value, 1, 3, 3),
        }));
      });
    }
  };

  bindSparkSlot("main");
  bindSparkSlot("left");
  bindSparkSlot("right");

  const characterSelect = document.querySelector('#legacyForm select[name="character_card_id"]');
  const bindGrandparentIdentity = (slotKey) => {
    const characterField = document.querySelector(`#legacyForm select[name="gp_${slotKey}_character_card_id"]`);
    if (characterField) {
      characterField.addEventListener("change", () => {
        captureLegacyFormDraft();
        updateLegacyEditorSparkState(slotKey, (sparkState) => ({
          ...sparkState,
          characterCardId: String(characterField.value || ""),
        }));
        requestRenderPreservingScroll();
      });
    }
  };

  bindGrandparentIdentity("left");
  bindGrandparentIdentity("right");

  const validateLegacyCreateStep = (step) => {
    const selectedCharacterCardId = String(state.legacyEditor.characterCardId || "").trim();
    if (step === 1) {
      if (!selectedCharacterCardId) {
        state.legacyStatus = { kind: "error", message: "Select an EN-available parent character before continuing." };
        requestRender();
        return false;
      }
      state.legacyStatus = { kind: "idle", message: "" };
      return true;
    }
    if (step === 2) {
      if (!selectedCharacterCardId) {
        state.legacyStatus = { kind: "error", message: "Select an EN-available parent character before configuring sparks." };
        requestRender();
        return false;
      }
      const blueSpark = buildLegacyFactorPayload("stat", state.legacyEditor.blueTargetKey, state.legacyEditor.blueStars, {
        characterCardId: selectedCharacterCardId,
      });
      const pinkSpark = buildLegacyFactorPayload(state.legacyEditor.pinkKind, state.legacyEditor.pinkTargetKey, state.legacyEditor.pinkStars, {
        characterCardId: selectedCharacterCardId,
      });
      if (!blueSpark || !pinkSpark) {
        state.legacyStatus = { kind: "error", message: "Blue and pink sparks must both be configured before continuing." };
        requestRender();
        return false;
      }
      state.legacyStatus = { kind: "idle", message: "" };
      return true;
    }
    return true;
  };

  if (characterSelect) {
    characterSelect.addEventListener("change", () => {
      captureLegacyFormDraft();
      state.legacyEditor.characterCardId = String(characterSelect.value || "");
      requestRenderPreservingScroll();
    });
  }
  const previousButton = document.getElementById("legacyWizardPrev");
  if (previousButton) {
    previousButton.addEventListener("click", () => {
      captureLegacyFormDraft();
      state.legacyCreateStep = clampNumber(state.legacyCreateStep - 1, 1, 3, 1);
      state.legacyStatus = { kind: "idle", message: "" };
      requestRenderPreservingScroll();
    });
  }
  const nextButton = document.getElementById("legacyWizardNext");
  if (nextButton) {
    nextButton.addEventListener("click", () => {
      captureLegacyFormDraft();
      if (!validateLegacyCreateStep(state.legacyCreateStep)) {
        return;
      }
      state.legacyCreateStep = clampNumber(state.legacyCreateStep + 1, 1, 3, 3);
      requestRenderPreservingScroll();
    });
  }
  detailEl.querySelectorAll("[data-add-legacy-white]").forEach((button) => {
    button.addEventListener("click", () => {
      captureLegacyFormDraft();
      const slotKey = button.dataset.addLegacyWhite === "left" || button.dataset.addLegacyWhite === "right"
        ? button.dataset.addLegacyWhite
        : "main";
      const sparkState = readSparkState(slotKey);
      const characterCardId = slotKey === "main"
        ? state.legacyEditor.characterCardId
        : sparkState.characterCardId;
      const payload = buildLegacyFactorPayload(
        sparkState.whiteKind,
        sparkState.whiteTargetKey,
        sparkState.whiteStars,
        { characterCardId },
      );
      if (!payload) {
        return;
      }
      updateLegacyEditorSparkState(slotKey, (currentState) => ({
        ...currentState,
        whiteSparks: currentState.whiteSparks
          .filter((spark) => !(spark.kind === payload.kind && spark.target_key === payload.target_key))
          .concat([payload]),
      }));
      requestRenderPreservingScroll();
    });
  });
  detailEl.querySelectorAll("[data-legacy-white-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      captureLegacyFormDraft();
      const slotKey = button.dataset.legacySlot === "left" || button.dataset.legacySlot === "right"
        ? button.dataset.legacySlot
        : "main";
      updateLegacyEditorSparkState(slotKey, (sparkState) => ({
        ...sparkState,
        whiteSparks: sparkState.whiteSparks.filter((_spark, index) => String(index) !== button.dataset.legacyWhiteRemove),
      }));
      requestRenderPreservingScroll();
    });
  });
    if (legacyForm) {
    legacyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveLegacyForm(new FormData(legacyForm), isCreateMode, legacyId);
    });
  }

  const deleteButton = document.getElementById("deleteLegacyButton");
  if (deleteButton && legacyId) {
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm("Delete this saved parent?")) {
        return;
      }
      await deleteLegacyParent(legacyId);
    });
  }
}


export function collectLegacyGrandparentPayload(slotKey, formData) {
  const sparkState = getLegacyEditorSparkState(slotKey);
  const readField = (name, fallback = "") => (
    formData.has(name)
      ? String(formData.get(name) || "").trim()
      : String(state.legacyFormDraft?.[name] || fallback || "")
  );
  const selectedCharacterCardId = String(readField(`gp_${slotKey}_character_card_id`, sparkState.characterCardId) || "").trim();
  if (!selectedCharacterCardId) {
    return null;
  }
  const selectedScenarioId = String(readField(`gp_${slotKey}_scenario_id`) || "").trim();
  const selectedStars = getCharacterBaseRarity(selectedCharacterCardId);
  return {
    character_card_id: selectedCharacterCardId,
    scenario_id: selectedScenarioId || null,
    scenario_name: selectedScenarioId ? getLegacyScenarioLabel(selectedScenarioId) : null,
    rating: String(readField(`gp_${slotKey}_rating`) || "").trim().toUpperCase() || null,
    stars: selectedStars,
    blue_spark: buildLegacyFactorPayload("stat", sparkState.blueTargetKey, sparkState.blueStars, { characterCardId: selectedCharacterCardId }),
    pink_spark: buildLegacyFactorPayload(sparkState.pinkKind, sparkState.pinkTargetKey, sparkState.pinkStars, { characterCardId: selectedCharacterCardId }),
    green_spark: characterSupportsGreenSpark(selectedCharacterCardId, selectedStars)
      ? buildLegacyFactorPayload("unique", "", sparkState.greenStars, { characterCardId: selectedCharacterCardId })
      : null,
    white_sparks: sparkState.whiteSparks.map((spark) => ({ ...spark })),
  };
}

export function collectLegacyPayload(formData) {
  const readField = (name, fallback = "") => (
    formData.has(name)
      ? String(formData.get(name) || "").trim()
      : String(state.legacyFormDraft?.[name] || fallback || "")
  );
  const selectedCharacterCardId = String(formData.get("character_card_id") || state.legacyEditor.characterCardId || "").trim();
  const selectedScenarioId = String(readField("scenario_id") || "").trim();
  const selectedStars = getCharacterBaseRarity(selectedCharacterCardId);
  return {
    character_card_id: selectedCharacterCardId,
    scenario_id: selectedScenarioId || null,
    scenario_name: selectedScenarioId ? getLegacyScenarioLabel(selectedScenarioId) : null,
    rating: String(readField("rating") || "").trim().toUpperCase() || null,
    stars: selectedStars,
    custom_tags: parseRosterTokenList(readField("custom_tags")),
    status_flags: parseRosterTokenList(readField("status_flags")),
    blue_spark: buildLegacyFactorPayload("stat", state.legacyEditor.blueTargetKey, state.legacyEditor.blueStars, { characterCardId: selectedCharacterCardId }),
    pink_spark: buildLegacyFactorPayload(state.legacyEditor.pinkKind, state.legacyEditor.pinkTargetKey, state.legacyEditor.pinkStars, { characterCardId: selectedCharacterCardId }),
    green_spark: characterSupportsGreenSpark(selectedCharacterCardId, selectedStars)
      ? buildLegacyFactorPayload("unique", "", state.legacyEditor.greenStars, { characterCardId: selectedCharacterCardId })
      : null,
    white_sparks: state.legacyEditor.whiteSparks.map((spark) => ({ ...spark })),
    grandparents: {
      left: collectLegacyGrandparentPayload("left", formData),
      right: collectLegacyGrandparentPayload("right", formData),
    },
  };
}

export async function saveLegacyForm(formData, isCreateMode, legacyId) {
  if (!state.activeProfileId) {
    return;
  }
  state.legacyStatus = { kind: "saving", message: "Saving parent locally..." };
  requestRender();
  try {
    const payload = collectLegacyPayload(formData);
    const response = await apiJson(
      isCreateMode
        ? `/api/profiles/${encodeURIComponent(state.activeProfileId)}/legacies`
        : `/api/profiles/${encodeURIComponent(state.activeProfileId)}/legacies/${encodeURIComponent(legacyId)}`,
      {
        method: isCreateMode ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      },
    );
    await loadLegacyForProfile(state.activeProfileId, true);
    state.legacyStatus = {
      kind: "saved",
      message: isCreateMode ? "Saved new parent locally." : "Saved parent locally.",
    };
    state.legacyFormDraft = null;
    setBrowseHash("roster", legacyEntityKey, response.entry.id);
  } catch (error) {
    state.legacyStatus = { kind: "error", message: error.message || "Could not save the legacy parent." };
    requestRender();
  }
}

export async function deleteLegacyParent(legacyId) {
  if (!state.activeProfileId) {
    return;
  }
  try {
    await apiJson(`/api/profiles/${encodeURIComponent(state.activeProfileId)}/legacies/${encodeURIComponent(legacyId)}`, {
      method: "DELETE",
    });
    await loadLegacyForProfile(state.activeProfileId, true);
    state.legacyStatus = { kind: "saved", message: "Deleted local parent." };
    state.legacyFormDraft = null;
    setBrowseHash("roster", legacyEntityKey, null);
  } catch (error) {
    state.legacyStatus = { kind: "error", message: error.message || "Could not delete the legacy parent." };
    requestRender();
  }
}

export async function saveBuildForm(formData, isCreateMode, buildId) {
  if (!state.activeProfileId) {
    return;
  }
  state.buildsStatus = { kind: "saving", message: "Saving build draft locally..." };
  requestRender();
  try {
    const payload = collectBuildPayload(formData);
    const response = await apiJson(
      isCreateMode
        ? `/api/profiles/${encodeURIComponent(state.activeProfileId)}/builds`
        : `/api/profiles/${encodeURIComponent(state.activeProfileId)}/builds/${encodeURIComponent(buildId)}`,
      {
        method: isCreateMode ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      },
    );
    await loadBuildsForProfile(state.activeProfileId, true);
    state.buildsStatus = {
      kind: "saved",
      message: isCreateMode ? "Saved new build draft locally." : "Saved build draft locally.",
    };
    setBrowseHash("roster", buildsEntityKey, response.entry.id);
  } catch (error) {
    state.buildsStatus = { kind: "error", message: error.message || "Could not save the build draft." };
    requestRender();
  }
}

export async function deleteBuild(buildId) {
  if (!state.activeProfileId) {
    return;
  }
  try {
    await apiJson(`/api/profiles/${encodeURIComponent(state.activeProfileId)}/builds/${encodeURIComponent(buildId)}`, {
      method: "DELETE",
    });
    await loadBuildsForProfile(state.activeProfileId, true);
    state.buildsStatus = { kind: "saved", message: "Deleted build draft." };
    setBrowseHash("roster", buildsEntityKey, null);
  } catch (error) {
    state.buildsStatus = { kind: "error", message: error.message || "Could not delete the build draft." };
    requestRender();
  }
}

export async function runLegacySimulatorPreview(formData) {
  if (!state.activeProfileId) {
    return;
  }
  state.legacySimulator.main_character_id = String(formData.get("main_character_id") || "").trim();
  state.legacySimulator.parent_a_legacy_id = String(formData.get("parent_a_legacy_id") || "").trim();
  state.legacySimulator.parent_b_legacy_id = String(formData.get("parent_b_legacy_id") || "").trim();
  state.legacySimulator.status = { kind: "working", message: "Running local inheritance preview..." };
  requestRender();
  try {
    state.legacySimulator.preview = await apiJson(`/api/profiles/${encodeURIComponent(state.activeProfileId)}/legacy-simulator/preview`, {
      method: "POST",
      body: JSON.stringify({
        main_character_id: state.legacySimulator.main_character_id,
        parent_a_legacy_id: state.legacySimulator.parent_a_legacy_id,
        parent_b_legacy_id: state.legacySimulator.parent_b_legacy_id,
      }),
    });
    state.legacySimulator.status = { kind: "saved", message: "Preview updated from local compatibility and saved sparks." };
  } catch (error) {
    state.legacySimulator.preview = null;
    state.legacySimulator.status = { kind: "error", message: error.message || "Could not run the inheritance preview." };
  }
  requestRender();
}
