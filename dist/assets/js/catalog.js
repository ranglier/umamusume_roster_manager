// Auto-split from app.js as part of docs/REFACTOR_PLAN.md.
import { TRAINING_EVENT_EFFECT_LABELS, asArray, data, getEntityItems, getSkillReferences, getViewState, state } from "./core.js";
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
import { requestRenderPreservingScroll, requestRenderPreservingScrollAndFocus } from "../app.js";

export function getSkillPickerOptions() {
  return getEntityItems("skills").map((item) => ({ value: String(item.id), label: item.title || String(item.id) }));
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

  return `
    <section class="character-grid-block${config.compact ? " character-grid-block-compact" : ""}">
      <div class="character-grid-head">${escapeHtml(title)}</div>
      <div class="character-grid-body" style="--character-grid-columns:${safeColumns.length};">
        ${safeColumns
          .map((column) => `
            <div class="character-grid-cell">
              <span class="character-grid-label">${escapeHtml(column.label)}</span>
              <strong class="character-grid-value">${escapeHtml(values?.[column.key] ?? "-")}</strong>
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
    <div class="detail-section">
      <h3>Course Geometry</h3>
      <pre class="code-block">${escapeHtml(
        JSON.stringify(
          {
            phases: detail.phases,
            corners: detail.corners,
            straights: detail.straights,
            slopes: detail.slopes,
            spurt_start: detail.spurt_start,
            stat_thresholds: detail.stat_thresholds,
          },
          null,
          2,
        ),
      )}</pre>
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
}
