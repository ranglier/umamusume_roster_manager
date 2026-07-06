// Phase 1 of the CM-first auto-build (docs/CM_BUILD_PLAN.md). Pure functions
// that, given a Champions Meeting target profile and the owned character
// roster, rank which umas fit the race and propose a running style + a stat
// target. Reuses the verified formulas in build_scoring.js - the aptitude fit
// is exact; proposeTargetStats is an explicitly-labeled heuristic (there is no
// verified stat-target formula in our sources). Deck/skills recommendation is
// Phase 2. No opponent/position simulation anywhere (Tier 3, out of scope).

import {
  getAptitudeModifier,
  getGutsStaminaCrossoverThreshold,
  getNearestStaminaReferences,
} from "./build_scoring.js";

export const RUNNING_STYLE_KEYS = ["runner", "leader", "betweener", "chaser"];

// Extracts a normalized target profile from a cm_target's detail.race_profile,
// so callers can pass either a frontend cm_target item or a plain profile. Keys
// match what the aptitude maps use (surface: turf/dirt, distance category:
// short/mile/medium/long).
export function targetProfileFromCmDetail(detail) {
  const race = detail?.race_profile || {};
  return {
    surfaceKey: race.surface_slug || String(race.surface || "").toLowerCase(),
    surface: race.surface || "",
    distanceKey: race.distance_category_slug || String(race.distance_category || "").toLowerCase(),
    distanceCategory: race.distance_category || "",
    distanceM: Number(race.distance_m) || 0,
  };
}

// Composite aptitude fit for a single style: the product of the four exact
// game modifiers (surface->accel, distance->speed, distance->accel,
// style->Wiz). A missing/unknown grade contributes 0 so it ranks last without
// throwing. All-A gives ~1.0, all-S gives ~1.21.
function styleFitScore(aptitudes, targetProfile, styleKey) {
  const surfaceMod = getAptitudeModifier("surfaceAccel", aptitudes?.surface?.[targetProfile.surfaceKey]) ?? 0;
  const distSpeedMod = getAptitudeModifier("distanceSpeed", aptitudes?.distance?.[targetProfile.distanceKey]) ?? 0;
  const distAccelMod = getAptitudeModifier("distanceAccel", aptitudes?.distance?.[targetProfile.distanceKey]) ?? 0;
  const styleMod = getAptitudeModifier("styleWiz", aptitudes?.style?.[styleKey]) ?? 0;
  return surfaceMod * distSpeedMod * distAccelMod * styleMod;
}

const USEFUL_GRADES = new Set(["S", "A"]);
const WORKABLE_GRADES = new Set(["S", "A", "B", "C"]);

function gradeVerdict(surfaceGrade, distanceGrade) {
  const s = String(surfaceGrade || "").toUpperCase();
  const d = String(distanceGrade || "").toUpperCase();
  if (USEFUL_GRADES.has(s) && USEFUL_GRADES.has(d)) return "useful";
  if (WORKABLE_GRADES.has(s) && WORKABLE_GRADES.has(d)) return "workable";
  return "off-target";
}

// Scores one owned character against the target, picking the running style that
// maximizes the aptitude fit. Ties resolve to the earlier style in
// RUNNING_STYLE_KEYS order (deterministic).
export function scoreCharacterForTarget(charItem, targetProfile) {
  const aptitudes = charItem?.detail?.aptitudes || {};
  const surfaceGrade = aptitudes.surface?.[targetProfile.surfaceKey] || "";
  const distanceGrade = aptitudes.distance?.[targetProfile.distanceKey] || "";

  let bestStyle = null;
  let bestScore = -Infinity;
  for (const styleKey of RUNNING_STYLE_KEYS) {
    const score = styleFitScore(aptitudes, targetProfile, styleKey);
    if (score > bestScore) {
      bestScore = score;
      bestStyle = styleKey;
    }
  }

  return {
    characterId: String(charItem?.id || ""),
    title: charItem?.title || String(charItem?.id || ""),
    bestStyle,
    styleGrade: aptitudes.style?.[bestStyle] || "",
    surfaceGrade,
    distanceGrade,
    fitScore: Math.round(bestScore * 10000) / 10000,
    verdict: gradeVerdict(surfaceGrade, distanceGrade),
  };
}

export function rankOwnedCharactersForTarget(ownedCharItems, targetProfile) {
  return (ownedCharItems || [])
    .map((item) => scoreCharacterForTarget(item, targetProfile))
    .sort((a, b) => b.fitScore - a.fitScore);
}

// Heuristic stat target - NOT a verified formula. Grounded where it can be:
// Stamina from the nearest umalator reference row for this distance+style
// (build_scoring.REQUIRED_STAMINA_TABLE) plus a CM debuff margin; Guts nudged
// just past the documented Guts/Stamina crossover; Speed/Power/Wit are common
// community defaults. Callers must present this as a starting point, not an
// optimum.
export function proposeTargetStats(targetProfile, styleKey) {
  const nearest = getNearestStaminaReferences(targetProfile.distanceM, 1)[0] || null;
  const staminaRef = nearest ? nearest[styleKey] : null;
  const gutsThreshold = getGutsStaminaCrossoverThreshold(targetProfile.distanceKey, targetProfile.distanceM, targetProfile.surfaceKey);

  return {
    stats: {
      speed: 1150,
      stamina: staminaRef != null ? staminaRef + 100 : 500,
      power: 1000,
      guts: gutsThreshold != null ? gutsThreshold + 50 : 350,
      wit: 1200,
    },
    basis: {
      staminaFrom: nearest ? `${nearest.distanceM}m + ${nearest.recoveries} gold(s) reference, +100 CM margin` : "fallback default (no close reference)",
      gutsFrom: gutsThreshold != null ? `just past the ${gutsThreshold} Guts crossover` : "fallback default",
    },
  };
}

// Orchestrates the Phase 1 recommendation: ranked candidates, each with its
// best style and a proposed stat target. Deck/skills stay empty until Phase 2.
export function recommendBuildForTarget(targetProfile, ownedCharItems, { limit = 5 } = {}) {
  const ranked = rankOwnedCharactersForTarget(ownedCharItems, targetProfile).slice(0, limit);
  return ranked.map((candidate) => ({
    ...candidate,
    proposal: proposeTargetStats(targetProfile, candidate.bestStyle),
  }));
}

// --- Phase 2a: heuristic support-deck suggestion. Deliberately a heuristic,
// not a scored optimum: our normalized data has no per-level stat curves, so
// there is no verified "support value" formula (docs/RACE_MECHANICS_REFERENCE.md
// only describes stat-stick passives qualitatively). We rank by what we can
// honestly read - rarity and limit break - and fill a type mix that follows
// the community deckbuilding guidance by distance ([REF-GL]). Note: the data's
// Wit type slug is "intelligence". ---

const DECK_SIZE = 6;

// Target type mix for a 6-card deck by distance category. Speed/Wit-heavy per
// [REF-GL] "Deckbuilding"; Stamina weight grows with distance.
const DECK_TYPE_DISTRIBUTION = {
  short: { speed: 3, intelligence: 2, power: 1 },
  mile: { speed: 3, intelligence: 2, power: 1 },
  medium: { speed: 2, intelligence: 2, stamina: 1, power: 1 },
  long: { speed: 2, intelligence: 1, stamina: 2, power: 1 },
};

export function getRecommendedTypeDistribution(distanceCategoryKey) {
  return DECK_TYPE_DISTRIBUTION[distanceCategoryKey] || DECK_TYPE_DISTRIBUTION.medium;
}

// Honest, explainable support score from the only fields we can read reliably:
// rarity dominates, limit break refines. No stat-curve guessing.
export function scoreSupportSummary(summary) {
  const rarity = Number(summary?.rarity) || 0;
  const limitBreak = Number(summary?.limitBreak) || 0;
  return rarity * 10 + limitBreak * 2;
}

// ownedSupportSummaries: [{ id, type, rarity, limitBreak }]. Returns the
// suggested deck plus the target vs actual type mix and a shortfall flag so
// the UI can be honest when the roster can't fill the recommended mix.
export function recommendSupportDeck(distanceCategoryKey, ownedSupportSummaries, { size = DECK_SIZE } = {}) {
  const target = getRecommendedTypeDistribution(distanceCategoryKey);
  const byType = new Map();
  for (const summary of ownedSupportSummaries || []) {
    const type = String(summary?.type || "").toLowerCase();
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(summary);
  }
  for (const list of byType.values()) {
    list.sort((a, b) => scoreSupportSummary(b) - scoreSupportSummary(a));
  }

  const picked = [];
  const pickedIds = new Set();
  const take = (summary) => {
    if (summary && !pickedIds.has(summary.id) && picked.length < size) {
      picked.push(summary);
      pickedIds.add(summary.id);
    }
  };

  // First pass: honor the target mix.
  for (const [type, count] of Object.entries(target)) {
    (byType.get(type) || []).slice(0, count).forEach(take);
  }
  // Second pass: fill any remaining slots with the best remaining, any type.
  const remaining = (ownedSupportSummaries || [])
    .filter((summary) => !pickedIds.has(summary.id))
    .sort((a, b) => scoreSupportSummary(b) - scoreSupportSummary(a));
  remaining.forEach(take);

  const actual = {};
  for (const summary of picked) {
    const type = String(summary.type || "").toLowerCase();
    actual[type] = (actual[type] || 0) + 1;
  }

  return {
    deck: picked.map((summary) => String(summary.id)),
    target,
    actual,
    shortfall: picked.length < size,
    filled: picked.length,
  };
}
