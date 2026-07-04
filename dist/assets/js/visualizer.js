// New module for the Race Skill Visualizer (docs/CM_BUILD_PLAN.md,
// docs/EXTERNAL_SOURCES_PLAN.md). Racetrack course geometry here is 1D only
// (meter-ranges along the course, no 2D curve/(x,y) shape data anywhere in
// the pipeline) - this stays an honest linear distance view, not a literal
// track oval.

import { escapeHtml } from "./dom-utils.js";

const CONDITION_TERM_PATTERN = /^(\w+)(==|>=|<=)(-?\d+)$/;

export function parseConditionString(rawCondition) {
  const text = String(rawCondition || "").trim();
  if (!text) {
    return { orGroups: [] };
  }

  const orGroups = text.split("@").map((alternative) =>
    alternative.split("&").map((rawTerm) => {
      const term = rawTerm.trim();
      const match = term.match(CONDITION_TERM_PATTERN);
      if (!match) {
        return { variable: null, raw: term };
      }
      const [, variable, operator, value] = match;
      return { variable, operator, value: Number(value) };
    }),
  );

  return { orGroups };
}

export const STATIC_ZONE_VARIABLES = new Set([
  "is_finalcorner",
  "is_lastcorner",
  "is_last_straight",
  "is_laststraight",
  "phase",
  "phase_random",
  "remain_distance",
  "slope",
]);

function isStaticTerm(term) {
  return term.variable !== null && STATIC_ZONE_VARIABLES.has(term.variable);
}

function describeTerm(term) {
  if (term.variable === null) {
    return term.raw;
  }
  return `${term.variable}${term.operator}${term.value}`;
}

function resolveZoneForStaticTerm(term, course) {
  const corners = Array.isArray(course?.corners) ? course.corners : [];
  const straights = Array.isArray(course?.straights) ? course.straights : [];
  const phases = Array.isArray(course?.phases) ? course.phases : [];
  const slopes = Array.isArray(course?.slopes) ? course.slopes : [];
  const lengthM = Number(course?.length_m) || 0;

  if (term.variable === "is_finalcorner" || term.variable === "is_lastcorner") {
    if (!corners.length) return null;
    const last = corners.reduce((best, corner) => ((corner.number ?? -Infinity) > (best.number ?? -Infinity) ? corner : best));
    return { start: last.start, end: last.end, approximate: false };
  }

  if (term.variable === "is_last_straight" || term.variable === "is_laststraight") {
    if (!straights.length) return null;
    const last = straights.reduce((best, straight) => (straight.start > best.start ? straight : best));
    return { start: last.start, end: last.end, approximate: false };
  }

  if (term.variable === "phase") {
    const match = phases.find((phase) => phase.id === term.value);
    return match ? { start: match.start, end: match.end, approximate: false } : null;
  }

  if (term.variable === "phase_random") {
    // phase_random has no explicit phase id in the condition itself - without
    // one, the best we can honestly say is "somewhere in the course", so
    // fall back to the last phase (the phase random effects are documented
    // as most commonly tied to) rather than fabricating a specific match.
    const match = phases[phases.length - 1];
    return match ? { start: match.start, end: match.end, approximate: true } : null;
  }

  if (term.variable === "remain_distance" && lengthM > 0) {
    const threshold = Math.min(term.value, lengthM);
    return { start: lengthM - threshold, end: lengthM, approximate: false };
  }

  if (term.variable === "slope") {
    const match = slopes.find((slope) => (term.value > 0 ? slope.slope > 0 : slope.slope < 0));
    return match ? { start: match.start, end: match.end, approximate: false, uphill: match.slope > 0 } : null;
  }

  return null;
}

export function resolveStaticZones(condition, precondition, course) {
  const zones = [];
  const unplacedDynamicOnly = [];
  const unparsedTerms = [];

  const groups = [...parseConditionString(condition).orGroups, ...parseConditionString(precondition).orGroups];

  for (const group of groups) {
    const staticTerms = group.filter(isStaticTerm);
    const dynamicTerms = group.filter((term) => !isStaticTerm(term));

    for (const term of dynamicTerms) {
      if (term.variable === null) {
        unparsedTerms.push(term.raw);
      }
    }

    if (!staticTerms.length) {
      const label = group.map(describeTerm).join(" & ");
      if (label) {
        unplacedDynamicOnly.push(label);
      }
      continue;
    }

    const dynamicBadges = dynamicTerms.filter((term) => term.variable !== null).map(describeTerm);

    for (const term of staticTerms) {
      const zone = resolveZoneForStaticTerm(term, course);
      if (zone) {
        zones.push({ ...zone, source: term.variable, dynamicBadges });
      }
    }
  }

  return { zones, unplacedDynamicOnly, unparsedTerms };
}

const SVG_WIDTH = 1000;
const LANE_CORNER = { y: 0, height: 24 };
const LANE_STRAIGHT = { y: 30, height: 24 };
const LANE_SLOPE = { y: 60, height: 16 };
const PHASE_TICK_Y = 82;
const SVG_HEIGHT = 130;

function metersToX(meters, lengthM) {
  if (!lengthM) return 0;
  return Math.max(0, Math.min(SVG_WIDTH, (meters / lengthM) * SVG_WIDTH));
}

function rangeRect(start, end, lengthM, lane, className) {
  const x = metersToX(start, lengthM);
  const width = Math.max(0, metersToX(end, lengthM) - x);
  return `<rect class="${className}" x="${x.toFixed(2)}" y="${lane.y}" width="${width.toFixed(2)}" height="${lane.height}" />`;
}

export function buildTrackSvg(course, { highlightZones = [] } = {}) {
  const lengthM = Number(course?.length_m) || 0;
  const corners = Array.isArray(course?.corners) ? course.corners : [];
  const straights = Array.isArray(course?.straights) ? course.straights : [];
  const slopes = Array.isArray(course?.slopes) ? course.slopes : [];
  const phases = Array.isArray(course?.phases) ? course.phases : [];

  const cornerRects = corners.map((corner) => rangeRect(corner.start, corner.end, lengthM, LANE_CORNER, "track-zone-corner"));
  const straightRects = straights.map((straight) => rangeRect(straight.start, straight.end, lengthM, LANE_STRAIGHT, "track-zone-straight"));
  const slopeRects = slopes.map((slope) =>
    rangeRect(slope.start, slope.end, lengthM, LANE_SLOPE, slope.slope > 0 ? "track-zone-uphill" : "track-zone-downhill"),
  );

  const LABEL_EDGE_MARGIN = 40;
  const phaseTicks = phases.map((phase) => {
    const x = metersToX(phase.start, lengthM);
    const anchor = x < LABEL_EDGE_MARGIN ? "start" : x > SVG_WIDTH - LABEL_EDGE_MARGIN ? "end" : "middle";
    return `
      <line class="track-phase-tick" x1="${x.toFixed(2)}" y1="${PHASE_TICK_Y}" x2="${x.toFixed(2)}" y2="${PHASE_TICK_Y + 10}" />
      <text class="track-phase-label" style="text-anchor:${anchor};" x="${x.toFixed(2)}" y="${PHASE_TICK_Y + 20}">${escapeHtml(`Phase ${phase.id}`)}</text>
    `;
  });

  const highlightRects = highlightZones.map((zone) => {
    const className = zone.approximate ? "track-zone-skill-highlight-approx" : "track-zone-skill-highlight";
    const x = metersToX(zone.start, lengthM);
    const width = Math.max(0, metersToX(zone.end, lengthM) - x);
    return `<rect class="${className}" x="${x.toFixed(2)}" y="-4" width="${width.toFixed(2)}" height="${SVG_HEIGHT - 12}" />`;
  });

  return `
    <svg class="track-svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Race track distance overview">
      <rect class="track-base-line" x="0" y="${LANE_STRAIGHT.y - 3}" width="${SVG_WIDTH}" height="2" />
      ${straightRects.join("")}
      ${cornerRects.join("")}
      ${slopeRects.join("")}
      ${phaseTicks.join("")}
      <line class="track-finish-line" x1="${SVG_WIDTH}" y1="0" x2="${SVG_WIDTH}" y2="${PHASE_TICK_Y}" />
      <text class="track-finish-label" x="${SVG_WIDTH - 4}" y="${PHASE_TICK_Y + 20}">Finish</text>
      ${highlightRects.join("")}
    </svg>
  `;
}

const SKILL_PICKER_LIMIT = 100;

export function getFilteredSkillPickerOptions(allOptions, query, selectedSkillId) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  let visibleOptions = normalizedQuery
    ? allOptions.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery))
    : allOptions;

  const isLimited = !normalizedQuery && visibleOptions.length > SKILL_PICKER_LIMIT;
  if (isLimited) {
    visibleOptions = visibleOptions.slice(0, SKILL_PICKER_LIMIT);
  }

  if (selectedSkillId && !visibleOptions.some((option) => option.value === selectedSkillId)) {
    const selectedOption = allOptions.find((option) => option.value === selectedSkillId);
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
