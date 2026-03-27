(function () {
  function createEmptyReferenceBundle() {
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

  const hasLoadedReferenceBundle = Boolean(window.UMA_REFERENCE_DATA);
  const data = window.UMA_REFERENCE_DATA || createEmptyReferenceBundle();
  const profileBackgroundMediaEl = document.getElementById("profileBackgroundMedia");
  const profileBackgroundVideoEl = document.getElementById("profileBackgroundVideo");
  const modeNavEl = document.getElementById("modeNav");
  const topHeaderEl = document.getElementById("topHeader");
  const pageTitleEl = document.getElementById("pageTitle");
  const summaryText = document.getElementById("summaryText");
  const globalBuild = document.getElementById("globalBuild");
  const lastBuildBlock = document.getElementById("lastBuildBlock");
  const refreshCommandBlock = document.getElementById("refreshCommandBlock");
  const activeProfileBlock = document.getElementById("activeProfileBlock");
  const activeProfileNameEl = document.getElementById("activeProfileName");
  const changeProfileButton = document.getElementById("changeProfileButton");
  const adminButton = document.getElementById("adminButton");
  const profileGateEl = document.getElementById("profileGate");
  const datasetBarEl = document.getElementById("datasetBar");
  const datasetHeadingEl = document.getElementById("datasetHeading");
  const navEl = document.getElementById("entityNav");
  const toolbarEl = document.getElementById("toolbar");
  const entityTitleEl = document.getElementById("entityTitle");
  const entityMetaEl = document.getElementById("entityMeta");
  const browseActionsEl = document.getElementById("browseActions");
  const resultCountEl = document.getElementById("resultCount");
  const listEl = document.getElementById("list");
  const detailEl = document.getElementById("detail");
  const detailPanelEl = document.querySelector(".detail-panel");
  const detailColumnEl = document.getElementById("detailColumn");
  const resultsPanelEl = document.getElementById("resultsPanel");
  const filtersEl = document.getElementById("filters");
  const searchInput = document.getElementById("searchInput");
  const clearButton = document.getElementById("clearButton");
  const backToTopButton = document.getElementById("backToTopButton");
  const compactLayoutQuery = window.matchMedia("(max-width: 1680px)");

  const referenceEntityKeys = Object.keys(data.entities);
  const rosterEntityKeys = ["characters", "supports"];
  const inlineMediaEntityKeys = new Set(["characters", "skills", "supports"]);
  const rosterFilterDefinitionsBase = [
    { key: "_roster_favorite", label: "Favorites" },
    { key: "_roster_note", label: "Has note" },
    { key: "_roster_tag", label: "Tags" },
    { key: "_roster_status", label: "Status" },
    { key: "_roster_progress", label: "Progress" },
  ];

  const state = {
    profileIndexLoaded: false,
    profilesIndex: { version: 1, last_profile_id: null, profiles: [] },
    selectedProfileId: null,
    activeProfileId: null,
    bootstrapStatusLoaded: false,
    bootstrapStatus: null,
    rosterDocument: normalizeRosterDocument(null),
    rosterProfileId: null,
    rosterViews: {
      characters: { profile_id: null, entity: "characters", updated_at: "", entries: {} },
      supports: { profile_id: null, entity: "supports", updated_at: "", entries: {} },
    },
    rosterStatus: { kind: "idle", message: "" },
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

  const viewStateByKey = {};
  const skillReferenceIndex = buildSkillReferenceIndex();

  function asArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value == null) {
      return [];
    }
    return [value];
  }

  function defaultProfilesIndex() {
    return {
      version: 1,
      last_profile_id: null,
      profiles: [],
    };
  }

  function normalizeProfilesIndex(payload) {
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

  function normalizeRosterDocument(payload) {
    const roster = payload && typeof payload === "object" ? payload : {};
    return {
      version: 1,
      updated_at: roster.updated_at || "",
      characters: roster.characters && typeof roster.characters === "object" ? roster.characters : {},
      supports: roster.supports && typeof roster.supports === "object" ? roster.supports : {},
    };
  }

  function normalizeRosterViewPayload(entityKey, payload) {
    const safePayload = payload && typeof payload === "object" ? payload : {};
    const entries = safePayload.entries && typeof safePayload.entries === "object" ? safePayload.entries : {};
    return {
      profile_id: safePayload.profile_id || null,
      entity: entityKey,
      updated_at: safePayload.updated_at || "",
      entries,
    };
  }

  function createSkillReferenceBucket() {
    return {
      characters: new Map(),
      supportHints: new Map(),
      supportEvents: new Map(),
    };
  }

  function upsertSkillReferenceEntry(collection, entry) {
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

  function addSkillReference(index, skillId, bucketKey, entry) {
    if (skillId == null) {
      return;
    }

    const key = String(skillId);
    if (!index[key]) {
      index[key] = createSkillReferenceBucket();
    }
    upsertSkillReferenceEntry(index[key][bucketKey], entry);
  }

  function finalizeSkillReferenceIndex(index) {
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

  function buildSkillReferenceIndex() {
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

  function getSkillReferences(skillId) {
    return skillReferenceIndex[String(skillId)] || {
      characters: [],
      supportHints: [],
      supportEvents: [],
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hashText(value) {
    const text = String(value ?? "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function badgePalette(badge) {
    const hash = hashText(badge);
    const hue = hash % 360;
    return {
      bg: `hsla(${hue}, 78%, 58%, 0.16)`,
      border: `hsla(${hue}, 84%, 64%, 0.3)`,
      text: `hsl(${hue}, 92%, 78%)`,
    };
  }

  function renderBadge(badge, extraClass) {
    const palette = badgePalette(badge);
    return `<span class="badge ${extraClass || ""}" style="--badge-bg:${palette.bg};--badge-border:${palette.border};--badge-text:${palette.text};">${escapeHtml(badge)}</span>`;
  }

  function formatDateTime(value) {
    if (!value) {
      return "-";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    return parsed.toLocaleString();
  }

  function syncToolbarMetrics() {
    if (!toolbarEl || toolbarEl.hidden) {
      document.documentElement.style.setProperty("--toolbar-height", "0px");
      return;
    }
    document.documentElement.style.setProperty("--toolbar-height", `${toolbarEl.offsetHeight}px`);
  }

  function syncBackToTopVisibility() {
    if (!backToTopButton || backToTopButton.hidden) {
      return;
    }

    if (window.scrollY > 260) {
      backToTopButton.classList.add("visible");
    } else {
      backToTopButton.classList.remove("visible");
    }
  }

  function isCompactLayout() {
    return compactLayoutQuery.matches;
  }

  function syncLayoutMode(hasSelectedItem) {
    document.body.classList.toggle("layout-compact", isCompactLayout());
    document.body.classList.toggle("layout-compact-detail-active", isCompactLayout() && hasSelectedItem);
  }

  function defaultEntityKeyForMode(mode) {
    return mode === "roster" ? "characters" : referenceEntityKeys[0];
  }

  function allowedEntityKeys(mode) {
    return mode === "roster" ? rosterEntityKeys : referenceEntityKeys;
  }

  function currentRouteState() {
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

  function setProfilesHash() {
    if (window.location.hash !== "#/profiles") {
      window.location.hash = "#/profiles";
      return;
    }
    requestRender();
  }

  function setWizardHash() {
    if (window.location.hash !== "#/wizard") {
      window.location.hash = "#/wizard";
      return;
    }
    requestRender();
  }

  function setAdminHash() {
    if (window.location.hash !== "#/admin") {
      window.location.hash = "#/admin";
      return;
    }
    requestRender();
  }

  function setBrowseHash(mode, entityKey, itemId) {
    const target = itemId
      ? `#/${mode}/${entityKey}/${encodeURIComponent(itemId)}`
      : `#/${mode}/${entityKey}`;
    if (window.location.hash !== target) {
      window.location.hash = target;
      return;
    }
    requestRender();
  }

  function hasFilterOption(entity, filterKey, value) {
    return asArray(entity?.filter_options?.[filterKey]).some((option) => option?.value === value);
  }

  function getDefaultFilters(entityKey, mode) {
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

  function createEntityState(mode, entityKey) {
    return {
      query: "",
      filters: getDefaultFilters(entityKey, mode),
      selectedId: null,
      presentation: mode === "roster" ? "detail" : "cards",
    };
  }

  function getViewState(mode, entityKey) {
    const key = `${mode}:${entityKey}`;
    if (!viewStateByKey[key]) {
      viewStateByKey[key] = createEntityState(mode, entityKey);
    }
    return viewStateByKey[key];
  }

  function getModeLabel(mode) {
    return mode === "roster" ? "My Roster" : "Catalog";
  }

  function getActiveProfile() {
    return state.profilesIndex.profiles.find((profile) => profile.id === state.activeProfileId) || null;
  }

  function getRosterViewPayload(entityKey) {
    return state.rosterViews[entityKey] || { profile_id: null, entity: entityKey, updated_at: "", entries: {} };
  }

  function getRosterViewEntry(entityKey, item) {
    return getRosterViewPayload(entityKey).entries?.[item.id] || null;
  }

  function syncSelectedProfileId() {
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

  function getMediaEntries(media) {
    return Object.values(media || {}).filter((asset) => asset && asset.src);
  }

  function getPrimaryMedia(media, preferredRoles) {
    const byRole = [...new Set([...asArray(preferredRoles), "banner", "cover", "portrait", "icon"])];
    const entries = getMediaEntries(media);
    for (const role of byRole) {
      const match = entries.find((entry) => entry.role === role);
      if (match) {
        return match;
      }
    }
    return entries[0] || null;
  }

  function resolveMediaAssetSrc(src) {
    const rawSrc = String(src || "").trim();
    if (!rawSrc) {
      return "";
    }
    if (/^(https?:)?\/\//i.test(rawSrc) || rawSrc.startsWith("data:")) {
      return rawSrc;
    }
    const isLocalReferenceMedia = rawSrc.startsWith("./media/") || rawSrc.startsWith("/media/") || rawSrc.startsWith("media/");
    if (!isLocalReferenceMedia) {
      return rawSrc;
    }
    const buildVersion = data.reference?.generated_at ? encodeURIComponent(String(data.reference.generated_at)) : "";
    if (!buildVersion) {
      return rawSrc;
    }
    return `${rawSrc}${rawSrc.includes("?") ? "&" : "?"}v=${buildVersion}`;
  }

  function renderImageAsset(asset, cssClass, loadingMode) {
    if (!asset?.src) {
      return "";
    }
    return `<img class="${cssClass}" src="${escapeHtml(resolveMediaAssetSrc(asset.src))}" alt="${escapeHtml(asset.alt || "")}" loading="${escapeHtml(loadingMode || "lazy")}">`;
  }

  function getResultMediaRoles(entityKey) {
    if (entityKey === "supports") {
      return ["icon", "cover"];
    }
    if (entityKey === "skills") {
      return ["icon"];
    }
    if (entityKey === "characters") {
      return ["portrait", "icon"];
    }
    if (entityKey === "races") {
      return ["banner"];
    }
    return [];
  }

  function renderResultMedia(item, entityKey, inline) {
    const primary = getPrimaryMedia(item.media, getResultMediaRoles(entityKey));
    if (!primary) {
      return "";
    }

    const wrapperClass = [
      "result-card-media",
      primary.role === "banner" ? "result-card-media-banner" : "result-card-media-tile",
      inline ? "result-card-media-inline" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `
      <div class="${wrapperClass}">
        ${renderImageAsset(primary, "result-card-media-image", "lazy")}
      </div>
    `;
  }

  function renderResultTop(item, entityKey) {
    const content = `
      <div class="result-card-content">
        <h3>${escapeHtml(item.title)}</h3>
        <p class="result-subtitle">${escapeHtml(item.subtitle || "")}</p>
      </div>
    `;

    if (inlineMediaEntityKeys.has(entityKey)) {
      const inlineMedia = renderResultMedia(item, entityKey, true);
      if (inlineMedia) {
        return `
          <div class="result-card-top result-card-top-inline">
            ${content}
            ${inlineMedia}
          </div>
        `;
      }
    }

    return `
      <div class="result-card-top result-card-top-stack">
        ${renderResultMedia(item, entityKey, false)}
        ${content}
      </div>
    `;
  }

  function getDetailMediaEntries(item, entityKey) {
    const entries = getMediaEntries(item.media);
    if (entityKey === "supports") {
      return entries.filter((asset) => asset.role === "cover");
    }
    return entries;
  }

  function renderDetailMedia(item, entityKey) {
    const entries = getDetailMediaEntries(item, entityKey);
    if (!entries.length) {
      return "";
    }

    return `
      <div class="detail-media-strip">
        ${entries
          .map((asset) => {
            const wrapperClass = asset.role === "banner"
              ? "detail-media-item detail-media-item-banner"
              : "detail-media-item detail-media-item-tile";
            return `
              <figure class="${wrapperClass}">
                ${renderImageAsset(asset, "detail-media-image", "eager")}
              </figure>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function shouldInlineDetailMedia(entityKey) {
    return entityKey === "characters" || entityKey === "supports";
  }

  function renderDetailHeader(item, entityKey, extraBadges) {
    const media = renderDetailMedia(item, entityKey);
    const titleBlock = `
      <div class="detail-header-copy">
        <h2 class="detail-title">${escapeHtml(item.title)}</h2>
        <p class="detail-subtitle">${escapeHtml(item.subtitle || "")}</p>
      </div>
    `;
    const mergedBadges = [...asArray(extraBadges), ...asArray(item.badges).filter(Boolean)];
    const badges = `
      <div class="badge-row detail-badge-row">
        ${mergedBadges.map((badge) => renderBadge(badge)).join("")}
      </div>
    `;

    if (media && shouldInlineDetailMedia(entityKey)) {
      return `
        <div class="detail-header detail-header-inline">
          ${titleBlock}
          ${media}
        </div>
        ${badges}
      `;
    }

    return `
      ${media}
      ${titleBlock}
      ${badges}
    `;
  }

  function renderLinks(urls) {
    return asArray(urls)
      .map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`)
      .join("<br>");
  }

  function renderSimpleList(items, valueSelector) {
    const values = asArray(items).map(valueSelector).filter(Boolean);
    if (!values.length) {
      return "<p class='source-note'>None</p>";
    }
    return `<ul class="list-inline">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
  }

  function renderReferenceList(items) {
    const entries = asArray(items).filter((entry) => entry && entry.entityKey && entry.id);
    if (!entries.length) {
      return "<p class='source-note'>None</p>";
    }

    return `
      <ul class="detail-reference-list">
        ${entries
          .map((entry) => {
            const buttonClasses = [
              "detail-reference-button",
              entry.availabilityEn && entry.availabilityEn !== "available" ? "detail-reference-button-unavailable" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return `
              <li>
                <button
                  class="${buttonClasses}"
                  type="button"
                  data-ref-entity="${escapeHtml(entry.entityKey)}"
                  data-ref-id="${escapeHtml(entry.id)}"
                >
                  <strong>${escapeHtml(entry.title || "Unknown")}</strong>
                  ${entry.subtitle ? `<span class="detail-reference-subtitle">${escapeHtml(entry.subtitle)}</span>` : ""}
                  ${entry.notes?.length ? `<span class="detail-reference-meta">${escapeHtml(entry.notes.join(", "))}</span>` : ""}
                </button>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  function renderLinkedSkillList(items) {
    const entries = asArray(items).filter((skill) => skill && skill.id);
    if (!entries.length) {
      return "<p class='source-note'>None</p>";
    }

    return `
      <ul class="detail-reference-list detail-reference-list-compact">
        ${entries
          .map((skill) => {
            const metaParts = [];
            if (skill.rarity != null) {
              metaParts.push(`R${skill.rarity}`);
            }
            if (skill.cost != null) {
              metaParts.push(`Cost ${skill.cost}`);
            }

            return `
              <li>
                <button
                  class="detail-reference-button detail-reference-button-compact"
                  type="button"
                  data-ref-entity="skills"
                  data-ref-id="${escapeHtml(skill.id)}"
                >
                  <strong>${escapeHtml(skill.name || "Unknown")}</strong>
                  <span class="detail-reference-subtitle">#${escapeHtml(skill.id)}</span>
                  ${metaParts.length ? `<span class="detail-reference-meta">${escapeHtml(metaParts.join(" | "))}</span>` : ""}
                </button>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  function tableFromRows(rows) {
    const safeRows = asArray(rows).filter((row) => Array.isArray(row) && row.length >= 2);
    if (!safeRows.length) {
      return "<p class='source-note'>No data.</p>";
    }

    return `
      <table class="detail-table">
        <tbody>
          ${safeRows
            .map(
              ([key, value]) => `
                <tr>
                  <th>${escapeHtml(key)}</th>
                  <td>${value}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderCharacterGradeGrid(title, columns, values, options) {
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

  function renderCharacterStatsTable(title, columns, rows) {
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

  function renderSupportStatGainTable(entries) {
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

  function renderFlagBadgeList(values) {
    const entries = asArray(values).filter(Boolean);
    if (!entries.length) {
      return "<p class='source-note'>None</p>";
    }
    return `<div class="badge-row">${entries.map((entry) => renderBadge(entry)).join("")}</div>`;
  }

  function renderCostRows(costs) {
    return tableFromRows(
      asArray(costs).map((cost) => [
        `Slot ${cost.slot_index}`,
        escapeHtml(`Category ${cost.item_category ?? "-"} | Item ${cost.item_id ?? "-"} | Qty ${cost.item_num ?? "-"}`),
      ]),
    );
  }

  function renderCharacterRosterProjection(projection) {
    if (!projection) {
      return "";
    }

    return `
      <div class="detail-section roster-derived-section">
        <h3>Current Progression</h3>
        ${tableFromRows([
          ["Stars", escapeHtml(projection.stars)],
          ["Awakening", escapeHtml(projection.awakening)],
          ["Unique Level", escapeHtml(projection.unique_level)],
          ["Progress", escapeHtml(projection.progress_bucket)],
          ["Unlock State", escapeHtml(projection.unlock_state)],
        ])}
        <h4>Local Tags</h4>
        ${renderFlagBadgeList(projection.custom_tags)}
        <h4>Status Flags</h4>
        ${renderFlagBadgeList(projection.status_flags)}
      </div>
      <div class="detail-section roster-derived-section">
        <h3>Unlocked Awakening Skills</h3>
        ${renderLinkedSkillList(projection.unlocked_awakening_skills)}
        <h4>Locked Awakening Skills</h4>
        ${renderLinkedSkillList(projection.locked_awakening_skills)}
      </div>
      <div class="detail-section roster-derived-section">
        <h3>Awakening Costs</h3>
        <h4>Unlocked Levels</h4>
        ${asArray(projection.unlocked_awakening_levels).length
          ? asArray(projection.unlocked_awakening_levels)
            .map((level) => `
              <div class="roster-progress-card">
                <strong>Awakening ${escapeHtml(level.awakening_level)}</strong>
                ${level.skill ? `<p class="source-note">${escapeHtml(level.skill.name || `Skill #${level.skill.id}`)}</p>` : ""}
                ${renderCostRows(level.costs)}
              </div>
            `)
            .join("")
          : "<p class='source-note'>None</p>"}
        <h4>Locked Levels</h4>
        ${asArray(projection.locked_awakening_levels).length
          ? asArray(projection.locked_awakening_levels)
            .map((level) => `
              <div class="roster-progress-card">
                <strong>Awakening ${escapeHtml(level.awakening_level)}</strong>
                ${level.skill ? `<p class="source-note">${escapeHtml(level.skill.name || `Skill #${level.skill.id}`)}</p>` : ""}
                ${renderCostRows(level.costs)}
              </div>
            `)
            .join("")
          : "<p class='source-note'>None</p>"}
      </div>
    `;
  }

  function renderSupportRosterProjection(projection) {
    if (!projection) {
      return "";
    }

    return `
      <div class="detail-section roster-derived-section">
        <h3>Current Progression</h3>
        ${tableFromRows([
          ["Level", escapeHtml(projection.level)],
          ["Limit Break", escapeHtml(projection.limit_break)],
          ["Level Cap", escapeHtml(projection.level_cap)],
          ["Rarity Max Level", escapeHtml(projection.rarity_max_level)],
          ["Progress", escapeHtml(projection.progress_bucket)],
          ["Usable", escapeHtml(projection.usable ? "Yes" : "No")],
          ["Current EXP", escapeHtml(projection.total_exp ?? "-")],
          ["Cap EXP", escapeHtml(projection.cap_total_exp ?? "-")],
        ])}
        <h4>Local Tags</h4>
        ${renderFlagBadgeList(projection.custom_tags)}
        <h4>Status Flags</h4>
        ${renderFlagBadgeList(projection.status_flags)}
      </div>
      <div class="detail-section roster-derived-section">
        <h3>Effective Support Values</h3>
        ${tableFromRows(
          asArray(projection.effective_effects).map((effect) => [
            effect.name || `Effect #${effect.effect_id}`,
            escapeHtml(`${effect.current_value ?? "-"} / ${effect.max_value ?? "-"} | stage ${effect.current_stage_index || 0}/${effect.max_stage_index || 0}`),
          ]),
        )}
      </div>
      <div class="detail-section roster-derived-section">
        <h3>Unique Effects At Current State</h3>
        ${tableFromRows(
          asArray(projection.effective_unique_effects).map((effect) => [
            effect.name || `Effect #${effect.effect_id}`,
            escapeHtml(`${effect.unlocked ? "Unlocked" : "Locked"} | ${effect.value ?? "-"}`),
          ]),
        )}
      </div>
    `;
  }

  function renderCharacters(detail, rosterProjection) {
    const release = detail.release || {};
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
      ${tableFromRows([
        ["Card ID", escapeHtml(detail.card_id)],
        ["Base Character ID", escapeHtml(detail.base_character_id)],
        ["Variant", escapeHtml(detail.variant)],
        ["Rarity", escapeHtml(`${detail.rarity}-star`)],
        ["Release", escapeHtml(`JP ${release.jp || "-"} | EN ${release.en || "-"}`)],
      ])}
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
      <div class="detail-section">
        <h3>Profile</h3>
        ${tableFromRows([
          ["Birthday", escapeHtml(detail.profile?.birthday || "-")],
          ["Height", escapeHtml(detail.profile?.height_cm || "-")],
          [
            "Measurements",
            escapeHtml(
              detail.profile?.measurements
                ? `B${detail.profile.measurements.b} / W${detail.profile.measurements.w} / H${detail.profile.measurements.h}`
                : "-",
            ),
          ],
          ["Sex", escapeHtml(detail.profile?.sex || "-")],
          ["Voice Actor", escapeHtml(detail.profile?.voice_actor?.en || detail.profile?.voice_actor?.ja || "-")],
        ])}
      </div>
      ${renderCharacterRosterProjection(rosterProjection)}
    `;
  }

  function renderSupports(detail, rosterProjection) {
    return `
      ${tableFromRows([
        ["Support ID", escapeHtml(detail.support_id)],
        ["Character ID", escapeHtml(detail.character_id)],
        ["Type", escapeHtml(detail.type)],
        ["Rarity", escapeHtml(detail.rarity)],
        ["Obtained", escapeHtml(detail.obtained)],
      ])}
      <div class="detail-section">
        <h3>Effects</h3>
        ${tableFromRows(
          asArray(detail.effects).map((effect) => [
            effect.name || `Effect #${effect.effect_id}`,
            escapeHtml(`max ${effect.max_value ?? "-"} | ${effect.description || ""}`),
          ]),
        )}
      </div>
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

  function renderSkills(detail) {
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

  function renderRaces(detail) {
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

  function renderRacetracks(detail) {
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

  function renderG1Factors(detail) {
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

  function renderCmTargets(detail) {
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

  function renderScenarios(detail) {
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

  function renderTrainingEvents(detail) {
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
            choice.choice_label || `Choice ${choice.index}`,
            escapeHtml(`${choice.effect_count || 0} effect token(s)${choice.choice_token != null ? ` | token ${choice.choice_token}` : ""}`),
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

  function renderCompatibility(detail, model) {
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

  function getDefaultRosterEntry(entityKey, item) {
    if (entityKey === "characters") {
      return {
        owned: false,
        favorite: false,
        note: "",
        stars: Number(item?.detail?.rarity) || 0,
        awakening: 0,
        unique_level: 1,
        custom_tags: [],
        status_flags: [],
      };
    }

    if (entityKey === "supports") {
      return {
        owned: false,
        favorite: false,
        note: "",
        level: 1,
        limit_break: 0,
        custom_tags: [],
        status_flags: [],
      };
    }

    return {
      owned: false,
      favorite: false,
      note: "",
    };
  }

  function getRosterEntry(entityKey, item) {
    const defaultEntry = getDefaultRosterEntry(entityKey, item);
    const bucket = state.rosterDocument?.[entityKey] || {};
    return {
      ...defaultEntry,
      ...(bucket[item.id] || {}),
    };
  }

  function pruneRosterEntry(entityKey, item, entry) {
    const defaults = getDefaultRosterEntry(entityKey, item);
    const pruned = {};

    Object.keys(defaults).forEach((key) => {
      const value = entry[key];
      const defaultValue = defaults[key];
      if (Array.isArray(value)) {
        if (JSON.stringify(value) !== JSON.stringify(defaultValue)) {
          pruned[key] = value;
        }
        return;
      }
      if (typeof value === "string") {
        if (value !== defaultValue) {
          pruned[key] = value;
        }
        return;
      }
      if (value !== defaultValue) {
        pruned[key] = value;
      }
    });

    return Object.keys(pruned).length ? pruned : null;
  }

  function setRosterEntry(entityKey, item, nextEntry) {
    const bucket = { ...(state.rosterDocument[entityKey] || {}) };
    const pruned = pruneRosterEntry(entityKey, item, nextEntry);

    if (pruned) {
      bucket[item.id] = pruned;
    } else {
      delete bucket[item.id];
    }

    state.rosterDocument = {
      ...state.rosterDocument,
      [entityKey]: bucket,
    };
  }

  function getRosterBadges(entityKey, item, mode) {
    if (!rosterEntityKeys.includes(entityKey) || !state.activeProfileId) {
      return [];
    }

    const entry = getRosterEntry(entityKey, item);
    const badges = [];

    if (entry.owned) {
      badges.push("Owned");
    }
    if (entry.favorite) {
      badges.push("Favorite");
    }
    if (entry.note) {
      badges.push("Note");
    }

    if (mode === "roster") {
      if (entityKey === "characters") {
        badges.push(`${entry.stars}-star`);
        badges.push(`Awk ${entry.awakening}`);
        badges.push(`U${entry.unique_level || 1}`);
      }
      if (entityKey === "supports") {
        badges.push(`Lv ${entry.level}`);
        badges.push(`LB ${entry.limit_break}`);
      }
    }

    asArray(entry.custom_tags).slice(0, 2).forEach((tag) => badges.push(tag));
    asArray(entry.status_flags).slice(0, 2).forEach((flag) => badges.push(flag));

    return badges;
  }

  function rosterCountForEntity(entityKey, predicate) {
    return data.entities[entityKey].items.reduce((count, item) => {
      return predicate(getRosterEntry(entityKey, item), item) ? count + 1 : count;
    }, 0);
  }

  function getRosterFilterOptions(entityKey, filterKey) {
    if (filterKey === "_roster_favorite") {
      return [{ value: "yes", label: "Only favorites", count: rosterCountForEntity(entityKey, (entry) => entry.favorite) }];
    }
    if (filterKey === "_roster_note") {
      return [{ value: "yes", label: "Has note", count: rosterCountForEntity(entityKey, (entry) => Boolean(entry.note?.trim())) }];
    }
    if (filterKey === "_roster_tag") {
      return buildRosterValueOptions(entityKey, (viewEntry) => viewEntry?.derived?.custom_tags);
    }
    if (filterKey === "_roster_status") {
      return buildRosterValueOptions(entityKey, (viewEntry) => viewEntry?.derived?.status_flags);
    }
    if (filterKey === "_roster_progress") {
      return buildRosterValueOptions(entityKey, (viewEntry) => viewEntry?.derived?.progress_bucket, {
        labelMap: {
          base: "Base",
          started: "Started",
          advanced: "Advanced",
          maxed: "Maxed",
          starter: "Starter",
          developing: "Developing",
          usable: "Usable",
        },
      });
    }
    if (filterKey === "_roster_unlock" && entityKey === "characters") {
      return buildRosterValueOptions(entityKey, (viewEntry) => viewEntry?.derived?.unlock_state, {
        labelMap: { none: "No unlock", partial: "Partial", full: "Full" },
      });
    }
    if (filterKey === "_roster_usable" && entityKey === "supports") {
      return [
        { value: "yes", label: "Usable", count: rosterCountForEntity(entityKey, (_entry, item) => Boolean(getRosterViewEntry(entityKey, item)?.derived?.usable)) },
      ];
    }
    return [];
  }

  function buildRosterValueOptions(entityKey, selector, options = {}) {
    const counts = new Map();
    const payload = getRosterViewPayload(entityKey);
    Object.values(payload.entries || {}).forEach((viewEntry) => {
      asArray(selector(viewEntry)).forEach((value) => {
        const key = String(value || "").trim();
        if (!key) {
          return;
        }
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });

    return Array.from(counts.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([value, count]) => ({
        value,
        label: options.labelMap?.[value] || value,
        count,
      }));
  }

  function getRosterFilterDefinitions(entityKey) {
    const definitions = [...rosterFilterDefinitionsBase];
    if (entityKey === "characters") {
      definitions.push({ key: "_roster_unlock", label: "Unlock state" });
    }
    if (entityKey === "supports") {
      definitions.push({ key: "_roster_usable", label: "Usable" });
    }
    return definitions;
  }

  function getFilterDefinitions(mode, entityKey) {
    const entity = data.entities[entityKey];
    const definitions = asArray(entity.filter_definitions);
    if (mode !== "roster") {
      return definitions;
    }
    return [...definitions, ...getRosterFilterDefinitions(entityKey)];
  }

  function getFilterOptions(mode, entityKey, definition) {
    if (definition.key.startsWith("_roster_")) {
      return getRosterFilterOptions(entityKey, definition.key);
    }
    return asArray(data.entities[entityKey].filter_options?.[definition.key]);
  }

  function matchesCustomRosterFilter(filterKey, item) {
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

  function getFilteredItems(mode, entityKey) {
    const entity = data.entities[entityKey];
    const localState = getViewState(mode, entityKey);
    const query = localState.query.trim().toLowerCase();

    return entity.items.filter((rawItem) => {
      const item = { ...rawItem, __entityKey: entityKey };
      const rosterEntry = getRosterEntry(entityKey, item);

      if (mode === "roster" && !rosterEntry.owned) {
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

  function renderModeNav(route) {
    if (!modeNavEl) {
      return;
    }

    if (route.page === "profiles" || route.page === "wizard") {
      modeNavEl.innerHTML = "";
      modeNavEl.hidden = true;
      return;
    }

    modeNavEl.hidden = false;
    const activeMode = route.page === "admin" ? "roster" : route.mode;
    const currentEntityForReference = activeMode === "reference" && allowedEntityKeys("reference").includes(route.entityKey)
      ? route.entityKey
      : defaultEntityKeyForMode("reference");
    const currentEntityForRoster = activeMode === "roster" && allowedEntityKeys("roster").includes(route.entityKey)
      ? route.entityKey
      : defaultEntityKeyForMode("roster");

    modeNavEl.innerHTML = `
      <button class="mode-button ${activeMode === "roster" ? "active" : ""}" type="button" data-mode="roster" data-target-entity="${escapeHtml(currentEntityForRoster)}">
        My Roster
      </button>
      <button class="mode-button ${activeMode === "reference" ? "active" : ""}" type="button" data-mode="reference" data-target-entity="${escapeHtml(currentEntityForReference)}">
        Catalog
      </button>
    `;

    modeNavEl.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode;
        const targetEntity = button.dataset.targetEntity;
        setBrowseHash(mode, targetEntity, null);
      });
    });
  }

  function renderProfilesPage() {
    const profiles = state.profilesIndex.profiles;
    const activeProfile = getActiveProfile();
    const apiError = state.profilesApiStatus.kind === "error" ? state.profilesApiStatus.message : "";

    profileGateEl.innerHTML = `
      <div class="profile-landing profile-landing-compact">
        <div class="profile-landing-copy">
          <h2>Welcome</h2>
          <p class="source-note">Welcome back. Choose the local profile you want to open to continue managing your roster.</p>
          ${apiError ? `<p class="source-note error-text profile-api-error">${escapeHtml(apiError)}</p>` : ""}
        </div>
        <div class="profile-top-meta">
          <span class="profile-eyebrow">Profile Select</span>
          <span class="profile-eyebrow">Last local build ${escapeHtml(formatDateTime(data.reference.generated_at || "-"))}</span>
        </div>
        <section class="profile-list-shell">
          <div class="profile-section-heading">
            <h3>Available Profiles</h3>
            <p class="source-note">One local roster per profile.</p>
          </div>
          ${profiles.length ? `
            <div class="profile-list">
              ${profiles.map((profile) => `
                <article class="profile-card ${profile.id === state.selectedProfileId ? "active" : ""}" data-profile-card="${escapeHtml(profile.id)}">
                  <div class="profile-card-copy">
                    <h3>${escapeHtml(profile.name)}</h3>
                    <p class="source-note">Created ${escapeHtml(formatDateTime(profile.created_at))}</p>
                    <p class="source-note">Updated ${escapeHtml(formatDateTime(profile.updated_at))}</p>
                    <div class="badge-row">
                      ${profile.id === activeProfile?.id ? '<span class="badge badge-strong">Active</span>' : ""}
                      <span class="badge">${escapeHtml(profile.id)}</span>
                    </div>
                  </div>
                  <div class="profile-card-actions">
                    <button type="button" class="button-strong" data-open-profile="${escapeHtml(profile.id)}">Open profile</button>
                  </div>
                </article>
              `).join("")}
            </div>
          ` : `
            <div class="empty-state">No profile exists yet. The bootstrap wizard will help you create one.</div>
          `}
        </section>
      </div>
    `;

    profileGateEl.querySelectorAll("[data-profile-card]").forEach((card) => {
      card.addEventListener("click", () => {
        state.selectedProfileId = card.dataset.profileCard;
        requestRender();
      });
    });

    profileGateEl.querySelectorAll("[data-open-profile]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        await openProfile(button.dataset.openProfile);
      });
    });
  }

  function wizardNeedsReferenceBuild() {
    return Boolean(state.bootstrapStatus?.needs_initial_update || !state.bootstrapStatus?.has_dist_bundle);
  }

  function getWizardProgress() {
    const activeJob = state.adminJobs.active_job;
    if (!wizardNeedsReferenceBuild()) {
      return 100;
    }
    if (activeJob?.type === "update" && activeJob.status === "running") {
      if (Number.isFinite(activeJob.progress)) {
        return Math.max(8, Math.min(99, Number(activeJob.progress)));
      }
      if (!state.wizardBuildStartedAt) {
        state.wizardBuildStartedAt = Date.now();
      }
      const elapsedSeconds = Math.max(0, (Date.now() - state.wizardBuildStartedAt) / 1000);
      return Math.min(92, 12 + Math.round(elapsedSeconds * 9));
    }
    if (activeJob?.type === "update" && activeJob.status === "succeeded") {
      return 100;
    }
    return 8;
  }

  function getTimedProgress(startedAt, floor, cap, ratePerSecond) {
    const started = startedAt ? new Date(startedAt).getTime() : Date.now();
    const safeStarted = Number.isFinite(started) ? started : Date.now();
    const elapsedSeconds = Math.max(0, (Date.now() - safeStarted) / 1000);
    return Math.min(cap, floor + Math.round(elapsedSeconds * ratePerSecond));
  }

  function getUpdateProgress(job) {
    if (!job) {
      return state.bootstrapStatus?.has_reference_db ? 100 : 0;
    }

    if (job.type !== "update") {
      return state.bootstrapStatus?.has_reference_db ? 100 : 0;
    }

    if (Number.isFinite(job.progress)) {
      return Math.max(0, Math.min(100, Number(job.progress)));
    }

    if (job.status === "running") {
      return getTimedProgress(job.started_at, 10, 92, 9);
    }

    if (job.status === "succeeded") {
      return 100;
    }

    return 0;
  }

  function renderJobCheckpointList(job, className) {
    const checkpoints = asArray(job?.checkpoints).slice(-6);
    if (!checkpoints.length) {
      return "";
    }
    return `
      <div class="${className}">
        ${checkpoints.map((entry, index) => `
          <div class="job-checkpoint-item ${index === checkpoints.length - 1 && job?.status === "running" ? "active" : ""}">
            ${escapeHtml(entry)}
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderWizardPage() {
    const wizardProfile = state.profilesIndex.profiles.find((profile) => profile.id === state.wizardProfileId) || null;
    const activeJob = state.adminJobs.active_job;
    const updateFailed = activeJob?.type === "update" && activeJob.status === "failed";
    const progress = getWizardProgress();
    const wizardTitle = wizardProfile ? `Preparing ${wizardProfile.name}` : "Bootstrap wizard";

    let modalContent = "";

    if (state.wizardStep === "create" || !wizardProfile) {
      modalContent = `
        <div class="profile-section-heading">
          <h3>Create your first profile</h3>
          <p class="source-note">Start by choosing a name for the profile that will own your local roster data.</p>
        </div>
        <form id="wizardCreateProfileForm" class="profile-form">
          <label class="field-label" for="wizardProfileNameInput">Profile name</label>
          <input id="wizardProfileNameInput" name="profile_name" type="text" maxlength="80" placeholder="Main profile" required>
          <div class="profile-modal-actions">
            <button type="submit" class="button-strong">Create profile</button>
          </div>
        </form>
      `;
    } else if (state.wizardStep === "import") {
      modalContent = `
        <div class="profile-section-heading">
          <h3>Import existing data?</h3>
          <p class="source-note">You can optionally import a previously exported profile ZIP into <strong>${escapeHtml(wizardProfile.name)}</strong>.</p>
        </div>
        <div class="profile-form">
          <label class="field-label" for="wizardImportProfileInput">Profile ZIP</label>
          <input id="wizardImportProfileInput" type="file" accept=".zip,application/zip">
          <div class="profile-modal-actions wizard-choice-actions">
            <button type="button" class="button-secondary" id="wizardSkipImportButton">No, continue</button>
            <button type="button" class="button-strong" id="wizardImportProfileButton">Yes, import ZIP</button>
          </div>
          <p class="source-note ${state.adminStatus.kind === "error" ? "error-text" : ""}">${escapeHtml(state.adminStatus.message || "Skip this step if you do not have an export yet.")}</p>
        </div>
      `;
    } else {
      const currentTask = activeJob?.current_task || (wizardNeedsReferenceBuild() ? "Preparing local database..." : "Ready");
      modalContent = `
        <div class="profile-section-heading">
          <h3>Create the local base</h3>
          <p class="source-note">${escapeHtml(wizardNeedsReferenceBuild() ? "Building the local reference base from GameTora data. This can take several minutes, especially during the asset synchronization step." : "Local reference base is ready. Redirecting to My Roster...")}</p>
        </div>
        <div class="wizard-progress-shell">
          <div class="wizard-progress-track">
            <div class="wizard-progress-bar" style="width:${escapeHtml(progress)}%"></div>
          </div>
          <div class="wizard-progress-meta">
            <strong>${escapeHtml(`${progress}%`)}</strong>
            <span class="source-note">${escapeHtml(activeJob?.message || currentTask)}</span>
          </div>
          <div class="wizard-task-card">
            <strong>Current task</strong>
            <span class="source-note">${escapeHtml(currentTask)}</span>
          </div>
        </div>
        <div class="admin-meta-grid">
          <div class="admin-meta-card"><span class="meta-label">Profile</span><strong>${escapeHtml(wizardProfile.name)}</strong></div>
          <div class="admin-meta-card"><span class="meta-label">Reference Meta</span><strong>${state.bootstrapStatus?.has_reference_meta ? "Ready" : "Missing"}</strong></div>
          <div class="admin-meta-card"><span class="meta-label">Reference DB</span><strong>${state.bootstrapStatus?.has_reference_db ? "Ready" : "Missing"}</strong></div>
        </div>
        ${updateFailed ? `
          <div class="profile-modal-actions">
            <button type="button" class="button-strong" id="wizardRetryBuildButton">Retry local base creation</button>
          </div>
        ` : ""}
        <p class="source-note ${state.adminStatus.kind === "error" || updateFailed ? "error-text" : ""}">${escapeHtml(state.adminStatus.message || (updateFailed ? "Local base creation failed. Retry the operation." : "Please wait while the local reference is prepared."))}</p>
      `;
    }

    profileGateEl.innerHTML = `
      <div class="profile-landing profile-landing-wizard wizard-shell">
        <div class="profile-top-meta">
          <span class="profile-eyebrow">Bootstrap Wizard</span>
          <span class="profile-eyebrow">${escapeHtml(wizardTitle)}</span>
        </div>
        <div class="profile-landing-copy">
          <h2>First-time setup</h2>
          <p class="source-note">The assistant guides the profile creation, optional data import and local base creation before opening <strong>My Roster</strong>.</p>
        </div>
        <div class="profile-modal wizard-modal">
          <div class="profile-modal-backdrop"></div>
          <div class="profile-modal-card wizard-modal-card">
            ${modalContent}
          </div>
        </div>
      </div>
    `;

    const wizardCreateProfileForm = document.getElementById("wizardCreateProfileForm");
    if (wizardCreateProfileForm) {
      wizardCreateProfileForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(wizardCreateProfileForm);
        const name = String(formData.get("profile_name") || "").trim();
        if (!name) {
          return;
        }
        try {
          const payload = await apiJson("/api/profiles", {
            method: "POST",
            body: JSON.stringify({ name }),
          });
          state.profilesIndex = normalizeProfilesIndex(payload.profiles);
          state.profileIndexLoaded = true;
          state.wizardProfileId = payload.created_profile.id;
          state.wizardStep = "import";
          state.selectedProfileId = payload.created_profile.id;
          state.adminStatus = { kind: "ready", message: `Created profile ${payload.created_profile.name}.` };
          await loadBootstrapStatus(true);
          requestRender();
        } catch (error) {
          state.adminStatus = { kind: "error", message: error.message || "Could not create the profile." };
          requestRender();
        }
      });
    }

    const wizardImportProfileButton = document.getElementById("wizardImportProfileButton");
    if (wizardImportProfileButton) {
      wizardImportProfileButton.addEventListener("click", async () => {
        const input = document.getElementById("wizardImportProfileInput");
        const file = input?.files?.[0];
        if (!file) {
          state.adminStatus = { kind: "error", message: "Choose a profile ZIP to import first." };
          requestRender();
          return;
        }
        try {
          const response = await apiBinary(`/api/profiles/${encodeURIComponent(state.wizardProfileId)}/import`, {
            method: "POST",
            headers: {
              "Content-Type": "application/zip",
            },
            body: file,
          });
          const payload = await response.json();
          state.profilesIndex = normalizeProfilesIndex(payload.profiles);
          state.profileIndexLoaded = true;
          state.selectedProfileId = payload.profile.id;
          state.adminStatus = { kind: "ready", message: `Imported data into ${payload.profile.name}.` };
          state.wizardStep = "build";
          await loadBootstrapStatus(true);
          requestRender();
        } catch (error) {
          state.adminStatus = { kind: "error", message: error.message || "Could not import the profile archive." };
          requestRender();
        }
      });
    }

    const wizardSkipImportButton = document.getElementById("wizardSkipImportButton");
    if (wizardSkipImportButton) {
      wizardSkipImportButton.addEventListener("click", () => {
        state.adminStatus = { kind: "idle", message: "" };
        state.wizardStep = "build";
        requestRender();
      });
    }

    const wizardRetryBuildButton = document.getElementById("wizardRetryBuildButton");
    if (wizardRetryBuildButton) {
      wizardRetryBuildButton.addEventListener("click", async () => {
        state.wizardBuildAutoStarted = false;
        state.wizardBuildStartedAt = null;
        state.adminStatus = { kind: "idle", message: "" };
        requestRender();
      });
    }
  }

  function renderAdminPage() {
    const activeJob = state.adminJobs.active_job;
    const recentJobs = asArray(state.adminJobs.recent_jobs);
    const activeProfile = getActiveProfile();
    const profiles = state.profilesIndex.profiles;
    const rosterEntityKey = defaultEntityKeyForMode("roster");
    const referenceEntityKey = defaultEntityKeyForMode("reference");
    const latestUpdateJob = [activeJob, ...recentJobs].find((job) => job?.type === "update") || null;
    const updateProgress = getUpdateProgress(latestUpdateJob);
    const updateCurrentTask = latestUpdateJob?.current_task || "Idle";
    const updateProgressText = activeJob?.type === "update" && activeJob.status === "running"
      ? (activeJob.message || "Update in progress...")
      : latestUpdateJob?.status === "succeeded"
        ? "Last update completed."
        : latestUpdateJob?.status === "failed"
          ? "Last update failed."
          : (state.bootstrapStatus?.has_reference_db ? "Reference is ready." : "No update has been run yet.");

    profileGateEl.innerHTML = `
      <div class="profile-landing admin-landing">
        <div class="profile-top-meta">
          <nav class="mode-nav admin-page-nav" aria-label="Administration navigation">
            <button class="mode-button" type="button" data-mode="roster" data-target-entity="${escapeHtml(rosterEntityKey)}">
              My Roster
            </button>
            <button class="mode-button" type="button" data-mode="reference" data-target-entity="${escapeHtml(referenceEntityKey)}">
              Catalog
            </button>
          </nav>
        </div>
        <div class="profile-landing-copy">
          <h2>Administration</h2>
          <p class="source-note ${state.adminStatus.kind === "error" ? "error-text" : ""}">${escapeHtml(state.adminStatus.message || "Manage updates, backups and local profiles from a single page.")}</p>
        </div>
        <div class="admin-layout">
          <section class="profile-list-shell">
            <div class="profile-section-heading profile-section-heading-split">
              <div class="profile-section-heading-copy">
                <h3>Reference maintenance</h3>
                <p class="source-note">Trigger a local update and follow the current job state.</p>
              </div>
              <div class="admin-section-actions">
                <button type="button" class="button-strong" id="adminRunUpdateButton" ${activeJob ? "disabled" : ""}>Run update</button>
                <button type="button" class="button-secondary" id="adminRefreshButton">Refresh status</button>
              </div>
            </div>
            <div class="admin-meta-grid">
              <div class="admin-meta-card"><span class="meta-label">Last build</span><strong>${escapeHtml(formatDateTime(data.reference.generated_at || "-"))}</strong></div>
              <div class="admin-meta-card"><span class="meta-label">Reference DB</span><strong>${state.bootstrapStatus?.has_reference_db ? "Ready" : "Missing"}</strong></div>
              <div class="admin-meta-card"><span class="meta-label">Active job</span><strong>${escapeHtml(activeJob ? `${activeJob.type} / ${activeJob.status}` : "Idle")}</strong></div>
            </div>
            <div class="admin-progress-shell">
              <div class="admin-progress-head">
                <strong>Update progress</strong>
                <span>${escapeHtml(`${updateProgress}%`)}</span>
              </div>
              <div class="wizard-progress-track">
                <div class="wizard-progress-bar" style="width:${escapeHtml(updateProgress)}%"></div>
              </div>
              <p class="source-note">${escapeHtml(updateProgressText)}</p>
              <div class="wizard-task-card admin-task-card">
                <strong>Current task</strong>
                <span class="source-note">${escapeHtml(updateCurrentTask)}</span>
              </div>
              ${renderJobCheckpointList(latestUpdateJob, "job-checkpoint-list")}
            </div>
            <div class="admin-job-list-shell">
              <div class="admin-job-list">
              ${recentJobs.length ? recentJobs.map((job) => `
                <article class="admin-job-item">
                  <strong>${escapeHtml(job.type)}</strong>
                  <span>${escapeHtml(job.status)}</span>
                  <span>${escapeHtml(formatDateTime(job.finished_at || job.started_at || job.created_at))}</span>
                </article>
              `).join("") : "<p class='source-note'>No admin job has been recorded yet.</p>"}
              </div>
            </div>
          </section>
          <section class="profile-list-shell">
            <div class="profile-section-heading profile-section-heading-split">
              <div class="profile-section-heading-copy">
                <h3>Backups</h3>
                <p class="source-note">Create and restore full local backups.</p>
              </div>
              <div class="admin-section-actions">
                <button type="button" class="button-strong" id="adminCreateBackupButton" ${activeJob ? "disabled" : ""}>Create backup</button>
              </div>
            </div>
            <div class="admin-list">
              ${state.backups.length ? state.backups.map((backup) => `
                <article class="admin-list-item">
                  <div class="admin-list-copy">
                    <strong>${escapeHtml(backup.filename)}</strong>
                    <span class="source-note">${escapeHtml(formatDateTime(backup.created_at))} | ${escapeHtml(`${Math.round((backup.size_bytes || 0) / 1024)} KB`)}</span>
                  </div>
                  <div class="admin-inline-actions">
                    <button type="button" data-backup-download="${escapeHtml(backup.id)}">Download</button>
                    <button type="button" class="button-secondary" data-backup-restore="${escapeHtml(backup.id)}" ${activeJob ? "disabled" : ""}>Restore</button>
                    <button type="button" class="button-danger" data-backup-delete="${escapeHtml(backup.id)}">Delete</button>
                  </div>
                </article>
              `).join("") : "<p class='source-note'>No local backup yet.</p>"}
            </div>
          </section>
          <section class="profile-list-shell admin-profiles-shell">
            <div class="profile-section-heading">
              <h3>Profiles</h3>
              <p class="source-note">Create, rename, export, import and delete local profiles.</p>
            </div>
            <form id="adminCreateProfileForm" class="profile-form">
              <label class="field-label" for="adminProfileNameInput">Create profile</label>
              <div class="admin-inline-form">
                <input id="adminProfileNameInput" name="profile_name" type="text" maxlength="80" placeholder="New profile" required>
                <button type="submit" class="button-strong">Create</button>
              </div>
            </form>
            <div class="profile-form">
              <label class="field-label" for="adminImportProfileInput">Import profile ZIP</label>
              <div class="admin-inline-form">
                <input id="adminImportProfileInput" type="file" accept=".zip,application/zip">
                <button type="button" class="button-secondary" id="adminImportProfileButton">Import</button>
              </div>
            </div>
            <div class="admin-list">
              ${profiles.map((profile) => `
                <article class="admin-list-item">
                  <div class="admin-list-copy">
                    <strong>${escapeHtml(profile.name)}</strong>
                    <span class="source-note">${escapeHtml(profile.id)}${profile.id === activeProfile?.id ? " | Active" : ""}</span>
                  </div>
                  <div class="admin-inline-actions">
                    <button type="button" data-profile-rename="${escapeHtml(profile.id)}">Rename</button>
                    <button type="button" class="button-secondary" data-profile-export="${escapeHtml(profile.id)}">Export</button>
                    <button type="button" class="button-danger" data-profile-delete-admin="${escapeHtml(profile.id)}">Delete</button>
                  </div>
                </article>
              `).join("")}
            </div>
          </section>
        </div>
      </div>
    `;

    profileGateEl.querySelectorAll(".admin-page-nav [data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        setBrowseHash(button.dataset.mode, button.dataset.targetEntity, null);
      });
    });

    const adminRunUpdateButton = document.getElementById("adminRunUpdateButton");
    if (adminRunUpdateButton) {
      adminRunUpdateButton.addEventListener("click", async () => {
        await runAdminJob("Update", "/api/admin/jobs/update");
        await refreshAdminData(true);
      });
    }

    const adminCreateBackupButton = document.getElementById("adminCreateBackupButton");
    if (adminCreateBackupButton) {
      adminCreateBackupButton.addEventListener("click", async () => {
        await runAdminJob("Backup", "/api/admin/jobs/backup");
        await refreshAdminData(true);
      });
    }

    const adminRefreshButton = document.getElementById("adminRefreshButton");
    if (adminRefreshButton) {
      adminRefreshButton.addEventListener("click", async () => {
        await refreshAdminData(true);
        requestRender();
      });
    }

    const adminCreateProfileForm = document.getElementById("adminCreateProfileForm");
    if (adminCreateProfileForm) {
      adminCreateProfileForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(adminCreateProfileForm);
        const name = String(formData.get("profile_name") || "").trim();
        if (!name) {
          return;
        }
        try {
          const payload = await apiJson("/api/profiles", {
            method: "POST",
            body: JSON.stringify({ name }),
          });
          state.profilesIndex = normalizeProfilesIndex(payload.profiles);
          state.profileIndexLoaded = true;
          state.adminStatus = { kind: "ready", message: `Created profile ${payload.created_profile.name}.` };
          syncSelectedProfileId();
          await loadBootstrapStatus(true);
          requestRender();
        } catch (error) {
          state.adminStatus = { kind: "error", message: error.message || "Could not create the profile." };
          requestRender();
        }
      });
    }

    const adminImportProfileButton = document.getElementById("adminImportProfileButton");
    if (adminImportProfileButton) {
      adminImportProfileButton.addEventListener("click", async () => {
        const input = document.getElementById("adminImportProfileInput");
        const file = input?.files?.[0];
        if (!file) {
          state.adminStatus = { kind: "error", message: "Choose a profile ZIP to import first." };
          requestRender();
          return;
        }
        try {
          const createdProfile = await importProfileArchive(file);
          state.adminStatus = { kind: "ready", message: `Imported profile ${createdProfile.name}.` };
          syncSelectedProfileId();
          requestRender();
        } catch (error) {
          state.adminStatus = { kind: "error", message: error.message || "Could not import the profile archive." };
          requestRender();
        }
      });
    }

    profileGateEl.querySelectorAll("[data-profile-rename]").forEach((button) => {
      button.addEventListener("click", async () => {
        const profileId = button.dataset.profileRename;
        const profile = profiles.find((entry) => entry.id === profileId);
        if (!profile) {
          return;
        }
        const nextName = window.prompt("Rename profile", profile.name);
        if (!nextName || nextName.trim() === profile.name) {
          return;
        }
        try {
          await renameProfileAndRefresh(profileId, nextName.trim());
          state.adminStatus = { kind: "ready", message: `Renamed profile to ${nextName.trim()}.` };
        } catch (error) {
          state.adminStatus = { kind: "error", message: error.message || "Could not rename the profile." };
        }
        requestRender();
      });
    });

    profileGateEl.querySelectorAll("[data-profile-export]").forEach((button) => {
      button.addEventListener("click", () => {
        downloadProfileExport(button.dataset.profileExport);
      });
    });

    profileGateEl.querySelectorAll("[data-profile-delete-admin]").forEach((button) => {
      button.addEventListener("click", async () => {
        const profileId = button.dataset.profileDeleteAdmin;
        const profile = profiles.find((entry) => entry.id === profileId);
        if (!profile || !window.confirm(`Delete profile "${profile.name}" and its local roster data?`)) {
          return;
        }
        try {
          await deleteProfileAndRefresh(profileId);
          state.adminStatus = { kind: "ready", message: `Deleted profile ${profile.name}.` };
        } catch (error) {
          state.adminStatus = { kind: "error", message: error.message || "Could not delete the profile." };
          requestRender();
        }
      });
    });

    profileGateEl.querySelectorAll("[data-backup-download]").forEach((button) => {
      button.addEventListener("click", () => downloadBackup(button.dataset.backupDownload));
    });

    profileGateEl.querySelectorAll("[data-backup-restore]").forEach((button) => {
      button.addEventListener("click", async () => {
        const backupId = button.dataset.backupRestore;
        if (!window.confirm(`Restore backup ${backupId}? This will replace local app data.`)) {
          return;
        }
        await restoreBackupAndRefresh(backupId);
      });
    });

    profileGateEl.querySelectorAll("[data-backup-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        const backupId = button.dataset.backupDelete;
        if (!window.confirm(`Delete backup ${backupId}?`)) {
          return;
        }
        try {
          const payload = await apiJson(`/api/admin/backups/${encodeURIComponent(backupId)}`, { method: "DELETE" });
          state.backups = asArray(payload.items);
          state.adminStatus = { kind: "ready", message: `Deleted backup ${backupId}.` };
        } catch (error) {
          state.adminStatus = { kind: "error", message: error.message || "Could not delete the backup." };
        }
        requestRender();
      });
    });
  }

  function renderProfileGate(route) {
    if (!profileGateEl) {
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

  function renderNav(mode, activeKey) {
    const keys = allowedEntityKeys(mode);
    navEl.innerHTML = keys
      .map((key) => {
        const totalCount = data.reference.entities[key].count;
        const ownedCount = mode === "roster" ? rosterCountForEntity(key, (entry) => entry.owned) : 0;
        const metaText = mode === "roster" ? `${totalCount} cards | ${ownedCount} owned` : `${totalCount} items`;
        return `
          <button class="entity-button ${key === activeKey ? "active" : ""}" data-entity="${escapeHtml(key)}" data-mode="${escapeHtml(mode)}" type="button">
            <strong>${escapeHtml(data.entities[key].label)}</strong><br>
            <span class="entity-meta">${escapeHtml(metaText)}</span>
          </button>
        `;
      })
      .join("");

    navEl.querySelectorAll("[data-entity]").forEach((button) => {
      button.addEventListener("click", () => setBrowseHash(mode, button.dataset.entity, null));
    });
  }

  function renderFilters(mode, entityKey) {
    const localState = getViewState(mode, entityKey);

    filtersEl.innerHTML = getFilterDefinitions(mode, entityKey)
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

    filtersEl.querySelectorAll("[data-filter-key]").forEach((input) => {
      input.addEventListener("change", (event) => {
        const key = event.target.dataset.filterKey;
        const values = Array.from(filtersEl.querySelectorAll(`[data-filter-key="${key}"]:checked`)).map((node) => node.value);
        localState.filters[key] = values;
        requestRender();
      });
    });

    filtersEl.querySelectorAll("details").forEach((detailsEl) => {
      detailsEl.addEventListener("toggle", () => {
        window.requestAnimationFrame(syncToolbarMetrics);
      });
    });
  }

  function renderBrowseActions(route, filteredItems) {
    if (!browseActionsEl) {
      return;
    }

    if (route.page !== "browse" || route.mode !== "roster") {
      browseActionsEl.innerHTML = "";
      browseActionsEl.hidden = true;
      return;
    }

    const localState = getViewState(route.mode, route.entityKey);
    const isBatch = localState.presentation === "batch";
    browseActionsEl.hidden = false;
    browseActionsEl.innerHTML = `
      <div class="presentation-switch">
        <button type="button" class="${!isBatch ? "active" : ""}" data-roster-presentation="detail">Detail</button>
        <button type="button" class="${isBatch ? "active" : ""}" data-roster-presentation="batch">Batch</button>
      </div>
      ${isBatch ? `
        <div class="batch-toolbar">
          <button type="button" class="button-secondary" data-batch-favorite="yes">Favorite filtered</button>
          <button type="button" class="button-secondary" data-batch-favorite="no">Unfavorite filtered</button>
          <button type="button" class="button-secondary" data-batch-tag="add">Add tag</button>
          <button type="button" class="button-secondary" data-batch-tag="remove">Remove tag</button>
        </div>
      ` : ""}
    `;

    browseActionsEl.querySelectorAll("[data-roster-presentation]").forEach((button) => {
      button.addEventListener("click", () => {
        localState.presentation = button.dataset.rosterPresentation;
        if (localState.presentation === "batch") {
          localState.selectedId = null;
        }
        requestRender();
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
  }

  async function applyBatchFavorite(entityKey, filteredItems, nextValue) {
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

  async function applyBatchTag(entityKey, filteredItems, action, rawTag) {
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

  function renderBatchList(entityKey, filteredItems) {
    if (!filteredItems.length) {
      listEl.innerHTML = "<div class='empty-state'>No owned entry matches the current roster search and filters.</div>";
      return;
    }

    listEl.innerHTML = `
      <div class="batch-table-shell">
        <table class="batch-table">
          <thead>
            <tr>
              <th>Entry</th>
              <th>Favorite</th>
              ${entityKey === "characters" ? "<th>Stars</th><th>Awk</th><th>Unique</th><th>Unlock</th>" : "<th>Level</th><th>LB</th><th>Cap</th><th>Usable</th>"}
              <th>Tags</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${filteredItems.map((item) => {
              const entry = getRosterEntry(entityKey, item);
              const derived = getRosterViewEntry(entityKey, item)?.derived || {};
              return `
                <tr data-batch-row="${escapeHtml(item.id)}">
                  <td>
                    <button type="button" class="batch-open-button" data-open-item="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>
                    <div class="batch-row-subtitle">${escapeHtml(item.subtitle || "")}</div>
                  </td>
                  <td><input data-batch-field="favorite" type="checkbox" ${entry.favorite ? "checked" : ""}></td>
                  ${entityKey === "characters"
                    ? `
                      <td><input data-batch-field="stars" type="number" min="0" max="5" value="${escapeHtml(entry.stars)}"></td>
                      <td><input data-batch-field="awakening" type="number" min="0" max="5" value="${escapeHtml(entry.awakening)}"></td>
                      <td><input data-batch-field="unique_level" type="number" min="1" max="6" value="${escapeHtml(entry.unique_level || 1)}"></td>
                      <td>${escapeHtml(derived.unlock_state || "-")}</td>
                    `
                    : `
                      <td><input data-batch-field="level" type="number" min="1" max="50" value="${escapeHtml(entry.level)}"></td>
                      <td><input data-batch-field="limit_break" type="number" min="0" max="4" value="${escapeHtml(entry.limit_break)}"></td>
                      <td>${escapeHtml(derived.level_cap || "-")}</td>
                      <td>${escapeHtml(derived.usable ? "Yes" : "No")}</td>
                    `}
                  <td><input data-batch-field="custom_tags" type="text" value="${escapeHtml(asArray(entry.custom_tags).join(", "))}" placeholder="tag, tag"></td>
                  <td><input data-batch-field="status_flags" type="text" value="${escapeHtml(asArray(entry.status_flags).join(", "))}" placeholder="flag, flag"></td>
                  <td>${escapeHtml(derived.progress_bucket || "-")}</td>
                  <td><button type="button" class="button-strong batch-save-button" data-save-batch-row="${escapeHtml(item.id)}">Save</button></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    listEl.querySelectorAll("[data-open-item]").forEach((button) => {
      button.addEventListener("click", () => {
        setBrowseHash("roster", entityKey, button.dataset.openItem);
      });
    });

    listEl.querySelectorAll("[data-save-batch-row]").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = filteredItems.find((entry) => entry.id === button.dataset.saveBatchRow);
        const row = button.closest("[data-batch-row]");
        if (!item || !row) {
          return;
        }
        await saveBatchRow(entityKey, item, row);
      });
    });
  }

  function collectBatchRowData(entityKey, item, row) {
    const defaults = getDefaultRosterEntry(entityKey, item);
    const baseEntry = {
      owned: true,
      favorite: row.querySelector('[data-batch-field="favorite"]')?.checked || false,
      note: getRosterEntry(entityKey, item).note || "",
      custom_tags: parseRosterTokenList(row.querySelector('[data-batch-field="custom_tags"]')?.value),
      status_flags: parseRosterTokenList(row.querySelector('[data-batch-field="status_flags"]')?.value),
    };

    if (entityKey === "characters") {
      return {
        ...baseEntry,
        stars: clampNumber(row.querySelector('[data-batch-field="stars"]')?.value, 0, 5, defaults.stars),
        awakening: clampNumber(row.querySelector('[data-batch-field="awakening"]')?.value, 0, 5, defaults.awakening),
        unique_level: clampNumber(row.querySelector('[data-batch-field="unique_level"]')?.value, 1, 6, defaults.unique_level || 1),
      };
    }

    return {
      ...baseEntry,
      level: clampNumber(row.querySelector('[data-batch-field="level"]')?.value, 1, 50, defaults.level),
      limit_break: clampNumber(row.querySelector('[data-batch-field="limit_break"]')?.value, 0, 4, defaults.limit_break),
    };
  }

  async function saveBatchRow(entityKey, item, row) {
    setRosterEntry(entityKey, item, collectBatchRowData(entityKey, item, row));
    await persistRosterDocument(`Saved ${item.title}.`);
  }

  function renderList(mode, entityKey, filteredItems) {
    const localState = getViewState(mode, entityKey);
    if (mode === "roster" && localState.presentation === "batch") {
      renderBatchList(entityKey, filteredItems);
      return;
    }
    if (!filteredItems.length) {
      listEl.innerHTML = mode === "roster"
        ? "<div class='empty-state'>No owned entry matches the current roster search and filters. Go to <strong>Catalog</strong> to add the characters and supports you own first.</div>"
        : "<div class='empty-state'>No result for the current search and filter set.</div>";
      return;
    }

    listEl.innerHTML = filteredItems
      .map((item) => {
        const rosterBadges = getRosterBadges(entityKey, item, mode);
        const displayBadges = [...rosterBadges, ...asArray(item.badges).filter(Boolean)].slice(0, 7);

        return `
          <article class="result-card ${item.id === localState.selectedId ? "active" : ""}" data-item-id="${escapeHtml(item.id)}">
            ${renderResultTop(item, entityKey)}
            <div class="badge-row">
              ${displayBadges.map((badge) => renderBadge(badge)).join("")}
            </div>
          </article>
        `;
      })
      .join("");

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

  function renderReferenceRosterActions(entityKey, item) {
    if (!rosterEntityKeys.includes(entityKey) || !state.activeProfileId) {
      return "";
    }

    const entry = getRosterEntry(entityKey, item);
    return `
      <div class="detail-section roster-section">
        <h3>${entry.owned ? "Owned Entry" : "Add to My Roster"}</h3>
        <p class="source-note">
          ${entry.owned
            ? "This entry is already in your roster. Remove it here if you no longer own it."
            : "Add this entry to your roster, then switch to My Roster to edit notes and progression."}
        </p>
        <div class="roster-actions">
          ${entry.owned
            ? `<button type="button" class="button-secondary" id="removeFromRosterButton">Remove from roster</button>`
            : `<button type="button" class="button-strong" id="addToRosterButton">Add to roster</button>`}
        </div>
      </div>
    `;
  }

  function renderRosterEditor(entityKey, item) {
    if (!rosterEntityKeys.includes(entityKey) || !state.activeProfileId) {
      return "";
    }

    const entry = getRosterEntry(entityKey, item);
    const viewEntry = getRosterViewEntry(entityKey, item);
    const derived = viewEntry?.derived || null;
    const statusText = state.rosterStatus.message || "Changes are stored locally for the active profile.";
    const progressFields = entityKey === "characters"
      ? `
        <label class="field-stack">
          <span>Stars</span>
          <input name="stars" type="number" min="0" max="5" value="${escapeHtml(entry.stars)}">
        </label>
        <label class="field-stack">
          <span>Awakening</span>
          <input name="awakening" type="number" min="0" max="5" value="${escapeHtml(entry.awakening)}">
        </label>
        <label class="field-stack">
          <span>Unique Level</span>
          <input name="unique_level" type="number" min="1" max="6" value="${escapeHtml(entry.unique_level || 1)}">
        </label>
      `
      : `
        <label class="field-stack">
          <span>Level</span>
          <input name="level" type="number" min="1" max="50" value="${escapeHtml(entry.level)}">
        </label>
        <label class="field-stack">
          <span>Limit break</span>
          <input name="limit_break" type="number" min="0" max="4" value="${escapeHtml(entry.limit_break)}">
        </label>
      `;

    return `
      <div class="detail-section roster-section">
        <h3>Roster</h3>
        <p class="source-note">Editing the owned roster entry for <strong>${escapeHtml(getActiveProfile()?.name || "selected profile")}</strong>.</p>
        <form id="rosterForm" class="roster-form" data-item-id="${escapeHtml(item.id)}" data-entity-key="${escapeHtml(entityKey)}">
          <div class="roster-toggle-row">
            <label class="toggle-field">
              <input name="favorite" type="checkbox" ${entry.favorite ? "checked" : ""}>
              <span>Favorite</span>
            </label>
          </div>
          <div class="roster-field-grid">
            ${progressFields}
            <label class="field-stack field-stack-full">
              <span>Local Tags</span>
              <input name="custom_tags" type="text" placeholder="comma, separated, tags" value="${escapeHtml(asArray(entry.custom_tags).join(", "))}">
            </label>
            <label class="field-stack field-stack-full">
              <span>Status Flags</span>
              <input name="status_flags" type="text" placeholder="ready, farming, candidate" value="${escapeHtml(asArray(entry.status_flags).join(", "))}">
            </label>
            <label class="field-stack field-stack-full">
              <span>Note</span>
              <textarea name="note" rows="4" placeholder="Optional local note">${escapeHtml(entry.note || "")}</textarea>
            </label>
          </div>
          <div class="roster-actions">
            <button type="submit" class="button-strong">Save locally</button>
            <button type="button" class="button-secondary" id="removeFromRosterButton">Remove from roster</button>
            <button type="button" class="button-secondary" id="rosterResetButton">Reset entry</button>
          </div>
          <p id="rosterStatus" class="source-note ${state.rosterStatus.kind === "error" ? "error-text" : ""}">${escapeHtml(statusText)}</p>
        </form>
        ${derived ? `
          <div class="roster-editor-meta-grid">
            <div class="admin-meta-card"><span class="meta-label">Progress</span><strong>${escapeHtml(derived.progress_bucket || "-")}</strong></div>
            ${entityKey === "characters"
              ? `<div class="admin-meta-card"><span class="meta-label">Unlock State</span><strong>${escapeHtml(derived.unlock_state || "-")}</strong></div>`
              : `<div class="admin-meta-card"><span class="meta-label">Usable</span><strong>${escapeHtml(derived.usable ? "Yes" : "No")}</strong></div>`}
            <div class="admin-meta-card"><span class="meta-label">Tags</span><strong>${escapeHtml(asArray(derived.custom_tags).join(", ") || "-")}</strong></div>
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderBrowseBody(entityKey, detail, rosterProjection) {
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

  function attachRosterFormListeners(entityKey, item) {
    const rosterForm = document.getElementById("rosterForm");
    if (!rosterForm) {
      return;
    }

    rosterForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveRosterForm(entityKey, item, rosterForm);
    });

    const removeButton = document.getElementById("removeFromRosterButton");
    if (removeButton) {
      removeButton.addEventListener("click", async () => {
        await removeItemFromRoster(entityKey, item);
      });
    }

    const resetButton = document.getElementById("rosterResetButton");
    if (resetButton) {
      resetButton.addEventListener("click", async () => {
        await resetRosterEntry(entityKey, item);
      });
    }
  }

  function renderDetail(route, selectedItem) {
    const localState = route.page === "browse" ? getViewState(route.mode, route.entityKey) : null;
    const isBatchMode = Boolean(route.mode === "roster" && localState?.presentation === "batch");
    if (isBatchMode) {
      detailEl.innerHTML = "<div class='detail-empty'>Batch mode focuses on quick inline maintenance. Use <strong>Open</strong> on a row or switch back to <strong>Detail</strong> mode for the full roster sheet.</div>";
      return;
    }

    if (!selectedItem) {
      detailEl.innerHTML = route.mode === "roster"
        ? "<div class='detail-empty'>Select an owned entry to inspect its reference data and edit the local roster fields. If the roster is empty, add entries from <strong>Catalog</strong> first.</div>"
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

    if (detailPanelEl) {
      detailPanelEl.scrollTop = 0;
    }
  }

  function syncHeader(route) {
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
    if (refreshCommandBlock) {
      refreshCommandBlock.hidden = (route.page === "profiles" || route.page === "wizard" || (route.page === "browse" && route.mode === "roster"));
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

    pageTitleEl.textContent = route.mode === "roster" ? "My Roster" : "Umamusume Pretty Derby Catalog";

    if (route.mode === "roster") {
      summaryText.textContent = activeProfile
        ? `Owned characters and supports for ${activeProfile.name}.`
        : "My Roster only shows owned characters and supports.";
      datasetHeadingEl.textContent = "Roster Datasets";
      return;
    }

    summaryText.textContent = "Browse the local catalog and add the characters and supports you own to My Roster.";
    datasetHeadingEl.textContent = "Catalog Datasets";
  }

  function syncShellVisibility(route) {
    const isGatePage = route.page === "profiles" || route.page === "wizard" || route.page === "admin";
    const isProfilesLikePage = route.page === "profiles" || route.page === "wizard" || route.page === "admin";
    profileGateEl.hidden = !isGatePage;
    if (topHeaderEl) {
      topHeaderEl.hidden = isProfilesLikePage;
    }
    datasetBarEl.hidden = isGatePage;
    toolbarEl.hidden = isGatePage;
    if (resultsPanelEl) {
      resultsPanelEl.hidden = isGatePage;
    }
    detailColumnEl.hidden = isGatePage;
    backToTopButton.hidden = isGatePage;
    document.body.classList.toggle("route-profiles", route.page === "profiles");
    document.body.classList.toggle("route-wizard", route.page === "wizard");
    document.body.classList.toggle("route-admin", route.page === "admin");
    document.body.classList.toggle("route-roster", route.page === "browse" && route.mode === "roster");
    document.body.classList.toggle("route-catalog", route.page === "browse" && route.mode === "reference");

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

  function renderBrowse(route) {
    const entity = data.entities[route.entityKey];
    const localState = getViewState(route.mode, route.entityKey);
    const isBatchMode = route.mode === "roster" && localState.presentation === "batch";

    if (route.itemId) {
      localState.selectedId = route.itemId;
    } else if (isCompactLayout()) {
      localState.selectedId = null;
    }

    renderNav(route.mode, route.entityKey);
    entityTitleEl.textContent = route.mode === "roster" ? `${entity.label} Roster` : entity.label;

    if (route.mode === "roster") {
      const ownedCount = rosterCountForEntity(route.entityKey, (entry) => entry.owned);
      entityMetaEl.textContent =
        `${ownedCount} owned entries | ${data.reference.entities[route.entityKey].count} available in catalog | roster updated ${formatDateTime(state.rosterDocument.updated_at || "-")}`;
    } else {
      entityMetaEl.textContent =
        `${data.reference.entities[route.entityKey].count} items | imported ${formatDateTime(entity.source.imported_at || "-")}`;
    }

    searchInput.placeholder = route.mode === "roster" ? "Search in current roster dataset" : "Search in current dataset";
    clearButton.textContent = route.mode === "roster" ? "Reset filters" : "Reset";
    searchInput.value = localState.query;
    renderFilters(route.mode, route.entityKey);

    const filteredItems = getFilteredItems(route.mode, route.entityKey);
    renderBrowseActions(route, filteredItems);
    resultCountEl.textContent = `${filteredItems.length} visible`;

    if (localState.selectedId && !filteredItems.some((item) => item.id === localState.selectedId)) {
      localState.selectedId = null;
    }

    if (!isCompactLayout() && !localState.selectedId && !isBatchMode) {
      localState.selectedId = filteredItems[0]?.id || null;
    }

    const selectedItem = filteredItems.find((item) => item.id === localState.selectedId) || null;
    if (detailColumnEl) {
      detailColumnEl.hidden = isBatchMode;
    }
    document.body.classList.toggle("roster-batch-mode", isBatchMode);
    syncLayoutMode(Boolean(selectedItem) && !isBatchMode);
    renderList(route.mode, route.entityKey, filteredItems);
    renderDetail(route, selectedItem);
  }

  async function apiJson(url, options) {
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

  async function apiBinary(url, options) {
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

  async function loadBootstrapStatus(force) {
    if (state.bootstrapStatusLoaded && !force) {
      return;
    }

    state.bootstrapStatus = await apiJson("/api/app/bootstrap-status");
    state.bootstrapStatusLoaded = true;
  }

  async function loadProfilesIndex(force) {
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
      state.profilesApiStatus = {
        kind: "error",
        message: "Profile API unavailable. Restart the local Python server to enable profile creation and selection.",
      };
      throw error;
    }
  }

  async function loadAdminJobs(force) {
    if (!force && state.adminJobs.active_job && state.adminJobs.active_job.status === "running") {
      state.adminJobs = await apiJson("/api/admin/jobs");
      return;
    }
    if (!force && state.adminJobs.recent_jobs.length) {
      return;
    }
    state.adminJobs = await apiJson("/api/admin/jobs");
  }

  async function loadBackups(force) {
    if (!force && state.backups.length) {
      return;
    }
    const payload = await apiJson("/api/admin/backups");
    state.backups = asArray(payload.items);
  }

  async function loadRosterForProfile(profileId, force) {
    if (!profileId) {
      state.rosterProfileId = null;
      state.rosterDocument = normalizeRosterDocument(null);
      state.rosterViews.characters = normalizeRosterViewPayload("characters", null);
      state.rosterViews.supports = normalizeRosterViewPayload("supports", null);
      return;
    }

    if (!force && state.rosterProfileId === profileId) {
      return;
    }

    state.rosterDocument = normalizeRosterDocument(await apiJson(`/api/profiles/${encodeURIComponent(profileId)}/roster`));
    state.rosterProfileId = profileId;
    state.rosterStatus = { kind: "idle", message: "" };
  }

  async function loadRosterViewsForProfile(profileId, force) {
    if (!profileId) {
      state.rosterViews.characters = normalizeRosterViewPayload("characters", null);
      state.rosterViews.supports = normalizeRosterViewPayload("supports", null);
      return;
    }

    const entitiesToLoad = rosterEntityKeys.filter((entityKey) => {
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

  async function createProfileAndOpen(name) {
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

  async function deleteProfileAndRefresh(profileId) {
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
    }
    if (state.wizardProfileId === profileId) {
      state.wizardProfileId = null;
    }

    syncSelectedProfileId();
    await loadBootstrapStatus(true);
    setProfilesHash();
  }

  async function renameProfileAndRefresh(profileId, name) {
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

  async function importProfileArchive(file) {
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

  function downloadProfileExport(profileId) {
    window.location.href = `/api/profiles/${encodeURIComponent(profileId)}/export`;
  }

  function downloadBackup(backupId) {
    window.location.href = `/api/admin/backups/${encodeURIComponent(backupId)}`;
  }

  async function openProfile(profileId, profilesAlreadyFresh) {
    if (!profilesAlreadyFresh) {
      await loadProfilesIndex(true);
    }

    await apiJson("/api/profiles/select", {
      method: "POST",
      body: JSON.stringify({ profile_id: profileId }),
    });

    await loadProfilesIndex(true);
    state.activeProfileId = profileId;
    state.selectedProfileId = profileId;
    state.wizardProfileId = null;
    state.wizardStep = "create";
    state.wizardBuildStartedAt = null;
    state.wizardBuildAutoStarted = false;
    state.wizardRedirectScheduled = false;
    await loadRosterForProfile(profileId, true);
    await loadRosterViewsForProfile(profileId, true);
    setBrowseHash("roster", "characters", null);
  }

  async function runAdminJob(jobType, endpoint) {
    state.adminStatus = { kind: "working", message: `${jobType} started...` };
    requestRender();

    try {
      const job = await apiJson(endpoint, { method: "POST" });
      state.adminJobs = {
        active_job: job,
        recent_jobs: asArray(state.adminJobs.recent_jobs),
      };
      await loadAdminJobs(true);
      state.adminStatus = { kind: "ready", message: `${jobType} is running in background.` };
    } catch (error) {
      state.adminStatus = { kind: "error", message: error.message || `Could not start ${jobType}.` };
    }

    requestRender();
  }

  async function refreshAdminData(force) {
    await loadAdminJobs(force);
    await loadBackups(force);
    await loadBootstrapStatus(true);
  }

  async function restoreBackupAndRefresh(backupId) {
    await runAdminJob("Restore", `/api/admin/backups/${encodeURIComponent(backupId)}/restore`);
  }

  function collectRosterFormData(entityKey, item, formEl) {
    const defaults = getDefaultRosterEntry(entityKey, item);
    const formData = new FormData(formEl);
    const note = String(formData.get("note") || "").trim();
    const baseEntry = {
      owned: true,
      favorite: formData.get("favorite") === "on",
      note,
      custom_tags: parseRosterTokenList(formData.get("custom_tags")),
      status_flags: parseRosterTokenList(formData.get("status_flags")),
    };

    if (entityKey === "characters") {
      return {
        ...baseEntry,
        stars: clampNumber(formData.get("stars"), 0, 5, defaults.stars),
        awakening: clampNumber(formData.get("awakening"), 0, 5, defaults.awakening),
        unique_level: clampNumber(formData.get("unique_level"), 1, 6, defaults.unique_level || 1),
      };
    }

    return {
      ...baseEntry,
      level: clampNumber(formData.get("level"), 1, 50, defaults.level),
      limit_break: clampNumber(formData.get("limit_break"), 0, 4, defaults.limit_break),
    };
  }

  function clampNumber(rawValue, min, max, fallback) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(parsed)));
  }

  function parseRosterTokenList(rawValue) {
    return String(rawValue || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry, index, entries) => entries.indexOf(entry) === index);
  }

  async function persistRosterDocument(successMessage) {
    if (!state.activeProfileId) {
      return;
    }

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
    }

    requestRender();
  }

  async function saveRosterForm(entityKey, item, formEl) {
    const nextEntry = collectRosterFormData(entityKey, item, formEl);
    setRosterEntry(entityKey, item, nextEntry);
    await persistRosterDocument(`Saved locally on ${formatDateTime(new Date().toISOString())}.`);
  }

  async function addItemToRoster(entityKey, item) {
    const currentEntry = getRosterEntry(entityKey, item);
    setRosterEntry(entityKey, item, {
      ...currentEntry,
      owned: true,
    });
    await persistRosterDocument("Added to My Roster.");
  }

  async function removeItemFromRoster(entityKey, item) {
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

  async function resetRosterEntry(entityKey, item) {
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

  async function render() {
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
        setBrowseHash("roster", "characters", null);
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

    if (route.page === "browse" && !state.activeProfileId) {
      if (state.profilesIndex.last_profile_id) {
        state.activeProfileId = state.profilesIndex.last_profile_id;
      } else {
        setProfilesHash();
        return;
      }
    }

    if (route.page === "browse" && state.activeProfileId) {
      await loadRosterForProfile(state.activeProfileId, false);
      await loadRosterViewsForProfile(state.activeProfileId, false);
      if (token !== state.renderToken) {
        return;
      }
    }

    syncHeader(route);
    renderModeNav(route);
    syncShellVisibility(route);

    if (route.page === "profiles" || route.page === "wizard" || route.page === "admin") {
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

  function requestRender() {
    render().catch((error) => {
      console.error(error);
      const route = currentRouteState();
      if (route.page === "profiles" || route.page === "wizard" || route.page === "admin") {
        syncShellVisibility(route);
        renderModeNav(route);
        renderProfileGate(route);
        window.requestAnimationFrame(syncToolbarMetrics);
        return;
      }
      detailEl.innerHTML = `<div class="detail-empty">Unexpected error: ${escapeHtml(error.message || String(error))}</div>`;
    });
  }

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

  window.addEventListener("resize", () => {
    requestRender();
    window.requestAnimationFrame(syncToolbarMetrics);
  });
  window.addEventListener("scroll", syncBackToTopVisibility, { passive: true });
  window.addEventListener("hashchange", requestRender);

  if (!window.location.hash) {
    setProfilesHash();
  } else {
    requestRender();
  }

  syncBackToTopVisibility();
})();
