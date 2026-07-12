// Auto-split from app.js as part of docs/REFACTOR_PLAN.md.
import { TRAINING_EVENT_EFFECT_LABELS, asArray, data, getEntityItems, getOwnedCharacterOptions, getSkillReferences, getViewState, renderGradeBadge, renderSelectOptions, setBrowseHash, state } from "./core.js";
import { escapeHtml, renderBadge, renderLinkedSkillList, renderReferenceList, renderSimpleList, tableFromRows } from "./dom-utils.js";
import { getRosterEntry, renderCharacterRosterProjection, renderSupportCurrentEffects, renderSupportRosterProjection } from "./roster.js";
import {
  buildTrackSvg,
  describeDynamicTermHuman,
  getFilteredSkillPickerOptions,
  MAX_VISUALIZER_SKILLS,
  resolveStaticZones,
  SKILL_HIGHLIGHT_CLASSES,
} from "./visualizer.js";
import { buildAutoPrepPlan, recommendBuildForTarget, recommendSkillsForBuild, recommendSupportDeck, targetProfileFromCmDetail } from "./build_recommender.js";
import { buildMetaWeights } from "./meta.js";
import { getBuildTargetRacetrack, getSkillReferenceItem, getSupportOwnedSummary, startSeededBuildDraft } from "./builds.js";
import { getOwnedSupportOptions } from "./core.js";
import { requestRenderPreservingScroll, requestRenderPreservingScrollAndFocus } from "../app.js";

const RECO_STYLE_LABELS = { runner: "Front Runner", leader: "Pace Chaser", betweener: "Late Surger", chaser: "End Closer" };
const RECO_VERDICT = { useful: { tone: "ok", label: "Strong fit" }, workable: { tone: "warn", label: "Workable" }, "off-target": { tone: "bad", label: "Off target" } };
const RECO_TYPE_LABELS = { speed: "Speed", stamina: "Stamina", power: "Power", guts: "Guts", intelligence: "Wisdom", friend: "Friend", group: "Group" };

function getOwnedCharacterItems() {
  const ownedIds = new Set(getOwnedCharacterOptions().map((option) => String(option.value)));
  return getEntityItems("characters").filter((item) => ownedIds.has(String(item.id)));
}

// A character's castable kit: unique/innate/awakening/event skills plus the
// evolved form of each evolution entry.
function getCharacterKitSkillIds(characterItem) {
  const links = characterItem?.detail?.skill_links || {};
  const ids = [];
  for (const key of ["unique", "innate", "awakening", "event"]) {
    for (const skill of asArray(links[key])) {
      if (skill?.id != null) ids.push(String(skill.id));
    }
  }
  for (const evo of asArray(links.evolution)) {
    if (evo?.to?.id != null) ids.push(String(evo.to.id));
  }
  return ids;
}

// Skills the chosen support deck can grant (hints + event skills).
function getDeckSkillIds(deckSupportIds) {
  const ids = [];
  for (const supportId of deckSupportIds) {
    const support = getEntityItems("supports").find((item) => String(item.id) === String(supportId));
    for (const key of ["hint_skills", "event_skills"]) {
      for (const skill of asArray(support?.detail?.[key])) {
        if (skill?.id != null) ids.push(String(skill.id));
      }
    }
  }
  return ids;
}

function getCandidateSkillReco(characterId, deckIds, profile) {
  const characterItem = getEntityItems("characters").find((item) => String(item.id) === String(characterId));
  const poolIds = [...getCharacterKitSkillIds(characterItem), ...getDeckSkillIds(deckIds)];
  const pool = poolIds.map((id) => getSkillReferenceItem(id)).filter(Boolean);
  return recommendSkillsForBuild(pool, profile);
}

// Recomputed by both the renderer and the click handler so no per-candidate
// payload has to be serialized into the DOM - buttons only carry a character
// id, matched back to the recommendation here. Each candidate is enriched with
// a skill shortlist built from its own kit plus the shared suggested deck.
export function getCmTargetRecommendations(detail) {
  const profile = targetProfileFromCmDetail(detail);
  const deckIds = getCmTargetDeck(detail).result.deck;
  return recommendBuildForTarget(profile, getOwnedCharacterItems(), { limit: 5 }).map((reco) => ({
    ...reco,
    skillReco: getCandidateSkillReco(reco.characterId, deckIds, profile),
  }));
}

// Auto Prep (docs/AUTO_PREP_PLAN.md Phase 2): assemble the full rosterData bundle
// from the reference/roster singletons and hand it to the pure aggregator. This
// is the single bridge between the DOM/state layer and buildAutoPrepPlan. The
// skill pool and the single-track gate are injected so the engine stays pure:
// buildSkillPool is called by the engine once the deck is known (kit + deck
// hints, same as getCandidateSkillReco); the course is only present when the
// cm_target resolves to exactly ONE racetrack (getBuildTargetRacetrack).
export function buildAutoPrepPlanForDetail(detail, { selectedCharacterId = null, weights = {}, pinnedDeckIds = [], excludedDeckIds = [] } = {}) {
  const targetItem = { detail };
  const racetrack = getBuildTargetRacetrack(targetItem);
  // Fold the loaded meta snapshot (if any) into the weights the engine consumes.
  // No snapshot -> empty supportMeta/characterMeta -> identical to before.
  const effectiveWeights = { ...buildMetaWeights(state.metaSnapshot), ...weights };
  const rosterData = {
    characters: getOwnedCharacterItems(),
    supportSummaries: getOwnedSupportSummariesForDeck(),
    buildSkillPool: (characterId, deckIds) => {
      const characterItem = getEntityItems("characters").find((item) => String(item.id) === String(characterId));
      const poolIds = [...getCharacterKitSkillIds(characterItem), ...getDeckSkillIds(deckIds)];
      return poolIds.map((id) => getSkillReferenceItem(id)).filter(Boolean);
    },
    course: racetrack?.detail || null,
    resolveStaticZones,
    weights: effectiveWeights,
    availableScenarios: getGlobalAvailableScenarios(),
  };
  return buildAutoPrepPlan(targetItem, rosterData, { selectedCharacterId, pinnedDeckIds, excludedDeckIds });
}

// Scenarios released on the player's version (Global), derived from GameTora's
// per-scenario `start_en` release timestamp (unix seconds; null = not on Global)
// - the same signal as card `available.en`. We never propose a scenario whose
// EN release is missing or still in the future. Global display name = `name_en`.
function getGlobalAvailableScenarios() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return getEntityItems("scenarios")
    .filter((item) => {
      const startEn = Number(item.detail?.start_en);
      return Number.isFinite(startEn) && startEn > 0 && startEn <= nowSeconds;
    })
    .map((item) => ({ slug: String(item.detail?.slug || item.id), name: item.detail?.name_en || item.detail?.name || item.title }));
}

// Owned supports reduced to the fields the deck heuristic reads, plus a title
// for display. limit_break lives on the roster entry (0..4).
function getOwnedSupportSummariesForDeck() {
  return getOwnedSupportOptions().map((option) => {
    const summary = getSupportOwnedSummary(option.value);
    return {
      id: String(option.value),
      title: summary.item?.title || String(option.value),
      type: summary.type,
      rarity: summary.rarity,
      limitBreak: Number(summary.entry?.limit_break) || 0,
      // Real per-effect values at the card's actual level/LB, from the
      // roster-view projection - lets scoreSupportForTarget rank on effective
      // value instead of rarity+LB (falls back gracefully if absent).
      effectiveEffects: summary.derived?.effective_effects || [],
    };
  });
}

// Same recompute-in-both-places pattern as the character recos: the handler
// re-derives the deck rather than reading it out of the DOM.
export function getCmTargetDeck(detail) {
  const profile = targetProfileFromCmDetail(detail);
  const summaries = getOwnedSupportSummariesForDeck();
  const titleById = new Map(summaries.map((summary) => [summary.id, summary]));
  return { result: recommendSupportDeck(profile.distanceKey, summaries, { targetProfile: profile }), titleById };
}

export function getSkillPickerOptions() {
  return getEntityItems("skills").map((item) => ({ value: String(item.id), label: item.title || String(item.id) }));
}

export function getBuildPickerOptions() {
  return getEntityItems("builds").map((item) => ({ value: String(item.id), label: item.title || String(item.id) }));
}

// A build draft's required_skills + optional_skills, deduped. Unknown skill
// ids (e.g. a skill removed from the reference since the draft was saved)
// are left in the list - the existing per-skill lookup in renderRacetracks
// already drops those silently, same as a manually-picked stale id would.
export function getBuildSkillIds(buildItem) {
  const entry = buildItem?.detail?.entry;
  if (!entry) return [];
  return [...new Set([...asArray(entry.required_skills), ...asArray(entry.optional_skills)].map(String))];
}

function renderConditionBadge(rawTerm) {
  const human = describeDynamicTermHuman(rawTerm);
  const title = human ? ` title="${escapeHtml(rawTerm)}"` : "";
  return `<span class="skill-dynamic-badge"${title}>${escapeHtml(human || rawTerm)}</span>`;
}

// Renders each AND-group of raw condition terms as its own chip, with an "OR"
// connector between groups - so alternative conditions (from `@` in the
// source data) read as alternatives instead of one flattened, ambiguous list.
function renderConditionGroups(groups) {
  return groups.map((terms) => `<div class="condition-group">${terms.map(renderConditionBadge).join("")}</div>`).join('<span class="condition-or">OR</span>');
}

export function getRacetrackVisualizerState(course) {
  const viewState = getViewState("reference", "racetracks");
  if (!viewState.visualizer || viewState.visualizer.courseId !== course.id) {
    viewState.visualizer = { courseId: course.id, skillQuery: "", selectedSkillIds: [] };
  }
  return viewState.visualizer;
}


export function renderCatalogSupportQuickAdd(item) {
  if (!state.activeProfileId) {
    return "";
  }
  const entry = getRosterEntry("supports", item);
  return `
    <div class="result-card-actions">
      <button
        type="button"
        class="${entry.owned ? "button-secondary" : "button-strong"} result-card-quick-add"
        data-support-quick-add="${escapeHtml(item.id)}"
        ${entry.owned ? "disabled" : ""}
      >${entry.owned ? "Owned" : "Add"}</button>
    </div>
  `;
}


export function renderCharacterGradeGrid(title, columns, values, options) {
  const safeColumns = asArray(columns);
  const config = options || {};
  if (!safeColumns.length) {
    return "<p class='source-note'>No data.</p>";
  }

  const formatGridValue = (rawValue) => (/^[SABCDEFG]$/i.test(String(rawValue)) ? renderGradeBadge(rawValue) : escapeHtml(rawValue));

  return `
    <section class="character-grid-block${config.compact ? " character-grid-block-compact" : ""}">
      <div class="character-grid-head">${escapeHtml(title)}</div>
      <div class="character-grid-body" style="--character-grid-columns:${safeColumns.length};">
        ${safeColumns
          .map((column) => `
            <div class="character-grid-cell">
              <span class="character-grid-label">${escapeHtml(column.label)}</span>
              <strong class="character-grid-value">${formatGridValue(values?.[column.key] ?? "-")}</strong>
            </div>
          `)
          .join("")}
      </div>
    </section>
  `;
}

export function renderCharacterStatsTable(title, columns, rows) {
  const safeColumns = asArray(columns);
  const safeRows = asArray(rows).filter((row) => row && row.label);
  if (!safeColumns.length || !safeRows.length) {
    return "<p class='source-note'>No data.</p>";
  }

  return `
    <section class="character-stats-block">
      <div class="character-grid-head">${escapeHtml(title)}</div>
      <div class="table-scroll">
        <table class="character-stats-table">
          <thead>
            <tr>
              <th>Tier</th>
              ${safeColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${safeRows
              .map((row) => `
                <tr>
                  <th>${escapeHtml(row.label)}</th>
                  ${safeColumns.map((column) => `<td>${escapeHtml(row.values?.[column.key] ?? "-")}</td>`).join("")}
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderSupportStatGainTable(entries) {
  const columns = [
    { key: "speed", label: "Speed" },
    { key: "stamina", label: "Stamina" },
    { key: "power", label: "Power" },
    { key: "guts", label: "Guts" },
    { key: "wisdom", label: "Wisdom" },
    { key: "skill_points", label: "Skill Pt" },
  ];
  const typeToKey = {
    1: "speed",
    2: "stamina",
    3: "power",
    4: "guts",
    5: "wisdom",
    30: "skill_points",
  };
  const values = {};

  asArray(entries).forEach((entry) => {
    const key = typeToKey?.[entry?.hint_type];
    if (key) {
      values[key] = `+${entry.hint_value}`;
    }
  });

  return renderCharacterStatsTable("Hint Gains", columns, [{ label: "Gain", values }]);
}

export function formatSupportEffectValue(effect, value) {
  if (value == null || value === "") {
    return "Locked";
  }
  const numericValue = Number(value);
  const displayValue = Number.isFinite(numericValue) ? `${Number.isInteger(numericValue) ? numericValue : numericValue.toFixed(1)}` : String(value);
  if (effect?.symbol === "percent") {
    return `${displayValue}%`;
  }
  if (effect?.symbol === "level") {
    return `Lv ${displayValue}`;
  }
  return displayValue;
}


export function renderCharacters(detail, rosterProjection) {
  const aptitudes = detail.aptitudes || {};
  const stats = detail.stats || {};
  const aptitudeSections = [
    {
      title: "Surface",
      columns: [
        { key: "turf", label: "Turf" },
        { key: "dirt", label: "Dirt" },
      ],
      values: aptitudes.surface || {},
    },
    {
      title: "Distance",
      columns: [
        { key: "short", label: "Short" },
        { key: "mile", label: "Mile" },
        { key: "medium", label: "Medium" },
        { key: "long", label: "Long" },
      ],
      values: aptitudes.distance || {},
    },
    {
      title: "Strategy",
      columns: [
        { key: "runner", label: "Front" },
        { key: "leader", label: "Pace" },
        { key: "betweener", label: "Late" },
        { key: "chaser", label: "End" },
      ],
      values: aptitudes.style || {},
    },
  ];
  const statColumns = [
    { key: "speed", label: "Speed" },
    { key: "stamina", label: "Stamina" },
    { key: "power", label: "Power" },
    { key: "guts", label: "Guts" },
    { key: "wit", label: "Wit" },
  ];

  return `
    <div class="detail-section">
      <h3>Aptitudes</h3>
      <div class="character-grid-stack">
        ${aptitudeSections.map((section) => renderCharacterGradeGrid(section.title, section.columns, section.values)).join("")}
      </div>
    </div>
    <div class="detail-section">
      <h3>Stat Bonus</h3>
      ${renderCharacterGradeGrid(
        "Bonus",
        statColumns,
        Object.fromEntries(Object.entries(detail.stat_bonus || {}).map(([key, value]) => [key, `${value}%`])),
        { compact: true },
      )}
    </div>
    <div class="detail-section">
      <h3>Stats</h3>
      ${renderCharacterStatsTable("Growth", statColumns, [
        { label: "Base", values: stats.base || {} },
        { label: "4-star", values: stats.four_star || {} },
        { label: "5-star", values: stats.five_star || {} },
      ])}
    </div>
    <div class="detail-section">
      <h3>Skills</h3>
      <h4>Unique</h4>
      ${renderLinkedSkillList(detail.skill_links?.unique)}
      <h4>Innate</h4>
      ${renderLinkedSkillList(detail.skill_links?.innate)}
      <h4>Awakening</h4>
      ${renderLinkedSkillList(detail.skill_links?.awakening)}
      <h4>Skills from events</h4>
      ${renderLinkedSkillList(detail.skill_links?.event)}
    </div>
    ${renderCharacterRosterProjection(rosterProjection)}
  `;
}

export function renderSupports(detail, rosterProjection) {
  return `
    ${rosterProjection
      ? `
        <div class="detail-section">
          <h3>Current Support Bonuses</h3>
          ${renderSupportCurrentEffects(rosterProjection)}
        </div>
      `
      : ""}
    <div class="detail-section">
      <h3>Unique Effects</h3>
      ${renderSimpleList(detail.unique_effects, (effect) => `${effect.name || `Effect #${effect.effect_id}`} (${effect.value})`)}
    </div>
    <div class="detail-section">
      <h3>Hint Skills</h3>
      ${renderLinkedSkillList(detail.hint_skills)}
    </div>
    <div class="detail-section">
      <h3>Skills from events</h3>
      ${renderLinkedSkillList(detail.event_skills)}
    </div>
    <div class="detail-section">
      <h3>Stat Gain</h3>
      ${renderSupportStatGainTable(detail.hint_other_effects)}
    </div>
    ${renderSupportRosterProjection(rosterProjection)}
  `;
}


export function renderSkills(detail) {
  const references = getSkillReferences(detail.skill_id);
  return `
    ${tableFromRows([
      ["Skill ID", escapeHtml(detail.skill_id)],
      ["Rarity", escapeHtml(detail.rarity)],
      ["Cost", escapeHtml(detail.cost || "-")],
      ["Type Tags", escapeHtml(asArray(detail.type_tags).join(", "))],
    ])}
    <div class="detail-section">
      <h3>Activation</h3>
      <p>${escapeHtml(detail.activation || "-")}</p>
    </div>
    <div class="detail-section">
      <h3>Description</h3>
      <p>${escapeHtml(detail.descriptions?.en || detail.descriptions?.ja || "-")}</p>
    </div>
    <div class="detail-section">
      <h3>Characters</h3>
      ${renderReferenceList(references.characters)}
    </div>
    <div class="detail-section">
      <h3>Supports (hint)</h3>
      ${renderReferenceList(references.supportHints)}
    </div>
    <div class="detail-section">
      <h3>Supports (events)</h3>
      ${renderReferenceList(references.supportEvents)}
    </div>
    <div class="detail-section">
      <h3>Condition Groups</h3>
      <pre class="code-block">${escapeHtml(JSON.stringify(detail.condition_groups || [], null, 2))}</pre>
    </div>
  `;
}

export function renderRaces(detail) {
  return `
    ${tableFromRows([
      ["Race Instance", escapeHtml(detail.race_instance_id)],
      ["Race ID", escapeHtml(detail.race_id)],
      ["Track", escapeHtml(detail.track_name)],
      ["Surface", escapeHtml(detail.surface)],
      ["Distance", escapeHtml(`${detail.distance_m}m | ${detail.distance_category}`)],
      ["Direction", escapeHtml(detail.direction)],
      ["Season / Time", escapeHtml(`${detail.season} | ${detail.time_of_day}`)],
      ["Grade", escapeHtml(detail.grade)],
    ])}
    <div class="detail-section">
      <h3>Factor Summary</h3>
      ${renderSimpleList(detail.factor_summary, (entry) => entry)}
    </div>
    <div class="detail-section">
      <h3>Related Racetracks</h3>
      <p class="source-note">Jump to the course to see the Skill Visualizer for this race's track layout.</p>
      ${renderReferenceList(detail.related_racetracks)}
    </div>
  `;
}

function buildSkillVisual(skillItem, className, course) {
  const resolved = asArray(skillItem.detail?.condition_groups).map((group) => resolveStaticZones(group.condition, group.precondition, course));
  const zones = resolved.flatMap((result) => result.zones);
  const unplaced = resolved.flatMap((result) => result.unplacedDynamicOnly);
  const seenBadgeGroups = new Set();
  const badgeGroups = zones
    .map((zone) => zone.dynamicBadges)
    .filter((badges) => badges.length && !seenBadgeGroups.has(badges) && seenBadgeGroups.add(badges));
  const unplacedGroups = unplaced.map((entry) => entry.split(" & "));
  return { item: skillItem, className, zones, badgeGroups, unplacedGroups };
}

export function renderRacetracks(detail) {
  const visualizerState = getRacetrackVisualizerState(detail);
  const picker = getFilteredSkillPickerOptions(getSkillPickerOptions(), visualizerState.skillQuery, visualizerState.selectedSkillIds);
  const skillVisuals = visualizerState.selectedSkillIds
    .map((id, index) => {
      const item = getEntityItems("skills").find((entry) => String(entry.id) === id);
      return item ? buildSkillVisual(item, SKILL_HIGHLIGHT_CLASSES[index % SKILL_HIGHLIGHT_CLASSES.length], detail) : null;
    })
    .filter(Boolean);
  const highlightGroups = skillVisuals.filter((visual) => visual.zones.length).map((visual) => ({ zones: visual.zones, className: visual.className }));
  const atSkillCap = visualizerState.selectedSkillIds.length >= MAX_VISUALIZER_SKILLS;
  const buildOptions = getBuildPickerOptions();

  return `
    ${tableFromRows([
      ["Course ID", escapeHtml(detail.course_id)],
      ["Track", escapeHtml(detail.track_name)],
      ["Surface", escapeHtml(detail.surface)],
      ["Distance", escapeHtml(`${detail.length_m}m | ${detail.distance_category}`)],
      ["Turn / Layout", escapeHtml(`${detail.turn} | ${detail.layout}`)],
      ["Corners / Straights", escapeHtml(`${detail.corner_count} / ${detail.straight_count}`)],
      ["Slopes", escapeHtml(`${detail.uphill_count} uphill | ${detail.downhill_count} downhill`)],
    ])}
    <div class="detail-section" data-visualizer-course-id="${escapeHtml(detail.id)}">
      <h3>Skill Visualizer</h3>
      <p class="source-note">Linear distance view — not an actual track shape.</p>
      <input
        type="text"
        class="skill-picker-input"
        id="visualizerSkillQuery"
        placeholder="Search a skill by name..."
        value="${escapeHtml(visualizerState.skillQuery)}"
      />
      <p class="source-note">Select up to ${MAX_VISUALIZER_SKILLS} skills to compare their activation zones.</p>
      <div class="skill-picker-results">
        ${picker.options
          .map((option) => {
            const isSelected = visualizerState.selectedSkillIds.includes(option.value);
            return `
              <button type="button" class="skill-picker-result${isSelected ? " active" : ""}" data-skill-pick="${escapeHtml(option.value)}"${!isSelected && atSkillCap ? " disabled" : ""}>
                ${escapeHtml(option.label)}
              </button>
            `;
          })
          .join("")}
        ${!picker.options.length ? "<p class='source-note'>No skill matches this search.</p>" : ""}
      </div>
      ${picker.isLimited ? `<p class="source-note">Showing ${picker.visibleCount} of ${picker.totalCount} skills — type to search for more.</p>` : ""}
      ${atSkillCap ? `<p class="source-note">Max ${MAX_VISUALIZER_SKILLS} skills selected — remove one to add another.</p>` : ""}
      <div class="build-load-row">
        <p class="source-note">Or load every skill from a build draft at once, to compare decks:</p>
        ${buildOptions.length
          ? `
            <div class="build-load-controls">
              <select id="visualizerBuildPick" class="skill-picker-input">${renderSelectOptions(buildOptions, "", "Choose a build draft...")}</select>
              <button type="button" id="visualizerBuildLoadBtn" class="build-load-btn">Add build's skills</button>
            </div>
          `
          : `<p class="source-note">No build drafts yet — create one under My Roster &gt; Builds.</p>`}
      </div>
      <div class="track-svg-wrap">${buildTrackSvg(detail, { highlightGroups })}</div>
      <div class="track-legend">
        <span class="legend-swatch track-zone-corner">Corner</span>
        <span class="legend-swatch track-zone-straight">Straight</span>
        <span class="legend-swatch track-zone-uphill">Uphill</span>
        <span class="legend-swatch track-zone-downhill">Downhill</span>
        ${skillVisuals.map((visual) => `<span class="legend-swatch ${visual.className}">${escapeHtml(visual.item.title)}</span>`).join("")}
      </div>
      ${skillVisuals
        .map(
          (visual) => `
          <div class="detail-section">
            <h4>
              <span class="legend-swatch ${visual.className}">${escapeHtml(visual.item.title)}</span>
              <button type="button" class="skill-remove-btn" data-skill-pick="${escapeHtml(String(visual.item.id))}" aria-label="Remove ${escapeHtml(visual.item.title)}">&times;</button>
            </h4>
            ${visual.zones.length
              ? `<p class="source-note">${visual.zones.length} track zone(s) highlighted above.${visual.zones.some((zone) => zone.approximate) ? " Hatched zones are approximate (e.g. random-phase conditions)." : ""}</p>`
              : `<p class="source-note">This skill's trigger isn't tied to a track position - it depends on race state:</p>`}
            ${visual.badgeGroups.length ? `<p class="source-note">Also requires:</p>${renderConditionGroups(visual.badgeGroups)}` : ""}
            ${visual.unplacedGroups.length
              ? `${visual.zones.length ? `<p class="source-note">Not shown on track (depends on other horses/ranking):</p>` : ""}${renderConditionGroups(visual.unplacedGroups)}`
              : ""}
          </div>
        `,
        )
        .join("")}
    </div>
  `;
}

export function renderG1Factors(detail) {
  return `
    ${tableFromRows([
      ["Factor ID", escapeHtml(detail.factor_id)],
      ["Race ID", escapeHtml(detail.race_id)],
      ["Career Years", escapeHtml(asArray(detail.career_years).join(", ") || "-")],
      ["Tracks", escapeHtml(asArray(detail.track_names).join(", ") || "-")],
    ])}
    <div class="detail-section">
      <h3>Effect Summary</h3>
      ${renderSimpleList(detail.effect_summary, (entry) => entry)}
    </div>
    <div class="detail-section">
      <h3>Related Races</h3>
      ${tableFromRows(
        asArray(detail.related_races).map((race) => [
          race.name,
          escapeHtml(`${race.track_name} | ${race.distance_m}m | ${race.grade}`),
        ]),
      )}
    </div>
  `;
}

export function renderCmTargets(detail) {
  const race = detail.race_profile || {};
  return `
    ${tableFromRows([
      ["CM ID", escapeHtml(detail.cm_id)],
      ["Name", escapeHtml(detail.name)],
      ["Dates", escapeHtml(`${detail.start_at || "-"} -> ${detail.end_at || "-"}`)],
      ["Track", escapeHtml(race.track_name || "-")],
      ["Surface", escapeHtml(race.surface || "-")],
      ["Distance", escapeHtml(`${race.distance_m || "-"}m | ${race.distance_category || "-"}`)],
      ["Direction", escapeHtml(race.direction || "-")],
      ["Season", escapeHtml(race.season || "-")],
      ["Weather", escapeHtml(race.weather || "-")],
      ["Condition", escapeHtml(race.condition || "-")],
    ])}
    <div class="detail-section">
      <h3>Related Races</h3>
      ${renderReferenceList(detail.related_races)}
    </div>
    <div class="detail-section">
      <h3>Related Racetracks</h3>
      ${renderReferenceList(detail.related_racetracks)}
    </div>
    ${renderCmTargetRecommendations(detail)}
  `;
}

// CM-first auto-build entry (docs/CM_BUILD_PLAN.md phase 1-2): rank the owned
// roster for this race and let one click seed a pre-filled build draft
// (character + style + stats + a heuristic support deck).
export function renderCmTargetRecommendations(detail) {
  const recos = getCmTargetRecommendations(detail);
  return `
    <div class="detail-section" data-cm-reco-target="${escapeHtml(detail.id)}">
      <h3>Recommended builds from my roster</h3>
      <p class="source-note">Ranked by exact aptitude fit for this race. Stat targets are a heuristic starting point (Stamina from the nearest umalator reference, Guts past the crossover), not an optimum.</p>
      ${!recos.length
        ? "<p class='source-note'>No owned character yet — add the umas you own from the Catalog to see recommendations.</p>"
        : `<div class="build-card-list">${recos.map(renderRecommendationCard).join("")}</div>`}
      ${recos.length ? renderSuggestedDeck(detail) : ""}
    </div>
  `;
}

function renderSuggestedDeck(detail) {
  const { result, titleById } = getCmTargetDeck(detail);
  const targetMix = Object.entries(result.target).map(([type, n]) => `${n} ${RECO_TYPE_LABELS[type] || type}`).join(" / ");
  const cards = result.deck.map((id) => {
    const summary = titleById.get(id);
    return `<span class="skill-dynamic-badge" title="${escapeHtml(`${RECO_TYPE_LABELS[summary?.type] || summary?.type || "?"} | R${summary?.rarity || "-"} | LB ${summary?.limitBreak ?? 0}`)}">${escapeHtml(summary?.title || id)}</span>`;
  }).join("");
  return `
    <h4>Suggested support deck</h4>
    <p class="source-note">Heuristic only — no verified support-value formula in our data (no stat curves). Target mix for this distance: <strong>${escapeHtml(targetMix)}</strong>; ranked by rarity then limit break.${result.shortfall ? ` Your roster only fills ${result.filled}/6 — add more owned supports.` : ""}</p>
    ${result.deck.length ? `<div>${cards}</div>` : "<p class='source-note'>No owned support yet — add the supports you own from the Catalog.</p>"}
  `;
}

function renderRecommendationCard(reco) {
  const verdict = RECO_VERDICT[reco.verdict] || RECO_VERDICT["off-target"];
  const stats = reco.proposal.stats;
  const statLine = `SPD ${stats.speed} · STA ${stats.stamina} · POW ${stats.power} · GUT ${stats.guts} · WIT ${stats.wit}`;
  const skill = reco.skillReco || { required: [], optional: [] };
  return `
    <article class="build-mini-card">
      <strong>${escapeHtml(reco.title)}</strong>
      <span class="build-hint build-hint-${verdict.tone}">${escapeHtml(verdict.label)}</span>
      <span>${escapeHtml(`${RECO_STYLE_LABELS[reco.bestStyle] || "-"} | Surface ${reco.surfaceGrade || "-"} / Distance ${reco.distanceGrade || "-"} / Style ${reco.styleGrade || "-"}`)}</span>
      <small>${escapeHtml(`Proposed stats: ${statLine}`)}</small>
      <small>${escapeHtml(`Recommended skills: ${skill.required.length} required / ${skill.optional.length} optional (from kit + deck, by effect category)`)}</small>
      <button type="button" class="button-secondary" data-cm-reco-character="${escapeHtml(reco.characterId)}">Create build from this</button>
    </article>
  `;
}

export function renderScenarios(detail) {
  const statColumns = [
    { key: "speed", label: "Speed" },
    { key: "stamina", label: "Stamina" },
    { key: "power", label: "Power" },
    { key: "guts", label: "Guts" },
    { key: "wit", label: "Wit" },
  ];

  return `
    ${tableFromRows([
      ["Scenario ID", escapeHtml(detail.scenario_id)],
      ["Key", escapeHtml(detail.key || "-")],
      ["Program", escapeHtml(detail.program_label || "-")],
      ["Order", escapeHtml(detail.order ?? "-")],
    ])}
    <div class="detail-section">
      <h3>Stat Caps</h3>
      ${renderCharacterGradeGrid("Caps", statColumns, detail.stat_caps || {}, { compact: true })}
    </div>
    <div class="detail-section">
      <h3>Factor Effects</h3>
      ${renderSimpleList(detail.factor_effects, (entry) => entry)}
    </div>
    <div class="detail-section">
      <h3>Scenario Factors</h3>
      ${tableFromRows(
        asArray(detail.factors).map((factor) => [
          factor.name || `Factor #${factor.id}`,
          escapeHtml(asArray(factor.effects).join(", ") || "-"),
        ]),
      )}
    </div>
  `;
}

export function renderTrainingEvents(detail) {
  return `
    ${tableFromRows([
      ["Event Source", escapeHtml(detail.source_label || detail.event_source || "-")],
      ["Owner ID", escapeHtml(detail.owner_id || "-")],
      ["Event ID", escapeHtml(detail.event_id || "-")],
      ["Name Source", escapeHtml(detail.name_source || "-")],
      ["Branching", escapeHtml(detail.has_branching ? "Yes" : "No")],
      ["Choice Count", escapeHtml(detail.choice_count ?? 0)],
    ])}
    <div class="detail-section">
      <h3>Linked Entities</h3>
      ${renderReferenceList(detail.linked_entities)}
    </div>
      <div class="detail-section">
        <h3>Choices</h3>
        ${tableFromRows(
          asArray(detail.choices).map((choice) => [
            formatTrainingEventChoiceLabel(choice),
            renderTrainingEventChoiceEffects(choice),
          ]),
        )}
      </div>
      <div class="detail-section">
        <h3>Raw Event Context</h3>
      <pre class="code-block">${escapeHtml(
        JSON.stringify(
          {
            raw_choice_token: detail.raw_choice_token,
            raw_extras: detail.raw_extras,
            source_metadata: detail.source_metadata,
          },
          null,
          2,
        ),
      )}</pre>
    </div>
    `;
}

export function formatTrainingEventChoiceLabel(choice) {
  const rawLabel = String(choice?.choice_label || "").trim();
  if (!rawLabel || /^\d+$/.test(rawLabel)) {
    return `Choice ${choice?.index || "?"}`;
  }
  return rawLabel;
}

export function renderTrainingEventChoiceEffects(choice) {
  const labels = [];
  const labelCounts = new Map();
  let unclassifiedCount = 0;

  asArray(choice?.effect_tokens).forEach((token) => {
    const label = TRAINING_EVENT_EFFECT_LABELS[String(token)] || TRAINING_EVENT_EFFECT_LABELS[Number(token)];
    if (!label) {
      unclassifiedCount += 1;
      return;
    }
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  });

  labelCounts.forEach((count, label) => {
    labels.push(count > 1 ? `${label} x${count}` : label);
  });

  if (unclassifiedCount > 0) {
    labels.push(unclassifiedCount === 1 ? "1 unclassified bonus" : `${unclassifiedCount} unclassified bonuses`);
  }

  if (!labels.length) {
    return "<span class='source-note'>No readable bonus mapping available.</span>";
  }

  return `<div class="badge-row">${labels.map((label) => renderBadge(label)).join("")}</div>`;
}

export function renderCompatibility(detail, model) {
  return `
    ${tableFromRows([
      ["Character ID", escapeHtml(detail.character_id)],
      ["Variants", escapeHtml(detail.variant_count)],
      ["EN Availability", escapeHtml(detail.available?.en ? "Available" : "Unreleased")],
      ["Model", escapeHtml(model?.pairwise_points_source || "-")],
    ])}
    <div class="detail-section">
      <h3>Top Matches</h3>
      ${tableFromRows(
        asArray(detail.top_matches)
          .slice(0, 10)
          .map((match) => [
            `${match.name || `#${match.character_id}`}`,
            escapeHtml(`${match.base_points} pts | ${match.shared_relation_count} groups`),
          ]),
      )}
    </div>
    <div class="detail-section">
      <h3>Relation Groups</h3>
      ${tableFromRows(
        asArray(detail.relation_groups)
          .slice(0, 12)
          .map((group) => [
            `Type ${group.relation_type}`,
            escapeHtml(`${group.relation_point} pts | ${group.member_count} members`),
          ]),
      )}
    </div>
  `;
}

export function attachRacetrackVisualizerListeners(course) {
  const visualizerState = getRacetrackVisualizerState(course);

  const queryInput = document.getElementById("visualizerSkillQuery");
  if (queryInput) {
    queryInput.addEventListener("input", () => {
      visualizerState.skillQuery = queryInput.value;
      requestRenderPreservingScrollAndFocus("visualizerSkillQuery");
    });
  }

  document.querySelectorAll("[data-skill-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      const skillId = button.dataset.skillPick;
      const ids = visualizerState.selectedSkillIds;
      const existingIndex = ids.indexOf(skillId);
      if (existingIndex >= 0) {
        ids.splice(existingIndex, 1);
      } else if (ids.length < MAX_VISUALIZER_SKILLS) {
        ids.push(skillId);
      }
      requestRenderPreservingScroll();
    });
  });

  const buildLoadBtn = document.getElementById("visualizerBuildLoadBtn");
  if (buildLoadBtn) {
    buildLoadBtn.addEventListener("click", () => {
      const buildId = document.getElementById("visualizerBuildPick")?.value;
      if (!buildId) {
        return;
      }
      const buildItem = getEntityItems("builds").find((item) => String(item.id) === buildId);
      const ids = visualizerState.selectedSkillIds;
      for (const skillId of getBuildSkillIds(buildItem)) {
        if (ids.length >= MAX_VISUALIZER_SKILLS) {
          break;
        }
        if (!ids.includes(skillId)) {
          ids.push(skillId);
        }
      }
      requestRenderPreservingScroll();
    });
  }
}

export function attachCmTargetRecommendationListeners(detail) {
  const buttons = document.querySelectorAll("[data-cm-reco-character]");
  if (!buttons.length) {
    return;
  }
  const recos = getCmTargetRecommendations(detail);
  const deck = getCmTargetDeck(detail).result.deck;
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const characterId = String(button.dataset.cmRecoCharacter || "");
      const reco = recos.find((candidate) => candidate.characterId === characterId);
      if (!reco) {
        return;
      }
      const skill = reco.skillReco || { required: [], optional: [] };
      startSeededBuildDraft({
        target_id: String(detail.id),
        character_id: reco.characterId,
        running_style: reco.bestStyle,
        target_stats: { ...reco.proposal.stats },
        support_deck: [...deck],
        required_skills: [...skill.required],
        optional_skills: [...skill.optional],
        name: `${detail.name} — ${reco.title}`,
      });
      setBrowseHash("roster", "builds", "__new__");
    });
  });
}
