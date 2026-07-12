import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoPrepPlan,
  categorizeSkillEffect,
  getRecommendedTypeDistribution,
  proposeTargetStats,
  rankOwnedCharactersForTarget,
  recommendBuildForTarget,
  makeSkillZoneCounter,
  recommendParentSpec,
  recommendScenario,
  recommendSkillsForBuild,
  recommendSupportDeck,
  scoreCharacterForTarget,
  scoreSupportForTarget,
  scoreSupportSummary,
  targetProfileFromCmDetail,
} from "../../src/ui/assets/js/build_recommender.js";

// Tokyo 2400m Turf Medium, mirrors data/normalized/cm_targets.json cm_001.
const MEDIUM_TURF = { surfaceKey: "turf", surface: "Turf", distanceKey: "medium", distanceCategory: "Medium", distanceM: 2400 };

function makeChar(id, aptitudes, title = id) {
  return { id, title, detail: { aptitudes } };
}

// Real Special Week aptitudes (data/normalized/characters.json item 100101).
const SPECIAL_WEEK = makeChar("100101", {
  surface: { turf: "A", dirt: "G" },
  distance: { short: "F", mile: "C", medium: "A", long: "A" },
  style: { runner: "G", leader: "A", betweener: "A", chaser: "C" },
}, "Special Week");

test("targetProfileFromCmDetail reads the race profile slugs", () => {
  const profile = targetProfileFromCmDetail({
    race_profile: { surface: "Turf", surface_slug: "turf", distance_m: 2400, distance_category: "Medium", distance_category_slug: "medium" },
  });
  assert.equal(profile.surfaceKey, "turf");
  assert.equal(profile.distanceKey, "medium");
  assert.equal(profile.distanceM, 2400);
});

test("scoreCharacterForTarget picks the best style and grades the surface/distance fit", () => {
  const result = scoreCharacterForTarget(SPECIAL_WEEK, MEDIUM_TURF);
  assert.equal(result.characterId, "100101");
  assert.equal(result.surfaceGrade, "A");
  assert.equal(result.distanceGrade, "A");
  // leader and betweener are both A; leader wins the tie (earlier in order).
  assert.equal(result.bestStyle, "leader");
  assert.equal(result.styleGrade, "A");
  assert.equal(result.fitScore, 1); // all-A product = 1.0
  assert.equal(result.verdict, "useful");
});

test("scoreCharacterForTarget rewards an S-aptitude character with a higher fit score", () => {
  const sTier = makeChar("s1", {
    surface: { turf: "S", dirt: "G" },
    distance: { short: "F", mile: "C", medium: "S", long: "A" },
    style: { runner: "S", leader: "B", betweener: "C", chaser: "D" },
  });
  const result = scoreCharacterForTarget(sTier, MEDIUM_TURF);
  assert.equal(result.bestStyle, "runner");
  // 1.05 (surface S) * 1.05 (dist speed S) * 1.0 (dist accel S) * 1.1 (style S)
  assert.ok(result.fitScore > 1.2);
  assert.equal(result.verdict, "useful");
});

test("scoreCharacterForTarget flags an off-target character and never throws on missing grades", () => {
  const offTarget = makeChar("d1", {
    surface: { turf: "D", dirt: "A" },
    distance: { short: "A", mile: "B", medium: "E", long: "F" },
    style: { runner: "B", leader: "C", betweener: "D", chaser: "E" },
  });
  const result = scoreCharacterForTarget(offTarget, MEDIUM_TURF);
  assert.equal(result.verdict, "off-target");
  assert.ok(Number.isFinite(result.fitScore));
});

test("rankOwnedCharactersForTarget sorts candidates by fit score descending", () => {
  const weak = makeChar("weak", {
    surface: { turf: "C", dirt: "G" },
    distance: { short: "F", mile: "C", medium: "C", long: "A" },
    style: { runner: "G", leader: "C", betweener: "B", chaser: "C" },
  });
  const ranked = rankOwnedCharactersForTarget([weak, SPECIAL_WEEK], MEDIUM_TURF);
  assert.deepEqual(ranked.map((c) => c.characterId), ["100101", "weak"]);
});

test("proposeTargetStats grounds Stamina in the nearest reference and Guts past the crossover", () => {
  const proposal = proposeTargetStats(MEDIUM_TURF, "leader");
  // 2400m + 1 gold leader reference is 930, plus the 100 CM margin.
  assert.equal(proposal.stats.stamina, 1030);
  // medium crossover is 320, proposal nudges just past it.
  assert.equal(proposal.stats.guts, 370);
  assert.equal(proposal.stats.speed, 1150);
  assert.equal(proposal.stats.wit, 1200);
  assert.match(proposal.basis.staminaFrom, /2400m/);
});

test("proposeTargetStats falls back to defaults when no reference is close", () => {
  const proposal = proposeTargetStats({ surfaceKey: "turf", distanceKey: "unknown", distanceM: NaN }, "leader");
  assert.equal(proposal.stats.stamina, 500);
  assert.equal(proposal.stats.guts, 350);
  assert.match(proposal.basis.staminaFrom, /fallback/);
});

test("recommendBuildForTarget returns ranked candidates each with a stat proposal, capped by limit", () => {
  const chars = [SPECIAL_WEEK, makeChar("b", { surface: { turf: "B" }, distance: { medium: "B" }, style: { leader: "B" } })];
  const recos = recommendBuildForTarget(MEDIUM_TURF, chars, { limit: 1 });
  assert.equal(recos.length, 1);
  assert.equal(recos[0].characterId, "100101");
  assert.ok(recos[0].proposal.stats.stamina > 0);
});

// --- Phase 2a: support deck heuristic ---

test("getRecommendedTypeDistribution is speed/wit heavy, with more stamina for longer distances", () => {
  assert.deepEqual(getRecommendedTypeDistribution("mile"), { speed: 3, intelligence: 2, power: 1 });
  assert.deepEqual(getRecommendedTypeDistribution("long"), { speed: 2, intelligence: 1, stamina: 2, power: 1 });
  // unknown category falls back to medium.
  assert.deepEqual(getRecommendedTypeDistribution("???"), getRecommendedTypeDistribution("medium"));
});

test("scoreSupportSummary ranks rarity first, limit break as a tiebreaker", () => {
  assert.ok(scoreSupportSummary({ rarity: 3, limitBreak: 0 }) > scoreSupportSummary({ rarity: 2, limitBreak: 4 }));
  assert.ok(scoreSupportSummary({ rarity: 3, limitBreak: 4 }) > scoreSupportSummary({ rarity: 3, limitBreak: 0 }));
});

function makeSupport(id, type, rarity, limitBreak = 0) {
  return { id, type, rarity, limitBreak };
}

// --- Phase 1a: score supports on real effective values ---

// effect_id constants: 1 Friendship, 8 Increased Training, 19 Specialty Rate,
// 15 Race Bonus, 31 Wit Recovery, 28 Energy Discount.
function eff(effectId, currentValue, level = 45) {
  return { effect_id: effectId, name: `Effect ${effectId}`, current_value: currentValue, current_unlock_level: level };
}

const LONG_TURF = { surfaceKey: "turf", distanceKey: "long", distanceM: 3000 };

test("scoreSupportForTarget sums family weight * value/reference, reasons sorted by points", () => {
  // Friendship 30 (ref 30 -> 100 pts), Increased Training 15 (ref 15 -> 85 pts).
  const summary = { id: "ssr", type: "speed", rarity: 3, limitBreak: 4, effectiveEffects: [eff(1, 30), eff(8, 15)] };
  const result = scoreSupportForTarget(summary, MEDIUM_TURF);
  assert.equal(result.hasProjection, true);
  assert.equal(result.score, 185);
  assert.equal(result.reasons[0].family, "friendship");
  assert.equal(result.reasons[0].points, 100);
  assert.equal(result.reasons[1].family, "training");
});

test("scoreSupportForTarget scales with the card's ACTUAL effective value", () => {
  const maxed = { id: "a", effectiveEffects: [eff(1, 30)] };
  const halfLeveled = { id: "b", effectiveEffects: [eff(1, 15)] };
  const full = scoreSupportForTarget(maxed, MEDIUM_TURF).score;
  const half = scoreSupportForTarget(halfLeveled, MEDIUM_TURF).score;
  assert.equal(full, 100);
  assert.equal(half, 50); // 100 * (15/30)
});

test("scoreSupportForTarget emphasizes energy/recovery families on long distances", () => {
  const witCard = { id: "wit", type: "intelligence", effectiveEffects: [eff(31, 4)] }; // ref 4 -> 45 pts base
  const onMedium = scoreSupportForTarget(witCard, MEDIUM_TURF).score;
  const onLong = scoreSupportForTarget(witCard, LONG_TURF).score;
  assert.equal(onMedium, 45 * 1.05);
  assert.equal(onLong, 45 * 1.2);
  assert.ok(onLong > onMedium);
});

test("scoreSupportForTarget falls back to rarity+LB when there is no projection, flagged", () => {
  const noProjection = { id: "x", type: "speed", rarity: 3, limitBreak: 4, effectiveEffects: [] };
  const result = scoreSupportForTarget(noProjection, MEDIUM_TURF);
  assert.equal(result.hasProjection, false);
  assert.equal(result.score, (3 * 10 + 4 * 2) * 6); // scoreSupportSummary * fallback scale
  assert.match(result.reasons[0].label, /No effect data/);
});

test("scoreSupportForTarget ignores unmapped effect ids and non-positive values", () => {
  const summary = { id: "x", effectiveEffects: [eff(999, 50), eff(1, 0), eff(1, null), eff(8, 15)] };
  const result = scoreSupportForTarget(summary, MEDIUM_TURF);
  assert.equal(result.score, 85); // only the Increased Training 15 counts
  assert.equal(result.reasons.length, 1);
});

test("scoreSupportForTarget weights override lets a future meta layer re-rank", () => {
  const summary = { id: "x", effectiveEffects: [eff(15, 10)] }; // Race Bonus, ref 10 -> 20 pts base
  const base = scoreSupportForTarget(summary, MEDIUM_TURF).score;
  const boosted = scoreSupportForTarget(summary, MEDIUM_TURF, { families: { raceBonus: 200 } }).score;
  assert.equal(base, 20);
  assert.equal(boosted, 200);
});

test("scoreSupportForTarget adds a capped, labeled meta bonus from weights.supportMeta", () => {
  const summary = { id: "30010", effectiveEffects: [eff(1, 30)] }; // 100 pts formula
  const weights = { supportMeta: { "30010": { bonus: 40, label: "top" } } };
  const result = scoreSupportForTarget(summary, MEDIUM_TURF, weights);
  assert.equal(result.score, 140); // 100 formula + 40 meta
  assert.equal(result.metaBonus, 40);
  const metaReason = result.reasons.find((r) => r.family === "meta");
  assert.ok(metaReason && /community snapshot/.test(metaReason.label));
  // no meta entry for this id -> no bonus, no meta reason
  const plain = scoreSupportForTarget(summary, MEDIUM_TURF, { supportMeta: { other: { bonus: 40 } } });
  assert.equal(plain.score, 100);
  assert.ok(!plain.reasons.some((r) => r.family === "meta"));
});

test("recommendSupportDeck honors the type mix then fills the best remaining, deduped to 6", () => {
  const owned = [
    makeSupport("s1", "speed", 3, 4), makeSupport("s2", "speed", 3, 2), makeSupport("s3", "speed", 2, 0),
    makeSupport("w1", "intelligence", 3, 4), makeSupport("w2", "intelligence", 3, 0),
    makeSupport("p1", "power", 3, 4), makeSupport("p2", "power", 2, 0),
    makeSupport("st1", "stamina", 3, 4),
  ];
  const result = recommendSupportDeck("medium", owned); // target: speed2 int2 stamina1 power1
  assert.equal(result.deck.length, 6);
  assert.equal(new Set(result.deck).size, 6);
  // best two speed by score are s1 (rarity3 lb4) and s2 (rarity3 lb2).
  assert.ok(result.deck.includes("s1") && result.deck.includes("s2"));
  assert.ok(result.deck.includes("w1") && result.deck.includes("w2"));
  assert.ok(result.deck.includes("st1"));
  assert.ok(result.deck.includes("p1"));
  assert.equal(result.shortfall, false);
  assert.equal(result.actual.speed, 2);
});

test("recommendSupportDeck ranks by effective value when projections are present, exposing per-card reasons", () => {
  // Same rarity/LB, but s2's projection is stronger (Friendship 30 vs 15) - it
  // must outrank the rarity+LB heuristic, which would have tied them.
  const owned = [
    { id: "s1", type: "speed", rarity: 3, limitBreak: 4, effectiveEffects: [eff(1, 15)] },
    { id: "s2", type: "speed", rarity: 3, limitBreak: 4, effectiveEffects: [eff(1, 30)] },
    { id: "w1", type: "intelligence", rarity: 3, limitBreak: 4, effectiveEffects: [eff(1, 30)] },
  ];
  const result = recommendSupportDeck("mile", owned, { targetProfile: MEDIUM_TURF });
  const speedPicks = result.picks.filter((p) => p.type === "speed");
  assert.equal(speedPicks[0].id, "s2"); // stronger friendship first
  assert.equal(speedPicks[0].hasProjection, true);
  assert.ok(speedPicks[0].reasons.length >= 1);
});

test("recommendSupportDeck pins force-included cards, excludes replaced ones, and lists a bench", () => {
  const owned = [
    { id: "s1", type: "speed", rarity: 3, limitBreak: 4, effectiveEffects: [eff(1, 30)] },
    { id: "s2", type: "speed", rarity: 3, limitBreak: 4, effectiveEffects: [eff(1, 25)] },
    { id: "s3", type: "speed", rarity: 3, limitBreak: 0, effectiveEffects: [eff(1, 10)] }, // weakest speed
    { id: "s4", type: "speed", rarity: 3, limitBreak: 2, effectiveEffects: [eff(1, 20)] },
    { id: "w1", type: "intelligence", rarity: 3, limitBreak: 4, effectiveEffects: [eff(1, 30)] },
    { id: "w2", type: "intelligence", rarity: 3, limitBreak: 0, effectiveEffects: [eff(1, 12)] },
    { id: "p1", type: "power", rarity: 3, limitBreak: 4, effectiveEffects: [eff(1, 20)] },
    { id: "p2", type: "power", rarity: 2, limitBreak: 0, effectiveEffects: [eff(1, 8)] },
  ];
  // Swap the weak s3 in by pinning it and excluding the strong s1 it replaces.
  const result = recommendSupportDeck("mile", owned, { targetProfile: MEDIUM_TURF, pinnedIds: ["s3"], excludedIds: ["s1"] });
  assert.ok(result.deck.includes("s3"));   // pinned card is in the deck
  assert.ok(!result.deck.includes("s1"));  // excluded card never appears
  assert.equal(result.deck.length, 6);
  // the leftover unpicked card is offered on the bench for a future swap.
  assert.ok(Object.values(result.benchByType).flat().some((c) => c.id === "p2"));
});

test("recommendSupportDeck flags a shortfall and fills what it can when the roster is too small", () => {
  const owned = [makeSupport("s1", "speed", 3, 0), makeSupport("w1", "intelligence", 2, 0)];
  const result = recommendSupportDeck("mile", owned);
  assert.equal(result.deck.length, 2);
  assert.equal(result.shortfall, true);
  assert.equal(result.filled, 2);
});

// --- Phase 1b: parent spec (spark shopping list, never concrete parents) ---

const LONG_TURF_RACES = {
  surfaceKey: "turf", surface: "Turf", distanceKey: "long", distanceCategory: "Long", distanceM: 3200,
  relatedRaces: [{ id: "r1", title: "Tenno Sho (Spring)" }, { id: "r2", title: "Kikuka Sho" }],
};

test("targetProfileFromCmDetail carries the related-race white sparks", () => {
  const profile = targetProfileFromCmDetail({
    name: "Japanese Derby",
    race_profile: { surface_slug: "turf", distance_category_slug: "medium", distance_m: 2400 },
    related_races: [{ id: "100901", title: "Japanese Oaks" }],
  });
  assert.equal(profile.relatedRaces.length, 1);
  assert.equal(profile.relatedRaces[0].title, "Japanese Oaks");
});

test("recommendParentSpec pinks the aptitude gaps below A and blues the constrained stats", () => {
  // Long turf, char is Long B (gap) and Turf A (fine), leader A style.
  const char = makeChar("c", {
    surface: { turf: "A" },
    distance: { long: "B", medium: "A" },
    style: { leader: "A", betweener: "A", runner: "G", chaser: "C" },
  }, "Gold Ship");
  const spec = recommendParentSpec(LONG_TURF_RACES, char, ["skill_a", { id: "skill_b", title: "Swinging Maestro" }]);
  // Only distance is below A -> single pink gap, both parents hunt LONG.
  assert.equal(spec.pinkGaps.length, 1);
  assert.equal(spec.pinkGaps[0].label, "LONG");
  assert.equal(spec.parents[0].pink.label, "LONG");
  assert.equal(spec.parents[1].pink.label, "LONG");
  // Long distance -> blue sparks are STAMINA then SPEED across the two parents.
  assert.equal(spec.parents[0].blue.stat, "STAMINA");
  assert.equal(spec.parents[1].blue.stat, "SPEED");
  assert.equal(spec.parents[0].stars, 3);
  assert.match(spec.parents[0].summary, /Parent 1: STAMINA, LONG 3★/);
});

test("recommendParentSpec spreads two aptitude gaps across the two parents by priority", () => {
  // Both distance (Long C) and surface (Turf B) are below A -> distance first.
  const char = makeChar("c", {
    surface: { turf: "B" },
    distance: { long: "C" },
    style: { leader: "A", runner: "G", betweener: "B", chaser: "C" },
  });
  const spec = recommendParentSpec(LONG_TURF_RACES, char);
  assert.equal(spec.pinkGaps.length, 2);
  assert.equal(spec.parents[0].pink.label, "LONG");   // priority 3
  assert.equal(spec.parents[1].pink.label, "TURF");   // priority 2
});

test("recommendParentSpec notes when aptitudes are already covered and lists white sparks", () => {
  const char = makeChar("c", {
    surface: { turf: "A" },
    distance: { long: "S" },
    style: { leader: "A", runner: "G", betweener: "A", chaser: "C" },
  });
  const spec = recommendParentSpec(LONG_TURF_RACES, char, ["skill_a"]);
  assert.equal(spec.pinkGaps.length, 0);
  assert.equal(spec.parents[0].pink, null);
  assert.equal(spec.whiteSparks.races.length, 2);
  assert.equal(spec.whiteSparks.skills[0].id, "skill_a");
  assert.match(spec.reasons[0], /already A\+/);
});

// --- Phase 1c: curated scenario suggestion ---

test("recommendScenario is confident (curated-match) for long turf -> L'Arc", () => {
  const result = recommendScenario({ surfaceKey: "turf", distanceKey: "long" });
  assert.equal(result.recommended.slug, "scenario-larc");
  assert.equal(result.confidence, "curated-match");
  assert.equal(result.source, "curated");
  assert.equal(result.note, null);
});

test("recommendScenario admits low confidence and says pick your most practiced otherwise", () => {
  const result = recommendScenario({ surfaceKey: "dirt", distanceKey: "short" });
  assert.equal(result.confidence, "low");
  assert.match(result.note, /pick the one you've practiced/i);
  assert.ok(result.recommended.slug); // still offers a safe default
  assert.ok(result.alternatives.length >= 1);
});

test("recommendScenario only proposes Global-available scenarios and uses their Global name", () => {
  // Global (today) = URA Finale, Unity Cup, Trackblazer. L'Arc is NOT available.
  const globalScenarios = [
    { slug: "scenario-ura", name: "URA Finale" },
    { slug: "scenario-aoharu", name: "Unity Cup" },
    { slug: "scenario-mant", name: "Trackblazer" },
  ];
  const result = recommendScenario({ surfaceKey: "turf", distanceKey: "long" }, { availableScenarios: globalScenarios });
  const proposed = [result.recommended.slug, ...result.alternatives.map((a) => a.slug)];
  assert.ok(!proposed.includes("scenario-larc")); // never propose an unavailable scenario
  assert.ok(proposed.every((slug) => globalScenarios.some((s) => s.slug === slug)));
  // display name is the Global one from the data, not the JP-based fallback.
  const unity = [result.recommended, ...result.alternatives].find((s) => s.slug === "scenario-aoharu");
  assert.equal(unity.name, "Unity Cup");
});

test("recommendScenario returns confidence 'none' when nothing known is available", () => {
  const result = recommendScenario({ surfaceKey: "turf", distanceKey: "long" }, { availableScenarios: [{ slug: "scenario-unknown", name: "Mystery" }] });
  assert.equal(result.confidence, "none");
  assert.equal(result.recommended, null);
});

// --- Phase 2b: skill recommendation by effect category ---

function makeSkill(id, effectTypes, rarity = 1, title = id) {
  return { id, title, detail: { rarity, condition_groups: [{ effects: effectTypes.map((t) => ({ type: t, value: 1 })) }] } };
}

test("categorizeSkillEffect maps effect type ids to categories, taking the highest-priority one present", () => {
  assert.equal(categorizeSkillEffect(makeSkill("a", [31])), "accel");
  assert.equal(categorizeSkillEffect(makeSkill("s", [27])), "speed");
  assert.equal(categorizeSkillEffect(makeSkill("s2", [22])), "speed");
  assert.equal(categorizeSkillEffect(makeSkill("r", [9])), "recovery");
  assert.equal(categorizeSkillEffect(makeSkill("d", [21])), "debuff");
  assert.equal(categorizeSkillEffect(makeSkill("x", [999])), "other");
  // accel outranks speed when a skill has both.
  assert.equal(categorizeSkillEffect(makeSkill("both", [27, 31])), "accel");
});

test("recommendSkillsForBuild puts accel/speed in required, drops debuffs, dedupes", () => {
  const pool = [
    makeSkill("accel1", [31], 3),
    makeSkill("speed1", [27], 3),
    makeSkill("recov1", [9], 2),
    makeSkill("debuff1", [21], 3),
    makeSkill("accel1", [31], 3), // duplicate id
  ];
  const result = recommendSkillsForBuild(pool, MEDIUM_TURF, { requiredLimit: 4, optionalLimit: 6 });
  assert.ok(result.required.includes("accel1"));
  assert.ok(result.required.includes("speed1"));
  assert.ok(result.optional.includes("recov1"));
  assert.ok(!result.required.includes("debuff1") && !result.optional.includes("debuff1"));
  // accel1 appears once despite the duplicate.
  assert.equal(result.required.filter((id) => id === "accel1").length, 1);
});

test("recommendSkillsForBuild ranks acceleration above speed above recovery", () => {
  const pool = [makeSkill("r", [9], 3), makeSkill("s", [27], 1), makeSkill("a", [31], 1)];
  const result = recommendSkillsForBuild(pool, MEDIUM_TURF, { requiredLimit: 4, optionalLimit: 6 });
  // accel and speed are required (in that priority order); recovery is optional.
  assert.deepEqual(result.required, ["a", "s"]);
  assert.deepEqual(result.optional, ["r"]);
});

// --- Phase 1d: course-aware skill bonus (gated on a single resolved track) ---

test("makeSkillZoneCounter counts static zones across a skill's condition groups", () => {
  const fakeResolve = (condition) => ({ zones: condition === "hit2" ? [{}, {}] : condition === "hit1" ? [{}] : [] });
  const counter = makeSkillZoneCounter({ length_m: 2400 }, fakeResolve);
  const skill = { detail: { condition_groups: [{ condition: "hit2" }, { condition: "miss" }, { condition: "hit1" }] } };
  assert.equal(counter(skill), 3);
});

test("recommendSkillsForBuild applies the gated zone bonus only when a counter is passed", () => {
  const pool = [makeSkill("a1", [31], 1), makeSkill("a2", [31], 1)]; // same category+rarity -> tie
  // a2 fires on this track, a1 never does.
  const counter = (item) => (item.id === "a2" ? 2 : 0);
  const withTrack = recommendSkillsForBuild(pool, MEDIUM_TURF, { courseZoneCounter: counter });
  assert.equal(withTrack.courseAware, true);
  assert.equal(withTrack.required[0], "a2"); // zone bonus breaks the tie
  const a2 = withTrack.entries.find((e) => e.id === "a2");
  assert.equal(a2.zones, 2);
  assert.match(a2.reasons.join(" "), /activates on 2 zones/);

  // Without a counter, order is unchanged and no zone reasons appear.
  const noTrack = recommendSkillsForBuild(pool, MEDIUM_TURF);
  assert.equal(noTrack.courseAware, false);
  assert.equal(noTrack.entries.every((e) => e.zones === 0), true);
});

// --- Phase 1e: the aggregator (one serializable plan) ---

// A CM target detail as targetProfileFromCmDetail reads it.
const LONG_TURF_TARGET = {
  detail: {
    name: "Tenno Sho (Spring)",
    race_profile: { surface: "Turf", surface_slug: "turf", distance_m: 3200, distance_category: "Long", distance_category_slug: "long" },
    related_races: [{ id: "r1", title: "Tenno Sho (Spring)" }],
  },
};

const STAYER = makeChar("stayer", {
  surface: { turf: "A", dirt: "G" },
  distance: { short: "F", mile: "C", medium: "A", long: "B" }, // long B -> pink gap
  style: { runner: "G", leader: "A", betweener: "A", chaser: "C" },
}, "Gold Ship");

const SPRINTER = makeChar("sprinter", {
  surface: { turf: "B" },
  distance: { short: "A", mile: "A", medium: "C", long: "E" },
  style: { runner: "A", leader: "B", betweener: "C", chaser: "D" },
}, "Sakura Bakushin O");

function planRoster(extra = {}) {
  return {
    characters: [STAYER, SPRINTER],
    supportSummaries: [
      { id: "sp1", type: "speed", rarity: 3, limitBreak: 4, title: "Kitasan", effectiveEffects: [eff(1, 30), eff(8, 15)] },
      { id: "st1", type: "stamina", rarity: 3, limitBreak: 4, title: "Super Creek", effectiveEffects: [eff(1, 25)] },
      { id: "w1", type: "intelligence", rarity: 3, limitBreak: 4, title: "FS", effectiveEffects: [eff(31, 4)] },
      { id: "p1", type: "power", rarity: 3, limitBreak: 2, title: "Vodka", effectiveEffects: [eff(15, 10)] },
    ],
    ...extra,
  };
}

test("buildAutoPrepPlan returns one serializable plan with reasons on every section", () => {
  const plan = buildAutoPrepPlan(LONG_TURF_TARGET, planRoster());
  // top-ranked long-turf uma is the stayer.
  assert.equal(plan.selected.characterId, "stayer");
  assert.ok(plan.selected.reasons[0].length > 0);
  assert.equal(plan.alternatives[0].characterId, "sprinter");
  assert.equal(plan.style.key, "leader");
  assert.ok(plan.stats.stats.stamina > 0);
  assert.ok(plan.deck.deck.length > 0);
  assert.ok(plan.deck.reasons.length >= 1);
  // long turf -> confident L'Arc scenario, parent pinks LONG (stayer is Long B).
  assert.equal(plan.scenario.recommended.slug, "scenario-larc");
  assert.equal(plan.parents.parents[0].pink.label, "LONG");
  // fully serializable (no functions survive a JSON round-trip).
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(plan)));
});

test("buildAutoPrepPlan honors a selected alternative uma", () => {
  const plan = buildAutoPrepPlan(LONG_TURF_TARGET, planRoster(), { selectedCharacterId: "sprinter" });
  assert.equal(plan.selected.characterId, "sprinter");
  assert.ok(plan.alternatives.some((a) => a.characterId === "stayer"));
});

test("buildAutoPrepPlan gates the course-aware skill bonus and wires the injected pool", () => {
  const pool = [makeSkill("a1", [31], 1, "Zone Skill")];
  const roster = planRoster({
    buildSkillPool: () => pool,
    course: { length_m: 3200 },
    resolveStaticZones: () => ({ zones: [{}, {}] }), // fires on 2 zones
  });
  const plan = buildAutoPrepPlan(LONG_TURF_TARGET, roster);
  assert.equal(plan.skills.courseAware, true);
  assert.equal(plan.meta.courseAware, true);
  const zoneSkill = plan.skills.entries.find((e) => e.id === "a1");
  assert.equal(zoneSkill.zones, 2);
  // the build's skills feed the parent white sparks.
  assert.ok(plan.parents.whiteSparks.skills.some((s) => s.id === "a1"));
});

test("buildAutoPrepPlan uses character meta only as an equal-fit tiebreaker, never over fit", () => {
  // STAYER and a same-fit clone; meta favors the clone. Fit is identical so meta
  // breaks the tie. SPRINTER has worse long fit and must NOT be lifted by meta.
  const clone = makeChar("clone", STAYER.detail.aptitudes, "Mejiro McQueen");
  const weights = { characterMeta: { clone: { popularity: 0.9, label: "top" }, sprinter: { popularity: 1, label: "top" } } };
  const plan = buildAutoPrepPlan(LONG_TURF_TARGET, planRoster({ characters: [STAYER, clone, SPRINTER], weights }));
  // clone (equal fit, higher meta) outranks stayer; sprinter (worse fit) still last.
  assert.equal(plan.selected.characterId, "clone");
  assert.ok(plan.selected.reasons.some((r) => /meta:/.test(r)));
  assert.notEqual(plan.selected.characterId, "sprinter");
  assert.equal(plan.meta.applied, true);
});

test("buildAutoPrepPlan degrades cleanly with an empty roster", () => {
  const plan = buildAutoPrepPlan(LONG_TURF_TARGET, { characters: [], supportSummaries: [] });
  assert.equal(plan.selected, null);
  assert.equal(plan.alternatives.length, 0);
  assert.match(plan.reasons[0], /No owned characters/);
});
