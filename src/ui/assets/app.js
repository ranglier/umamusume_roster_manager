// Entry point. Wires up the feature modules extracted under assets/js/
// as part of docs/REFACTOR_PLAN.md.
import { activeProfileBlock, activeProfileNameEl, adminButton, allowedEntityKeys, appSidebarEl, asArray, backToTopButton, BUILD_RUNNING_STYLE_OPTIONS, BUILD_STATUS_OPTIONS, browseActionsEl, buildsEntityKey, changeProfileButton, clearButton, collectionEntityKeys, compactLayoutQuery, createEntityState, currentRouteState, data, datasetBarEl, datasetHeadingEl, defaultEntityKeyForMode, defaultProfilesIndex, detailColumnEl, detailEl, detailPanelEl, entityMetaEl, entityTitleEl, filtersEl, getActiveProfile, getBuildTargetOptions, getEntityItems, getLoadedReferenceGeneratedAt, getRosterViewEntry, getRosterViewPayload, getRunsForTarget, getViewState, globalBuild, hasLoadedReferenceBundle, lastBuildBlock, legacyEntityKey, listEl, navEl, normalizeProfilesIndex, normalizeRosterDocument, normalizeRosterViewPayload, pageTitleEl, profileBackgroundMediaEl, profileBackgroundVideoEl, profileGateEl, referenceEntityKeys, renderGradeBadge, resetBuildsDocument, resetLegacyViewPayload, resultCountEl, resultsPanelEl, rosterEntityKeys, searchInput, setAdminHash, setBrowseHash, setHomeHash, setPrepHash, setProfilesHash, setWizardHash, SIDEBAR_SECTIONS, sidebarSectionForRoute, sidebarSectionsEl, state, summaryText, syncSelectedProfileId, toolbarEl, topHeaderEl, viewStateByKey } from "./js/core.js";
import { escapeHtml, formatDateTime, renderBadge, renderDetailHeader, renderLinks, renderResultTop } from "./js/dom-utils.js";
import { attachCmTargetRecommendationListeners, attachRacetrackVisualizerListeners, buildAutoPrepPlanForDetail, getCmTargetDeck, getCmTargetRecommendations, renderCatalogSupportQuickAdd, renderCharacters, renderCmTargets, renderCompatibility, renderG1Factors, renderRaces, renderRacetracks, renderScenarios, renderSkills, renderSupports, renderTrainingEvents } from "./js/catalog.js";
import { formatCmTargetLabel, planToBuildSeed, selectDefaultTargetId, summarizeTargetRuns } from "./js/prep.js";
import { attachRosterFormListeners, collectRosterFormData, getDefaultRosterEntry, getRosterBadges, getRosterEntry, getRosterFilterDefinitions, getRosterFilterOptions, removeSelectedBatchRows, renderBatchList, renderReferenceRosterActions, renderRosterCardProgress, renderRosterEditor, rosterCountForEntity, saveVisibleBatchRows, setRosterEntry } from "./js/roster.js";
import { attachLegacyFormListeners, getCharacterRosterDefaults, getLegacyCharacterOptions, renderLegacyDetailBody, renderLegacyEditor, renderLegacyPreview, renderLegacySimulatorList } from "./js/legacy.js";
import { attachBuildFormListeners, createEmptyBuildEntry, renderBuildEditor, renderBuildFeasibilityPanel, renderBuildSpurtPanel, startSeededBuildDraft } from "./js/builds.js";
import { loadBuildsForProfile, loadLegacyForProfile, loadRunsForProfile, openProfile, refreshAdminData, renderAdminPage, renderProfilesPage, renderWizardPage, runAdminJob, wizardNeedsReferenceBuild } from "./js/admin.js";
import { renderRosterImportPanel } from "./js/roster_import.js";


export function syncToolbarMetrics() {
  if (!toolbarEl || toolbarEl.hidden) {
    document.documentElement.style.setProperty("--toolbar-height", "0px");
    return;
  }
  document.documentElement.style.setProperty("--toolbar-height", `${toolbarEl.offsetHeight}px`);
}

export function syncBackToTopVisibility() {
  if (!backToTopButton || backToTopButton.hidden) {
    return;
  }

  if (window.scrollY > 260) {
    backToTopButton.classList.add("visible");
  } else {
    backToTopButton.classList.remove("visible");
  }
}

export function isCompactLayout() {
  return compactLayoutQuery.matches;
}

export function syncLayoutMode(hasSelectedItem) {
  document.body.classList.toggle("layout-compact", isCompactLayout());
  document.body.classList.toggle("layout-compact-detail-active", isCompactLayout() && hasSelectedItem);
}

// Off-canvas sidebar (overlay mode, <=1440px). `body.sidebar-open` is the single
// source of truth; the CSS only reacts to it inside the <=1440 media block.
export function openSidebar() {
  document.body.classList.add("sidebar-open");
  document.querySelectorAll(".sidebar-toggle").forEach((el) => el.setAttribute("aria-expanded", "true"));
  const firstItem = document.querySelector("#appSidebar .sidebar-section-item");
  if (firstItem) {
    firstItem.focus();
  }
}

export function closeSidebar() {
  if (!document.body.classList.contains("sidebar-open")) {
    return;
  }
  document.body.classList.remove("sidebar-open");
  document.querySelectorAll(".sidebar-toggle").forEach((el) => el.setAttribute("aria-expanded", "false"));
  // Return focus to the visible toggle (the one in the active screen's header).
  const visibleToggle = Array.from(document.querySelectorAll(".sidebar-toggle")).find((el) => el.offsetParent !== null);
  if (visibleToggle) {
    visibleToggle.focus();
  }
}

export function toggleSidebar() {
  if (document.body.classList.contains("sidebar-open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

// Exposed for the inline handlers on #sidebarToggle / #sidebarBackdrop. Inline
// handlers survive any DOM re-insertion and don't depend on bind timing.
if (typeof window !== "undefined") {
  window.umaSidebar = { toggle: toggleSidebar, close: closeSidebar };
}


export function getFilterDefinitions(mode, entityKey) {
  const entity = data.entities[entityKey];
  const definitions = asArray(entity.filter_definitions);
  if (mode !== "roster") {
    return definitions;
  }
  return [...definitions, ...getRosterFilterDefinitions(entityKey)];
}

export function getFilterOptions(mode, entityKey, definition) {
  if (definition.key.startsWith("_roster_")) {
    return getRosterFilterOptions(entityKey, definition.key);
  }
  return asArray(data.entities[entityKey].filter_options?.[definition.key]);
}

export function matchesCustomRosterFilter(filterKey, item) {
  const entry = getRosterEntry(item.entityKey || item.__entityKey || "", item);
  const viewEntry = getRosterViewEntry(item.entityKey || item.__entityKey || "", item);
  if (filterKey === "_roster_favorite") {
    return entry.favorite ? ["yes"] : [];
  }
  if (filterKey === "_roster_note") {
    return entry.note?.trim() ? ["yes"] : [];
  }
  if (filterKey === "_roster_tag") {
    return asArray(viewEntry?.derived?.custom_tags);
  }
  if (filterKey === "_roster_status") {
    return asArray(viewEntry?.derived?.status_flags);
  }
  if (filterKey === "_roster_progress") {
    return asArray(viewEntry?.derived?.progress_bucket);
  }
  if (filterKey === "_roster_unlock") {
    return asArray(viewEntry?.derived?.unlock_state);
  }
  if (filterKey === "_roster_usable") {
    return viewEntry?.derived?.usable ? ["yes"] : [];
  }
  return true;
}

export function getFilteredItems(mode, entityKey) {
  const entity = data.entities[entityKey];
  const localState = getViewState(mode, entityKey);
  const query = localState.query.trim().toLowerCase();

  return entity.items.filter((rawItem) => {
    const item = { ...rawItem, __entityKey: entityKey };
    const rosterEntry = entityKey === legacyEntityKey || entityKey === buildsEntityKey ? { owned: true } : getRosterEntry(entityKey, item);

    if (mode === "roster" && entityKey !== legacyEntityKey && entityKey !== buildsEntityKey && !rosterEntry.owned) {
      return false;
    }

    if (query && !String(item.search_text || "").toLowerCase().includes(query)) {
      return false;
    }

    return getFilterDefinitions(mode, entityKey).every((definition) => {
      const selected = localState.filters[definition.key] || [];
      if (!selected.length) {
        return true;
      }

      if (definition.key.startsWith("_roster_")) {
        const values = asArray(matchesCustomRosterFilter(definition.key, item));
        if (!values.length) {
          return false;
        }
        return selected.some((value) => values.includes(value));
      }

      const rawValue = item.filters?.[definition.key];
      const values = Array.isArray(rawValue) ? rawValue : rawValue == null ? [] : [rawValue];
      return selected.some((value) => values.includes(value));
    });
  });
}

// Task-oriented left sidebar. Supersedes renderModeNav (the old mode toggle) and
// owns the contextual entity sub-nav (previously rendered by renderBrowse). It is
// a pure projection of the route: the section rail highlights via
// sidebarSectionForRoute, and the sub-nav lists the entities for the active
// section. Hidden on the full-screen gate pages (profiles/wizard).
export function renderSidebar(route) {
  if (!appSidebarEl) {
    return;
  }

  const isGate = route.page === "profiles" || route.page === "wizard";
  appSidebarEl.hidden = isGate;
  if (isGate) {
    return;
  }

  const activeSection = sidebarSectionForRoute(route);

  if (sidebarSectionsEl) {
    sidebarSectionsEl.innerHTML = SIDEBAR_SECTIONS
      .map((section) => `
        <button
          type="button"
          class="sidebar-section-item ${section.id === activeSection ? "active" : ""}"
          data-section="${escapeHtml(section.id)}"
        >
          <span class="sidebar-section-icon" data-icon="${escapeHtml(section.icon)}" aria-hidden="true"></span>
          <span class="sidebar-section-label">${escapeHtml(section.label)}</span>
        </button>
      `)
      .join("");

    sidebarSectionsEl.querySelectorAll("[data-section]").forEach((button) => {
      const section = SIDEBAR_SECTIONS.find((entry) => entry.id === button.dataset.section);
      if (section) {
        button.addEventListener("click", () => section.target());
      }
    });
  }

  // Contextual sub-nav for the active section (reuses renderNav's per-entity meta).
  if (route.page === "admin") {
    if (navEl) {
      navEl.innerHTML = "";
    }
  } else if (route.mode === "reference") {
    renderNav("reference", route.entityKey, referenceEntityKeys);
  } else if (route.entityKey === buildsEntityKey) {
    renderNav("roster", route.entityKey, [buildsEntityKey]);
  } else {
    renderNav("roster", route.entityKey, collectionEntityKeys);
  }
}

export function renderProfileGate(route) {
  if (!profileGateEl) {
    return;
  }

  if (route.page === "home") {
    renderHomePage();
    return;
  }

  if (route.page === "prep") {
    renderPrepPage(route);
    return;
  }

  if (route.page === "wizard") {
    renderWizardPage();
    return;
  }

  if (route.page === "admin") {
    renderAdminPage();
    return;
  }

  renderProfilesPage();
}

// Phase 2 home dashboard. Task-oriented landing that puts CM prep front and centre
// and surfaces the player's own roster (recent builds, collection counts). Rendered
// into #profileGate with the sidebar visible (home is a gate-like page).
export function renderHomePage() {
  if (!profileGateEl) {
    return;
  }

  const profile = getActiveProfile();
  const profileName = profile ? profile.name : "your roster";
  const ownedCharacters = rosterCountForEntity("characters", (entry) => entry.owned);
  const ownedSupports = rosterCountForEntity("supports", (entry) => entry.owned);
  const savedParents = data.reference.entities[legacyEntityKey]?.count || 0;

  const builds = getEntityItems(buildsEntityKey);
  const recentBuilds = builds.slice(-4).reverse();

  const buildsMarkup = recentBuilds.length
    ? recentBuilds
        .map((item) => {
          const labels = item.detail?.labels || {};
          const subtitle = [labels.character, labels.target].filter(Boolean).join(" · ") || "No character yet";
          return `
            <button type="button" class="home-build-row" data-build-id="${escapeHtml(item.id)}">
              <span class="home-build-copy">
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(subtitle)}</span>
              </span>
              <span class="home-build-status">${escapeHtml(labels.status || "Draft")}</span>
            </button>
          `;
        })
        .join("")
    : `<p class="home-empty">No build yet. Start a CM prep to begin.</p>`;

  profileGateEl.innerHTML = `
    <div class="home-dashboard">
      <div class="home-hero">
        <button class="sidebar-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="appSidebar" onclick="window.umaSidebar&&window.umaSidebar.toggle()">
          <span class="sidebar-toggle-bars" aria-hidden="true"></span>
        </button>
        <div class="home-hero-copy">
          <p class="home-eyebrow">Profile · ${escapeHtml(profileName)}</p>
          <h1 class="home-title">Welcome</h1>
          <p class="home-sub">Plan your Champions Meeting builds from your roster.</p>
        </div>
      </div>

      <button type="button" class="home-cta" id="homeStartBuild">
        <span class="home-cta-copy">
          <strong>Prepare a Champions Meeting</strong>
          <span>Target → uma from your roster → deck → skills</span>
        </span>
        <span class="home-cta-arrow" aria-hidden="true">→</span>
      </button>

      <div class="home-grid">
        <section class="home-card">
          <h2 class="home-card-title">Resume a build</h2>
          <div class="home-build-list">${buildsMarkup}</div>
          <button type="button" class="home-card-link" data-home-nav="builds">All builds →</button>
        </section>

        <section class="home-card">
          <h2 class="home-card-title">My Collection</h2>
          <div class="home-stat-row">
            <div class="home-stat"><strong>${ownedCharacters}</strong><span>characters</span></div>
            <div class="home-stat"><strong>${ownedSupports}</strong><span>supports</span></div>
            <div class="home-stat"><strong>${savedParents}</strong><span>parents</span></div>
          </div>
          <button type="button" class="home-card-link" data-home-nav="collection">Manage my collection →</button>
        </section>

        <section class="home-card">
          <h2 class="home-card-title">References</h2>
          <p class="home-card-note">Skills · Races · Tracks · Scenarios · Compatibility</p>
          <button type="button" class="home-card-link" data-home-nav="reference">Open references →</button>
        </section>
      </div>
    </div>
  `;

  const startBuildButton = document.getElementById("homeStartBuild");
  if (startBuildButton) {
    // The home CTA now leads to Auto Prep (docs/AUTO_PREP_PLAN.md Phase 2): give
    // a target, get a full plan. The classic build editor stays the expert mode.
    startBuildButton.addEventListener("click", () => setPrepHash());
  }

  profileGateEl.querySelectorAll("[data-build-id]").forEach((button) => {
    button.addEventListener("click", () => setBrowseHash("roster", buildsEntityKey, button.dataset.buildId));
  });

  profileGateEl.querySelectorAll("[data-home-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.homeNav;
      if (target === "reference") {
        setBrowseHash("reference", defaultEntityKeyForMode("reference"), null);
      } else if (target === "collection") {
        setBrowseHash("roster", "characters", null);
      } else {
        setBrowseHash("roster", buildsEntityKey, null);
      }
    });
  });
}

// --- Auto Prep page (docs/AUTO_PREP_PLAN.md Phase 2). Renders into #profileGate
// (gate-like, sidebar visible). One decision asked - the target - then the whole
// plan from buildAutoPrepPlan, each section with an expandable "why". Client-only
// on already-loaded data; the uma choice is kept in module scope so it survives
// re-renders and resets when the target changes. ---
let prepSelection = { targetId: null, characterId: null, deckPinned: [], deckExcluded: [] };

const PREP_STYLE_LABELS = { runner: "Front Runner", leader: "Pace Chaser", betweener: "Late Surger", chaser: "End Closer" };
const PREP_VERDICT_TONE = { useful: "ok", workable: "warn", "off-target": "bad" };

function renderPrepWhy(reasons) {
  const items = asArray(reasons).filter(Boolean);
  if (!items.length) return "";
  return `
    <details class="prep-why">
      <summary>Why</summary>
      <ul>${items.map((reason) => `<li>${escapeHtml(String(reason))}</li>`).join("")}</ul>
    </details>
  `;
}

function renderPrepDeckCard(pick, titleById, benchByType) {
  const title = pick.title || titleById.get(String(pick.id)) || String(pick.id);
  const reasons = asArray(pick.reasons)
    .slice(0, 3)
    .map((reason) => {
      const value = reason.value != null ? ` ${reason.value}` : "";
      const level = reason.level ? ` @Lv${reason.level}` : "";
      return `<li>${escapeHtml(`${reason.label}${value}${level}`)} <span class="prep-pts">+${escapeHtml(String(reason.points ?? 0))}</span></li>`;
    })
    .join("");
  const bench = asArray(benchByType?.[pick.type]);
  const swapMenu = bench.length
    ? `
      <details class="prep-swap">
        <summary>Swap</summary>
        <div class="prep-swap-list">
          ${bench.map((candidate) => `
            <button type="button" class="prep-swap-option" data-prep-swap-from="${escapeHtml(String(pick.id))}" data-prep-swap-to="${escapeHtml(String(candidate.id))}">
              <span>${escapeHtml(candidate.title || String(candidate.id))}</span>
              <span class="prep-deck-score">${escapeHtml(String(candidate.score ?? 0))}</span>
            </button>
          `).join("")}
        </div>
      </details>
    `
    : "";
  return `
    <article class="prep-deck-card" data-prep-slot="${escapeHtml(String(pick.id))}">
      <div class="prep-deck-head">
        <span class="prep-deck-type" data-type="${escapeHtml(pick.type || "")}">${escapeHtml(RECO_TYPE_LABELS_APP[pick.type] || pick.type || "?")}</span>
        <strong>${escapeHtml(title)}</strong>
        <span class="prep-deck-score">${escapeHtml(String(pick.score ?? 0))}</span>
      </div>
      <ul class="prep-deck-reasons">${reasons}</ul>
      ${pick.hasProjection ? "" : `<p class="prep-note">No projection - ranked by rarity+LB</p>`}
      ${swapMenu}
    </article>
  `;
}

const RECO_TYPE_LABELS_APP = { speed: "Speed", stamina: "Stamina", power: "Power", guts: "Guts", intelligence: "Wisdom", friend: "Friend", group: "Group" };

// A minimal build entry so the existing Feasibility / Last-Spurt panels
// (builds.js) can be reused verbatim: they read target_id (for the racetrack),
// running_style, target_stats and target_aptitudes.distance/surface.
function prepSyntheticEntry(plan, targetId) {
  return {
    target_id: String(targetId || ""),
    running_style: plan.style?.key || "",
    target_stats: { ...(plan.stats?.stats || {}) },
    target_aptitudes: {
      distance: plan.selected?.distanceGrade || "",
      surface: plan.selected?.surfaceGrade || "",
    },
  };
}

const PREP_RUN_OUTCOME = { win: { tone: "ok", label: "Win" }, loss: { tone: "bad", label: "Loss" }, untested: { tone: "neutral", label: "Untested" } };
const PREP_STAT_ABBR = { speed: "SPD", stamina: "STA", power: "PWR", guts: "GUT", wit: "WIT" };

// "Past runs on this target" (Phase 3): the real outcomes recorded against this
// CM, most recent first, so the plan is grounded in what actually happened last
// time. Empty (no section) when nothing has been logged for the target.
function renderPrepRunsSection(targetId) {
  const runs = summarizeTargetRuns(getRunsForTarget(targetId));
  if (!runs.length) {
    return "";
  }
  const titleById = new Map(getEntityItems("characters").map((item) => [String(item.id), item.title || String(item.id)]));
  const rows = runs
    .map((run) => {
      const outcome = PREP_RUN_OUTCOME[run.outcome] || PREP_RUN_OUTCOME.untested;
      const statsText = Object.entries(run.finalStats)
        .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
        .map(([key, value]) => `${PREP_STAT_ABBR[key] || key.toUpperCase()} ${value}`)
        .join(" · ");
      return `
        <div class="prep-run">
          <span class="prep-badge prep-badge-${outcome.tone}">${escapeHtml(outcome.label)}</span>
          <strong>${escapeHtml(titleById.get(run.characterId) || run.characterId || "Unknown uma")}</strong>
          ${run.runningStyle ? `<span class="prep-run-style">${escapeHtml(PREP_STYLE_LABELS[run.runningStyle] || run.runningStyle)}</span>` : ""}
          ${statsText ? `<span class="prep-run-stats">${escapeHtml(statsText)}</span>` : ""}
          ${run.notes ? `<span class="prep-run-notes">${escapeHtml(run.notes)}</span>` : ""}
        </div>
      `;
    })
    .join("");
  return `
    <section class="prep-section prep-section-runs">
      <div class="prep-section-head"><h2>Past runs on this target</h2><span class="prep-badge">${runs.length}</span></div>
      <div class="prep-runs-list">${rows}</div>
      <p class="prep-note">What actually happened last time on this CM - grounds the plan in your own results.</p>
    </section>
  `;
}

function renderPrepPlanSections(plan, targetId) {
  if (!plan?.selected) {
    return `<div class="prep-empty"><p>${escapeHtml(plan?.reasons?.[0] || "No plan available for this target.")}</p></div>`;
  }

  const selected = plan.selected;
  const titleById = new Map((plan.deck?.picks || []).map((pick) => [String(pick.id), pick.title]));
  const skillTitleById = new Map((plan.skills?.entries || []).map((entry) => [String(entry.id), entry.title]));
  const skillLine = (ids) => asArray(ids).map((id) => escapeHtml(skillTitleById.get(String(id)) || String(id))).join(", ") || "-";

  const altButtons = asArray(plan.alternatives)
    .map((alt) => `
      <button type="button" class="prep-alt" data-prep-uma="${escapeHtml(String(alt.characterId))}">
        <strong>${escapeHtml(alt.title)}</strong>
        <span class="prep-badge prep-badge-${PREP_VERDICT_TONE[alt.verdict] || "neutral"}">${escapeHtml(alt.verdict)}</span>
        <span class="prep-alt-fit">fit ${escapeHtml(String(alt.fitScore))}</span>
      </button>
    `)
    .join("");

  return `
    <section class="prep-section prep-section-uma">
      <div class="prep-section-head"><h2>Retained uma</h2><span class="prep-badge prep-badge-${PREP_VERDICT_TONE[selected.verdict] || "neutral"}">${escapeHtml(selected.verdict)}</span></div>
      <div class="prep-uma-main">
        <strong class="prep-uma-name">${escapeHtml(selected.title)}</strong>
        <span class="prep-uma-meta">${escapeHtml(PREP_STYLE_LABELS[plan.style?.key] || plan.style?.key || "-")} · ${escapeHtml(selected.surfaceGrade || "-")}/${escapeHtml(selected.distanceGrade || "-")} · fit ${escapeHtml(String(selected.fitScore))}</span>
      </div>
      ${renderPrepWhy(selected.reasons)}
      ${altButtons ? `<div class="prep-alts"><span class="prep-alts-label">Alternatives</span>${altButtons}</div>` : ""}
    </section>

    <section class="prep-section">
      <div class="prep-section-head"><h2>Running style &amp; stats</h2></div>
      <p class="prep-line"><strong>${escapeHtml(PREP_STYLE_LABELS[plan.style?.key] || plan.style?.key || "-")}</strong> — ${escapeHtml(plan.style?.reason || "")}</p>
      <div class="prep-stats-grid">
        ${Object.entries(plan.stats?.stats || {}).map(([key, value]) => `<div class="prep-stat"><span>${escapeHtml(key)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("")}
      </div>
      ${renderPrepWhy(plan.stats?.reasons)}
    </section>

    <section class="prep-section">
      <div class="prep-section-head">
        <h2>Support deck</h2>
        ${plan.deck?.shortfall ? `<span class="prep-badge prep-badge-warn">${escapeHtml(String(plan.deck.filled))}/6</span>` : ""}
        ${prepSelection.deckExcluded.length ? `<button type="button" class="prep-slot-swap" id="prepResetSwaps">Reset swaps</button>` : ""}
      </div>
      <div class="prep-deck-grid">${(plan.deck?.picks || []).map((pick) => renderPrepDeckCard(pick, titleById, plan.deck?.benchByType)).join("")}</div>
      ${renderPrepWhy(plan.deck?.reasons)}
    </section>

    <section class="prep-section">
      <div class="prep-section-head"><h2>Skills</h2>${plan.skills?.courseAware ? `<span class="prep-badge prep-badge-ok">course-aware</span>` : ""}</div>
      <p class="prep-line"><span class="prep-line-label">Required</span> ${skillLine(plan.skills?.required)}</p>
      <p class="prep-line"><span class="prep-line-label">Optional</span> ${skillLine(plan.skills?.optional)}</p>
      ${renderPrepWhy(plan.skills?.reasons)}
    </section>

    <section class="prep-section">
      <div class="prep-section-head"><h2>Scenario</h2><span class="prep-badge prep-badge-${plan.scenario?.confidence === "curated-match" ? "ok" : "neutral"}">${escapeHtml(plan.scenario?.source || "curated")}</span></div>
      <p class="prep-line"><strong>${escapeHtml(plan.scenario?.recommended?.name || "-")}</strong> — ${escapeHtml(plan.scenario?.recommended?.verdict || "")}</p>
      ${plan.scenario?.note ? `<p class="prep-note">${escapeHtml(plan.scenario.note)}</p>` : ""}
      ${renderPrepWhy(plan.scenario?.reasons)}
    </section>

    <section class="prep-section">
      <div class="prep-section-head"><h2>Parent spec</h2></div>
      ${(plan.parents?.parents || []).map((parent) => `<p class="prep-line"><strong>${escapeHtml(parent.summary)}</strong></p>`).join("")}
      <p class="prep-line"><span class="prep-line-label">White · races</span> ${asArray(plan.parents?.whiteSparks?.races).map((race) => escapeHtml(race.title)).join(", ") || "-"}</p>
      <p class="prep-line"><span class="prep-line-label">White · skills</span> ${asArray(plan.parents?.whiteSparks?.skills).map((skill) => escapeHtml(skill.title)).join(", ") || "-"}</p>
      ${renderPrepWhy(plan.parents?.reasons)}
    </section>

    <section class="prep-section prep-section-readouts">
      <div class="prep-section-head"><h2>Deterministic readouts</h2></div>
      <div class="build-panel-grid">
        ${renderBuildFeasibilityPanel(prepSyntheticEntry(plan, targetId))}
        ${renderBuildSpurtPanel(prepSyntheticEntry(plan, targetId))}
      </div>
    </section>

    ${renderPrepRunsSection(targetId)}

    <div class="prep-actions">
      <button type="button" class="prep-primary" id="prepSaveDraft">Save as build draft</button>
    </div>
  `;
}

export function renderPrepPage(route) {
  if (!profileGateEl) {
    return;
  }

  const targetItems = getEntityItems("cm_targets");
  if (!targetItems.length) {
    profileGateEl.innerHTML = `<div class="prep-page"><div class="prep-empty"><p>No Champions Meeting targets in the reference data.</p></div></div>`;
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const defaultId = selectDefaultTargetId(targetItems, nowSeconds);
  const activeId = route.targetId && targetItems.some((item) => String(item.id) === String(route.targetId))
    ? String(route.targetId)
    : defaultId;

  // Reset the uma override and deck swaps when the target changes.
  if (prepSelection.targetId !== activeId) {
    prepSelection = { targetId: activeId, characterId: null, deckPinned: [], deckExcluded: [] };
  }

  const activeItem = targetItems.find((item) => String(item.id) === String(activeId));
  const detail = activeItem?.detail || {};
  const plan = buildAutoPrepPlanForDetail(detail, {
    selectedCharacterId: prepSelection.characterId,
    pinnedDeckIds: prepSelection.deckPinned,
    excludedDeckIds: prepSelection.deckExcluded,
  });

  const options = targetItems
    .slice()
    .sort((a, b) => (Number(b.detail?.start_ts) || 0) - (Number(a.detail?.start_ts) || 0))
    .map((item) => {
      const label = formatCmTargetLabel(item);
      return `<option value="${escapeHtml(String(item.id))}" ${String(item.id) === String(activeId) ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");

  profileGateEl.innerHTML = `
    <div class="prep-page">
      <header class="prep-header">
        <button class="sidebar-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="appSidebar" onclick="window.umaSidebar&&window.umaSidebar.toggle()">
          <span class="sidebar-toggle-bars" aria-hidden="true"></span>
        </button>
        <div class="prep-header-copy">
          <p class="home-eyebrow">Auto Prep</p>
          <h1 class="home-title">Prepare a Champions Meeting</h1>
        </div>
        <div class="prep-target-row">
          <label class="field-stack">
            <span>Target</span>
            <select id="prepTarget">${options}</select>
          </label>
          <button type="button" class="prep-secondary" id="prepRegenerate">Regenerate</button>
        </div>
      </header>
      ${renderPrepPlanSections(plan, activeId)}
    </div>
  `;

  const targetSelect = document.getElementById("prepTarget");
  if (targetSelect) {
    targetSelect.addEventListener("change", () => setPrepHash(targetSelect.value));
  }
  const regenerateButton = document.getElementById("prepRegenerate");
  if (regenerateButton) {
    regenerateButton.addEventListener("click", () => {
      prepSelection.characterId = null;
      requestRender();
    });
  }
  profileGateEl.querySelectorAll("[data-prep-uma]").forEach((button) => {
    button.addEventListener("click", () => {
      prepSelection.characterId = button.dataset.prepUma;
      requestRender();
    });
  });
  profileGateEl.querySelectorAll("[data-prep-swap-to]").forEach((button) => {
    button.addEventListener("click", () => {
      const fromId = button.dataset.prepSwapFrom;
      const toId = button.dataset.prepSwapTo;
      // Exclude the replaced card and pin the chosen one; drop any stale pin for
      // the replaced card so chained swaps stay consistent.
      if (fromId && !prepSelection.deckExcluded.includes(fromId)) prepSelection.deckExcluded.push(fromId);
      prepSelection.deckPinned = prepSelection.deckPinned.filter((id) => id !== fromId);
      if (toId && !prepSelection.deckPinned.includes(toId)) prepSelection.deckPinned.push(toId);
      requestRender();
    });
  });
  const resetSwapsButton = document.getElementById("prepResetSwaps");
  if (resetSwapsButton) {
    resetSwapsButton.addEventListener("click", () => {
      prepSelection.deckPinned = [];
      prepSelection.deckExcluded = [];
      requestRender();
    });
  }
  const saveButton = document.getElementById("prepSaveDraft");
  if (saveButton) {
    saveButton.addEventListener("click", () => {
      const seed = planToBuildSeed(plan, activeId);
      if (!seed) return;
      startSeededBuildDraft(seed);
      setBrowseHash("roster", buildsEntityKey, "__new__");
    });
  }
}

export function renderNav(mode, activeKey, keys = allowedEntityKeys(mode), targetEl = navEl) {
  if (!targetEl) {
    return;
  }
  targetEl.innerHTML = keys
    .map((key) => {
      const totalCount = data.reference.entities[key].count;
      const ownedCount = mode === "roster" && key !== legacyEntityKey && key !== buildsEntityKey ? rosterCountForEntity(key, (entry) => entry.owned) : 0;
      const metaText = mode === "roster"
        ? (key === legacyEntityKey
          ? `${totalCount} saved parents`
          : key === buildsEntityKey
            ? `${totalCount} drafts`
            : `${totalCount} cards | ${ownedCount} owned`)
        : `${totalCount} items`;
      return `
        <button class="entity-button ${key === activeKey ? "active" : ""}" data-entity="${escapeHtml(key)}" data-mode="${escapeHtml(mode)}" type="button">
          <strong>${escapeHtml(data.entities[key].label)}</strong><br>
          <span class="entity-meta">${escapeHtml(metaText)}</span>
        </button>
      `;
    })
    .join("");

  targetEl.querySelectorAll("[data-entity]").forEach((button) => {
    button.addEventListener("click", () => setBrowseHash(mode, button.dataset.entity, null));
  });
}

export function renderFilters(mode, entityKey) {
  const localState = getViewState(mode, entityKey);

  const boxesMarkup = getFilterDefinitions(mode, entityKey)
    .map((definition) => {
      const options = getFilterOptions(mode, entityKey, definition);
      if (!options.length) {
        return "";
      }

      return `
        <details class="filter-box">
          <summary>${escapeHtml(definition.label)}</summary>
          <div class="filter-options">
            ${options
              .map((option) => `
                <label class="filter-option">
                  <span>
                    <input
                      type="checkbox"
                      data-filter-key="${escapeHtml(definition.key)}"
                      value="${escapeHtml(option.value)}"
                      ${localState.filters[definition.key]?.includes(option.value) ? "checked" : ""}
                    >
                    ${escapeHtml(option.label)}
                  </span>
                  <span>${escapeHtml(option.count)}</span>
                </label>
              `)
              .join("")}
          </div>
        </details>
      `;
    })
    .join("");

  if (!boxesMarkup.trim()) {
    filtersEl.innerHTML = "";
    return;
  }

  // Collapsed by default so the filter grid stops pushing results below the fold
  // on small screens. The active-filter count stays visible on the collapsed
  // summary, and the open state is remembered per view (localState.filtersOpen).
  const activeCount = Object.values(localState.filters || {})
    .reduce((total, values) => total + (Array.isArray(values) ? values.length : 0), 0);

  filtersEl.innerHTML = `
    <details class="filters-collapse" ${localState.filtersOpen ? "open" : ""}>
      <summary class="filters-collapse-summary">
        <span class="filters-collapse-label">Filters</span>
        ${activeCount ? `<span class="filters-active-count">${activeCount}</span>` : ""}
      </summary>
      <div class="filters-grid">${boxesMarkup}</div>
    </details>
  `;

  const collapseEl = filtersEl.querySelector(".filters-collapse");
  if (collapseEl) {
    collapseEl.addEventListener("toggle", () => {
      localState.filtersOpen = collapseEl.open;
    });
  }

  filtersEl.querySelectorAll("[data-filter-key]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const key = event.target.dataset.filterKey;
      const values = Array.from(filtersEl.querySelectorAll(`[data-filter-key="${key}"]:checked`)).map((node) => node.value);
      localState.filters[key] = values;
      requestRenderPreservingScroll();
    });
  });

  filtersEl.querySelectorAll("details").forEach((detailsEl) => {
    detailsEl.addEventListener("toggle", () => {
      window.requestAnimationFrame(syncToolbarMetrics);
    });
  });
}

export function renderBrowseActions(route, filteredItems) {
  if (!browseActionsEl) {
    return;
  }

  if (route.page !== "browse" || route.mode !== "roster") {
    browseActionsEl.innerHTML = "";
    browseActionsEl.hidden = true;
    return;
  }

  const localState = getViewState(route.mode, route.entityKey);
  if (route.entityKey === buildsEntityKey) {
    browseActionsEl.hidden = false;
    browseActionsEl.innerHTML = `
      <div class="batch-toolbar">
        <button type="button" class="button-secondary" id="newBuildEntryButton">New build</button>
      </div>
    `;
    const newBuildButton = document.getElementById("newBuildEntryButton");
    if (newBuildButton) {
      newBuildButton.addEventListener("click", () => {
        state.buildsStatus = { kind: "idle", message: "" };
        state.buildEditor.activeFormTab = "setup";
        // Start a genuinely fresh draft: drop any persisted create-draft
        // (e.g. a previous CM recommendation seed) so the form isn't stale.
        if (state.buildEditor.targetKey === "__new__") {
          state.buildEditor.draft = null;
        }
        setBrowseHash(route.mode, route.entityKey, "__new__");
      });
    }
    return;
  }

  if (route.entityKey === legacyEntityKey) {
    const isSimulator = localState.presentation === "simulator";
    browseActionsEl.hidden = false;
    browseActionsEl.innerHTML = `
      <div class="presentation-switch">
        <button type="button" class="${!isSimulator ? "active" : ""}" data-legacy-presentation="parents">Parents</button>
        <button type="button" class="${isSimulator ? "active" : ""}" data-legacy-presentation="simulator">Simulator</button>
      </div>
      ${!isSimulator ? `
        <div class="batch-toolbar">
          <button type="button" class="button-secondary" id="newLegacyEntryButton">New parent</button>
        </div>
      ` : ""}
    `;

    browseActionsEl.querySelectorAll("[data-legacy-presentation]").forEach((button) => {
      button.addEventListener("click", () => {
        localState.presentation = button.dataset.legacyPresentation;
        if (localState.presentation === "simulator") {
          localState.selectedId = null;
        }
        requestRender();
      });
    });

    const newLegacyButton = document.getElementById("newLegacyEntryButton");
    if (newLegacyButton) {
      newLegacyButton.addEventListener("click", () => {
        localState.presentation = "parents";
        state.legacyStatus = { kind: "idle", message: "" };
        state.legacyCreateStep = 1;
        setBrowseHash(route.mode, route.entityKey, "__new__");
      });
    }
    return;
  }

  const isBatch = localState.presentation === "batch";
  const isImport = localState.presentation === "import";
  const supportsImport = route.entityKey === "supports" || route.entityKey === "characters";
  browseActionsEl.hidden = false;
  browseActionsEl.innerHTML = `
    <div class="presentation-switch">
      <button type="button" class="${!isBatch && !isImport ? "active" : ""}" data-roster-presentation="detail">Detail</button>
      <button type="button" class="${isBatch ? "active" : ""}" data-roster-presentation="batch">Batch</button>
      ${supportsImport ? `<button type="button" class="${isImport ? "active" : ""}" data-roster-presentation="import">Import</button>` : ""}
    </div>
    ${isBatch ? `
      <div class="batch-toolbar">
        <button type="button" class="button-strong" data-save-batch-all>Save changes</button>
        <button type="button" class="button-secondary" data-batch-favorite="yes">Favorite filtered</button>
        <button type="button" class="button-secondary" data-batch-favorite="no">Unfavorite filtered</button>
        <button type="button" class="button-secondary" data-batch-tag="add">Add tag</button>
        <button type="button" class="button-secondary" data-batch-tag="remove">Remove tag</button>
        <button type="button" class="button-danger" data-batch-remove>Remove selected</button>
      </div>
    ` : ""}
  `;

  browseActionsEl.querySelectorAll("[data-roster-presentation]").forEach((button) => {
    button.addEventListener("click", () => {
      localState.presentation = button.dataset.rosterPresentation;
      if (localState.presentation === "batch" || localState.presentation === "import") {
        localState.selectedId = null;
      }
      requestRenderPreservingScroll();
    });
  });

  browseActionsEl.querySelectorAll("[data-batch-favorite]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextValue = button.dataset.batchFavorite === "yes";
      await applyBatchFavorite(route.entityKey, filteredItems, nextValue);
    });
  });

  browseActionsEl.querySelectorAll("[data-batch-tag]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.batchTag;
      const value = window.prompt(action === "add" ? "Tag to add to filtered roster entries" : "Tag to remove from filtered roster entries", "");
      if (!value || !value.trim()) {
        return;
      }
      await applyBatchTag(route.entityKey, filteredItems, action, value.trim());
    });
  });

  const removeSelectedButton = browseActionsEl.querySelector("[data-batch-remove]");
  if (removeSelectedButton) {
    removeSelectedButton.addEventListener("click", async () => {
      const selectedIds = Array.from(listEl.querySelectorAll("[data-batch-select]:checked")).map((box) => box.dataset.batchSelect);
      if (!selectedIds.length) {
        window.alert("Tick the checkbox on the entries to remove first.");
        return;
      }
      if (!window.confirm(`Remove ${selectedIds.length} entr${selectedIds.length === 1 ? "y" : "ies"} from the roster?`)) {
        return;
      }
      await removeSelectedBatchRows(route.entityKey, selectedIds);
    });
  }

  const saveBatchAllButton = browseActionsEl.querySelector("[data-save-batch-all]");
  if (saveBatchAllButton) {
    saveBatchAllButton.addEventListener("click", async () => {
      await saveVisibleBatchRows(route.entityKey, filteredItems);
    });
  }
}

export async function applyBatchFavorite(entityKey, filteredItems, nextValue) {
  await refreshRosterFromServer();
  filteredItems.forEach((item) => {
    const entry = getRosterEntry(entityKey, item);
    setRosterEntry(entityKey, item, {
      ...entry,
      owned: true,
      favorite: nextValue,
    });
  });
  await persistRosterDocument(nextValue ? "Filtered roster entries marked as favorites." : "Filtered roster entries removed from favorites.");
}

export async function applyBatchTag(entityKey, filteredItems, action, rawTag) {
  await refreshRosterFromServer();
  filteredItems.forEach((item) => {
    const entry = getRosterEntry(entityKey, item);
    const tags = new Set(asArray(entry.custom_tags));
    if (action === "add") {
      tags.add(rawTag);
    } else {
      tags.delete(rawTag);
    }
    setRosterEntry(entityKey, item, {
      ...entry,
      owned: true,
      custom_tags: Array.from(tags),
    });
  });
  await persistRosterDocument(action === "add" ? `Tag "${rawTag}" added to filtered roster entries.` : `Tag "${rawTag}" removed from filtered roster entries.`);
}


export function renderList(mode, entityKey, filteredItems) {
  const localState = getViewState(mode, entityKey);
  if (mode === "roster" && entityKey === legacyEntityKey && localState.presentation === "simulator") {
    renderLegacySimulatorList();
    return;
  }
  if (mode === "roster" && (entityKey === "supports" || entityKey === "characters") && localState.presentation === "import") {
    renderRosterImportPanel(entityKey);
    return;
  }
  if (mode === "roster" && localState.presentation === "batch") {
    renderBatchList(entityKey, filteredItems);
    return;
  }
  if (mode === "roster" && entityKey === buildsEntityKey) {
    renderBuildsHub(filteredItems, localState);
    return;
  }
  if (!filteredItems.length) {
    listEl.innerHTML = mode === "roster"
      ? (entityKey === legacyEntityKey
        ? "<div class='empty-state'>No saved parent matches the current legacy search and filters. Create a first parent from <strong>New parent</strong>.</div>"
        : entityKey === buildsEntityKey
          ? "<div class='empty-state'>No build draft matches the current search and filters. Create a first draft from <strong>New build</strong>.</div>"
          : "<div class='empty-state'>No owned entry matches the current roster search and filters. Go to <strong>Catalog</strong> to add the characters and supports you own first.</div>")
      : "<div class='empty-state'>No result for the current search and filter set.</div>";
    return;
  }

  listEl.innerHTML = filteredItems
    .map((item) => {
      const rosterBadges = getRosterBadges(entityKey, item, mode);
      const displayBadges = [...rosterBadges, ...asArray(item.badges).filter(Boolean)].slice(0, 7);
      const rosterProjection = mode === "roster" ? getRosterViewEntry(entityKey, item)?.derived || null : null;

      return `
        <article class="result-card ${mode === "roster" ? "result-card-roster" : ""} ${item.id === localState.selectedId ? "active" : ""}" data-item-id="${escapeHtml(item.id)}">
          ${renderResultTop(item, entityKey)}
          ${mode === "roster" && entityKey !== legacyEntityKey && entityKey !== buildsEntityKey ? renderRosterCardProgress(entityKey, rosterProjection) : ""}
          <div class="badge-row">
            ${displayBadges.map((badge) => renderBadge(badge)).join("")}
          </div>
          ${mode === "reference" && entityKey === "supports" ? renderCatalogSupportQuickAdd(item) : ""}
        </article>
      `;
    })
    .join("");

  listEl.querySelectorAll("[data-support-quick-add]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const itemId = button.dataset.supportQuickAdd;
      const item = filteredItems.find((candidate) => String(candidate.id) === String(itemId));
      if (!item || getRosterEntry("supports", item).owned) {
        return;
      }
      button.disabled = true;
      button.textContent = "Adding...";
      await addItemToRoster("supports", item);
    });
  });

  listEl.querySelectorAll("[data-item-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const itemId = card.dataset.itemId;
      if (isCompactLayout() && localState.selectedId === itemId) {
        setBrowseHash(mode, entityKey, null);
        return;
      }
      setBrowseHash(mode, entityKey, itemId);
    });
  });
}


// Phase 3 "CM Prep" hub: replaces the flat build list with a status-grouped
// board plus a launcher that brings the CM-target recommendation (previously only
// reachable from the Catalog) next to the build editor. Selecting a CM target runs
// the tested recommender engine (getCmTargetRecommendations) against the owned
// roster; "Build" seeds a draft and opens it in the detail editor.
export function renderBuildsHub(filteredItems, localState) {
  const cmTargetOptions = getBuildTargetOptions("cm_targets");
  const groups = BUILD_STATUS_OPTIONS
    .map((option) => ({
      ...option,
      items: filteredItems.filter((item) => (item.filters?.status || "draft") === option.value),
    }))
    .filter((group) => group.items.length);

  const boardMarkup = filteredItems.length
    ? groups
        .map((group) => `
          <section class="prepa-column">
            <div class="prepa-column-head">
              <span>${escapeHtml(group.label)}</span>
              <span class="prepa-column-count">${group.items.length}</span>
            </div>
            <div class="prepa-column-cards">
              ${group.items
                .map((item) => {
                  const labels = item.detail?.labels || {};
                  const subtitle = [labels.character, labels.target].filter(Boolean).join(" · ") || "No character";
                  return `
                    <button type="button" class="prepa-build-card ${item.id === localState.selectedId ? "active" : ""}" data-item-id="${escapeHtml(item.id)}">
                      <strong>${escapeHtml(item.title)}</strong>
                      <span>${escapeHtml(subtitle)}</span>
                      ${labels.mode ? `<span class="prepa-build-mode">${escapeHtml(labels.mode)}</span>` : ""}
                    </button>
                  `;
                })
                .join("")}
            </div>
          </section>
        `)
        .join("")
    : `<p class="home-empty">No build yet. Pick a CM target above, or start from a blank build.</p>`;

  listEl.innerHTML = `
    <div class="prepa-hub">
      <section class="prepa-launcher">
        <div class="prepa-launcher-head">
          <h3>New CM prep</h3>
          <button type="button" class="button-secondary" id="prepaBlankBuild">Blank build</button>
        </div>
        <label class="field-stack">
          <span>Champions Meeting target</span>
          <select id="prepaCmTargetSelect">
            <option value="">Choose a target…</option>
            ${cmTargetOptions.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
        <div id="prepaRecoPanel" class="prepa-reco-panel"></div>
      </section>
      <div class="prepa-board">${boardMarkup}</div>
    </div>
  `;

  const blankButton = document.getElementById("prepaBlankBuild");
  if (blankButton) {
    blankButton.addEventListener("click", () => {
      state.buildsStatus = { kind: "idle", message: "" };
      state.buildEditor.activeFormTab = "setup";
      if (state.buildEditor.targetKey === "__new__") {
        state.buildEditor.draft = null;
      }
      setBrowseHash("roster", buildsEntityKey, "__new__");
    });
  }

  listEl.querySelectorAll(".prepa-build-card[data-item-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const itemId = card.dataset.itemId;
      if (isCompactLayout() && localState.selectedId === itemId) {
        setBrowseHash("roster", buildsEntityKey, null);
        return;
      }
      setBrowseHash("roster", buildsEntityKey, itemId);
    });
  });

  const select = document.getElementById("prepaCmTargetSelect");
  const recoPanel = document.getElementById("prepaRecoPanel");
  if (select) {
    select.addEventListener("change", () => renderPrepaReco(select.value, recoPanel));
  }
}

// Compact reco list for a chosen CM target, reusing the tested recommender. Each
// row seeds a fresh build draft (same seed shape as the Catalog CM reco) and opens
// the editor, so CM prep now lives entirely inside the CM Prep section.
function renderPrepaReco(targetId, panel) {
  if (!panel) {
    return;
  }
  if (!targetId) {
    panel.innerHTML = "";
    return;
  }

  const cmItem = getEntityItems("cm_targets").find((item) => String(item.id) === String(targetId));
  const detail = cmItem?.detail;
  if (!detail) {
    panel.innerHTML = "<p class='source-note'>Target not found.</p>";
    return;
  }

  const recos = getCmTargetRecommendations(detail);
  const deck = getCmTargetDeck(detail).result.deck;
  if (!recos.length) {
    panel.innerHTML = "<p class='source-note'>No owned uma to recommend for this target. Add characters to your collection first.</p>";
    return;
  }

  const styleLabel = (key) => BUILD_RUNNING_STYLE_OPTIONS.find((option) => option.value === key)?.label || key || "-";

  panel.innerHTML = `
    <p class="prepa-reco-title">Recommended uma from your roster</p>
    <div class="prepa-reco-list">
      ${recos
        .map((reco) => `
          <div class="prepa-reco-row">
            <span class="prepa-reco-copy">
              <strong>${escapeHtml(reco.title)}</strong>
              <span>${escapeHtml(styleLabel(reco.bestStyle))} · fit ${reco.fitScore.toFixed(2)}</span>
            </span>
            <span class="prepa-reco-grades">${renderGradeBadge(reco.surfaceGrade)}${renderGradeBadge(reco.distanceGrade)}</span>
            <button type="button" class="button-strong prepa-reco-build" data-reco-char="${escapeHtml(reco.characterId)}">Build</button>
          </div>
        `)
        .join("")}
    </div>
  `;

  panel.querySelectorAll("[data-reco-char]").forEach((button) => {
    button.addEventListener("click", () => {
      const reco = recos.find((candidate) => candidate.characterId === button.dataset.recoChar);
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
      setBrowseHash("roster", buildsEntityKey, "__new__");
    });
  });
}

export function renderBrowseBody(entityKey, detail, rosterProjection) {
  if (entityKey === "characters") return renderCharacters(detail, rosterProjection);
  if (entityKey === "supports") return renderSupports(detail, rosterProjection);
  if (entityKey === "skills") return renderSkills(detail);
  if (entityKey === "races") return renderRaces(detail);
  if (entityKey === "racetracks") return renderRacetracks(detail);
  if (entityKey === "g1_factors") return renderG1Factors(detail);
  if (entityKey === "cm_targets") return renderCmTargets(detail);
  if (entityKey === "scenarios") return renderScenarios(detail);
  if (entityKey === "training_events") return renderTrainingEvents(detail);
  if (entityKey === "compatibility") return renderCompatibility(detail, data.entities[entityKey].model);
  return "";
}


export function renderDetail(route, selectedItem) {
  const localState = route.page === "browse" ? getViewState(route.mode, route.entityKey) : null;
  // Batch and import are full-width presentations: the detail column is
  // hidden by renderBrowse, this placeholder only shows if it reappears.
  const isBatchMode = Boolean(route.mode === "roster" && (localState?.presentation === "batch" || localState?.presentation === "import"));
  if (isBatchMode) {
    detailEl.innerHTML = "<div class='detail-empty'>Batch mode focuses on quick inline maintenance. Use <strong>Open</strong> on a row or switch back to <strong>Detail</strong> mode for the full roster sheet.</div>";
    return;
  }

  if (route.mode === "roster" && route.entityKey === buildsEntityKey) {
    if (route.itemId === "__new__" || localState?.selectedId === "__new__") {
      const createEntry = createEmptyBuildEntry();
      detailEl.innerHTML = `
        <button class="detail-close-button" type="button" id="detailCloseButton">Close details</button>
        ${renderBuildEditor(createEntry, true)}
      `;
      const closeButton = document.getElementById("detailCloseButton");
      if (closeButton) {
        closeButton.addEventListener("click", () => setBrowseHash(route.mode, route.entityKey, null));
      }
      attachBuildFormListeners(true);
      if (detailPanelEl) {
        detailPanelEl.scrollTop = 0;
      }
      return;
    }
  }

  if (route.mode === "roster" && route.entityKey === legacyEntityKey) {
    if (localState?.presentation === "simulator") {
      detailEl.innerHTML = renderLegacyPreview(state.legacySimulator.preview);
      if (detailPanelEl) {
        detailPanelEl.scrollTop = 0;
      }
      return;
    }

    if (route.itemId === "__new__" || localState?.selectedId === "__new__") {
      const initialCharacterId = getLegacyCharacterOptions("")[0]?.value || "";
      const initialProgress = getCharacterRosterDefaults(initialCharacterId);
      const createEntry = {
        id: "",
        character_card_id: initialCharacterId,
        scenario_id: "",
        rating: "",
        stars: initialProgress.stars,
        awakening: initialProgress.awakening,
        custom_tags: [],
        status_flags: [],
        blue_spark: null,
        pink_spark: null,
        green_spark: null,
        white_sparks: [],
      };
      detailEl.innerHTML = renderLegacyEditor(createEntry, true);
      attachLegacyFormListeners(true);
      if (detailPanelEl) {
        detailPanelEl.scrollTop = 0;
      }
      return;
    }
  }

  if (!selectedItem) {
    detailEl.innerHTML = route.mode === "roster"
      ? (route.entityKey === legacyEntityKey
        ? "<div class='detail-empty'>Select a saved parent to inspect and edit its local inheritance sheet, or create a new one from <strong>New parent</strong>.</div>"
        : route.entityKey === buildsEntityKey
          ? "<div class='detail-empty'>Select a build draft to inspect and edit it, or create one from <strong>New build</strong>.</div>"
          : "<div class='detail-empty'>Select an owned entry to inspect its reference data and edit the local roster fields. If the roster is empty, add entries from <strong>Catalog</strong> first.</div>")
      : "<div class='detail-empty'>Select an entry to inspect its local normalized data and source metadata.</div>";
    if (detailPanelEl) {
      detailPanelEl.scrollTop = 0;
    }
    return;
  }

  const entity = data.entities[route.entityKey];
  const detail = selectedItem.detail;
  const rosterBadges = getRosterBadges(route.entityKey, selectedItem, route.mode);
  const rosterProjection = route.mode === "roster" ? getRosterViewEntry(route.entityKey, selectedItem)?.derived || null : null;

  if (route.mode === "roster" && route.entityKey === buildsEntityKey) {
    detailEl.innerHTML = `
      <button class="detail-close-button" type="button" id="detailCloseButton">Close details</button>
      ${renderDetailHeader(selectedItem, route.entityKey, rosterBadges)}
      ${renderBuildEditor(detail.entry, false, detail.labels)}
    `;

    const closeButton = document.getElementById("detailCloseButton");
    if (closeButton) {
      closeButton.addEventListener("click", () => setBrowseHash(route.mode, route.entityKey, null));
    }

    attachBuildFormListeners(false, detail.entry.id);
    if (detailPanelEl) {
      detailPanelEl.scrollTop = 0;
    }
    return;
  }

  if (route.mode === "roster" && route.entityKey === legacyEntityKey) {
    detailEl.innerHTML = `
      <button class="detail-close-button" type="button" id="detailCloseButton">Close details</button>
      ${renderDetailHeader(selectedItem, route.entityKey, rosterBadges)}
      ${renderLegacyEditor(detail.entry, false)}
      ${renderLegacyDetailBody(detail)}
    `;

    detailEl.querySelectorAll("[data-ref-entity][data-ref-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const targetEntity = button.dataset.refEntity;
        const targetMode = targetEntity === legacyEntityKey ? "roster" : "reference";
        setBrowseHash(targetMode, targetEntity, button.dataset.refId);
      });
    });

    const closeButton = document.getElementById("detailCloseButton");
    if (closeButton) {
      closeButton.addEventListener("click", () => setBrowseHash(route.mode, route.entityKey, null));
    }

    attachLegacyFormListeners(false, detail.entry.id);
    if (detailPanelEl) {
      detailPanelEl.scrollTop = 0;
    }
    return;
  }

  detailEl.innerHTML = `
    <button class="detail-close-button" type="button" id="detailCloseButton">Close details</button>
    ${renderDetailHeader(selectedItem, route.entityKey, rosterBadges)}
    ${route.mode === "reference" ? renderReferenceRosterActions(route.entityKey, selectedItem) : ""}
    ${route.mode === "roster" ? renderRosterEditor(route.entityKey, selectedItem) : ""}
    ${renderBrowseBody(route.entityKey, detail, rosterProjection)}
    <div class="detail-section">
      <h3>Source</h3>
      <p class="source-note">Imported locally on ${escapeHtml(formatDateTime(entity.source.imported_at || "-"))}.</p>
      <p class="source-note">${renderLinks(entity.source.page_urls || [])}</p>
    </div>
  `;

  detailEl.querySelectorAll("[data-ref-entity][data-ref-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetEntity = button.dataset.refEntity;
      const targetMode = route.mode === "roster" && rosterEntityKeys.includes(targetEntity) ? "roster" : "reference";
      setBrowseHash(targetMode, targetEntity, button.dataset.refId);
    });
  });

  const closeButton = document.getElementById("detailCloseButton");
  if (closeButton) {
    closeButton.addEventListener("click", () => setBrowseHash(route.mode, route.entityKey, null));
  }

  const addToRosterButton = document.getElementById("addToRosterButton");
  if (addToRosterButton) {
    addToRosterButton.addEventListener("click", async () => {
      await addItemToRoster(route.entityKey, selectedItem);
    });
  }

  const removeFromReferenceButton = document.getElementById("removeFromRosterButton");
  if (removeFromReferenceButton && route.mode === "reference") {
    removeFromReferenceButton.addEventListener("click", async () => {
      await removeItemFromRoster(route.entityKey, selectedItem);
    });
  }

  attachRosterFormListeners(route.entityKey, selectedItem);

  if (route.entityKey === "racetracks") {
    attachRacetrackVisualizerListeners(detail);
  }

  if (route.entityKey === "cm_targets") {
    attachCmTargetRecommendationListeners(detail);
  }

  if (detailPanelEl) {
    detailPanelEl.scrollTop = 0;
  }
}

export function syncHeader(route) {
  const activeProfile = getActiveProfile();

  activeProfileNameEl.textContent = activeProfile ? activeProfile.name : "No profile selected";
  changeProfileButton.hidden = (route.page === "profiles" || route.page === "wizard" || !activeProfile);
  if (adminButton) {
    adminButton.hidden = (route.page === "profiles" || route.page === "wizard" || route.page === "admin" || !activeProfile);
  }
  if (activeProfileBlock) {
    activeProfileBlock.hidden = ((route.page === "profiles" || route.page === "wizard") || (route.page === "browse" && route.mode === "reference") || !activeProfile);
  }
  if (lastBuildBlock) {
    lastBuildBlock.hidden = (route.page === "profiles" || route.page === "wizard" || (route.page === "browse" && route.mode === "roster"));
  }

  if (route.page === "wizard") {
    pageTitleEl.textContent = "Bootstrap Wizard";
    summaryText.textContent = "Create your first profile, prepare local data and enter My Roster.";
    datasetHeadingEl.textContent = "Bootstrap";
    return;
  }

  if (route.page === "profiles") {
    pageTitleEl.textContent = "Choose your local profile";
    summaryText.textContent = "Select an existing profile before entering your local roster.";
    datasetHeadingEl.textContent = "Profiles";
    return;
  }

  if (route.page === "admin") {
    pageTitleEl.textContent = "Administration";
    summaryText.textContent = activeProfile
      ? `Local maintenance and profile management for ${activeProfile.name}.`
      : "Local maintenance and profile management.";
    datasetHeadingEl.textContent = "Profiles";
    return;
  }

  if (route.page === "home") {
    // The home dashboard renders its own hero; the top header stays hidden here.
    pageTitleEl.textContent = "Home";
    summaryText.textContent = "";
    datasetHeadingEl.textContent = "Home";
    return;
  }

  if (route.page === "prep") {
    // Auto Prep renders its own header; keep the top header hidden like home.
    pageTitleEl.textContent = "CM Prep";
    summaryText.textContent = "";
    datasetHeadingEl.textContent = "CM Prep";
    return;
  }

  pageTitleEl.textContent = route.mode === "roster" ? "My Roster" : "Umamusume Pretty Derby Catalog";

  if (route.mode === "roster") {
    summaryText.textContent = activeProfile
      ? `Owned characters, supports, legacy parents and build drafts for ${activeProfile.name}.`
      : "My Roster shows owned characters, supports, legacy parents and build drafts.";
    datasetHeadingEl.textContent = "Roster Datasets";
    return;
  }

  summaryText.textContent = "Browse the local catalog and add the characters and supports you own to My Roster.";
  datasetHeadingEl.textContent = "Catalog Datasets";
}

export function syncShellVisibility(route) {
  // Home + admin render into #profileGate (like the profiles/wizard gate) but keep
  // the sidebar visible; only profiles/wizard are the full-screen video gate.
  const isGatePage = route.page === "profiles" || route.page === "wizard" || route.page === "admin" || route.page === "home" || route.page === "prep";
  const isProfilesLikePage = isGatePage;
  profileGateEl.hidden = !isGatePage;
  if (topHeaderEl) {
    // The sidebar (active section) and the toolbar (dataset title + counts)
    // already convey what the old top header showed, so hide it on browse pages
    // too — it was pure duplication eating vertical space on small screens.
    topHeaderEl.hidden = isProfilesLikePage || route.page === "browse";
  }
  // The old #datasetBar is an empty shell now (its entity nav moved into the
  // sidebar); keep it hidden on every route.
  datasetBarEl.hidden = true;
  toolbarEl.hidden = isGatePage;
  if (resultsPanelEl) {
    resultsPanelEl.hidden = isGatePage;
  }
  detailColumnEl.hidden = isGatePage;
  backToTopButton.hidden = isGatePage;
  // Sidebar shows on browse + admin; hidden on the full-screen gate pages
  // (profiles/wizard) so the animated video background is never overlapped.
  if (appSidebarEl) {
    appSidebarEl.hidden = route.page === "profiles" || route.page === "wizard";
  }
  document.body.classList.toggle("route-profiles", route.page === "profiles");
  document.body.classList.toggle("route-wizard", route.page === "wizard");
  document.body.classList.toggle("route-admin", route.page === "admin");
  document.body.classList.toggle("route-home", route.page === "home");
  document.body.classList.toggle("route-prep", route.page === "prep");
  document.body.classList.toggle("route-roster", route.page === "browse" && route.mode === "roster");
  document.body.classList.toggle("route-catalog", route.page === "browse" && route.mode === "reference");
  if (route.page !== "browse") {
    document.body.classList.remove("legacy-detail-expanded");
  }

  if (profileBackgroundMediaEl) {
    profileBackgroundMediaEl.hidden = !(route.page === "profiles" || route.page === "wizard");
  }

  if (profileBackgroundVideoEl) {
    if (route.page === "profiles" || route.page === "wizard") {
      const playPromise = profileBackgroundVideoEl.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    } else {
      profileBackgroundVideoEl.pause();
    }
  }
}

export function renderBrowse(route) {
  const entity = data.entities[route.entityKey];
  const localState = getViewState(route.mode, route.entityKey);
  const isBatchMode = route.mode === "roster" && (localState.presentation === "batch" || localState.presentation === "import");

  if (route.itemId) {
    localState.selectedId = route.itemId;
  } else if (isCompactLayout()) {
    localState.selectedId = null;
  }

  // The entity sub-nav is now owned by renderSidebar (called earlier in render());
  // renderBrowse no longer touches navEl.
  entityTitleEl.textContent = route.mode === "roster" ? `${entity.label} Roster` : entity.label;

  if (route.mode === "roster") {
    if (route.entityKey === legacyEntityKey) {
      entityMetaEl.textContent =
        `${data.reference.entities[route.entityKey].count} saved parents | updated ${formatDateTime(state.legacyView.updated_at || "-")}`;
    } else if (route.entityKey === buildsEntityKey) {
      entityMetaEl.textContent =
        `${data.reference.entities[route.entityKey].count} build drafts | updated ${formatDateTime(state.buildsDocument.updated_at || "-")}`;
    } else {
      const ownedCount = rosterCountForEntity(route.entityKey, (entry) => entry.owned);
      entityMetaEl.textContent =
        `${ownedCount} owned entries | ${data.reference.entities[route.entityKey].count} available in catalog | roster updated ${formatDateTime(state.rosterDocument.updated_at || "-")}`;
    }
  } else {
    entityMetaEl.textContent =
      `${data.reference.entities[route.entityKey].count} items | imported ${formatDateTime(entity.source.imported_at || "-")}`;
  }

  const isLegacySimulator = route.mode === "roster" && route.entityKey === legacyEntityKey && localState.presentation === "simulator";
  searchInput.disabled = isLegacySimulator;
  clearButton.disabled = isLegacySimulator;
  searchInput.placeholder = route.mode === "roster" ? "Search in current roster dataset" : "Search in current dataset";
  clearButton.textContent = route.mode === "roster" ? "Reset filters" : "Reset";
  searchInput.value = isLegacySimulator ? "" : localState.query;
  if (isLegacySimulator) {
    filtersEl.innerHTML = "";
  } else {
    renderFilters(route.mode, route.entityKey);
  }

  const filteredItems = getFilteredItems(route.mode, route.entityKey);
  renderBrowseActions(route, filteredItems);
  resultCountEl.textContent = isLegacySimulator
    ? `${state.legacyView.items.length} saved parents`
    : `${filteredItems.length} visible`;

  const hasLegacyDetailTarget =
    route.entityKey === legacyEntityKey &&
    (localState.presentation === "simulator" || localState.selectedId === "__new__");
  const hasBuildDetailTarget =
    route.entityKey === buildsEntityKey &&
    localState.selectedId === "__new__";

  if (localState.selectedId && localState.selectedId !== "__new__" && !filteredItems.some((item) => item.id === localState.selectedId)) {
    localState.selectedId = null;
  }

  if (!isCompactLayout() && !localState.selectedId && !isBatchMode && !(route.entityKey === legacyEntityKey && localState.presentation === "simulator")) {
    localState.selectedId = filteredItems[0]?.id || null;
  }

  const selectedItem = filteredItems.find((item) => item.id === localState.selectedId) || null;
  if (detailColumnEl) {
    detailColumnEl.hidden = isBatchMode;
  }
  document.body.classList.toggle("roster-batch-mode", isBatchMode);
  document.body.classList.toggle(
    "legacy-detail-expanded",
    route.mode === "roster" &&
      route.entityKey === legacyEntityKey &&
      localState.presentation === "parents" &&
      !isBatchMode &&
      Boolean(selectedItem || localState.selectedId === "__new__"),
  );
  document.body.classList.toggle(
    "legacy-create-active",
    route.mode === "roster" &&
      route.entityKey === legacyEntityKey &&
      localState.presentation === "parents" &&
      !isBatchMode &&
      localState.selectedId === "__new__",
  );
  syncLayoutMode(Boolean(selectedItem || hasLegacyDetailTarget || hasBuildDetailTarget) && !isBatchMode);
  renderList(route.mode, route.entityKey, filteredItems);
  renderDetail(route, selectedItem);
}

export async function apiJson(url, options) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  }

  return payload;
}

export async function apiBinary(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  }
  return response;
}

export async function loadBootstrapStatus(force) {
  const bootstrapStatusIsFresh = state.bootstrapStatusLoaded && (Date.now() - state.bootstrapStatusLoadedAt) < 10000;
  if (!force && bootstrapStatusIsFresh) {
    return;
  }

  state.bootstrapStatus = await apiJson("/api/app/bootstrap-status");
  state.bootstrapStatusLoaded = true;
  state.bootstrapStatusLoadedAt = Date.now();
}

export async function loadProfilesIndex(force) {
  if (state.profileIndexLoaded && !force) {
    return;
  }

  try {
    state.profilesIndex = normalizeProfilesIndex(await apiJson("/api/profiles"));
    state.profileIndexLoaded = true;
    state.profilesApiStatus = { kind: "ready", message: "" };
    if (!state.activeProfileId && state.profilesIndex.last_profile_id) {
      state.activeProfileId = state.profilesIndex.last_profile_id;
    }
    if (state.activeProfileId && !state.profilesIndex.profiles.some((profile) => profile.id === state.activeProfileId)) {
      state.activeProfileId = null;
      state.rosterProfileId = null;
      state.rosterDocument = normalizeRosterDocument(null);
      state.rosterViews.characters = normalizeRosterViewPayload("characters", null);
      state.rosterViews.supports = normalizeRosterViewPayload("supports", null);
      resetLegacyViewPayload();
      resetBuildsDocument();
    }
    syncSelectedProfileId();
  } catch (error) {
    state.profileIndexLoaded = false;
    state.profilesIndex = defaultProfilesIndex();
    state.selectedProfileId = null;
    state.activeProfileId = null;
    state.rosterProfileId = null;
    state.rosterDocument = normalizeRosterDocument(null);
    state.rosterViews.characters = normalizeRosterViewPayload("characters", null);
    state.rosterViews.supports = normalizeRosterViewPayload("supports", null);
    resetLegacyViewPayload();
    resetBuildsDocument();
    state.profilesApiStatus = {
      kind: "error",
      message: "Profile API unavailable. Restart the local Python server to enable profile creation and selection.",
    };
    throw error;
  }
}

export async function loadAdminJobs(force) {
  if (!force && state.adminJobs.active_job && state.adminJobs.active_job.status === "running") {
    state.adminJobs = await apiJson("/api/admin/jobs");
    return;
  }
  if (!force && state.adminJobs.recent_jobs.length) {
    return;
  }
  state.adminJobs = await apiJson("/api/admin/jobs");
}

export async function loadBackups(force) {
  if (!force && state.backups.length) {
    return;
  }
  const payload = await apiJson("/api/admin/backups");
  state.backups = asArray(payload.items);
}

export async function loadRosterForProfile(profileId, force) {
  if (!profileId) {
    state.rosterProfileId = null;
    state.rosterDocument = normalizeRosterDocument(null);
    state.rosterViews.characters = normalizeRosterViewPayload("characters", null);
    state.rosterViews.supports = normalizeRosterViewPayload("supports", null);
    resetLegacyViewPayload();
    resetBuildsDocument();
    return;
  }

  if (!force && state.rosterProfileId === profileId) {
    return;
  }

  state.rosterDocument = normalizeRosterDocument(await apiJson(`/api/profiles/${encodeURIComponent(profileId)}/roster`));
  state.rosterProfileId = profileId;
  state.rosterStatus = { kind: "idle", message: "" };
}

// The roster save is a whole-document PUT: last writer wins. A stale tab
// (another window, or an assistant verification session) that saves an old
// document silently resurrects entries deleted elsewhere — observed in real
// use. Every mutation flow therefore refreshes the document from the server
// first, so its changes land on top of the latest saved state.
export async function refreshRosterFromServer() {
  if (!state.activeProfileId) {
    return;
  }
  try {
    const serverRoster = await apiJson(`/api/profiles/${encodeURIComponent(state.activeProfileId)}/roster`);
    state.rosterDocument = normalizeRosterDocument(serverRoster);
    state.rosterProfileId = state.activeProfileId;
  } catch {
    // Server unreachable: keep the local document; the save itself will
    // fail and resync through persistRosterDocument's error path.
  }
}

export async function loadRosterViewsForProfile(profileId, force) {
  if (!profileId) {
    state.rosterViews.characters = normalizeRosterViewPayload("characters", null);
    state.rosterViews.supports = normalizeRosterViewPayload("supports", null);
    return;
  }

  const entitiesToLoad = ["characters", "supports"].filter((entityKey) => {
    const payload = getRosterViewPayload(entityKey);
    return force || payload.profile_id !== profileId;
  });

  if (!entitiesToLoad.length) {
    return;
  }

  const payloads = await Promise.all(
    entitiesToLoad.map((entityKey) => apiJson(`/api/profiles/${encodeURIComponent(profileId)}/roster-view/${encodeURIComponent(entityKey)}`)),
  );

  entitiesToLoad.forEach((entityKey, index) => {
    state.rosterViews[entityKey] = normalizeRosterViewPayload(entityKey, payloads[index]);
  });
}

export async function createProfileAndOpen(name) {
  const payload = await apiJson("/api/profiles", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  state.profilesIndex = normalizeProfilesIndex(payload.profiles);
  state.profileIndexLoaded = true;
  state.selectedProfileId = payload.created_profile.id;
  await loadBootstrapStatus(true);
  await openProfile(payload.created_profile.id, true);
}

export async function deleteProfileAndRefresh(profileId) {
  state.profilesIndex = normalizeProfilesIndex(await apiJson(`/api/profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE",
  }));
  state.profileIndexLoaded = true;

  if (state.activeProfileId === profileId) {
    state.activeProfileId = null;
    state.rosterProfileId = null;
    state.rosterDocument = normalizeRosterDocument(null);
    state.rosterViews.characters = normalizeRosterViewPayload("characters", null);
    state.rosterViews.supports = normalizeRosterViewPayload("supports", null);
    resetLegacyViewPayload();
    resetBuildsDocument();
  }
  if (state.wizardProfileId === profileId) {
    state.wizardProfileId = null;
  }

  syncSelectedProfileId();
  await loadBootstrapStatus(true);
  setProfilesHash();
}

export async function renameProfileAndRefresh(profileId, name) {
  const payload = await apiJson(`/api/profiles/${encodeURIComponent(profileId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  state.profilesIndex = normalizeProfilesIndex(payload.profiles);
  state.profileIndexLoaded = true;
  if (state.activeProfileId === profileId) {
    const updated = state.profilesIndex.profiles.find((profile) => profile.id === profileId);
    if (updated) {
      activeProfileNameEl.textContent = updated.name;
    }
  }
  syncSelectedProfileId();
  requestRender();
}

export async function importProfileArchive(file) {
  const response = await apiBinary("/api/profiles/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/zip",
    },
    body: file,
  });
  const payload = await response.json();
  state.profilesIndex = normalizeProfilesIndex(payload.profiles);
  state.profileIndexLoaded = true;
  state.selectedProfileId = payload.created_profile.id;
  await loadBootstrapStatus(true);
  return payload.created_profile;
}


export function showAppToast(message, kind = "success") {
  const previousToast = document.getElementById("appToast");
  if (previousToast) {
    previousToast.remove();
  }
  const toast = document.createElement("div");
  toast.id = "appToast";
  toast.className = `app-toast app-toast-${kind}`;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("visible");
  }, 20);
  window.setTimeout(() => {
    toast.classList.remove("visible");
    window.setTimeout(() => toast.remove(), 220);
  }, 3400);
}

export async function persistRosterDocument(successMessage, scope = null) {
  if (!state.activeProfileId) {
    return;
  }

  state.rosterStatusScope = scope;
  state.rosterStatus = { kind: "saving", message: "Saving locally..." };
  requestRender();

  try {
    const savedRoster = await apiJson(`/api/profiles/${encodeURIComponent(state.activeProfileId)}/roster`, {
      method: "PUT",
      body: JSON.stringify(state.rosterDocument),
    });
    state.rosterDocument = normalizeRosterDocument(savedRoster);
    state.rosterProfileId = state.activeProfileId;
    await loadRosterViewsForProfile(state.activeProfileId, true);
    state.rosterStatus = {
      kind: "saved",
      message: successMessage || `Saved locally on ${formatDateTime(state.rosterDocument.updated_at)}.`,
    };
  } catch (error) {
    state.rosterStatus = {
      kind: "error",
      message: error.message || "Could not save the local roster entry.",
    };
    // The caller mutated the local document BEFORE this save; keeping the
    // rejected mutation would poison every later save from any screen (a
    // whole-document PUT — observed in real use with an invalid
    // unique_level blocking support saves). Resync from the server, which
    // still holds the last valid state; keep the error message visible.
    try {
      const serverRoster = await apiJson(`/api/profiles/${encodeURIComponent(state.activeProfileId)}/roster`);
      state.rosterDocument = normalizeRosterDocument(serverRoster);
      state.rosterProfileId = state.activeProfileId;
    } catch {
      // Server unreachable: nothing to resync from.
    }
  }

  requestRender();
}

export async function saveRosterForm(entityKey, item, formEl) {
  const nextEntry = collectRosterFormData(entityKey, item, formEl);
  await refreshRosterFromServer();
  setRosterEntry(entityKey, item, nextEntry);
  await persistRosterDocument(`Saved locally on ${formatDateTime(new Date().toISOString())}.`, `${entityKey}:${item.id}`);
}

export async function addItemToRoster(entityKey, item) {
  await refreshRosterFromServer();
  const currentEntry = getRosterEntry(entityKey, item);
  setRosterEntry(entityKey, item, {
    ...currentEntry,
    owned: true,
  });
  await persistRosterDocument("Added to My Roster.");
}

export async function removeItemFromRoster(entityKey, item) {
  await refreshRosterFromServer();
  const bucket = { ...(state.rosterDocument[entityKey] || {}) };
  delete bucket[item.id];
  state.rosterDocument = {
    ...state.rosterDocument,
    [entityKey]: bucket,
  };
  await persistRosterDocument("Removed from My Roster.");

  const route = currentRouteState();
  if (route.page === "browse" && route.mode === "roster" && route.entityKey === entityKey && route.itemId === item.id) {
    setBrowseHash("roster", entityKey, null);
  }
}

export async function resetRosterEntry(entityKey, item) {
  await refreshRosterFromServer();
  const bucket = { ...(state.rosterDocument[entityKey] || {}) };
  delete bucket[item.id];
  state.rosterDocument = {
    ...state.rosterDocument,
    [entityKey]: bucket,
  };
  setRosterEntry(entityKey, item, {
    ...getDefaultRosterEntry(entityKey, item),
    owned: true,
  });
  await persistRosterDocument("Owned roster entry reset to defaults.");
}

export async function render() {
  const token = ++state.renderToken;

  await loadProfilesIndex(false);
  await loadBootstrapStatus(false);
  if (token !== state.renderToken) {
    return;
  }

  const route = currentRouteState();

  if (!state.bootstrapStatus?.has_profiles) {
    if (route.page !== "wizard") {
      setWizardHash();
      return;
    }
  } else if (route.page === "wizard" && !state.wizardProfileId) {
    if (state.bootstrapStatus.recommended_entry === "roster" && state.profilesIndex.last_profile_id) {
      state.activeProfileId = state.profilesIndex.last_profile_id;
      setHomeHash();
    } else {
      setProfilesHash();
    }
    return;
  }

  if (route.page === "admin") {
    await refreshAdminData(true);
    if (token !== state.renderToken) {
      return;
    }
  } else if (route.page === "wizard" && state.adminJobs.active_job?.status === "running") {
    await refreshAdminData(true);
    if (token !== state.renderToken) {
      return;
    }
  }

  if (!hasLoadedReferenceBundle && state.bootstrapStatus?.has_reference_meta && state.bootstrapStatus?.has_reference_db) {
    window.location.reload();
    return;
  }

  const loadedReferenceGeneratedAt = getLoadedReferenceGeneratedAt();
  const availableReferenceGeneratedAt = String(state.bootstrapStatus?.reference_generated_at || "");
  if (
    hasLoadedReferenceBundle &&
    loadedReferenceGeneratedAt &&
    availableReferenceGeneratedAt &&
    loadedReferenceGeneratedAt < availableReferenceGeneratedAt
  ) {
    window.location.reload();
    return;
  }

  if (route.page === "wizard" && state.wizardProfileId && state.wizardStep === "build") {
    const updateJob = state.adminJobs.active_job?.type === "update" ? state.adminJobs.active_job : null;
    const needsReferenceBuild = wizardNeedsReferenceBuild();

    if (updateJob?.status === "failed") {
      state.wizardBuildAutoStarted = false;
    }

    if (needsReferenceBuild && !updateJob && !state.wizardBuildAutoStarted) {
      state.wizardBuildAutoStarted = true;
      state.wizardBuildStartedAt = Date.now();
      await runAdminJob("Local base creation", "/api/admin/jobs/update");
      await refreshAdminData(true);
      if (token !== state.renderToken) {
        return;
      }
    }

    if (!needsReferenceBuild && !state.wizardRedirectScheduled) {
      state.wizardRedirectScheduled = true;
      window.setTimeout(() => {
        if (currentRouteState().page === "wizard" && state.wizardProfileId) {
          openProfile(state.wizardProfileId, true).catch((error) => {
            state.adminStatus = { kind: "error", message: error.message || "Could not open the new profile." };
            requestRender();
          });
        }
      }, 700);
    }
  }

  const needsRosterData = route.page === "browse" || route.page === "home" || route.page === "prep";

  if (needsRosterData && !state.activeProfileId) {
    if (state.profilesIndex.last_profile_id) {
      state.activeProfileId = state.profilesIndex.last_profile_id;
    } else {
      setProfilesHash();
      return;
    }
  }

  if (needsRosterData && state.activeProfileId) {
    await loadRosterForProfile(state.activeProfileId, false);
    await loadRosterViewsForProfile(state.activeProfileId, false);
    await loadLegacyForProfile(state.activeProfileId, false);
    await loadBuildsForProfile(state.activeProfileId, false);
    await loadRunsForProfile(state.activeProfileId, false);
    if (token !== state.renderToken) {
      return;
    }
  }

  syncHeader(route);
  renderSidebar(route);
  syncShellVisibility(route);

  if (route.page === "profiles" || route.page === "wizard" || route.page === "admin" || route.page === "home" || route.page === "prep") {
    renderProfileGate(route);
    syncLayoutMode(false);
    window.requestAnimationFrame(syncToolbarMetrics);
    if ((route.page === "wizard" || route.page === "admin") && state.adminJobs.active_job?.status === "running") {
      window.setTimeout(() => {
        if (currentRouteState().page === route.page) {
          requestRender();
        }
      }, 2000);
    }
    return;
  }

  renderBrowse(route);
  window.requestAnimationFrame(syncToolbarMetrics);
}

export function requestRender() {
  return render().catch((error) => {
    console.error(error);
    const route = currentRouteState();
    if (route.page === "profiles" || route.page === "wizard" || route.page === "admin" || route.page === "home" || route.page === "prep") {
      syncShellVisibility(route);
      renderSidebar(route);
      renderProfileGate(route);
      window.requestAnimationFrame(syncToolbarMetrics);
      return;
    }
    detailEl.innerHTML = `<div class="detail-empty">Unexpected error: ${escapeHtml(error.message || String(error))}</div>`;
  });
}

export function requestRenderPreservingScroll() {
  const windowScrollY = window.scrollY;
  const detailScrollTop = detailPanelEl ? detailPanelEl.scrollTop : null;
  requestRender().finally(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: windowScrollY });
      if (detailPanelEl && detailScrollTop != null) {
        detailPanelEl.scrollTop = detailScrollTop;
      }
    });
  });
}

export function requestRenderPreservingScrollAndFocus(elementId) {
  const focusTarget = document.getElementById(elementId);
  const selectionStart = typeof focusTarget?.selectionStart === "number" ? focusTarget.selectionStart : null;
  const selectionEnd = typeof focusTarget?.selectionEnd === "number" ? focusTarget.selectionEnd : null;
  requestRenderPreservingScroll();
  window.requestAnimationFrame(() => {
    const nextTarget = document.getElementById(elementId);
    if (!nextTarget) {
      return;
    }
    nextTarget.focus({ preventScroll: true });
    if (selectionStart != null && selectionEnd != null && typeof nextTarget.setSelectionRange === "function") {
      nextTarget.setSelectionRange(selectionStart, selectionEnd);
    }
  });
}


// Deferred via queueMicrotask below instead of running inline: app.js and
// core.js import from each other (core.js needs requestRender for its hash
// setters), and this file's top-level wiring reads core.js bindings like
// `searchInput` and `state`. With that cycle, running this code at module
// top level can throw "Cannot access 'x' before initialization" depending on
// module evaluation order. queueMicrotask guarantees the whole module graph
// (including the cyclic parts) has finished evaluating first. If you add a
// new top-level side effect here that touches an imported binding, keep it
// inside boot(), not at file scope.
function boot() {
  searchInput.addEventListener("input", () => {
    const route = currentRouteState();
    if (route.page !== "browse") {
      return;
    }
    getViewState(route.mode, route.entityKey).query = searchInput.value;
    requestRender();
  });

  clearButton.addEventListener("click", () => {
    const route = currentRouteState();
    if (route.page !== "browse") {
      return;
    }
    const preservedPresentation = getViewState(route.mode, route.entityKey).presentation;
    viewStateByKey[`${route.mode}:${route.entityKey}`] = createEntityState(route.mode, route.entityKey);
    if (route.mode === "roster") {
      viewStateByKey[`${route.mode}:${route.entityKey}`].presentation = preservedPresentation;
    }
    requestRender();
  });

  if (changeProfileButton) {
    changeProfileButton.addEventListener("click", () => {
      setProfilesHash();
    });
  }

  if (adminButton) {
    adminButton.addEventListener("click", () => {
      setAdminHash();
    });
  }

  if (backToTopButton) {
    backToTopButton.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  globalBuild.textContent = formatDateTime(data.reference.generated_at || "-");

  // Debounced resize: only needs to refresh toolbar metrics on drag; layout-tier
  // changes are handled deterministically by the compactLayoutQuery listener.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.requestAnimationFrame(syncToolbarMetrics);
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => requestRender(), 150);
  });
  // Crossing the compact threshold re-renders immediately so the auto-select /
  // detail-flip logic in renderBrowse re-evaluates without waiting on the debounce.
  compactLayoutQuery.addEventListener("change", () => requestRender());
  window.addEventListener("scroll", syncBackToTopVisibility, { passive: true });
  window.addEventListener("hashchange", requestRender);

  // Off-canvas sidebar: the toggle/backdrop use inline onclick handlers (see
  // index.html) that call window.umaSidebar, so no element binding is needed here.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  });
  // Any navigation (all sidebar links mutate the hash) closes the overlay.
  window.addEventListener("hashchange", closeSidebar);
  // Leaving overlay mode (widening past the rail threshold) resets the state.
  const sidebarOverlayQuery = window.matchMedia("(max-width: 1440px)");
  sidebarOverlayQuery.addEventListener("change", (event) => {
    if (!event.matches) {
      closeSidebar();
    }
  });

  if (!window.location.hash) {
    setProfilesHash();
  } else {
    requestRender();
  }

  syncBackToTopVisibility();
}

queueMicrotask(boot);

