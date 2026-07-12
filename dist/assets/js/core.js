// Auto-split from app.js as part of docs/REFACTOR_PLAN.md.
import { clampNumber, escapeHtml } from "./dom-utils.js";
import { getRosterEntry } from "./roster.js";
import { requestRender } from "../app.js";


export function createEmptyReferenceBundle() {
  const entitySpecs = [
    ["characters", "Characters"],
    ["supports", "Supports"],
    ["skills", "Skills"],
    ["races", "Races"],
    ["racetracks", "Racetracks"],
    ["g1_factors", "G1 Factors"],
    ["cm_targets", "CM Targets"],
    ["scenarios", "Scenarios"],
    ["training_events", "Training Events"],
    ["compatibility", "Compatibility"],
  ];

  const entities = Object.fromEntries(
    entitySpecs.map(([key, label]) => [
      key,
      {
        key,
        label,
        count: 0,
        items: [],
        filter_definitions: [],
        filter_options: {},
        source: {
          imported_at: "",
          page_urls: [],
        },
        model: {},
      },
    ]),
  );

  return {
    generated_at: null,
    reference: {
      generated_at: null,
      entities: Object.fromEntries(entitySpecs.map(([key]) => [key, { count: 0 }])),
    },
    entities,
  };
}

export const hasLoadedReferenceBundle = Boolean(window.UMA_REFERENCE_DATA);
export const data = window.UMA_REFERENCE_DATA || createEmptyReferenceBundle();
export const profileBackgroundMediaEl = document.getElementById("profileBackgroundMedia");
export const profileBackgroundVideoEl = document.getElementById("profileBackgroundVideo");
export const appSidebarEl = document.getElementById("appSidebar");
export const sidebarSectionsEl = document.getElementById("sidebarSections");
export const topHeaderEl = document.getElementById("topHeader");
export const pageTitleEl = document.getElementById("pageTitle");
export const summaryText = document.getElementById("summaryText");
export const globalBuild = document.getElementById("globalBuild");
export const lastBuildBlock = document.getElementById("lastBuildBlock");
export const activeProfileBlock = document.getElementById("activeProfileBlock");
export const activeProfileNameEl = document.getElementById("activeProfileName");
export const changeProfileButton = document.getElementById("changeProfileButton");
export const adminButton = document.getElementById("adminButton");
export const profileGateEl = document.getElementById("profileGate");
export const datasetBarEl = document.getElementById("datasetBar");
export const datasetHeadingEl = document.getElementById("datasetHeading");
export const navEl = document.getElementById("entityNav");
export const toolbarEl = document.getElementById("toolbar");
export const entityTitleEl = document.getElementById("entityTitle");
export const entityMetaEl = document.getElementById("entityMeta");
export const browseActionsEl = document.getElementById("browseActions");
export const resultCountEl = document.getElementById("resultCount");
export const listEl = document.getElementById("list");
export const detailEl = document.getElementById("detail");
export const detailPanelEl = document.querySelector(".detail-panel");
export const detailColumnEl = document.getElementById("detailColumn");
export const resultsPanelEl = document.getElementById("resultsPanel");
export const filtersEl = document.getElementById("filters");
export const searchInput = document.getElementById("searchInput");
export const clearButton = document.getElementById("clearButton");
export const backToTopButton = document.getElementById("backToTopButton");
export const compactLayoutQuery = window.matchMedia("(max-width: 1100px)");

export const referenceEntityKeys = Object.keys(data.entities);
export const legacyEntityKey = "legacy";
export const buildsEntityKey = "builds";
export const rosterEntityKeys = ["characters", "supports", legacyEntityKey, buildsEntityKey];
// Collection sub-nav = roster minus builds (builds now lives under the "CM Prep"
// section). This is a view-layer grouping only; allowedEntityKeys("roster") keeps
// returning the full tested list, so the route model / tests are untouched.
export const collectionEntityKeys = ["characters", "supports", legacyEntityKey];
export const inlineMediaEntityKeys = new Set(["characters", "skills", "supports"]);
export const rosterFilterDefinitionsBase = [
  { key: "_roster_favorite", label: "Favorites" },
  { key: "_roster_note", label: "Has note" },
  { key: "_roster_tag", label: "Tags" },
  { key: "_roster_status", label: "Status" },
  { key: "_roster_progress", label: "Progress" },
];
export const TRAINING_EVENT_EFFECT_LABELS = {
  37: "Extra Tank hint +1",
  38: "Friendship +5",
  39: "Guts +15",
  40: "Energy +10",
  41: "Mood +1",
  42: "Energy -10",
  43: "Stamina +15",
  44: "Skill Pt +15",
  45: "Speed +10",
  46: "Stamina +5",
  47: "Left-Handed hint +1",
  48: "Speed +5",
  49: "Wisdom +5",
  50: "Speed +15",
  51: "Friendship +5",
  52: "Guts +10",
  53: "Pace Chaser Straightaways hint +1",
  54: "Early Lead hint +1",
  55: "Energy +5",
};
export const LEGACY_KIND_LABELS = {
  stat: "Stat",
  surface: "Surface",
  distance: "Distance",
  style: "Style",
  unique: "Unique",
  scenario: "Scenario",
  g1: "G1",
  skill: "Skill",
};
export const LEGACY_STAT_OPTIONS = [
  { value: "speed", label: "Speed" },
  { value: "stamina", label: "Stamina" },
  { value: "power", label: "Power" },
  { value: "guts", label: "Guts" },
  { value: "wit", label: "Wit" },
];
export const LEGACY_SURFACE_OPTIONS = [
  { value: "turf", label: "Turf" },
  { value: "dirt", label: "Dirt" },
];
export const LEGACY_DISTANCE_OPTIONS = [
  { value: "short", label: "Short" },
  { value: "mile", label: "Mile" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];
export const LEGACY_STYLE_OPTIONS = [
  { value: "runner", label: "Front" },
  { value: "leader", label: "Pace" },
  { value: "betweener", label: "Late" },
  { value: "chaser", label: "End" },
];
export const LEGACY_PINK_KIND_OPTIONS = [
  { value: "surface", label: "Surface" },
  { value: "distance", label: "Distance" },
  { value: "style", label: "Style" },
];
export const LEGACY_WHITE_KIND_OPTIONS = [
  { value: "scenario", label: "Scenario" },
  { value: "g1", label: "G1" },
  { value: "skill", label: "Skill" },
];
export const LEGACY_SCENARIO_FALLBACK_OPTIONS = [
  { value: "scenario_ura", label: "URA Finale" },
  { value: "scenario_aoharu", label: "Aoharu Cup" },
  { value: "scenario_make_a_new_track", label: "Make a New Track" },
  { value: "scenario_gl", label: "Grand Live" },
  { value: "scenario_gm", label: "Grand Masters" },
  { value: "scenario_larc", label: "Project L'Arc" },
  { value: "scenario_uaf", label: "U.A.F. Ready GO!" },
  { value: "scenario_cooking", label: "Harvest Festival" },
  { value: "scenario_mecha", label: "Run! Mecha Umamusume" },
  { value: "scenario_legend", label: "Twinkle Legends" },
];
export const LEGACY_RATING_OPTIONS = [
  { value: "", label: "Unknown" },
  { value: "G", label: "G" },
  { value: "F", label: "F" },
  { value: "E", label: "E" },
  { value: "E+", label: "E+" },
  { value: "D", label: "D" },
  { value: "D+", label: "D+" },
  { value: "C", label: "C" },
  { value: "C+", label: "C+" },
  { value: "B", label: "B" },
  { value: "B+", label: "B+" },
  { value: "A", label: "A" },
  { value: "A+", label: "A+" },
  { value: "S", label: "S" },
  { value: "S+", label: "S+" },
  { value: "SS", label: "SS" },
  { value: "SS+", label: "SS+" },
  { value: "UF", label: "UF" },
  { value: "UG", label: "UG" },
  { value: "UE", label: "UE" },
];
export const BUILD_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "planned", label: "Planned" },
  { value: "testing", label: "Testing" },
  { value: "done", label: "Done" },
  { value: "archived", label: "Archived" },
];
export const BUILD_MODE_OPTIONS = [
  { value: "champions_meeting", label: "Champions Meeting" },
  { value: "freeform", label: "Freeform" },
];
export const BUILD_STAT_FIELDS = [
  { key: "speed", label: "Speed" },
  { key: "stamina", label: "Stamina" },
  { key: "power", label: "Power" },
  { key: "guts", label: "Guts" },
  { key: "wit", label: "Wisdom" },
];
export const BUILD_APTITUDE_FIELDS = [
  { key: "surface", label: "Surface" },
  { key: "distance", label: "Distance" },
  { key: "style", label: "Style" },
];
export const BUILD_APTITUDE_GRADES = ["", "S", "A", "B", "C", "D", "E", "F", "G"];

export function renderGradeBadge(grade) {
  const normalized = String(grade || "").toUpperCase();
  if (!BUILD_APTITUDE_GRADES.includes(normalized) || !normalized) {
    return escapeHtml(grade ?? "-");
  }
  return `<span class="grade-badge" data-grade="${normalized}">${normalized}</span>`;
}

export const BUILD_RUNNING_STYLE_OPTIONS = [
  { value: "", label: "Not chosen" },
  { value: "runner", label: "Front Runner" },
  { value: "leader", label: "Pace Chaser" },
  { value: "betweener", label: "Late Surger" },
  { value: "chaser", label: "End Closer" },
];
export const BUILD_SUPPORT_TYPES = [
  { value: "", label: "All support types" },
  { value: "speed", label: "Speed" },
  { value: "stamina", label: "Stamina" },
  { value: "power", label: "Power" },
  { value: "guts", label: "Guts" },
  { value: "wit", label: "Wisdom" },
  { value: "friend", label: "Friend" },
  { value: "group", label: "Group" },
];

export function createEmptyLegacySparkState() {
  return {
    characterCardId: "",
    blueTargetKey: "speed",
    blueStars: 3,
    pinkKind: "surface",
    pinkTargetKey: "turf",
    pinkQuery: "",
    pinkStars: 3,
    greenEnabled: false,
    greenStars: 3,
    whiteSparks: [],
    whiteKind: "skill",
    whiteTargetKey: "",
    whiteQuery: "",
    whiteStars: 3,
  };
}

export function createEmptyLegacyRelativeState() {
  return createEmptyLegacySparkState();
}

export function createEmptyLegacyEditorState() {
  return {
    targetKey: null,
    ...createEmptyLegacySparkState(),
    grandparents: {
      left: createEmptyLegacyRelativeState(),
      right: createEmptyLegacyRelativeState(),
    },
  };
}

export function createLegacyEntity() {
  return {
    key: legacyEntityKey,
    label: "Legacy",
    count: 0,
    items: [],
    filter_definitions: [],
    filter_options: {},
    source: {
      imported_at: "",
      page_urls: [],
    },
    model: {},
  };
}

export function createBuildsEntity() {
  return {
    key: buildsEntityKey,
    label: "Builds",
    count: 0,
    items: [],
    filter_definitions: [
      { key: "status", label: "Status" },
      { key: "mode", label: "Mode" },
      { key: "tag", label: "Tags" },
    ],
    filter_options: {},
    source: {
      imported_at: "",
      page_urls: [],
    },
    model: {},
  };
}

if (!data.entities[legacyEntityKey]) {
  data.entities[legacyEntityKey] = createLegacyEntity();
}
if (!data.entities[buildsEntityKey]) {
  data.entities[buildsEntityKey] = createBuildsEntity();
}
if (!data.reference) {
  data.reference = { generated_at: null, entities: {} };
}
if (!data.reference.entities) {
  data.reference.entities = {};
}
if (!data.reference.entities[legacyEntityKey]) {
  data.reference.entities[legacyEntityKey] = { count: 0 };
}
if (!data.reference.entities[buildsEntityKey]) {
  data.reference.entities[buildsEntityKey] = { count: 0 };
}

export const state = {
  profileIndexLoaded: false,
  profilesIndex: { version: 1, last_profile_id: null, profiles: [] },
  selectedProfileId: null,
  activeProfileId: null,
  bootstrapStatusLoaded: false,
  bootstrapStatus: null,
  bootstrapStatusLoadedAt: 0,
  rosterDocument: normalizeRosterDocument(null),
  rosterProfileId: null,
  rosterViews: {
    characters: { profile_id: null, entity: "characters", updated_at: "", entries: {} },
    supports: { profile_id: null, entity: "supports", updated_at: "", entries: {} },
  },
  legacyView: { profile_id: null, updated_at: "", items: [], filter_definitions: [], filter_options: {} },
  legacyStatus: { kind: "idle", message: "" },
  legacyEditor: createEmptyLegacyEditorState(),
  legacyCreateStep: 1,
  legacyFormDraft: null,
  legacySimulator: {
    main_character_id: "",
    parent_a_legacy_id: "",
    parent_b_legacy_id: "",
    active_slot: "parent_a",
    preview: null,
    status: { kind: "idle", message: "" },
  },
  buildsDocument: normalizeBuildsDocument(null, null),
  buildsProfileId: null,
  buildsStatus: { kind: "idle", message: "" },
  // Run results: the real outcome of executing a build. Displayed inside the
  // build's editor as a "Runs" tab, so they are not a top-level nav entity —
  // just a per-profile document kept alongside builds.
  runsDocument: { version: 1, updated_at: "", entries: [] },
  runsProfileId: null,
  runsStatus: { kind: "idle", message: "" },
  // One-shot seed for a pre-filled build draft, set by the CM-target
  // recommendation flow (build_recommender) before routing to "__new__".
  // createEmptyBuildEntry() consumes and clears it.
  pendingBuildSeed: null,
  buildEditor: {
    targetKey: null,
    draft: null,
    skillQuery: "",
    supportType: "",
    showAllSupports: false,
    showAllCharacters: false,
    showAllParents: false,
    // Which refinement tab of the build editor form is visible. All fields
    // stay in the DOM (CSS show/hide) so FormData capture is unaffected.
    activeFormTab: "setup",
  },
  rosterStatus: { kind: "idle", message: "" },
  // Which form triggered the last roster save ("<entityKey>:<itemId>", or
  // null for bulk flows). Detail panels only display rosterStatus when it is
  // theirs — a failed character save must not surface in a support panel.
  rosterStatusScope: null,
  // Screenshot-based roster import (docs/ROSTER_IMPORT_PLAN.md), one slot per
  // importable entity. Reference fingerprints live in memory (hydrated from
  // localStorage); results carry the reviewed rows of the reconciliation table.
  rosterImport: {
    supports: {
      status: { kind: "idle", message: "" },
      fingerprints: null,
      fingerprintsVersion: "",
      learned: null,
      building: false,
      processing: false,
      results: [],
    },
    characters: {
      status: { kind: "idle", message: "" },
      fingerprints: null,
      fingerprintsVersion: "",
      learned: null,
      building: false,
      processing: false,
      results: [],
    },
  },
  profilesApiStatus: { kind: "idle", message: "" },
  adminJobs: { active_job: null, recent_jobs: [] },
  backups: [],
  adminStatus: { kind: "idle", message: "" },
  wizardProfileId: null,
  wizardStep: "create",
  wizardBuildStartedAt: null,
  wizardBuildAutoStarted: false,
  wizardRedirectScheduled: false,
  renderToken: 0,
};

export const viewStateByKey = {};
export const skillReferenceIndex = buildSkillReferenceIndex();

export function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}

export function defaultProfilesIndex() {
  return {
    version: 1,
    last_profile_id: null,
    profiles: [],
  };
}

export function normalizeProfilesIndex(payload) {
  if (!payload || typeof payload !== "object") {
    return defaultProfilesIndex();
  }

  const profiles = asArray(payload.profiles)
    .filter((profile) => profile && profile.id && profile.name)
    .map((profile) => ({
      id: String(profile.id),
      name: String(profile.name),
      created_at: profile.created_at || "",
      updated_at: profile.updated_at || "",
    }));

  const profileIds = profiles.map((profile) => profile.id);
  return {
    version: 1,
    last_profile_id: profileIds.includes(payload.last_profile_id) ? payload.last_profile_id : null,
    profiles,
  };
}

export function normalizeRosterDocument(payload) {
  const roster = payload && typeof payload === "object" ? payload : {};
  return {
    version: 1,
    updated_at: roster.updated_at || "",
    characters: roster.characters && typeof roster.characters === "object" ? roster.characters : {},
    supports: roster.supports && typeof roster.supports === "object" ? roster.supports : {},
  };
}

export function normalizeRosterViewPayload(entityKey, payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const entries = safePayload.entries && typeof safePayload.entries === "object" ? safePayload.entries : {};
  return {
    profile_id: safePayload.profile_id || null,
    entity: entityKey,
    updated_at: safePayload.updated_at || "",
    entries,
  };
}

export function normalizeLegacyViewPayload(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  return {
    profile_id: safePayload.profile_id || null,
    updated_at: safePayload.updated_at || "",
    items: asArray(safePayload.items).filter((item) => item && item.id),
    filter_definitions: asArray(safePayload.filter_definitions),
    filter_options: safePayload.filter_options && typeof safePayload.filter_options === "object" ? safePayload.filter_options : {},
  };
}

export function createEmptyLegacyViewPayload(profileId = null) {
  return {
    profile_id: profileId,
    updated_at: "",
    items: [],
    filter_definitions: [],
    filter_options: {},
  };
}

export function applyLegacyViewPayload(payload) {
  state.legacyView = normalizeLegacyViewPayload(payload);
  data.entities[legacyEntityKey] = {
    ...createLegacyEntity(),
    items: state.legacyView.items,
    count: state.legacyView.items.length,
    filter_definitions: state.legacyView.filter_definitions,
    filter_options: state.legacyView.filter_options,
    source: {
      imported_at: state.legacyView.updated_at,
      page_urls: [],
    },
  };
  data.reference.entities[legacyEntityKey] = { count: state.legacyView.items.length };
}

export function resetLegacyViewPayload() {
  applyLegacyViewPayload(createEmptyLegacyViewPayload());
  state.legacyEditor = createEmptyLegacyEditorState();
  state.legacySimulator = {
    main_character_id: "",
    parent_a_legacy_id: "",
    parent_b_legacy_id: "",
    active_slot: "parent_a",
    preview: null,
    status: { kind: "idle", message: "" },
  };
}

export function normalizeBuildEntry(rawEntry) {
  const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
  return {
    id: String(entry.id || ""),
    mode: String(entry.mode || "champions_meeting"),
    name: String(entry.name || ""),
    target_id: String(entry.target_id || ""),
    character_id: String(entry.character_id || ""),
    scenario_id: String(entry.scenario_id || ""),
    running_style: String(entry.running_style || ""),
    support_deck: asArray(entry.support_deck).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6),
    legacy_pair: entry.legacy_pair && typeof entry.legacy_pair === "object" ? {
      parent_a: String(entry.legacy_pair.parent_a || ""),
      parent_b: String(entry.legacy_pair.parent_b || ""),
    } : {},
    target_stats: entry.target_stats && typeof entry.target_stats === "object" ? entry.target_stats : {},
    target_aptitudes: entry.target_aptitudes && typeof entry.target_aptitudes === "object" ? entry.target_aptitudes : {},
    required_skills: asArray(entry.required_skills).map((item) => String(item || "").trim()).filter(Boolean),
    optional_skills: asArray(entry.optional_skills).map((item) => String(item || "").trim()).filter(Boolean),
    status: String(entry.status || "draft"),
    notes: String(entry.notes || ""),
    custom_tags: asArray(entry.custom_tags).map((item) => String(item || "").trim()).filter(Boolean),
    created_at: String(entry.created_at || ""),
    updated_at: String(entry.updated_at || ""),
  };
}

export function normalizeBuildsDocument(payload, profileId) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  return {
    version: 1,
    profile_id: profileId || null,
    updated_at: safePayload.updated_at || "",
    entries: asArray(safePayload.entries).map(normalizeBuildEntry).filter((entry) => entry.id),
  };
}

export function createEmptyBuildsDocument(profileId = null) {
  return {
    version: 1,
    profile_id: profileId,
    updated_at: "",
    entries: [],
  };
}

export function getBuildReferenceLabel(entityKey, id) {
  const resolvedId = String(id || "").trim();
  if (!resolvedId) {
    return "";
  }
  const item = getEntityItems(entityKey).find((entry) => String(entry.id) === resolvedId);
  return item ? (item.subtitle ? `${item.title} ${item.subtitle}` : item.title) : resolvedId;
}

export function getBuildLegacyLabel(legacyId) {
  const item = state.legacyView.items.find((entry) => entry.id === legacyId);
  return item ? (item.subtitle ? `${item.title} ${item.subtitle}` : item.title) : String(legacyId || "");
}

export function getBuildFilterOptions(entries) {
  const statusCounts = new Map();
  const modeCounts = new Map();
  const tagCounts = new Map();
  entries.forEach((entry) => {
    if (entry.status) {
      statusCounts.set(entry.status, (statusCounts.get(entry.status) || 0) + 1);
    }
    if (entry.mode) {
      modeCounts.set(entry.mode, (modeCounts.get(entry.mode) || 0) + 1);
    }
    entry.custom_tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  });

  const fromCounts = (counts, labelMap = {}) => Array.from(counts.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([value, count]) => ({ value, label: labelMap[value] || value, count }));

  return {
    status: fromCounts(statusCounts, Object.fromEntries(BUILD_STATUS_OPTIONS.map((option) => [option.value, option.label]))),
    mode: fromCounts(modeCounts, Object.fromEntries(BUILD_MODE_OPTIONS.map((option) => [option.value, option.label]))),
    tag: fromCounts(tagCounts),
  };
}

export function buildItemFromEntry(entry) {
  const modeLabel = BUILD_MODE_OPTIONS.find((option) => option.value === entry.mode)?.label || entry.mode;
  const statusLabel = BUILD_STATUS_OPTIONS.find((option) => option.value === entry.status)?.label || entry.status;
  const targetLabel = getBuildReferenceLabel("cm_targets", entry.target_id);
  const characterLabel = getBuildReferenceLabel("characters", entry.character_id);
  const scenarioLabel = getBuildReferenceLabel("scenarios", entry.scenario_id);
  const parentLabels = [entry.legacy_pair.parent_a, entry.legacy_pair.parent_b].filter(Boolean).map(getBuildLegacyLabel);
  const title = entry.name || "Build draft";
  const subtitleParts = [statusLabel, targetLabel || "No CM target", characterLabel || "No character"].filter(Boolean);
  const searchText = [
    title,
    subtitleParts.join(" "),
    modeLabel,
    scenarioLabel,
    parentLabels.join(" "),
    entry.custom_tags.join(" "),
    entry.notes,
  ].join(" ");

  return {
    id: entry.id,
    title,
    subtitle: subtitleParts.join(" | "),
    badges: [statusLabel, modeLabel, ...entry.custom_tags].filter(Boolean),
    filters: {
      status: entry.status,
      mode: entry.mode,
      tag: entry.custom_tags,
    },
    search_text: searchText,
    detail: {
      entry,
      labels: {
        mode: modeLabel,
        status: statusLabel,
        target: targetLabel,
        character: characterLabel,
        scenario: scenarioLabel,
        parents: parentLabels,
      },
    },
  };
}

export function applyBuildsDocument(payload, profileId = state.activeProfileId) {
  state.buildsDocument = normalizeBuildsDocument(payload, profileId);
  const entries = state.buildsDocument.entries;
  const items = entries.map(buildItemFromEntry);
  data.entities[buildsEntityKey] = {
    ...createBuildsEntity(),
    items,
    count: items.length,
    filter_options: getBuildFilterOptions(entries),
    source: {
      imported_at: state.buildsDocument.updated_at,
      page_urls: [],
    },
  };
  data.reference.entities[buildsEntityKey] = { count: items.length };
}

export function resetBuildsDocument(profileId = null) {
  state.buildsProfileId = profileId;
  applyBuildsDocument(createEmptyBuildsDocument(profileId), profileId);
  state.buildsStatus = { kind: "idle", message: "" };
  state.buildEditor = {
    targetKey: null,
    draft: null,
    skillQuery: "",
    supportType: "",
    showAllSupports: false,
    showAllCharacters: false,
    showAllParents: false,
  };
}

export function applyRunsDocument(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  state.runsDocument = { version: 1, updated_at: String(payload?.updated_at || ""), entries };
}

export function resetRunsDocument(profileId = null) {
  state.runsProfileId = profileId;
  state.runsDocument = { version: 1, updated_at: "", entries: [] };
  state.runsStatus = { kind: "idle", message: "" };
}

export function getRunsForBuild(buildId) {
  const targetId = String(buildId || "");
  if (!targetId) {
    return [];
  }
  return asArray(state.runsDocument?.entries).filter((entry) => String(entry.build_id) === targetId);
}

export function createSkillReferenceBucket() {
  return {
    characters: new Map(),
    supportHints: new Map(),
    supportEvents: new Map(),
  };
}

export function upsertSkillReferenceEntry(collection, entry) {
  const key = String(entry.id);
  let current = collection.get(key);
  if (!current) {
    current = {
      entityKey: entry.entityKey,
      id: key,
      title: entry.title || "Unknown",
      subtitle: entry.subtitle || "",
      availabilityEn: entry.availabilityEn || "unknown",
      notes: [],
    };
    collection.set(key, current);
  }

  asArray(entry.notes)
    .filter(Boolean)
    .forEach((note) => {
      if (!current.notes.includes(note)) {
        current.notes.push(note);
      }
    });
}

export function addSkillReference(index, skillId, bucketKey, entry) {
  if (skillId == null) {
    return;
  }

  const key = String(skillId);
  if (!index[key]) {
    index[key] = createSkillReferenceBucket();
  }
  upsertSkillReferenceEntry(index[key][bucketKey], entry);
}

export function finalizeSkillReferenceIndex(index) {
  const sortEntries = (entries) => entries.sort((left, right) => {
    const titleCompare = String(left.title || "").localeCompare(String(right.title || ""));
    if (titleCompare !== 0) {
      return titleCompare;
    }
    return String(left.subtitle || "").localeCompare(String(right.subtitle || ""));
  });

  return Object.fromEntries(
    Object.entries(index).map(([skillId, bucket]) => [
      skillId,
      {
        characters: sortEntries(Array.from(bucket.characters.values())),
        supportHints: sortEntries(Array.from(bucket.supportHints.values())),
        supportEvents: sortEntries(Array.from(bucket.supportEvents.values())),
      },
    ]),
  );
}

export function buildSkillReferenceIndex() {
  const index = {};
  const characterItems = asArray(data.entities.characters?.items);
  const supportItems = asArray(data.entities.supports?.items);

  characterItems.forEach((item) => {
    const detail = item?.detail || {};
    const baseEntry = {
      entityKey: "characters",
      id: item?.id,
      title: item?.title,
      subtitle: item?.subtitle,
      availabilityEn: item?.filters?.availability_en || "unknown",
    };

    [
      ["Unique", detail.skill_links?.unique],
      ["Innate", detail.skill_links?.innate],
      ["Awakening", detail.skill_links?.awakening],
      ["Events", detail.skill_links?.event],
    ].forEach(([note, skills]) => {
      asArray(skills).forEach((skill) => {
        addSkillReference(index, skill?.id, "characters", { ...baseEntry, notes: [note] });
      });
    });

    asArray(detail.skill_links?.evolution).forEach((evolution) => {
      addSkillReference(index, evolution?.from?.id, "characters", { ...baseEntry, notes: ["Evolution From"] });
      addSkillReference(index, evolution?.to?.id, "characters", { ...baseEntry, notes: ["Evolution To"] });
    });
  });

  supportItems.forEach((item) => {
    const detail = item?.detail || {};
    const baseEntry = {
      entityKey: "supports",
      id: item?.id,
      title: item?.title,
      subtitle: item?.subtitle,
      availabilityEn: item?.filters?.availability_en || "unknown",
    };

    asArray(detail.hint_skills).forEach((skill) => {
      addSkillReference(index, skill?.id, "supportHints", baseEntry);
    });

    asArray(detail.event_skills).forEach((skill) => {
      addSkillReference(index, skill?.id, "supportEvents", baseEntry);
    });
  });

  return finalizeSkillReferenceIndex(index);
}

export function getSkillReferences(skillId) {
  return skillReferenceIndex[String(skillId)] || {
    characters: [],
    supportHints: [],
    supportEvents: [],
  };
}


export function defaultEntityKeyForMode(mode) {
  return mode === "roster" ? "characters" : referenceEntityKeys[0];
}

export function getLoadedReferenceGeneratedAt() {
  return String(data.reference?.generated_at || data.generated_at || "");
}

export function allowedEntityKeys(mode) {
  return mode === "roster" ? rosterEntityKeys : referenceEntityKeys;
}

export function currentRouteState() {
  const rawHash = (window.location.hash || "").replace(/^#\/?/, "");
  const segments = rawHash ? rawHash.split("/").filter(Boolean).map(decodeURIComponent) : [];

  if (!segments.length || segments[0] === "profiles") {
    return { page: "profiles" };
  }

  if (segments[0] === "wizard") {
    return { page: "wizard" };
  }

  if (segments[0] === "admin") {
    return { page: "admin" };
  }

  if (segments[0] === "home") {
    return { page: "home" };
  }

  if (segments[0] === "reference" || segments[0] === "roster") {
    const mode = segments[0];
    const entityKey = segments[1] || defaultEntityKeyForMode(mode);
    const validEntityKey = allowedEntityKeys(mode).includes(entityKey) ? entityKey : defaultEntityKeyForMode(mode);
    return {
      page: "browse",
      mode,
      entityKey: validEntityKey,
      itemId: segments[2] || null,
    };
  }

  if (referenceEntityKeys.includes(segments[0])) {
    return {
      page: "browse",
      mode: "reference",
      entityKey: segments[0],
      itemId: segments[1] || null,
    };
  }

  return { page: "profiles" };
}

export function setProfilesHash() {
  if (window.location.hash !== "#/profiles") {
    window.location.hash = "#/profiles";
    return;
  }
  requestRender();
}

export function setWizardHash() {
  if (window.location.hash !== "#/wizard") {
    window.location.hash = "#/wizard";
    return;
  }
  requestRender();
}

export function setAdminHash() {
  if (window.location.hash !== "#/admin") {
    window.location.hash = "#/admin";
    return;
  }
  requestRender();
}

export function setHomeHash() {
  if (window.location.hash !== "#/home") {
    window.location.hash = "#/home";
    return;
  }
  requestRender();
}

export function setBrowseHash(mode, entityKey, itemId) {
  const target = itemId
    ? `#/${mode}/${entityKey}/${encodeURIComponent(itemId)}`
    : `#/${mode}/${entityKey}`;
  if (window.location.hash !== target) {
    window.location.hash = target;
    return;
  }
  requestRender();
}

// Task-oriented sidebar sections. Each is a pure view-layer projection over the
// existing route grammar (setBrowseHash / setAdminHash), so no new routing scheme
// is introduced. `target()` is deferred to click time.
export const SIDEBAR_SECTIONS = [
  { id: "accueil", label: "Home", icon: "home", target: () => setHomeHash() },
  { id: "prepa_cm", label: "CM Prep", icon: "target", target: () => setBrowseHash("roster", buildsEntityKey, null) },
  { id: "collection", label: "My Collection", icon: "collection", target: () => setBrowseHash("roster", "characters", null) },
  { id: "reference", label: "References", icon: "reference", target: () => setBrowseHash("reference", defaultEntityKeyForMode("reference"), null) },
  { id: "admin", label: "Admin", icon: "admin", target: () => setAdminHash() },
];

// Derive the active sidebar section from the current route. Returns null on the
// full-screen gate pages (profiles/wizard) where the sidebar is hidden.
export function sidebarSectionForRoute(route) {
  if (route.page === "home") return "accueil";
  if (route.page === "admin") return "admin";
  if (route.page === "browse" && route.mode === "reference") return "reference";
  if (route.page === "browse" && route.mode === "roster") {
    return route.entityKey === buildsEntityKey ? "prepa_cm" : "collection";
  }
  return null;
}

export function hasFilterOption(entity, filterKey, value) {
  return asArray(entity?.filter_options?.[filterKey]).some((option) => option?.value === value);
}

export function getDefaultFilters(entityKey, mode) {
  if (mode !== "reference") {
    return {};
  }

  const entity = data.entities[entityKey];
  const defaults = {};

  if (!entity) {
    return defaults;
  }

  if (hasFilterOption(entity, "availability_en", "available")) {
    defaults.availability_en = ["available"];
  }

  if (entityKey === "skills" && hasFilterOption(entity, "has_cost", "yes")) {
    defaults.has_cost = ["yes"];
  }

  return defaults;
}

export function createEntityState(mode, entityKey) {
  return {
    query: "",
    filters: getDefaultFilters(entityKey, mode),
    filtersOpen: false,
    selectedId: null,
    presentation: mode === "roster" ? (entityKey === legacyEntityKey ? "parents" : "detail") : "cards",
  };
}

export function getViewState(mode, entityKey) {
  const key = `${mode}:${entityKey}`;
  if (!viewStateByKey[key]) {
    viewStateByKey[key] = createEntityState(mode, entityKey);
  }
  return viewStateByKey[key];
}

export function getModeLabel(mode) {
  return mode === "roster" ? "My Roster" : "Catalog";
}

export function getActiveProfile() {
  return state.profilesIndex.profiles.find((profile) => profile.id === state.activeProfileId) || null;
}

export function getRosterViewPayload(entityKey) {
  if (entityKey === legacyEntityKey) {
    return state.legacyView || { profile_id: null, entity: legacyEntityKey, updated_at: "", entries: {} };
  }
  if (entityKey === buildsEntityKey) {
    return state.buildsDocument || createEmptyBuildsDocument();
  }
  return state.rosterViews[entityKey] || { profile_id: null, entity: entityKey, updated_at: "", entries: {} };
}

export function getRosterViewEntry(entityKey, item) {
  if (entityKey === legacyEntityKey) {
    return item?.detail?.entry ? { derived: item.detail } : null;
  }
  if (entityKey === buildsEntityKey) {
    return item?.detail?.entry ? { derived: item.detail } : null;
  }
  return getRosterViewPayload(entityKey).entries?.[item.id] || null;
}

export function getSupportLevelCap(rarity, limitBreak) {
  const baseCapByRarity = { 1: 20, 2: 25, 3: 30 };
  const safeRarity = Number(rarity) || 0;
  const safeLimitBreak = clampNumber(limitBreak, 0, 4, 0);
  const baseCap = baseCapByRarity[safeRarity] || 30;
  return Math.min(50, baseCap + (safeLimitBreak * 5));
}

export function getSupportEntryLevelCap(item, limitBreakOverride) {
  const currentEntry = getRosterEntry("supports", item);
  const effectiveLimitBreak = limitBreakOverride == null ? currentEntry.limit_break : limitBreakOverride;
  return getSupportLevelCap(item?.detail?.rarity, effectiveLimitBreak);
}

export function syncSelectedProfileId() {
  const profileIds = state.profilesIndex.profiles.map((profile) => profile.id);
  if (!profileIds.length) {
    state.selectedProfileId = null;
    return;
  }

  if (profileIds.includes(state.selectedProfileId)) {
    return;
  }

  if (state.profilesIndex.last_profile_id && profileIds.includes(state.profilesIndex.last_profile_id)) {
    state.selectedProfileId = state.profilesIndex.last_profile_id;
    return;
  }

  state.selectedProfileId = profileIds[0];
}


export function getEntityItems(entityKey) {
  return asArray(data.entities?.[entityKey]?.items);
}

export function getAllCharacterOptions() {
  return getEntityItems("characters")
    .map((item) => ({
      value: item.id,
      label: item.subtitle ? `${item.title} ${item.subtitle}` : item.title,
      availabilityEn: String(item.filters?.availability_en || "").toLowerCase(),
      owned: Boolean(getRosterEntry("characters", item).owned),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function getOwnedCharacterOptions() {
  return getAllCharacterOptions().filter((item) => item.owned);
}

export function getOwnedSupportOptions() {
  return getEntityItems("supports")
    .filter((item) => getRosterEntry("supports", item).owned)
    .map((item) => ({
      value: item.id,
      label: item.subtitle ? `${item.title} ${item.subtitle}` : item.title,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function getBuildTargetOptions(entityKey) {
  return getEntityItems(entityKey)
    .map((item) => ({
      value: item.id,
      label: item.subtitle ? `${item.title} ${item.subtitle}` : item.title,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function renderSelectOptions(options, selectedValue, emptyLabel = "None") {
  const selected = String(selectedValue || "");
  return `
    <option value="">${escapeHtml(emptyLabel)}</option>
    ${asArray(options).map((option) => `
      <option value="${escapeHtml(option.value)}" ${String(option.value) === selected ? "selected" : ""}>${escapeHtml(option.label)}</option>
    `).join("")}
  `;
}
