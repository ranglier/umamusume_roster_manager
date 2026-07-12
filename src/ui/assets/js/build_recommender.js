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
    raceName: detail?.name || race.track_name || "",
    // The CM's own race family (G1s at this track/distance) - the useful white
    // "race sparks" to hunt on parents. Carried through so recommendParentSpec
    // stays pure and self-contained (its signature takes only the profile).
    relatedRaces: (detail?.related_races || []).map((r) => ({ id: String(r.id || ""), title: r.title || "" })),
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
// rarity dominates, limit break refines. No stat-curve guessing. Kept as the
// FALLBACK for cards without a roster-view projection (see scoreSupportForTarget).
export function scoreSupportSummary(summary) {
  const rarity = Number(summary?.rarity) || 0;
  const limitBreak = Number(summary?.limitBreak) || 0;
  return rarity * 10 + limitBreak * 2;
}

// --- Phase 1a (Auto Prep, docs/AUTO_PREP_PLAN.md): score a support on its REAL
// effective values. The roster-view projection resolves every effect to its
// value AT THE CARD'S ACTUAL LEVEL/LB (scripts/lib/roster_progression.py ->
// resolve_support_effect_value -> `current_value`) - the recommender used to
// ignore this entirely and rank by rarity+LB. We now sum, per effect family,
//     familyWeight * (current_value / referenceValue)
// where referenceValue is a documented "strong maxed" magnitude so families of
// wildly different scales (Friendship is 15-40%, Race Bonus 5-15%, Initial Speed
// 20-35 points, Hint Lv. 1-4...) contribute comparably. The weights are
// HAND-PICKED and DOCUMENTED below - they are an explainable heuristic, not a
// proven optimum, and are confronted against real use (and later the meta). The
// `weights` argument is the Phase 4 meta injection hook: it overrides any family
// weight or reference without touching this code. Output carries reasons[] (the
// top contributing effects with their real value), never an opaque number. ---

// effect_id -> family key. Numeric ids are stable across the dataset
// (data/normalized/supports.json; ids 1..32, see the calibration note below).
export const SUPPORT_EFFECT_FAMILY = {
  1: "friendship",
  2: "mood",
  3: "statGain", 4: "statGain", 5: "statGain", 6: "statGain", 7: "statGain",
  8: "training",
  9: "initialStat", 10: "initialStat", 11: "initialStat", 12: "initialStat", 13: "initialStat",
  14: "bond",
  15: "raceBonus",
  16: "fanCount",
  17: "hint", 18: "hint",
  19: "specialty",
  25: "eventRecovery", 26: "eventRecovery",
  27: "failureRate",
  28: "energyDiscount",
  30: "skillPoint", 32: "skillPoint",
  31: "wisdomRecovery",
};

// Importance per family, in "points when the effect delivers its reference
// magnitude". Ordered by the community consensus on what makes a training
// support strong: Friendship Bonus and Increased Training (effectiveness)
// dominate; Specialty Rate keeps the card training its own stat; Wit cards live
// on their training recovery; then per-type stat gains / bond / energy; the
// situational bonuses (initial stats, race, hint, skill points, fan count) are
// minor. Tune here, not in the flow.
export const SUPPORT_FAMILY_WEIGHTS = {
  friendship: 100,
  training: 85,
  specialty: 55,
  wisdomRecovery: 45,
  statGain: 35,
  bond: 30,
  energyDiscount: 25,
  mood: 22,
  raceBonus: 20,
  failureRate: 18,
  initialStat: 14,
  hint: 12,
  skillPoint: 12,
  eventRecovery: 10,
  fanCount: 5,
};

// "Strong maxed" magnitude per effect_id, read off the max_value ranges in
// data/normalized/supports.json (calibration snapshot 2026-07: Friendship
// 15..40, Increased Training 5..20, Specialty 10..120, Initial stats 20..35,
// Race Bonus 5..15, Hint Lv. 1..4, Wit Recovery 2..5). Only used to normalize
// current_value into a ~0..1 share of a strong effect; not a cap.
export const SUPPORT_EFFECT_REFERENCE = {
  1: 30, 2: 45,
  3: 1.5, 4: 1.5, 5: 1.5, 6: 1.5, 7: 2,
  8: 15,
  9: 30, 10: 30, 11: 30, 12: 30, 13: 30,
  14: 35, 15: 10, 16: 20,
  17: 3, 18: 60, 19: 70,
  25: 60, 26: 50, 27: 20, 28: 20,
  30: 1.5, 31: 4, 32: 45,
};

// Mild, labeled distance modulation: energy/recovery families matter more on
// longer distances (stamina- and energy-tight), mirroring categoryWeight's
// recovery bump for skills. Everything else is target-independent card quality -
// distance composition is handled by the type-mix constraint in the deck
// builder, not by re-weighting a card's intrinsic value.
const DISTANCE_ENERGY_EMPHASIS = { short: 1.0, mile: 1.0, medium: 1.05, long: 1.2 };
const ENERGY_FAMILIES = new Set(["wisdomRecovery", "energyDiscount", "failureRate"]);

// Puts the rarity+LB fallback proxy on a band comparable to projection scores
// (a strong maxed SSR projects to a few hundred points). Deliberately
// conservative so a card WITHOUT projection data ranks below an equivalent card
// that does have it. Approximate by construction - flagged in reasons[].
const SUPPORT_FALLBACK_SCALE = 6;

// Scores one owned support against the target from its real effective values.
// `summary` is a roster-view support projection; effects are read from
// `effectiveEffects` (camelCase) or `effective_effects` (raw projection shape).
// Returns { score, hasProjection, reasons[] }. When no effect delivers a usable
// current_value, falls back to scoreSupportSummary (flagged, not silent).
export function scoreSupportForTarget(summary, targetProfile, weights = {}) {
  const familyWeights = { ...SUPPORT_FAMILY_WEIGHTS, ...(weights?.families || {}) };
  const references = { ...SUPPORT_EFFECT_REFERENCE, ...(weights?.references || {}) };
  const emphasis = DISTANCE_ENERGY_EMPHASIS[targetProfile?.distanceKey] ?? 1.0;
  const effects = summary?.effectiveEffects || summary?.effective_effects || [];

  const contributions = [];
  for (const effect of effects) {
    const effectId = Number(effect?.effect_id);
    const family = SUPPORT_EFFECT_FAMILY[effectId];
    if (!family) continue;
    const value = Number(effect?.current_value);
    if (!Number.isFinite(value) || value <= 0) continue;
    const reference = references[effectId] || 1;
    let weight = familyWeights[family] ?? 0;
    if (ENERGY_FAMILIES.has(family)) weight *= emphasis;
    const points = weight * (value / reference);
    if (points <= 0) continue;
    contributions.push({
      effectId,
      family,
      label: effect.name || `Effect #${effectId}`,
      value,
      level: effect.current_unlock_level || null,
      points: Math.round(points * 100) / 100,
    });
  }

  if (!contributions.length) {
    const proxy = scoreSupportSummary(summary) * SUPPORT_FALLBACK_SCALE;
    return {
      score: Math.round(proxy * 100) / 100,
      hasProjection: false,
      reasons: [{
        family: "fallback",
        label: `No effect data - ranked by rarity R${Number(summary?.rarity) || 0} / LB ${Number(summary?.limitBreak) || 0}`,
        points: Math.round(proxy * 100) / 100,
      }],
    };
  }

  contributions.sort((a, b) => b.points - a.points);
  const score = contributions.reduce((sum, entry) => sum + entry.points, 0);
  return {
    score: Math.round(score * 100) / 100,
    hasProjection: true,
    reasons: contributions.slice(0, 5),
  };
}

// ownedSupportSummaries: [{ id, type, rarity, limitBreak, effectiveEffects? }].
// Scores each card on its real effective values (scoreSupportForTarget) when a
// projection is present, and falls back to rarity+LB otherwise. The type mix is
// now a composition CONSTRAINT (first pass), not the ranking criterion. Returns
// the suggested deck (ids), the target vs actual mix, a shortfall flag, and
// `picks` with per-card { score, reasons[], hasProjection } for the UI. Pass
// `targetProfile` for distance-aware scoring; `weights` is the meta hook.
export function recommendSupportDeck(distanceCategoryKey, ownedSupportSummaries, { size = DECK_SIZE, targetProfile = null, weights = {} } = {}) {
  const target = getRecommendedTypeDistribution(distanceCategoryKey);
  const profile = targetProfile || { distanceKey: distanceCategoryKey };

  // Score once, cache by summary object (ids can collide across passes).
  const scoreById = new Map();
  const detailById = new Map();
  const scoreOf = (summary) => {
    const id = String(summary?.id ?? "");
    if (!scoreById.has(id)) {
      const detail = scoreSupportForTarget(summary, profile, weights);
      scoreById.set(id, detail.score);
      detailById.set(id, detail);
    }
    return scoreById.get(id);
  };
  (ownedSupportSummaries || []).forEach(scoreOf);

  const byType = new Map();
  for (const summary of ownedSupportSummaries || []) {
    const type = String(summary?.type || "").toLowerCase();
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(summary);
  }
  for (const list of byType.values()) {
    list.sort((a, b) => scoreOf(b) - scoreOf(a));
  }

  const picked = [];
  const pickedIds = new Set();
  const take = (summary) => {
    if (summary && !pickedIds.has(summary.id) && picked.length < size) {
      picked.push(summary);
      pickedIds.add(summary.id);
    }
  };

  // First pass: honor the target mix (composition constraint).
  for (const [type, count] of Object.entries(target)) {
    (byType.get(type) || []).slice(0, count).forEach(take);
  }
  // Second pass: fill any remaining slots with the best remaining, any type.
  const remaining = (ownedSupportSummaries || [])
    .filter((summary) => !pickedIds.has(summary.id))
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  remaining.forEach(take);

  const actual = {};
  for (const summary of picked) {
    const type = String(summary.type || "").toLowerCase();
    actual[type] = (actual[type] || 0) + 1;
  }

  return {
    deck: picked.map((summary) => String(summary.id)),
    picks: picked.map((summary) => {
      const id = String(summary.id);
      const detail = detailById.get(id) || { score: 0, reasons: [], hasProjection: false };
      return { id, type: String(summary.type || "").toLowerCase(), title: summary.title, ...detail };
    }),
    target,
    actual,
    shortfall: picked.length < size,
    filled: picked.length,
  };
}

// --- Phase 2b: skill recommendation by effect category. The category comes
// from the skill's effect `type` id, mapped below. That mapping is INFERRED,
// not published by GameTora: each entry was cross-checked against several
// well-known skills of that type (e.g. type 31 = Feel the Burn!/Groundwork =
// acceleration; type 27/22 = Certain Victory/Shooting Star = speed; type 9 =
// Clear Heart = recovery; type 8/13/21 = Smoke Screen/Hesitant = debuff). Only
// the high-frequency, high-confidence categories are mapped; everything else
// stays "other". Precise per-track zone fit (does an accel fire at the spurt
// start?) is deliberately NOT auto-scored here - it needs an unambiguous track
// (same limit as the stat-threshold/last-spurt panels), and the Skill
// Visualizer already shows it exactly per racetrack. ---

const EFFECT_TYPE_CATEGORY = {
  31: "accel",
  22: "speed",
  27: "speed",
  9: "recovery",
  8: "debuff",
  13: "debuff",
  21: "debuff",
};

const CATEGORY_PRIORITY = { accel: 4, speed: 3, recovery: 2, debuff: 1, other: 0 };

// Highest-priority category among all of a skill's effect types.
export function categorizeSkillEffect(skillItem) {
  const groups = skillItem?.detail?.condition_groups || [];
  let best = "other";
  for (const group of groups) {
    for (const effect of group.effects || []) {
      const category = EFFECT_TYPE_CATEGORY[effect.type] || "other";
      if (CATEGORY_PRIORITY[category] > CATEGORY_PRIORITY[best]) {
        best = category;
      }
    }
  }
  return best;
}

// Weight per category for a self-win build. Acceleration dominates
// ([REF-GL] "How to Win"); debuffs help other umas, not this one, so they are
// excluded from a self-build's own kit.
function categoryWeight(category, targetProfile) {
  const base = { accel: 100, speed: 60, recovery: 40, other: 10, debuff: -1 };
  let weight = base[category] ?? 0;
  // Recovery matters much more on long distances (stamina-tight).
  if (category === "recovery" && targetProfile?.distanceKey === "long") weight = 60;
  return weight;
}

// poolSkillItems: resolved reference skill items (with detail.condition_groups
// and detail.rarity), deduped by the caller or here. Returns a required/optional
// shortlist plus a per-category count.
export function recommendSkillsForBuild(poolSkillItems, targetProfile, { requiredLimit = 4, optionalLimit = 6 } = {}) {
  const seen = new Set();
  const scored = [];
  for (const item of poolSkillItems || []) {
    const id = String(item?.id || item?.detail?.skill_id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const category = categorizeSkillEffect(item);
    const weight = categoryWeight(category, targetProfile);
    if (weight < 0) continue; // drop debuffs from a self-build
    const rarity = Number(item?.detail?.rarity) || 0;
    scored.push({ id, title: item.title || id, category, score: weight + rarity * 3 });
  }
  scored.sort((a, b) => b.score - a.score);

  const required = [];
  const optional = [];
  for (const entry of scored) {
    if ((entry.category === "accel" || entry.category === "speed") && required.length < requiredLimit) {
      required.push(entry);
    } else if (optional.length < optionalLimit) {
      optional.push(entry);
    }
  }

  const byCategory = {};
  for (const entry of [...required, ...optional]) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
  }

  return {
    required: required.map((entry) => entry.id),
    optional: optional.map((entry) => entry.id),
    byCategory,
    poolSize: scored.length,
  };
}

// --- Phase 1b (Auto Prep): parent SPEC, not parent SELECTION. Decision on
// record (docs/AUTO_PREP_PLAN.md): half the parents come from the in-game friend
// borrow list at setup time, invisible to the app, so we NEVER name concrete
// parents - we say what sparks to hunt for. A parent spec is one blue stat spark
// + one pink aptitude spark at a target star level, plus a shared list of white
// sparks (race + build skills). All heuristic, all labeled, all with reasons. ---

const APTITUDE_LABELS = {
  runner: "FRONT RUNNER", leader: "PACE CHASER", betweener: "LATE SURGER", chaser: "END CLOSER",
};

// Recommend chasing 3-star sparks: the practical strong target (each star adds a
// meaningful chunk; 3 is reliably reachable when hunting a specific spark).
const PARENT_SPARK_STARS = 3;

function isBelowA(grade) {
  const g = String(grade || "").toUpperCase();
  return g !== "S" && g !== "A";
}

// Aptitude gaps the target needs but the character is below A on, in priority
// order: distance drives both speed and accel modifiers (biggest lever), then
// surface (accel), then running style (Wiz). A pink spark on a parent lifts the
// child's grade, so these are the ones worth hunting.
function collectPinkGaps(aptitudes, targetProfile, bestStyle) {
  const gaps = [];
  const distanceGrade = aptitudes?.distance?.[targetProfile.distanceKey];
  if (isBelowA(distanceGrade)) {
    gaps.push({ kind: "distance", label: String(targetProfile.distanceCategory || targetProfile.distanceKey || "").toUpperCase(), currentGrade: String(distanceGrade || "-").toUpperCase(), priority: 3 });
  }
  const surfaceGrade = aptitudes?.surface?.[targetProfile.surfaceKey];
  if (isBelowA(surfaceGrade)) {
    gaps.push({ kind: "surface", label: String(targetProfile.surface || targetProfile.surfaceKey || "").toUpperCase(), currentGrade: String(surfaceGrade || "-").toUpperCase(), priority: 2 });
  }
  const styleGrade = aptitudes?.style?.[bestStyle];
  if (isBelowA(styleGrade)) {
    gaps.push({ kind: "style", label: APTITUDE_LABELS[bestStyle] || String(bestStyle || "").toUpperCase(), currentGrade: String(styleGrade || "-").toUpperCase(), priority: 1 });
  }
  return gaps.sort((a, b) => b.priority - a.priority);
}

// The two most constrained base stats for a target, as a labeled heuristic tied
// to the same distance->stamina reasoning as the Feasibility panel: stamina is
// the binding threshold on medium/long, raw speed on short/mile; the second stat
// is the runner-up pressure. Each parent takes one blue spark from this ranking.
function rankConstrainedStats(targetProfile) {
  const staminaHeavy = targetProfile?.distanceKey === "long" || targetProfile?.distanceKey === "medium";
  return staminaHeavy
    ? [
        { stat: "STAMINA", reason: "stamina is the binding threshold at this distance (see Feasibility)" },
        { stat: "SPEED", reason: "raw speed still sets the pace" },
      ]
    : [
        { stat: "SPEED", reason: "short/mile races are won on raw speed" },
        { stat: "POWER", reason: "acceleration out of the corners" },
      ];
}

// recommendParentSpec(targetProfile, charItem, buildSkills)
// - buildSkills: array of skill ids or { id, title } from the build draft.
// Returns two parent specs (blue + pink + stars), the full pink-gap list, the
// shared white-spark shopping list (races + skills), and reasons[]. Never picks
// concrete parents.
export function recommendParentSpec(targetProfile, charItem, buildSkills = []) {
  const aptitudes = charItem?.detail?.aptitudes || {};
  const bestStyle = scoreCharacterForTarget(charItem, targetProfile).bestStyle;
  const pinkGaps = collectPinkGaps(aptitudes, targetProfile, bestStyle);
  const blueStats = rankConstrainedStats(targetProfile);

  // Blue: each parent covers one of the top-2 constrained stats. Pink: if there
  // are 2+ aptitude gaps, spread the top two across the parents to cover more
  // ground; with a single gap, both parents hunt it (aptitude sparks stack).
  const parents = [0, 1].map((index) => {
    const blue = blueStats[index] || blueStats[0];
    let pink = null;
    if (pinkGaps.length >= 2) pink = pinkGaps[index] || pinkGaps[0];
    else if (pinkGaps.length === 1) pink = pinkGaps[0];
    const parts = [`Parent ${index + 1}: ${blue.stat}`];
    if (pink) parts.push(`${pink.label} ${PARENT_SPARK_STARS}★`);
    return {
      label: `Parent ${index + 1}`,
      blue: { stat: blue.stat, reason: blue.reason },
      pink: pink ? { kind: pink.kind, label: pink.label, currentGrade: pink.currentGrade, stars: PARENT_SPARK_STARS } : null,
      stars: PARENT_SPARK_STARS,
      summary: parts.join(", "),
    };
  });

  const raceSparks = (targetProfile?.relatedRaces || []).slice(0, 4).map((race) => ({ id: race.id, title: race.title }));
  const skillSparks = (buildSkills || [])
    .map((skill) => (typeof skill === "string" ? { id: skill, title: skill } : { id: String(skill?.id || ""), title: skill?.title || String(skill?.id || "") }))
    .filter((skill) => skill.id)
    .slice(0, 6);

  const reasons = [];
  if (pinkGaps.length) {
    reasons.push(`Pink sparks fill aptitude gaps where ${charItem?.title || "this uma"} is below A: ${pinkGaps.map((g) => `${g.label} (${g.currentGrade})`).join(", ")}.`);
  } else {
    reasons.push("Aptitudes already A+ for this target - no pink spark strictly needed; a second blue or a skill spark is fine.");
  }
  reasons.push(`Blue sparks target the most constrained stats: ${blueStats.map((b) => b.stat).join(" then ")}.`);
  if (raceSparks.length) reasons.push(`White race sparks worth having: ${raceSparks.map((r) => r.title).join(", ")}.`);
  if (skillSparks.length) reasons.push(`White skill sparks from the build: ${skillSparks.map((s) => s.title).join(", ")}.`);

  return {
    parents,
    pinkGaps,
    whiteSparks: { races: raceSparks, skills: skillSparks },
    stars: PARENT_SPARK_STARS,
    reasons,
  };
}

// --- Phase 1c (Auto Prep): scenario suggestion from a CURATED table. This is
// the project's weakest source of truth, and it is labeled as such: scenario
// value is mostly target-independent (it's about the mechanics you want and what
// you've practiced), so v1 only makes a confident call where a scenario clearly
// favors the target's distance/surface (L'Arc for long turf), and otherwise says
// so out loud ("no strong signal - pick your most practiced"). The meta layer
// (Phase 4) replaces/weights this. Notes are hand-written, source "curated". ---

// Keyed by scenario slug (data/normalized/scenarios.json). Only the widely-known
// scenarios are described; `favors` is the only field recommendScenario keys on.
export const SCENARIO_NOTES = [
  { slug: "scenario-larc", name: "Project L'Arc", bonusType: "races", caps: "high stat gains overseas", favors: { distance: ["long", "medium"], surface: ["turf"] }, verdict: "Best for long turf targets: overseas races reward stamina and pace, big stat swings." },
  { slug: "scenario-uaf", name: "U.A.F. Ready GO!", bonusType: "training", caps: "very high all-round stats", favors: {}, verdict: "Strong general pick: athletics training pushes high stats across the board." },
  { slug: "scenario-aoharu", name: "Aoharu Cup", bonusType: "races", caps: "team races give stat blocks", favors: { distance: ["medium", "long"] }, verdict: "Reliable all-rounder; team races help stamina-leaning builds." },
  { slug: "scenario-live", name: "Grand Live", bonusType: "training", caps: "skill-point heavy", favors: {}, verdict: "Best when the build wants many skills - performance stats feed hints and SP." },
  { slug: "scenario-masters", name: "Grandmasters", bonusType: "training", caps: "high ceilings, complex", favors: {}, verdict: "Advanced min-maxing; high ceilings but more micro." },
  { slug: "scenario-mant", name: "TS Climax", bonusType: "training", caps: "shop-boosted, flexible", favors: {}, verdict: "Flexible high ceiling if you like managing the shop." },
  { slug: "scenario-ura", name: "URA Finale", bonusType: "training", caps: "baseline, no special mechanic", favors: {}, verdict: "Simplest baseline - safe when unsure or learning a new uma." },
];

function scenarioFavorScore(note, targetProfile) {
  let score = 0;
  if ((note.favors?.distance || []).includes(targetProfile?.distanceKey)) score += 2;
  if ((note.favors?.surface || []).includes(targetProfile?.surfaceKey)) score += 1;
  return score;
}

// recommendScenario(targetProfile) -> { recommended, alternatives, confidence,
// note, reasons[] }. confidence is "curated-match" only when a scenario clearly
// favors the target's distance+surface; otherwise "low" with an honest note.
export function recommendScenario(targetProfile) {
  const scored = SCENARIO_NOTES
    .map((note) => ({ note, favor: scenarioFavorScore(note, targetProfile) }))
    .sort((a, b) => b.favor - a.favor);

  const top = scored[0];
  const strong = top.favor >= 3; // matched both distance AND surface
  const recommended = top.note;
  const alternatives = scored.slice(1, 4).map((entry) => ({ slug: entry.note.slug, name: entry.note.name, verdict: entry.note.verdict }));

  const reasons = [];
  let confidence;
  let note;
  if (strong) {
    confidence = "curated-match";
    note = null;
    reasons.push(`${recommended.name}: ${recommended.verdict}`);
  } else {
    confidence = "low";
    note = "No strong scenario signal for this target - pick the one you've practiced most. This table is curated (to be replaced by meta data).";
    reasons.push(note);
    reasons.push(`Default suggestion ${recommended.name}: ${recommended.verdict}`);
  }

  return {
    recommended: { slug: recommended.slug, name: recommended.name, bonusType: recommended.bonusType, caps: recommended.caps, verdict: recommended.verdict },
    alternatives,
    confidence,
    source: "curated",
    note,
    reasons,
  };
}
