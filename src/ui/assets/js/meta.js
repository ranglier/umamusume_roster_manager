// Meta / Insights adapter (docs/AUTO_PREP_PLAN.md Phase 4, docs/EXTERNAL_SOURCES_PLAN.md
// "Spike uma.moe"). PURE: turns a dated local meta snapshot into the optional
// `weights` the deterministic engine already accepts (the Phase-1 injection
// hook), plus small labels for the UI. No network, no DOM - the snapshot is
// produced offline by scripts/fetch_meta_snapshot.py and loaded as a static
// file; this module never fetches anything.
//
// Design guardrails (project philosophy = explainable, formula-first):
// - Meta is ADDITIVE and CAPPED so it nudges but never dominates the verified
//   formula (a support's meta bonus tops out well below its Friendship weight).
// - Meta is always LABELED in reasons[] as coming from a dated community
//   snapshot, never presented as canonical truth.
// - IDs are identity-mapped (uma.moe uses the game's numeric ids = ours), so no
//   fragile cross-reference is needed.

// Max meta bonus (points) a maximally-popular support can add to its formula
// score. Deliberately below the Friendship family weight (100) so meta refines
// the ranking within a tier without overturning real effective value.
export const META_SUPPORT_BONUS_MAX = 40;

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// A coarse, honest popularity label for badges/reasons. Percentiles are relative
// to the snapshot's own maximum (popularity is count / maxCount).
export function metaPopularityLabel(popularity) {
  const p = clamp01(popularity);
  if (p >= 0.75) return "top";
  if (p >= 0.4) return "high";
  if (p > 0) return "seen";
  return "";
}

// buildMetaWeights(snapshot, opts) -> weights fragment the engine consumes:
//   { supportMeta: { [supportId]: { popularity, count, bonus, label } },
//     characterMeta: { [characterId]: { popularity, count, label } },
//     meta: { source, generatedAt, sampleSize } }
// `snapshot` shape (scripts/fetch_meta_snapshot.py): { schema_version, source,
// generated_at, sample_size, supports: { id: { count, popularity } },
// characters: { id: { count, popularity } } }. Missing/empty -> empty maps, so a
// caller with no snapshot gets a no-op weights fragment (behaviour unchanged).
export function buildMetaWeights(snapshot, { supportBonusMax = META_SUPPORT_BONUS_MAX } = {}) {
  const supportMeta = {};
  for (const [id, entry] of Object.entries(snapshot?.supports || {})) {
    const popularity = clamp01(entry?.popularity);
    if (!(popularity > 0)) continue;
    supportMeta[String(id)] = {
      popularity,
      count: Number(entry?.count) || 0,
      bonus: Math.round(popularity * supportBonusMax),
      label: metaPopularityLabel(popularity),
    };
  }

  const characterMeta = {};
  for (const [id, entry] of Object.entries(snapshot?.characters || {})) {
    const popularity = clamp01(entry?.popularity);
    if (!(popularity > 0)) continue;
    characterMeta[String(id)] = {
      popularity,
      count: Number(entry?.count) || 0,
      label: metaPopularityLabel(popularity),
    };
  }

  return {
    supportMeta,
    characterMeta,
    meta: {
      source: snapshot?.source || "unknown",
      generatedAt: snapshot?.generated_at || "",
      sampleSize: Number(snapshot?.sample_size) || 0,
    },
  };
}

// True when a weights fragment carries any usable meta signal (lets the UI show
// a "meta" indicator only when a snapshot is actually loaded).
export function hasMetaSignal(weights) {
  return Boolean(
    weights &&
      ((weights.supportMeta && Object.keys(weights.supportMeta).length) ||
        (weights.characterMeta && Object.keys(weights.characterMeta).length)),
  );
}
