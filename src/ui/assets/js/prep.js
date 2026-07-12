// Auto Prep (docs/AUTO_PREP_PLAN.md, Phase 2) - the small PURE glue for the
// #/prep page: default-target selection and plan->build-seed mapping. Kept
// dependency-free (no DOM, no state singletons) so both are unit-tested; the
// DOM/data assembly lives in catalog.js (buildAutoPrepPlanForDetail) and the
// rendering in app.js (renderPrepPage).

// Pick the default CM target: the one running now, else the next upcoming, else
// the most recently finished (the dataset starts in 2021, so "no future CM" is
// the common case - we preselect the latest past one and let the user change
// it). `items` are cm_target entity items ({ id, detail: { start_ts, end_ts }});
// `nowSeconds` and the timestamps are compared in the same unit (unix seconds).
export function selectDefaultTargetId(items, nowSeconds) {
  const rows = (items || [])
    .map((item) => ({
      id: String(item?.id ?? ""),
      start: Number(item?.detail?.start_ts) || 0,
      end: Number(item?.detail?.end_ts) || 0,
    }))
    .filter((row) => row.id);
  if (!rows.length) return null;

  const current = rows
    .filter((row) => row.start && row.end && row.start <= nowSeconds && nowSeconds <= row.end)
    .sort((a, b) => b.start - a.start)[0];
  if (current) return current.id;

  const upcoming = rows
    .filter((row) => row.start && row.start > nowSeconds)
    .sort((a, b) => a.start - b.start)[0];
  if (upcoming) return upcoming.id;

  // Most recently finished (fall back to latest start if end is missing).
  return rows.slice().sort((a, b) => (b.end || b.start) - (a.end || a.start))[0].id;
}

// Map an Auto Prep plan (buildAutoPrepPlan output) to a build-editor seed
// (state.pendingBuildSeed shape, see builds.js createEmptyBuildEntry). Pure:
// the caller passes the plan and the target id. Aptitudes/scenario stay for the
// editor's own pickers; we seed what the plan decided (uma, style, stats, deck,
// skills). Returns null when the plan has no retained uma.
export function planToBuildSeed(plan, targetId) {
  if (!plan?.selected) return null;
  return {
    name: plan.target?.name ? `Auto Prep - ${plan.target.name}` : "Auto Prep",
    target_id: String(targetId || ""),
    character_id: String(plan.selected.characterId || ""),
    running_style: plan.style?.key || "",
    support_deck: (plan.deck?.deck || []).slice(0, 6).map(String),
    target_stats: { ...(plan.stats?.stats || {}) },
    required_skills: [...(plan.skills?.required || [])].map(String),
    optional_skills: [...(plan.skills?.optional || [])].map(String),
  };
}
