// Tier 1 build-scoring formulas (docs/CM_BUILD_PLAN.md phase 3D, "evaluation
// locale deterministe"). Every constant here is sourced from
// docs/RACE_MECHANICS_REFERENCE.md - verified game formulas cross-referenced
// across three community documents, not guessed weights. Deliberately no
// opponent/position simulation (that's Tier 3, out of scope - see that doc).

const APTITUDE_MODIFIERS = {
  surfaceAccel: { S: 1.05, A: 1.0, B: 0.9, C: 0.8, D: 0.7, E: 0.5, F: 0.3, G: 0.1 },
  distanceSpeed: { S: 1.05, A: 1.0, B: 0.9, C: 0.8, D: 0.6, E: 0.4, F: 0.2, G: 0.1 },
  distanceAccel: { S: 1.0, A: 1.0, B: 1.0, C: 1.0, D: 1.0, E: 0.6, F: 0.5, G: 0.4 },
  styleWiz: { S: 1.1, A: 1.0, B: 0.85, C: 0.75, D: 0.6, E: 0.4, F: 0.2, G: 0.1 },
};

export function getAptitudeModifier(kind, grade) {
  const table = APTITUDE_MODIFIERS[kind];
  if (!table) return null;
  const normalized = String(grade || "").trim().toUpperCase();
  return table[normalized] ?? null;
}

// Compares a character's current aptitude grade against the build's planned
// (post-inheritance) target grade for the same aptitude kind.
export function compareAptitudeModifiers(kind, currentGrade, targetGrade) {
  const current = getAptitudeModifier(kind, currentGrade);
  const target = getAptitudeModifier(kind, targetGrade);
  return {
    current,
    target,
    gain: current != null && target != null ? Math.round((target - current) * 1000) / 1000 : null,
  };
}

const HP_STRATEGY_COEF = { runner: 0.95, leader: 0.89, betweener: 1.0, chaser: 0.995 };

export function computeMaxHp(staminaStat, courseDistanceM, styleKey) {
  const coef = HP_STRATEGY_COEF[styleKey];
  if (coef == null || !Number.isFinite(staminaStat) || !Number.isFinite(courseDistanceM)) {
    return null;
  }
  return courseDistanceM + 0.8 * coef * staminaStat;
}

// Empirical stamina reference points (umalator measurements, [REF-GL]), not a
// formula - only exact (distance, recovery count) matches are returned.
// Interpolating between rows would assert a precision these measurements
// don't carry across arbitrary tracks.
export const REQUIRED_STAMINA_TABLE = [
  { distanceM: 1400, recoveries: 0, runner: 570, leader: 540, betweener: 500, chaser: 510 },
  { distanceM: 1800, recoveries: 0, runner: 800, leader: 770, betweener: 720, chaser: 740 },
  { distanceM: 1800, recoveries: 1, runner: 640, leader: 600, betweener: 560, chaser: 580 },
  { distanceM: 2400, recoveries: 1, runner: 910, leader: 930, betweener: 870, chaser: 900 },
  { distanceM: 2400, recoveries: 2, runner: 710, leader: 720, betweener: 680, chaser: 700 },
  { distanceM: 2600, recoveries: 1, runner: 1130, leader: 1110, betweener: 1030, chaser: 1060 },
  { distanceM: 2600, recoveries: 2, runner: 900, leader: 870, betweener: 820, chaser: 850 },
  { distanceM: 3200, recoveries: 2, runner: 1080, leader: 1060, betweener: 990, chaser: 1020 },
  { distanceM: 3200, recoveries: 3, runner: 830, leader: 800, betweener: 750, chaser: 780 },
];

export function getRequiredStaminaEstimate(distanceM, recoveries, styleKey) {
  const entry = REQUIRED_STAMINA_TABLE.find((row) => row.distanceM === distanceM && row.recoveries === recoveries);
  return entry ? entry[styleKey] ?? null : null;
}

// Nearest reference rows by distance, for manual judgement when there is no
// exact match - always labeled as approximate context, never substituted for
// an exact figure.
export function getNearestStaminaReferences(distanceM, limit = 2) {
  if (!Number.isFinite(distanceM)) return [];
  return [...REQUIRED_STAMINA_TABLE].sort((a, b) => Math.abs(a.distanceM - distanceM) - Math.abs(b.distanceM - distanceM)).slice(0, limit);
}

const STAT_THRESHOLD_KEYS = { 1: "speed", 2: "stamina", 3: "power", 4: "guts", 5: "wit" };

function statThresholdTierBonus(statValue) {
  const value = Number(statValue) || 0;
  if (value > 900) return 0.2;
  if (value > 600) return 0.15;
  if (value > 300) return 0.1;
  return 0.05;
}

// racetracks.stat_thresholds is a list of raw 1-indexed stat ids (1=speed,
// 2=stamina, 3=power, 4=guts, 5=wit); the course's bonus is the average of
// each threshold stat's own tier, not a single combined check.
export function computeStatThresholdBonus(targetStats, statThresholdIndices) {
  const indices = Array.isArray(statThresholdIndices) ? statThresholdIndices : [];
  if (!indices.length) return null;
  const bonuses = indices.map((index) => statThresholdTierBonus(targetStats?.[STAT_THRESHOLD_KEYS[index]]));
  return bonuses.reduce((sum, value) => sum + value, 0) / bonuses.length;
}

export function computeSkillActivationChance(wizStat) {
  if (!Number.isFinite(wizStat) || wizStat <= 0) return null;
  return Math.max(100 - 9000 / wizStat, 20);
}

export function computeRushedChance(wizStat) {
  if (!Number.isFinite(wizStat) || wizStat <= 0) return null;
  return (6.5 / Math.log10(0.1 * wizStat + 1)) ** 2;
}

// Below this Guts value, +1 Guts is worth more than +1 Stamina; above it,
// less. Dirt races use 260 regardless of distance category per [REF-GL] -
// the exact reason isn't explained there, taken as-is rather than guessed.
export function getGutsStaminaCrossoverThreshold(distanceCategoryKey, distanceM, surfaceKey) {
  if (String(surfaceKey || "").toLowerCase() === "dirt") return 260;
  switch (distanceCategoryKey) {
    case "short":
      return 210;
    case "mile":
      return 260;
    case "medium":
      return 320;
    case "long":
      return Number.isFinite(distanceM) ? (distanceM >= 3300 ? 440 : 380) : null;
    default:
      return null;
  }
}
