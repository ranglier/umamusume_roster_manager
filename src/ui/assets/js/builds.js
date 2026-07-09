// Auto-split from app.js as part of docs/REFACTOR_PLAN.md.
import { BUILD_APTITUDE_FIELDS, BUILD_APTITUDE_GRADES, BUILD_MODE_OPTIONS, BUILD_RUNNING_STYLE_OPTIONS, BUILD_STATUS_OPTIONS, BUILD_STAT_FIELDS, BUILD_SUPPORT_TYPES, asArray, data, getActiveProfile, getBuildReferenceLabel, getBuildTargetOptions, getEntityItems, getOwnedCharacterOptions, getOwnedSupportOptions, getRosterViewEntry, normalizeBuildEntry, renderGradeBadge, renderSelectOptions, state } from "./core.js";
import { clampNumber, escapeHtml, parseRosterTokenList, renderBadge, tableFromRows } from "./dom-utils.js";
import { getRosterEntry } from "./roster.js";
import { deleteBuild, formatLegacyFactorLabel, getCharacterReferenceItem, saveBuildForm } from "./legacy.js";
import { attachBuildRunsListeners, renderBuildRunsPanel } from "./runs.js";
import { requestRenderPreservingScroll, requestRenderPreservingScrollAndFocus } from "../app.js";
import {
  compareAptitudeModifiers,
  computeLastSpurtSpeedMax,
  computeMaxHp,
  computeRushedChance,
  computeSkillActivationChance,
  computeStatThresholdBonus,
  findTrackZoneAtDistance,
  getAptitudeModifier,
  getGutsStaminaCrossoverThreshold,
  getLastSpurtStartDistance,
  getNearestStaminaReferences,
} from "./build_scoring.js";

const RUNNING_STYLE_LABELS = { runner: "Front Runner", leader: "Pace Chaser", betweener: "Late Surger", chaser: "End Closer" };


export function getBuildEditorKey(isCreateMode, buildId) {
  return isCreateMode ? "__new__" : String(buildId || "");
}

export function getCurrentBuildFormEntry(entry, isCreateMode) {
  const targetKey = getBuildEditorKey(isCreateMode, entry.id);
  if (state.buildEditor.targetKey === targetKey && state.buildEditor.draft) {
    return normalizeBuildEntry({
      ...entry,
      ...state.buildEditor.draft,
      id: entry.id || state.buildEditor.draft.id || "",
    });
  }
  return normalizeBuildEntry(entry);
}

export function getBuildTargetItem(targetId) {
  const id = String(targetId || "").trim();
  return getEntityItems("cm_targets").find((item) => String(item.id) === id) || null;
}

export function getBuildTargetProfile(entry) {
  const targetItem = getBuildTargetItem(entry.target_id);
  const profile = targetItem?.detail?.race_profile || {};
  return {
    item: targetItem,
    track: profile.track_name || "",
    surface: profile.surface || "",
    surfaceKey: profile.surface_slug || String(profile.surface || "").toLowerCase(),
    distance: profile.distance_m || "",
    distanceCategory: profile.distance_category || "",
    distanceKey: profile.distance_category_slug || String(profile.distance_category || "").toLowerCase(),
    direction: profile.direction || "",
    season: profile.season || "",
    weather: profile.weather || "",
    condition: profile.condition || "",
  };
}

// cm_targets.related_racetracks is a fuzzy match (terrain/distance
// category/direction, no exact course_id - see docs/PROJECT_STATUS.md
// section 11quater vs the races case). Only return a racetrack when the
// match is unambiguous; a stat-threshold bonus computed from the wrong one
// of 2-3 candidates would be worse than not showing one at all.
export function getBuildTargetRacetrack(targetItem) {
  const candidates = asArray(targetItem?.detail?.related_racetracks);
  if (candidates.length !== 1) {
    return null;
  }
  return getEntityItems("racetracks").find((item) => String(item.id) === String(candidates[0].id)) || null;
}

export function renderBuildHint(label, tone = "neutral") {
  return `<span class="build-hint build-hint-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

export function getAptitudeTone(grade) {
  const normalized = String(grade || "").toUpperCase();
  if (normalized === "S" || normalized === "A") return "ok";
  if (normalized === "B" || normalized === "C") return "warn";
  if (normalized) return "bad";
  return "neutral";
}

export function getAptitudeHint(grade) {
  const tone = getAptitudeTone(grade);
  if (tone === "ok") return { label: "Matches target", tone };
  if (tone === "warn") return { label: "Needs inheritance", tone };
  if (tone === "bad") return { label: "Off target", tone };
  return { label: "No target data", tone };
}

export function getCharacterAptitudeForTarget(item, targetProfile) {
  const aptitudes = item?.detail?.aptitudes || {};
  const surfaceGrade = targetProfile.surfaceKey ? aptitudes.surface?.[targetProfile.surfaceKey] : "";
  const distanceGrade = targetProfile.distanceKey ? aptitudes.distance?.[targetProfile.distanceKey] : "";
  return {
    surfaceGrade: surfaceGrade || "",
    distanceGrade: distanceGrade || "",
    surfaceHint: getAptitudeHint(surfaceGrade),
    distanceHint: getAptitudeHint(distanceGrade),
    useful: ["S", "A"].includes(String(surfaceGrade || "").toUpperCase()) && ["S", "A"].includes(String(distanceGrade || "").toUpperCase()),
    workable: ["S", "A", "B", "C"].includes(String(surfaceGrade || "").toUpperCase()) && ["S", "A", "B", "C"].includes(String(distanceGrade || "").toUpperCase()),
  };
}

// Real game coefficients (docs/RACE_MECHANICS_REFERENCE.md), comparing the
// character's current aptitude grade against the build's planned
// (post-inheritance) target grade - replaces the old S/A-vs-rest binary
// bucket with the actual multiplier and the gain inheritance would buy.
export function getCharacterAptitudeFit(item, targetProfile, entry) {
  const aptitudes = item?.detail?.aptitudes || {};
  const targetAptitudes = entry?.target_aptitudes || {};
  const styleKey = entry?.running_style || "";

  const surfaceCurrentGrade = targetProfile.surfaceKey ? aptitudes.surface?.[targetProfile.surfaceKey] : "";
  const distanceCurrentGrade = targetProfile.distanceKey ? aptitudes.distance?.[targetProfile.distanceKey] : "";
  const styleCurrentGrade = styleKey ? aptitudes.style?.[styleKey] : "";

  const withGrades = (kind, currentGrade, targetGrade) => ({
    ...compareAptitudeModifiers(kind, currentGrade, targetGrade),
    currentGrade: currentGrade || "",
    targetGrade: targetGrade || "",
  });

  return {
    surfaceAccel: withGrades("surfaceAccel", surfaceCurrentGrade, targetAptitudes.surface),
    distanceSpeed: withGrades("distanceSpeed", distanceCurrentGrade, targetAptitudes.distance),
    distanceAccel: withGrades("distanceAccel", distanceCurrentGrade, targetAptitudes.distance),
    style: styleKey ? withGrades("styleWiz", styleCurrentGrade, targetAptitudes.style) : null,
  };
}

function formatModifier(value) {
  return value != null ? `${value.toFixed(2)}x` : "-";
}

function renderAptitudeFitRow(label, fit) {
  if (!fit) {
    return "";
  }
  const currentGradeMarkup = fit.currentGrade ? renderGradeBadge(fit.currentGrade) : escapeHtml("Unknown");
  const targetText = fit.targetGrade ? `${fit.targetGrade} (${formatModifier(fit.target)})` : "no target set";
  const gainText = fit.gain == null ? "" : fit.gain === 0 ? " · no change planned" : ` · ${fit.gain > 0 ? "+" : ""}${fit.gain.toFixed(2)}x planned`;
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${currentGradeMarkup} <span>(${escapeHtml(formatModifier(fit.current))})</span></strong>
      <small>${escapeHtml(`-> ${targetText}${gainText}`)}</small>
    </div>
  `;
}

export function getBuildCharacterOptions(entry) {
  const targetProfile = getBuildTargetProfile(entry);
  const options = getOwnedCharacterOptions().map((option) => {
    const item = getCharacterReferenceItem(option.value);
    const analysis = getCharacterAptitudeForTarget(item, targetProfile);
    const hint = !targetProfile.item
      ? "No CM target"
      : `${targetProfile.surface || "Surface"} ${analysis.surfaceGrade || "-"} / ${targetProfile.distanceCategory || "Distance"} ${analysis.distanceGrade || "-"}`;
    return { ...option, analysis, hint };
  });
  if (!targetProfile.item || state.buildEditor.showAllCharacters) {
    return { recommended: options, other: [], hiddenCount: 0 };
  }
  const recommended = options.filter((option) => option.analysis.workable || option.value === entry.character_id);
  return {
    recommended,
    other: [],
    hiddenCount: Math.max(0, options.length - recommended.length),
  };
}

export function renderBuildCharacterSelect(entry) {
  const groups = getBuildCharacterOptions(entry);
  const renderOptions = (options) => options.map((option) => `
    <option value="${escapeHtml(option.value)}" ${String(option.value) === String(entry.character_id || "") ? "selected" : ""}>
      ${escapeHtml(`${option.label} - ${option.hint}`)}
    </option>
  `).join("");
  const noOptions = !groups.recommended.length && !groups.other.length;
  return `
    <select name="character_id" id="buildCharacterSelect">
      <option value="">Select an owned character</option>
      ${groups.recommended.length ? `<optgroup label="${state.buildEditor.showAllCharacters ? "Owned characters" : "Useful for target"}">${renderOptions(groups.recommended)}</optgroup>` : ""}
      ${groups.other.length ? `<optgroup label="Other owned">${renderOptions(groups.other)}</optgroup>` : ""}
    </select>
    ${groups.hiddenCount ? `<small class="source-note">${escapeHtml(`${groups.hiddenCount} off-target owned characters hidden.`)}</small>` : ""}
    ${noOptions ? "<small class='source-note error-text'>No owned character yet. Add one from Catalog first.</small>" : ""}
    <label class="build-inline-toggle"><input type="checkbox" id="buildShowAllCharacters" ${state.buildEditor.showAllCharacters ? "checked" : ""}> Show all owned characters</label>
  `;
}

export function getSupportReferenceItem(supportId) {
  return getEntityItems("supports").find((item) => String(item.id) === String(supportId)) || null;
}

export function getSupportOwnedSummary(supportId) {
  const item = getSupportReferenceItem(supportId);
  const entry = item ? getRosterEntry("supports", item) : {};
  const derived = item ? getRosterViewEntry("supports", item)?.derived : null;
  return {
    item,
    entry,
    derived,
    type: String(item?.detail?.type || "").toLowerCase(),
    typeLabel: item?.detail?.type ? String(item.detail.type).replace(/^./, (char) => char.toUpperCase()) : "Support",
    rarity: Number(item?.detail?.rarity || 0),
    levelText: derived ? `${derived.level || 1}/${derived.level_cap || "-"}` : entry?.level ? `${entry.level}` : "-",
    lbText: entry?.limit_break != null ? `${entry.limit_break}/4` : "-",
  };
}

export function getBuildSupportOptions(entry) {
  const selected = new Set(asArray(entry.support_deck).map(String));
  const all = getOwnedSupportOptions().map((option) => ({
    ...option,
    summary: getSupportOwnedSummary(option.value),
    selected: selected.has(String(option.value)),
  }));
  if (state.buildEditor.showAllSupports || !state.buildEditor.supportType) {
    return all;
  }
  return all.filter((option) => option.summary.type === state.buildEditor.supportType || option.selected);
}

export function getLegacySparkSummaryText(item) {
  const summary = item?.detail?.spark_summary || {};
  const pieces = [];
  if (summary.blue) pieces.push(`Blue ${formatLegacyFactorLabel(summary.blue)}`);
  if (summary.pink) pieces.push(`Pink ${formatLegacyFactorLabel(summary.pink)}`);
  if (summary.green) pieces.push(`Green ${formatLegacyFactorLabel(summary.green)}`);
  if (summary.white_count) pieces.push(`${summary.white_count} white`);
  return pieces.join(" | ");
}

export function legacyMatchesBuildTarget(item, targetProfile) {
  const pink = item?.detail?.spark_summary?.pink;
  if (!pink || !targetProfile.item) {
    return false;
  }
  if (pink.kind === "surface" && pink.target_key === targetProfile.surfaceKey) {
    return true;
  }
  if (pink.kind === "distance" && pink.target_key === targetProfile.distanceKey) {
    return true;
  }
  return false;
}

export function getBuildParentOptions(entry) {
  const targetProfile = getBuildTargetProfile(entry);
  const selected = new Set([entry.legacy_pair?.parent_a, entry.legacy_pair?.parent_b].filter(Boolean));
  const all = state.legacyView.items.map((item) => ({
    value: item.id,
    label: item.subtitle ? `${item.title} ${item.subtitle}` : item.title,
    sparkText: getLegacySparkSummaryText(item),
    matchesTarget: legacyMatchesBuildTarget(item, targetProfile),
    selected: selected.has(item.id),
  }));
  if (!targetProfile.item || state.buildEditor.showAllParents) {
    return { visible: all, hiddenCount: 0 };
  }
  const visible = all.filter((option) => option.matchesTarget || option.selected);
  return { visible, hiddenCount: Math.max(0, all.length - visible.length) };
}

export function getSkillReferenceItem(skillId) {
  const id = String(skillId || "").trim();
  return getEntityItems("skills").find((item) => String(item.id) === id || String(item.detail?.skill_id || "") === id) || null;
}

export function renderBuildSkillChip(skillId, bucket) {
  const item = getSkillReferenceItem(skillId);
  const detail = item?.detail || {};
  const title = item?.title || detail.name || String(skillId);
  const meta = [
    `#${skillId}`,
    detail.rarity != null ? `R${detail.rarity}` : "",
    detail.cost != null ? `Cost ${detail.cost}` : "",
  ].filter(Boolean).join(" | ");
  return `
    <span class="build-skill-chip" data-skill-id="${escapeHtml(skillId)}" data-skill-bucket="${escapeHtml(bucket)}">
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></span>
      <button type="button" data-skill-remove="${escapeHtml(skillId)}" data-skill-bucket="${escapeHtml(bucket)}" aria-label="Remove ${escapeHtml(title)}">x</button>
    </span>
  `;
}

export function getBuildSkillSearchResults(entry) {
  const query = String(state.buildEditor.skillQuery || "").trim().toLowerCase();
  if (!query) {
    return [];
  }
  const selected = new Set([...asArray(entry.required_skills), ...asArray(entry.optional_skills)].map(String));
  return getEntityItems("skills")
    .filter((item) => {
      if (selected.has(String(item.id))) {
        return false;
      }
      const detail = item.detail || {};
      const haystack = [
        item.id,
        item.title,
        item.subtitle,
        detail.skill_id,
        detail.name,
        asArray(detail.type_tags).join(" "),
        asArray(detail.localized_type_tags).join(" "),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .slice(0, 12);
}

export function getBuildSkillSourceLabels(entry, skillId) {
  const labels = [];
  const id = String(skillId || "");
  const referenceSkill = getSkillReferenceItem(id);
  const knownIds = new Set([id, String(referenceSkill?.id || ""), String(referenceSkill?.detail?.skill_id || "")].filter(Boolean));
  const skillMatches = (skill) => knownIds.has(String(skill?.id || "")) || knownIds.has(String(skill?.skill_id || ""));
  const character = getCharacterReferenceItem(entry.character_id);
  if (character) {
    Object.entries(character.detail?.skill_links || {}).forEach(([kind, skills]) => {
      if (asArray(skills).some(skillMatches)) {
        labels.push(`Character ${kind}`);
      }
    });
  }
  asArray(entry.support_deck).forEach((supportId) => {
    const support = getSupportReferenceItem(supportId);
    if (!support) return;
    if (asArray(support.detail?.hint_skills).some(skillMatches)) {
      labels.push(`${support.title} hint`);
    }
    if (asArray(support.detail?.event_skills).some(skillMatches)) {
      labels.push(`${support.title} event`);
    }
  });
  [entry.legacy_pair?.parent_a, entry.legacy_pair?.parent_b].filter(Boolean).forEach((legacyId) => {
    const legacy = state.legacyView.items.find((item) => item.id === legacyId);
    const factors = asArray(legacy?.detail?.factors);
    if (factors.some((factor) => knownIds.has(String(factor.skill_id || factor.target_key || "")))) {
      labels.push(`${legacy.title} spark`);
    }
  });
  return labels.slice(0, 4);
}

export function createEmptyBuildEntry() {
  // A CM-target recommendation may have seeded a pre-filled draft (character,
  // style, target stats). Consume it once; fall back to the first available
  // options otherwise. The seed's fields override the arbitrary defaults.
  const seed = state.pendingBuildSeed;
  state.pendingBuildSeed = null;
  return {
    id: "",
    mode: "champions_meeting",
    name: seed?.name || "",
    target_id: seed?.target_id || getBuildTargetOptions("cm_targets")[0]?.value || "",
    character_id: seed?.character_id || getOwnedCharacterOptions()[0]?.value || "",
    scenario_id: getBuildTargetOptions("scenarios")[0]?.value || "",
    running_style: seed?.running_style || "",
    support_deck: asArray(seed?.support_deck).slice(0, 6),
    legacy_pair: {
      parent_a: state.legacyView.items[0]?.id || "",
      parent_b: state.legacyView.items[1]?.id || "",
    },
    target_stats: seed?.target_stats || {},
    target_aptitudes: {},
    required_skills: asArray(seed?.required_skills),
    optional_skills: asArray(seed?.optional_skills),
    status: "draft",
    notes: "",
    custom_tags: [],
    created_at: "",
    updated_at: "",
  };
}

// Seeds a pre-filled create draft and stores it as the persistent editor draft
// so it survives the async render loop (renderDetail may call
// createEmptyBuildEntry more than once; the one-shot seed alone would be
// consumed by the first pass and lost). Callers navigate to "__new__" after.
export function startSeededBuildDraft(seed) {
  state.pendingBuildSeed = seed;
  state.buildEditor.targetKey = "__new__";
  state.buildEditor.draft = createEmptyBuildEntry();
  state.buildEditor.activeFormTab = "setup";
}

export function renderBuildSupportPicker(selectedSupportIds) {
  const selected = new Set(asArray(selectedSupportIds).map(String));
  const selectedCount = selected.size;
  const supports = getBuildSupportOptions({ support_deck: selectedSupportIds });
  if (!supports.length) {
    return `
      <div class="build-picker-toolbar">
        <label class="field-stack">
          <span>Type filter</span>
          <select id="buildSupportTypeFilter" ${state.buildEditor.showAllSupports ? "disabled" : ""}>
            ${BUILD_SUPPORT_TYPES.map((option) => `<option value="${escapeHtml(option.value)}" ${state.buildEditor.supportType === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
        <label class="build-inline-toggle"><input type="checkbox" id="buildShowAllSupports" ${state.buildEditor.showAllSupports ? "checked" : ""}> Show all owned supports</label>
      </div>
      <p class='source-note'>No owned support matches this filter. Add supports from Catalog or change the type filter.</p>
    `;
  }
  return `
    <div class="build-picker-toolbar">
      <label class="field-stack">
        <span>Type filter</span>
        <select id="buildSupportTypeFilter" ${state.buildEditor.showAllSupports ? "disabled" : ""}>
          ${BUILD_SUPPORT_TYPES.map((option) => `<option value="${escapeHtml(option.value)}" ${state.buildEditor.supportType === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
      <label class="build-inline-toggle"><input type="checkbox" id="buildShowAllSupports" ${state.buildEditor.showAllSupports ? "checked" : ""}> Show all owned supports</label>
    </div>
    <div class="build-choice-grid">
      ${supports.map((option) => {
        const isSelected = selected.has(String(option.value));
        const summary = option.summary;
        const skillCount = asArray(summary.item?.detail?.hint_skills).length + asArray(summary.item?.detail?.event_skills).length;
        return `
          <label class="build-choice ${isSelected ? "active" : ""}">
            <input type="checkbox" name="support_deck" value="${escapeHtml(option.value)}" ${isSelected ? "checked" : ""}>
            <span>
              <strong>${escapeHtml(option.label)}</strong>
              <small>${escapeHtml(`${summary.typeLabel} | R${summary.rarity || "-"} | Lv ${summary.levelText} | LB ${summary.lbText} | ${skillCount} skills`)}</small>
            </span>
          </label>
        `;
      }).join("")}
    </div>
    <p class="source-note">${escapeHtml(`${selectedCount}/6 supports selected.`)}</p>
  `;
}

export function renderBuildStatsFields(entry) {
  return `
    <div class="roster-field-grid">
      ${BUILD_STAT_FIELDS.map((field) => `
        <label class="field-stack">
          <span>${escapeHtml(field.label)}</span>
          <input name="stat_${escapeHtml(field.key)}" type="number" min="0" max="2500" value="${escapeHtml(entry.target_stats?.[field.key] ?? "")}" placeholder="0">
        </label>
      `).join("")}
    </div>
  `;
}

export function renderBuildAptitudeFields(entry) {
  return `
    <div class="roster-field-grid">
      ${BUILD_APTITUDE_FIELDS.map((field) => `
        <label class="field-stack">
          <span>${escapeHtml(field.label)}</span>
          <select name="aptitude_${escapeHtml(field.key)}">
            ${BUILD_APTITUDE_GRADES.map((grade) => `
              <option value="${escapeHtml(grade)}" ${String(entry.target_aptitudes?.[field.key] || "").toUpperCase() === grade ? "selected" : ""}>${escapeHtml(grade || "None")}</option>
            `).join("")}
          </select>
        </label>
      `).join("")}
    </div>
  `;
}

export function renderBuildTargetPanel(entry) {
  const profile = getBuildTargetProfile(entry);
  if (!profile.item) {
    return `
      <section class="build-panel">
        <div class="build-panel-head">
          <h4>CM Target</h4>
          ${renderBuildHint("No target", "neutral")}
        </div>
        <p class="source-note">Select a Champions Meeting target to unlock target-aware hints.</p>
      </section>
    `;
  }
  return `
    <section class="build-panel">
      <div class="build-panel-head">
        <h4>${escapeHtml(profile.item.title || "CM Target")}</h4>
        ${renderBuildHint("Target loaded", "ok")}
      </div>
      <div class="build-metric-grid">
        <div><span>Track</span><strong>${escapeHtml(profile.track || "-")}</strong></div>
        <div><span>Surface</span><strong>${escapeHtml(profile.surface || "-")}</strong></div>
        <div><span>Distance</span><strong>${escapeHtml(profile.distance ? `${profile.distance}m` : "-")}</strong></div>
        <div><span>Category</span><strong>${escapeHtml(profile.distanceCategory || "-")}</strong></div>
        <div><span>Direction</span><strong>${escapeHtml(profile.direction || "-")}</strong></div>
        <div><span>Season</span><strong>${escapeHtml(profile.season || "-")}</strong></div>
        <div><span>Weather</span><strong>${escapeHtml(profile.weather || "-")}</strong></div>
        <div><span>Condition</span><strong>${escapeHtml(profile.condition || "-")}</strong></div>
      </div>
    </section>
  `;
}

export function renderBuildCharacterPanel(entry) {
  const item = getCharacterReferenceItem(entry.character_id);
  const target = getBuildTargetProfile(entry);
  if (!item) {
    return `
      <section class="build-panel">
        <div class="build-panel-head">
          <h4>Main Character</h4>
          ${renderBuildHint("No owned option", "bad")}
        </div>
        <p class="source-note">Select an owned character to inspect target aptitudes.</p>
      </section>
    `;
  }
  const analysis = getCharacterAptitudeForTarget(item, target);
  const fit = getCharacterAptitudeFit(item, target, entry);
  return `
    <section class="build-panel">
      <div class="build-panel-head">
        <h4>${escapeHtml(item.title)}</h4>
        ${renderBuildHint(analysis.useful ? "Matches target" : analysis.workable ? "Needs inheritance" : "Off target", analysis.useful ? "ok" : analysis.workable ? "warn" : "bad")}
      </div>
      <div class="build-metric-grid">
        <div><span>Variant</span><strong>${escapeHtml(item.subtitle || "-")}</strong></div>
        <div><span>Rarity</span><strong>${escapeHtml(item.detail?.rarity || "-")}</strong></div>
        ${renderAptitudeFitRow(`${target.surface || "Surface"} (accel)`, fit.surfaceAccel)}
        ${renderAptitudeFitRow(`${target.distanceCategory || "Distance"} (speed)`, fit.distanceSpeed)}
        ${renderAptitudeFitRow(`${target.distanceCategory || "Distance"} (accel)`, fit.distanceAccel)}
        ${fit.style ? renderAptitudeFitRow(`${RUNNING_STYLE_LABELS[entry.running_style] || "Style"} (Wiz)`, fit.style) : ""}
      </div>
      ${!entry.running_style ? "<p class='source-note'>Choose a running style below to also see the Style/Wiz aptitude fit.</p>" : ""}
    </section>
  `;
}

export function renderBuildSupportPanel(entry) {
  const selectedSupports = asArray(entry.support_deck);
  if (!selectedSupports.length) {
    return `
      <section class="build-panel">
        <div class="build-panel-head">
          <h4>Support Deck</h4>
          ${renderBuildHint("No owned options", "warn")}
        </div>
        <p class="source-note">Select up to 6 owned supports to inspect deck balance and available skills.</p>
      </section>
    `;
  }
  const summaries = selectedSupports.map(getSupportOwnedSummary).filter((summary) => summary.item);
  const typeCounts = new Map();
  summaries.forEach((summary) => typeCounts.set(summary.typeLabel, (typeCounts.get(summary.typeLabel) || 0) + 1));
  return `
    <section class="build-panel">
      <div class="build-panel-head">
        <h4>Support Deck</h4>
        ${renderBuildHint(`${summaries.length}/6 selected`, summaries.length === 6 ? "ok" : "warn")}
      </div>
      <div class="badge-row">${Array.from(typeCounts.entries()).map(([type, count]) => renderBadge(`${type} x${count}`)).join("")}</div>
      <div class="build-card-list">
        ${summaries.map((summary) => {
          const hints = asArray(summary.item.detail?.hint_skills).slice(0, 3).map((skill) => skill.name).filter(Boolean);
          const events = asArray(summary.item.detail?.event_skills).slice(0, 2).map((skill) => skill.name).filter(Boolean);
          return `
            <article class="build-mini-card">
              <strong>${escapeHtml(summary.item.title)}</strong>
              <span>${escapeHtml(`${summary.typeLabel} | R${summary.rarity || "-"} | Lv ${summary.levelText} | LB ${summary.lbText}`)}</span>
              <small>${escapeHtml([...hints, ...events].join(" | ") || "No skill summary")}</small>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

export function renderBuildParentPanel(entry) {
  const parentIds = [entry.legacy_pair?.parent_a, entry.legacy_pair?.parent_b].filter(Boolean);
  if (!parentIds.length) {
    return `
      <section class="build-panel">
        <div class="build-panel-head">
          <h4>Parents</h4>
          ${renderBuildHint("No parents", "warn")}
        </div>
        <p class="source-note">Select saved parents to inspect pink spark target coverage.</p>
      </section>
    `;
  }
  const target = getBuildTargetProfile(entry);
  return `
    <section class="build-panel">
      <div class="build-panel-head">
        <h4>Parents</h4>
        ${renderBuildHint(parentIds.length >= 2 ? "Pair selected" : "Partial pair", parentIds.length >= 2 ? "ok" : "warn")}
      </div>
      <div class="build-card-list">
        ${parentIds.map((legacyId) => {
          const item = state.legacyView.items.find((entryItem) => entryItem.id === legacyId);
          if (!item) {
            return `<article class="build-mini-card"><strong>${escapeHtml(legacyId)}</strong><span>Missing legacy parent</span></article>`;
          }
          const matches = legacyMatchesBuildTarget(item, target);
          return `
            <article class="build-mini-card">
              <strong>${escapeHtml(item.title)}</strong>
              <span>${escapeHtml(item.subtitle || "Saved parent")}</span>
              <small>${escapeHtml(getLegacySparkSummaryText(item) || "No spark summary")}</small>
              ${renderBuildHint(matches ? "Pink matches target" : "Pink off target", matches ? "ok" : "warn")}
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

export function renderBuildSkillPanel(entry) {
  const skills = [
    ...asArray(entry.required_skills).map((skillId) => ({ skillId, bucket: "required" })),
    ...asArray(entry.optional_skills).map((skillId) => ({ skillId, bucket: "optional" })),
  ];
  if (!skills.length) {
    return `
      <section class="build-panel">
        <div class="build-panel-head">
          <h4>Skills</h4>
          ${renderBuildHint("No skills", "neutral")}
        </div>
        <p class="source-note">Add required and optional skills with the local search below.</p>
      </section>
    `;
  }
  return `
    <section class="build-panel">
      <div class="build-panel-head">
        <h4>Skills</h4>
        ${renderBuildHint(`${skills.length} selected`, "ok")}
      </div>
      <div class="build-card-list">
        ${skills.map(({ skillId, bucket }) => {
          const item = getSkillReferenceItem(skillId);
          const sources = getBuildSkillSourceLabels(entry, skillId);
          return `
            <article class="build-mini-card">
              <strong>${escapeHtml(item?.title || skillId)}</strong>
              <span>${escapeHtml(`${bucket === "required" ? "Required" : "Optional"} | #${skillId}${item?.detail?.cost != null ? ` | Cost ${item.detail.cost}` : ""}`)}</span>
              <small>${escapeHtml(sources.join(" | ") || "No source detected in selected character/supports/parents")}</small>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

// Tier 1 deterministic feasibility (docs/CM_BUILD_PLAN.md phase 3D): pure
// game formulas from docs/RACE_MECHANICS_REFERENCE.md applied to the build's
// own target_stats/running_style - no opponent or position simulation.
export function renderBuildFeasibilityPanel(entry) {
  const target = getBuildTargetProfile(entry);
  if (!target.item) {
    return `
      <section class="build-panel">
        <div class="build-panel-head">
          <h4>Feasibility</h4>
          ${renderBuildHint("No target", "neutral")}
        </div>
        <p class="source-note">Select a CM target and a running style to compute HP, stat thresholds and skill activation odds.</p>
      </section>
    `;
  }
  if (!entry.running_style) {
    return `
      <section class="build-panel">
        <div class="build-panel-head">
          <h4>Feasibility</h4>
          ${renderBuildHint("No running style", "warn")}
        </div>
        <p class="source-note">Choose a running style below - HP and stat-threshold formulas both depend on it.</p>
      </section>
    `;
  }

  const stats = entry.target_stats || {};
  const stamina = Number(stats.stamina);
  const guts = Number(stats.guts);
  const wit = Number(stats.wit);
  const maxHp = Number.isFinite(stamina) ? computeMaxHp(stamina, target.distance, entry.running_style) : null;
  const nearestStamina = getNearestStaminaReferences(target.distance, 2);
  const racetrack = getBuildTargetRacetrack(target.item);
  const thresholdIndices = asArray(racetrack?.detail?.stat_thresholds);
  const thresholdBonus = thresholdIndices.length ? computeStatThresholdBonus(stats, thresholdIndices) : null;
  const activationChance = Number.isFinite(wit) ? computeSkillActivationChance(wit) : null;
  const rushedChance = Number.isFinite(wit) ? computeRushedChance(wit) : null;
  const gutsThreshold = getGutsStaminaCrossoverThreshold(target.distanceKey, target.distance, target.surfaceKey);

  return `
    <section class="build-panel">
      <div class="build-panel-head">
        <h4>Feasibility</h4>
        ${renderBuildHint("Tier 1 - formulas only", "ok")}
      </div>
      <div class="build-metric-grid">
        <div>
          <span>Max HP (${escapeHtml(RUNNING_STYLE_LABELS[entry.running_style])})</span>
          <strong>${maxHp != null ? escapeHtml(Math.round(maxHp).toString()) : "-"}</strong>
          <small>${escapeHtml(stamina ? `${target.distance}m + 0.8 x style coef x ${stamina} Stamina` : "Set a target Stamina to compute")}</small>
        </div>
        <div>
          <span>Nearest Stamina reference points</span>
          <strong>${nearestStamina.length ? escapeHtml(nearestStamina.map((row) => `${row[entry.running_style]}`).join(" / ")) : "-"}</strong>
          <small>${escapeHtml(nearestStamina.length ? nearestStamina.map((row) => `${row.distanceM}m + ${row.recoveries} gold(s)`).join(" | ") : "No umalator reference this close to this distance")}</small>
        </div>
        <div>
          <span>Stat threshold bonus</span>
          <strong>${thresholdBonus != null ? `+${(thresholdBonus * 100).toFixed(1)}%` : "-"}</strong>
          <small>${escapeHtml(
            thresholdIndices.length
              ? `Speed bonus on this track's threshold stat(s), from target_stats`
              : racetrack
                ? "This track has no secret stat threshold"
                : "Track not uniquely determined from this CM target - not shown"
          )}</small>
        </div>
        <div>
          <span>Skill activation chance</span>
          <strong>${activationChance != null ? `${activationChance.toFixed(1)}%` : "-"}</strong>
          <small>${escapeHtml(wit ? `From ${wit} base Wisdom (pre-race check, same for greens)` : "Set a target Wisdom to compute")}</small>
        </div>
        <div>
          <span>Rushed (Kakari) chance</span>
          <strong>${rushedChance != null ? `${rushedChance.toFixed(1)}%` : "-"}</strong>
          <small>${escapeHtml("Also rolled from Wisdom, before the race")}</small>
        </div>
        <div>
          <span>Guts/Stamina crossover</span>
          <strong>${gutsThreshold != null ? `${gutsThreshold} Guts` : "-"}</strong>
          <small>${escapeHtml(
            gutsThreshold == null
              ? "No documented threshold for this distance"
              : Number.isFinite(guts)
                ? guts >= gutsThreshold
                  ? `${guts} Guts is above it - extra Stamina matters more now`
                  : `${guts} Guts is below it - extra Guts still outvalues Stamina`
                : "Set a target Guts to compare"
          )}</small>
        </div>
      </div>
    </section>
  `;
}

// Tier 2 (docs/CM_BUILD_PLAN.md phase 3D): projects where the last spurt
// starts, assuming Stamina covers the remainder (the HP-sufficient case -
// see getLastSpurtStartDistance), then reads that position against the
// same corner/straight/slope zones the racetrack's Skill Visualizer draws.
// Still no opponents or position simulation.
export function renderBuildSpurtPanel(entry) {
  const target = getBuildTargetProfile(entry);
  if (!target.item) {
    return `
      <section class="build-panel">
        <div class="build-panel-head">
          <h4>Last Spurt Projection</h4>
          ${renderBuildHint("No target", "neutral")}
        </div>
        <p class="source-note">Select a CM target to project where the last spurt starts.</p>
      </section>
    `;
  }
  if (!entry.running_style) {
    return `
      <section class="build-panel">
        <div class="build-panel-head">
          <h4>Last Spurt Projection</h4>
          ${renderBuildHint("No running style", "warn")}
        </div>
        <p class="source-note">Choose a running style below to project the spurt start.</p>
      </section>
    `;
  }
  const racetrack = getBuildTargetRacetrack(target.item);
  if (!racetrack) {
    return `
      <section class="build-panel">
        <div class="build-panel-head">
          <h4>Last Spurt Projection</h4>
          ${renderBuildHint("Track ambiguous", "warn")}
        </div>
        <p class="source-note">This CM target doesn't resolve to a single racetrack (same limit as the stat-threshold bonus above) - the projection needs exact course geometry, so it isn't shown.</p>
      </section>
    `;
  }

  const stats = entry.target_stats || {};
  const speed = Number(stats.speed);
  const guts = Number(stats.guts);
  const distanceProficiency = getAptitudeModifier("distanceSpeed", entry.target_aptitudes?.distance);
  const spurtSpeed =
    Number.isFinite(speed) && Number.isFinite(guts) && distanceProficiency != null
      ? computeLastSpurtSpeedMax({ distanceM: target.distance, speedStat: speed, distanceProficiency, gutsStat: guts, styleKey: entry.running_style })
      : null;
  const spurtStartDistance = getLastSpurtStartDistance(target.distance);
  const zone = spurtStartDistance != null ? findTrackZoneAtDistance(racetrack.detail, spurtStartDistance) : null;
  const zoneParts = [];
  if (zone?.cornerNumber != null) zoneParts.push(`Corner #${zone.cornerNumber}`);
  if (zone?.onStraight) zoneParts.push("Straight");
  if (zone?.slope) zoneParts.push(zone.slope === "uphill" ? "Uphill" : "Downhill");

  return `
    <section class="build-panel">
      <div class="build-panel-head">
        <h4>Last Spurt Projection</h4>
        ${renderBuildHint("Tier 2 - HP-sufficient case", "ok")}
      </div>
      <div class="build-metric-grid">
        <div>
          <span>Projected spurt start</span>
          <strong>${spurtStartDistance != null ? escapeHtml(`${Math.round(spurtStartDistance)}m`) : "-"}</strong>
          <small>${escapeHtml(
            spurtStartDistance != null
              ? `${((spurtStartDistance / target.distance) * 100).toFixed(1)}% of the course - assumes Stamina covers the rest, see Feasibility`
              : "Missing course distance"
          )}</small>
        </div>
        <div>
          <span>Track element there</span>
          <strong>${escapeHtml(zoneParts.length ? zoneParts.join(" + ") : "Between marked zones")}</strong>
          <small>Cross-check with this racetrack's Skill Visualizer for skills covering this zone</small>
        </div>
        <div>
          <span>Max spurt speed</span>
          <strong>${spurtSpeed != null ? `${spurtSpeed.toFixed(2)} m/s` : "-"}</strong>
          <small>${escapeHtml(spurtSpeed != null ? "Formula from docs/RACE_MECHANICS_REFERENCE.md" : "Set target Speed/Guts and a Distance aptitude target to compute")}</small>
        </div>
      </div>
    </section>
  `;
}

export function renderBuildInsightPanels(entry) {
  return `
    <div class="build-panel-grid">
      ${renderBuildTargetPanel(entry)}
      ${renderBuildCharacterPanel(entry)}
      ${renderBuildFeasibilityPanel(entry)}
      ${renderBuildSpurtPanel(entry)}
      ${renderBuildSupportPanel(entry)}
      ${renderBuildParentPanel(entry)}
      ${renderBuildSkillPanel(entry)}
    </div>
  `;
}

export function renderBuildSkillEditor(entry) {
  const results = getBuildSkillSearchResults(entry);
  return `
    <div class="build-form-section">
      <h3>Skills</h3>
      <input type="hidden" name="required_skills" value="${escapeHtml(asArray(entry.required_skills).join(", "))}">
      <input type="hidden" name="optional_skills" value="${escapeHtml(asArray(entry.optional_skills).join(", "))}">
      <div class="build-skill-columns">
        <div class="build-skill-bucket">
          <h4>Required</h4>
          <div class="build-skill-chip-row">
            ${asArray(entry.required_skills).map((skillId) => renderBuildSkillChip(skillId, "required")).join("") || "<p class='source-note'>No required skill selected.</p>"}
          </div>
        </div>
        <div class="build-skill-bucket">
          <h4>Optional</h4>
          <div class="build-skill-chip-row">
            ${asArray(entry.optional_skills).map((skillId) => renderBuildSkillChip(skillId, "optional")).join("") || "<p class='source-note'>No optional skill selected.</p>"}
          </div>
        </div>
      </div>
      <label class="field-stack field-stack-full">
        <span>Skill search</span>
        <input id="buildSkillSearchInput" type="search" value="${escapeHtml(state.buildEditor.skillQuery)}" placeholder="Search skill name, id or tag">
      </label>
      <div class="build-skill-results">
        ${state.buildEditor.skillQuery && !results.length ? "<p class='source-note'>No skill found for this search.</p>" : ""}
        ${results.map((item) => {
          const detail = item.detail || {};
          const meta = [
            `#${item.id}`,
            detail.rarity != null ? `R${detail.rarity}` : "",
            detail.cost != null ? `Cost ${detail.cost}` : "",
          ].filter(Boolean).join(" | ");
          return `
            <article class="build-skill-result">
              <div>
                <strong>${escapeHtml(item.title || detail.name || item.id)}</strong>
                <span>${escapeHtml(meta)}</span>
              </div>
              <div class="build-skill-result-actions">
                <button type="button" class="button-secondary" data-skill-add="required" data-skill-id="${escapeHtml(item.id)}">Required</button>
                <button type="button" class="button-secondary" data-skill-add="optional" data-skill-id="${escapeHtml(item.id)}">Optional</button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

export function renderBuildReferenceSummary(entry, labels) {
  const supportLabels = asArray(entry.support_deck)
    .map((supportId) => getBuildReferenceLabel("supports", supportId))
    .filter(Boolean);
  const requiredSkills = asArray(entry.required_skills).map((skillId) => getBuildReferenceLabel("skills", skillId)).filter(Boolean);
  const optionalSkills = asArray(entry.optional_skills).map((skillId) => getBuildReferenceLabel("skills", skillId)).filter(Boolean);

  return `
    <div class="roster-editor-highlight build-summary">
      <h4>Build Summary</h4>
      ${tableFromRows([
        ["Mode", escapeHtml(labels.mode || "-")],
        ["Status", escapeHtml(labels.status || "-")],
        ["Target", escapeHtml(labels.target || "-")],
        ["Character", escapeHtml(labels.character || "-")],
        ["Scenario", escapeHtml(labels.scenario || "-")],
        ["Parents", escapeHtml(asArray(labels.parents).join(" / ") || "-")],
        ["Support deck", escapeHtml(supportLabels.join(" / ") || "-")],
        ["Required skills", escapeHtml(requiredSkills.join(" / ") || asArray(entry.required_skills).join(", ") || "-")],
        ["Optional skills", escapeHtml(optionalSkills.join(" / ") || asArray(entry.optional_skills).join(", ") || "-")],
      ])}
    </div>
  `;
}

export const BUILD_EDITOR_TABS = [
  { key: "setup", label: "Setup" },
  { key: "deck", label: "Support Deck" },
  { key: "stats", label: "Stats & Aptitudes" },
  { key: "skills", label: "Skills" },
  { key: "legacy", label: "Parents" },
  { key: "notes", label: "Notes & Tags" },
  { key: "runs", label: "Runs" },
];

// Phase 4 guided assistant (create mode only): the existing editor tabs presented
// as a linear journey with a final recap. Parents/Notes stay out of the guided
// flow — they remain available once the draft is saved and reopens in edit mode's
// full tab set. Reuses the exact same tab panel bodies, so nothing is duplicated.
export const BUILD_ASSISTANT_STEPS = [
  { key: "setup", label: "Target & uma" },
  { key: "deck", label: "Deck" },
  { key: "stats", label: "Stats" },
  { key: "skills", label: "Skills" },
  { key: "recap", label: "Recap" },
];

// Ergonomic rework (docs/CM_BUILD_PLAN.md phase 3): the proposal readout
// (insight panels) leads; the heavy manual form is split into tabs so only one
// refinement section shows at a time instead of a ~10000px scroll. Every field
// stays in the DOM (panels are CSS show/hide) so FormData capture, live-draft
// re-render and focus preservation all keep working unchanged.
export function renderBuildEditor(entry, isCreateMode, labels = {}) {
  entry = getCurrentBuildFormEntry(entry, isCreateMode);
  const statusText = state.buildsStatus.message || "Build drafts are stored locally for the active profile.";
  const targetOptions = getBuildTargetOptions("cm_targets");
  const scenarioOptions = getBuildTargetOptions("scenarios");
  const parentOptions = getBuildParentOptions(entry);
  const selectedSupports = asArray(entry.support_deck);
  const activeTab = BUILD_EDITOR_TABS.some((tab) => tab.key === state.buildEditor.activeFormTab) ? state.buildEditor.activeFormTab : "setup";

  const tabBodies = {
    setup: `
      <label class="field-stack field-stack-full">
        <span>Name</span>
        <input name="name" type="text" maxlength="120" value="${escapeHtml(entry.name || "")}" placeholder="Champions Meeting draft">
      </label>
      <div class="roster-field-grid">
        <label class="field-stack">
          <span>Mode</span>
          <select name="mode">
            ${BUILD_MODE_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${entry.mode === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
        <label class="field-stack">
          <span>Status</span>
          <select name="status">
            ${BUILD_STATUS_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${entry.status === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="roster-field-grid">
        <label class="field-stack">
          <span>CM Target</span>
          <select name="target_id">
            ${renderSelectOptions(targetOptions, entry.target_id, "No CM target")}
          </select>
        </label>
        <label class="field-stack">
          <span>Scenario</span>
          <select name="scenario_id">
            ${renderSelectOptions(scenarioOptions, entry.scenario_id, "No scenario")}
          </select>
        </label>
        <label class="field-stack field-stack-full">
          <span>Main Character</span>
          ${renderBuildCharacterSelect(entry)}
        </label>
        <label class="field-stack">
          <span>Running Style</span>
          <select name="running_style">
            ${BUILD_RUNNING_STYLE_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${(entry.running_style || "") === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
      </div>
    `,
    deck: `${renderBuildSupportPicker(selectedSupports)}`,
    stats: `
      <div class="build-form-section">
        <h4>Target Stats</h4>
        ${renderBuildStatsFields(entry)}
      </div>
      <div class="build-form-section">
        <h4>Target Aptitudes</h4>
        ${renderBuildAptitudeFields(entry)}
      </div>
    `,
    skills: renderBuildSkillEditor(entry),
    legacy: `
      <div class="roster-field-grid">
        <label class="field-stack">
          <span>Parent A</span>
          <select name="parent_a">
            ${renderSelectOptions(parentOptions.visible.map((option) => ({
              value: option.value,
              label: `${option.label}${option.sparkText ? ` - ${option.sparkText}` : ""}`,
            })), entry.legacy_pair?.parent_a, "No parent")}
          </select>
        </label>
        <label class="field-stack">
          <span>Parent B</span>
          <select name="parent_b">
            ${renderSelectOptions(parentOptions.visible.map((option) => ({
              value: option.value,
              label: `${option.label}${option.sparkText ? ` - ${option.sparkText}` : ""}`,
            })), entry.legacy_pair?.parent_b, "No parent")}
          </select>
        </label>
      </div>
      ${parentOptions.hiddenCount ? `<p class='source-note'>${escapeHtml(`${parentOptions.hiddenCount} parents hidden because their pink spark does not match the target.`)}</p>` : ""}
      <label class="build-inline-toggle"><input type="checkbox" id="buildShowAllParents" ${state.buildEditor.showAllParents ? "checked" : ""}> Show all saved parents</label>
      ${state.legacyView.items.length ? "" : "<p class='source-note'>No saved parent yet. Add parents in the Legacy tab when you want to test inheritance planning.</p>"}
    `,
    notes: `
      <label class="field-stack field-stack-full">
        <span>Tags</span>
        <input name="custom_tags" type="text" value="${escapeHtml(asArray(entry.custom_tags).join(", "))}" placeholder="mile, test, safe">
      </label>
      <label class="field-stack field-stack-full">
        <span>Notes</span>
        <textarea name="notes" rows="5" placeholder="Training assumptions, substitutes, run notes">${escapeHtml(entry.notes || "")}</textarea>
      </label>
    `,
    // Runs only make sense against a saved build (they need a build_id), so the
    // panel is empty in the create-mode assistant and only populated in edit mode.
    runs: isCreateMode ? "" : renderBuildRunsPanel(entry),
  };

  const statusLine = `<p id="buildStatus" class="source-note ${state.buildsStatus.kind === "error" ? "error-text" : ""}">${escapeHtml(statusText)}</p>`;

  let formMarkup;
  if (isCreateMode) {
    const activeStep = BUILD_ASSISTANT_STEPS.some((step) => step.key === state.buildEditor.activeFormTab)
      ? state.buildEditor.activeFormTab
      : "setup";
    const activeIndex = BUILD_ASSISTANT_STEPS.findIndex((step) => step.key === activeStep);
    const recapLabels = {
      mode: BUILD_MODE_OPTIONS.find((option) => option.value === entry.mode)?.label || entry.mode,
      status: BUILD_STATUS_OPTIONS.find((option) => option.value === entry.status)?.label || entry.status,
      target: getBuildReferenceLabel("cm_targets", entry.target_id),
      character: getBuildReferenceLabel("characters", entry.character_id),
      scenario: getBuildReferenceLabel("scenarios", entry.scenario_id),
      parents: [],
    };
    const recapBody = `
      <p class="source-note">Review the proposal (panels above), then create the build. Parents and notes are set afterwards in the full editor.</p>
      ${renderBuildReferenceSummary(entry, recapLabels)}
    `;
    const stepBodies = { ...tabBodies, recap: recapBody };

    formMarkup = `
      <form id="buildForm" class="roster-form build-assistant" data-build-id="${escapeHtml(entry.id || "")}" data-build-mode="create">
        <div class="build-assistant-progress">
          ${BUILD_ASSISTANT_STEPS.map((step, index) => {
            const stepState = index < activeIndex ? "done" : index === activeIndex ? "active" : "";
            return `
              <button type="button" class="build-assistant-step ${stepState}" data-assistant-step="${step.key}">
                <span class="build-assistant-step-n">${index + 1}</span>
                <span class="build-assistant-step-label">${escapeHtml(step.label)}</span>
              </button>
            `;
          }).join("")}
        </div>
        ${BUILD_ASSISTANT_STEPS.map((step) => `<div class="build-tab-panel${step.key === activeStep ? " active" : ""}" data-build-tab-panel="${step.key}">${stepBodies[step.key]}</div>`).join("")}
        <div class="roster-actions build-assistant-nav">
          ${activeStep !== "setup" ? `<button type="button" class="button-secondary" data-assistant-nav="prev">Back</button>` : "<span></span>"}
          ${activeStep !== "recap"
            ? `<button type="button" class="button-strong" data-assistant-nav="next">Next</button>`
            : `<button type="submit" class="button-strong">Create build</button>`}
        </div>
        ${statusLine}
      </form>
    `;
  } else {
    formMarkup = `
      <form id="buildForm" class="roster-form" data-build-id="${escapeHtml(entry.id || "")}" data-build-mode="edit">
        <div class="build-tabs" role="tablist">
          ${BUILD_EDITOR_TABS.map((tab) => `<button type="button" class="build-tab${tab.key === activeTab ? " active" : ""}" data-build-tab="${tab.key}">${escapeHtml(tab.label)}</button>`).join("")}
        </div>
        ${BUILD_EDITOR_TABS.map((tab) => `<div class="build-tab-panel${tab.key === activeTab ? " active" : ""}" data-build-tab-panel="${tab.key}">${tabBodies[tab.key]}</div>`).join("")}
        <div class="roster-actions">
          <button type="submit" class="button-strong">Save build</button>
          <button type="button" class="button-danger" id="deleteBuildButton">Delete build</button>
        </div>
        ${statusLine}
      </form>
    `;
  }

  return `
    <div class="detail-section roster-section">
      <h3>${isCreateMode ? "CM Prep Assistant" : "Build Draft"}</h3>
      <p class="source-note">${isCreateMode
        ? `Guided flow for <strong>${escapeHtml(getActiveProfile()?.name || "selected profile")}</strong>. The panels below are the deterministic proposal readout (aptitude, HP, stat thresholds, skill activation, last-spurt projection). Move through it step by step.`
        : `Planner for <strong>${escapeHtml(getActiveProfile()?.name || "selected profile")}</strong>. The panels below are the deterministic proposal readout (aptitude, HP, stat thresholds, skill activation, last-spurt projection) — no opponent or position simulation. Refine the draft in the tabs.`}</p>
      ${renderBuildInsightPanels(entry)}
      ${formMarkup}
    </div>
  `;
}

export function collectBuildPayload(formData) {
  const targetStats = {};
  BUILD_STAT_FIELDS.forEach((field) => {
    const rawValue = String(formData.get(`stat_${field.key}`) || "").trim();
    if (rawValue !== "") {
      targetStats[field.key] = clampNumber(rawValue, 0, 2500, 0);
    }
  });

  const targetAptitudes = {};
  BUILD_APTITUDE_FIELDS.forEach((field) => {
    const value = String(formData.get(`aptitude_${field.key}`) || "").trim().toUpperCase();
    if (value) {
      targetAptitudes[field.key] = value;
    }
  });

  const parentA = String(formData.get("parent_a") || "").trim();
  const parentB = String(formData.get("parent_b") || "").trim();

  return {
    mode: String(formData.get("mode") || "champions_meeting"),
    name: String(formData.get("name") || "").trim(),
    target_id: String(formData.get("target_id") || "").trim(),
    character_id: String(formData.get("character_id") || "").trim(),
    scenario_id: String(formData.get("scenario_id") || "").trim(),
    running_style: String(formData.get("running_style") || "").trim(),
    support_deck: asArray(formData.getAll("support_deck")).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 6),
    legacy_pair: {
      parent_a: parentA,
      parent_b: parentA && parentA === parentB ? "" : parentB,
    },
    target_stats: targetStats,
    target_aptitudes: targetAptitudes,
    required_skills: parseRosterTokenList(formData.get("required_skills")),
    optional_skills: parseRosterTokenList(formData.get("optional_skills")),
    status: String(formData.get("status") || "draft"),
    notes: String(formData.get("notes") || "").trim(),
    custom_tags: parseRosterTokenList(formData.get("custom_tags")),
  };
}

export function captureBuildFormDraft(isCreateMode, buildId) {
  const buildForm = document.getElementById("buildForm");
  if (!buildForm) {
    return null;
  }
  const draft = collectBuildPayload(new FormData(buildForm));
  draft.id = isCreateMode ? "" : String(buildId || "");
  state.buildEditor.targetKey = getBuildEditorKey(isCreateMode, buildId);
  state.buildEditor.draft = draft;
  return draft;
}

export function updateBuildSkillDraft(isCreateMode, buildId, updater) {
  const draft = captureBuildFormDraft(isCreateMode, buildId) || createEmptyBuildEntry();
  updater(draft);
  state.buildEditor.targetKey = getBuildEditorKey(isCreateMode, buildId);
  state.buildEditor.draft = draft;
  requestRenderPreservingScroll();
}

export function attachBuildFormListeners(isCreateMode, buildId) {
  const buildForm = document.getElementById("buildForm");
  if (!buildForm) {
    return;
  }
  state.buildEditor.targetKey = getBuildEditorKey(isCreateMode, buildId);

  // Tab switch: capture the current form state first (all fields are in the
  // DOM regardless of the visible tab), then re-render with the new active tab.
  buildForm.querySelectorAll("[data-build-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      captureBuildFormDraft(isCreateMode, buildId);
      state.buildEditor.activeFormTab = button.dataset.buildTab;
      requestRenderPreservingScroll();
    });
  });

  // Guided assistant (create mode): step chips jump directly, prev/next walk the
  // ordered steps. Same capture-then-rerender contract as the edit-mode tabs.
  buildForm.querySelectorAll("[data-assistant-step]").forEach((button) => {
    button.addEventListener("click", () => {
      captureBuildFormDraft(isCreateMode, buildId);
      state.buildEditor.activeFormTab = button.dataset.assistantStep;
      requestRenderPreservingScroll();
    });
  });

  buildForm.querySelectorAll("[data-assistant-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      captureBuildFormDraft(isCreateMode, buildId);
      const currentKey = BUILD_ASSISTANT_STEPS.some((step) => step.key === state.buildEditor.activeFormTab)
        ? state.buildEditor.activeFormTab
        : "setup";
      const currentIndex = BUILD_ASSISTANT_STEPS.findIndex((step) => step.key === currentKey);
      const delta = button.dataset.assistantNav === "prev" ? -1 : 1;
      const nextIndex = Math.min(Math.max(currentIndex + delta, 0), BUILD_ASSISTANT_STEPS.length - 1);
      state.buildEditor.activeFormTab = BUILD_ASSISTANT_STEPS[nextIndex].key;
      requestRenderPreservingScroll();
    });
  });

  buildForm.querySelectorAll('input[name="support_deck"]').forEach((input) => {
    input.addEventListener("change", () => {
      const selected = Array.from(buildForm.querySelectorAll('input[name="support_deck"]:checked'));
      if (selected.length > 6) {
        input.checked = false;
        state.buildsStatus = { kind: "error", message: "A support deck can contain up to 6 cards." };
        requestRenderPreservingScroll();
        return;
      }
      captureBuildFormDraft(isCreateMode, buildId);
      requestRenderPreservingScroll();
    });
  });

  ["target_id", "character_id", "scenario_id", "running_style", "parent_a", "parent_b", "mode", "status"].forEach((name) => {
    const control = buildForm.querySelector(`[name="${name}"]`);
    if (control) {
      control.addEventListener("change", () => {
        captureBuildFormDraft(isCreateMode, buildId);
        requestRenderPreservingScroll();
      });
    }
  });

  buildForm.querySelectorAll('[name^="stat_"], [name^="aptitude_"]').forEach((control) => {
    control.addEventListener("change", () => {
      captureBuildFormDraft(isCreateMode, buildId);
      requestRenderPreservingScroll();
    });
  });

  const supportTypeFilter = document.getElementById("buildSupportTypeFilter");
  if (supportTypeFilter) {
    supportTypeFilter.addEventListener("change", () => {
      captureBuildFormDraft(isCreateMode, buildId);
      state.buildEditor.supportType = supportTypeFilter.value;
      requestRenderPreservingScroll();
    });
  }

  const showAllSupports = document.getElementById("buildShowAllSupports");
  if (showAllSupports) {
    showAllSupports.addEventListener("change", () => {
      captureBuildFormDraft(isCreateMode, buildId);
      state.buildEditor.showAllSupports = showAllSupports.checked;
      requestRenderPreservingScroll();
    });
  }

  const showAllCharacters = document.getElementById("buildShowAllCharacters");
  if (showAllCharacters) {
    showAllCharacters.addEventListener("change", () => {
      captureBuildFormDraft(isCreateMode, buildId);
      state.buildEditor.showAllCharacters = showAllCharacters.checked;
      requestRenderPreservingScroll();
    });
  }

  const showAllParents = document.getElementById("buildShowAllParents");
  if (showAllParents) {
    showAllParents.addEventListener("change", () => {
      captureBuildFormDraft(isCreateMode, buildId);
      state.buildEditor.showAllParents = showAllParents.checked;
      requestRenderPreservingScroll();
    });
  }

  const skillSearchInput = document.getElementById("buildSkillSearchInput");
  if (skillSearchInput) {
    skillSearchInput.addEventListener("input", () => {
      captureBuildFormDraft(isCreateMode, buildId);
      state.buildEditor.skillQuery = skillSearchInput.value;
      requestRenderPreservingScrollAndFocus("buildSkillSearchInput");
    });
  }

  buildForm.querySelectorAll("[data-skill-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const bucket = button.dataset.skillAdd === "optional" ? "optional_skills" : "required_skills";
      const skillId = String(button.dataset.skillId || "");
      if (!skillId) {
        return;
      }
      updateBuildSkillDraft(isCreateMode, buildId, (draft) => {
        draft.required_skills = asArray(draft.required_skills).filter((id) => String(id) !== skillId);
        draft.optional_skills = asArray(draft.optional_skills).filter((id) => String(id) !== skillId);
        draft[bucket] = [...asArray(draft[bucket]), skillId];
      });
    });
  });

  buildForm.querySelectorAll("[data-skill-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const skillId = String(button.dataset.skillRemove || "");
      const bucket = button.dataset.skillBucket === "optional" ? "optional_skills" : "required_skills";
      updateBuildSkillDraft(isCreateMode, buildId, (draft) => {
        draft[bucket] = asArray(draft[bucket]).filter((id) => String(id) !== skillId);
      });
    });
  });

  buildForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveBuildForm(new FormData(buildForm), isCreateMode, buildId);
  });

  const deleteButton = document.getElementById("deleteBuildButton");
  if (deleteButton && buildId) {
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm("Delete this build draft?")) {
        return;
      }
      await deleteBuild(buildId);
    });
  }

  // Runs tab (edit mode only): wire log/save/delete against the saved build.
  if (!isCreateMode && buildId) {
    const buildEntry = asArray(state.buildsDocument?.entries).find((current) => String(current.id) === String(buildId));
    if (buildEntry) {
      attachBuildRunsListeners(buildEntry);
    }
  }
}
