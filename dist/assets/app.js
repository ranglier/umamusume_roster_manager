(function () {
  const data = window.UMA_REFERENCE_DATA;
  const toolbarEl = document.getElementById("toolbar");
  const navEl = document.getElementById("entityNav");
  const entityTitleEl = document.getElementById("entityTitle");
  const entityMetaEl = document.getElementById("entityMeta");
  const resultCountEl = document.getElementById("resultCount");
  const listEl = document.getElementById("list");
  const detailEl = document.getElementById("detail");
  const detailPanelEl = document.querySelector(".detail-panel");
  const filtersEl = document.getElementById("filters");
  const searchInput = document.getElementById("searchInput");
  const clearButton = document.getElementById("clearButton");
  const backToTopButton = document.getElementById("backToTopButton");
  const globalBuild = document.getElementById("globalBuild");
  const summaryText = document.getElementById("summaryText");
  const compactLayoutQuery = window.matchMedia("(max-width: 1680px)");

  if (!data) {
    document.body.innerHTML = "<main class='detail-empty'>Missing local reference bundle. Run the update script first.</main>";
    return;
  }

  const entityKeys = Object.keys(data.entities);
  const inlineMediaEntityKeys = new Set(["characters", "skills", "supports"]);
  const stateByEntity = Object.fromEntries(
    entityKeys.map((key) => [key, createEntityState(key)]),
  );
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
    const characterItems = asArray(data.entities?.characters?.items);
    const supportItems = asArray(data.entities?.supports?.items);

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

  function hasFilterOption(entity, filterKey, value) {
    return asArray(entity?.filter_options?.[filterKey]).some((option) => option?.value === value);
  }

  function getDefaultFilters(entityKey) {
    const entity = data.entities[entityKey];
    const defaults = {};

    if (!entity) {
      return defaults;
    }

    if (hasFilterOption(entity, "availability_en", "available")) {
      defaults.availability_en = ["available"];
    }

    if (entityKey === "skills") {
      if (hasFilterOption(entity, "has_cost", "yes")) {
        defaults.has_cost = ["yes"];
      }
    }

    return defaults;
  }

  function createEntityState(entityKey) {
    return {
      query: "",
      filters: getDefaultFilters(entityKey),
      selectedId: null,
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

  function renderBadge(badge) {
    const palette = badgePalette(badge);
    return `<span class="badge" style="--badge-bg:${palette.bg};--badge-border:${palette.border};--badge-text:${palette.text};">${escapeHtml(badge)}</span>`;
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

  function renderImageAsset(asset, cssClass, loadingMode) {
    if (!asset?.src) {
      return "";
    }
    return `<img class="${cssClass}" src="${escapeHtml(asset.src)}" alt="${escapeHtml(asset.alt || "")}" loading="${escapeHtml(loadingMode || "lazy")}">`;
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

  function renderDetailHeader(item, entityKey) {
    const media = renderDetailMedia(item, entityKey);
    const titleBlock = `
      <div class="detail-header-copy">
        <h2 class="detail-title">${escapeHtml(item.title)}</h2>
        <p class="detail-subtitle">${escapeHtml(item.subtitle || "")}</p>
      </div>
    `;
    const badges = `
      <div class="badge-row detail-badge-row">
        ${asArray(item.badges)
          .filter(Boolean)
          .map((badge) => renderBadge(badge))
          .join("")}
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
    if (!toolbarEl) {
      return;
    }
    document.documentElement.style.setProperty("--toolbar-height", `${toolbarEl.offsetHeight}px`);
  }

  function syncBackToTopVisibility() {
    if (!backToTopButton) {
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

  function currentHashState() {
    const hash = (window.location.hash || "").replace(/^#\/?/, "");
    const [entityKey, rawId] = hash.split("/");
    if (!data.entities[entityKey]) {
      return { entityKey: entityKeys[0], itemId: null };
    }
    return { entityKey, itemId: rawId ? decodeURIComponent(rawId) : null };
  }

  function setHash(entityKey, itemId) {
    const target = itemId ? `#/${entityKey}/${encodeURIComponent(itemId)}` : `#/${entityKey}`;
    if (window.location.hash !== target) {
      window.location.hash = target;
      return;
    }
    render();
  }

  function getFilteredItems(entityKey) {
    const entity = data.entities[entityKey];
    const localState = stateByEntity[entityKey];
    const query = localState.query.trim().toLowerCase();

    return entity.items.filter((item) => {
      if (query && !String(item.search_text || "").toLowerCase().includes(query)) {
        return false;
      }

      return entity.filter_definitions.every((definition) => {
        const selected = localState.filters[definition.key] || [];
        if (!selected.length) {
          return true;
        }

        const rawValue = item.filters?.[definition.key];
        const values = Array.isArray(rawValue) ? rawValue : rawValue == null ? [] : [rawValue];
        return selected.some((value) => values.includes(value));
      });
    });
  }

  function renderNav(activeKey) {
    navEl.innerHTML = entityKeys
      .map((key) => {
        const count = data.reference.entities[key].count;
        return `
          <button class="entity-button ${key === activeKey ? "active" : ""}" data-entity="${escapeHtml(key)}" type="button">
            <strong>${escapeHtml(data.entities[key].label)}</strong><br>
            <span class="entity-meta">${count} items</span>
          </button>
        `;
      })
      .join("");

    navEl.querySelectorAll("[data-entity]").forEach((button) => {
      button.addEventListener("click", () => setHash(button.dataset.entity, null));
    });
  }

  function renderFilters(entityKey) {
    const entity = data.entities[entityKey];
    const localState = stateByEntity[entityKey];

    filtersEl.innerHTML = entity.filter_definitions
      .map((definition) => {
        const options = entity.filter_options[definition.key] || [];
        if (!options.length) {
          return "";
        }

        return `
          <details class="filter-box">
            <summary>${escapeHtml(definition.label)}</summary>
            <div class="filter-options">
              ${options
                .map(
                  (option) => `
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
                  `,
                )
                .join("")}
            </div>
          </details>
        `;
      })
      .join("");

    filtersEl.querySelectorAll("[data-filter-key]").forEach((input) => {
      input.addEventListener("change", (event) => {
        const key = event.target.dataset.filterKey;
        const values = Array.from(filtersEl.querySelectorAll(`[data-filter-key="${key}"]:checked`)).map(
          (node) => node.value,
        );
        localState.filters[key] = values;
        render();
      });
    });

    filtersEl.querySelectorAll("details").forEach((detailsEl) => {
      detailsEl.addEventListener("toggle", () => {
        window.requestAnimationFrame(syncToolbarMetrics);
      });
    });
  }

  function renderList(entityKey, filteredItems) {
    const localState = stateByEntity[entityKey];
    if (!filteredItems.length) {
      listEl.innerHTML = "<div class='empty-state'>No result for the current search and filter set.</div>";
      return;
    }

    listEl.innerHTML = filteredItems
      .map(
        (item) => `
          <article class="result-card ${item.id === localState.selectedId ? "active" : ""}" data-item-id="${escapeHtml(item.id)}">
            ${renderResultTop(item, entityKey)}
            <div class="badge-row">
              ${asArray(item.badges)
                .filter(Boolean)
                .slice(0, 6)
                .map((badge) => renderBadge(badge))
                .join("")}
            </div>
          </article>
        `,
      )
      .join("");

    listEl.querySelectorAll("[data-item-id]").forEach((card) => {
      card.addEventListener("click", () => {
        const itemId = card.dataset.itemId;
        if (isCompactLayout() && localState.selectedId === itemId) {
          setHash(entityKey, null);
          return;
        }
        setHash(entityKey, itemId);
      });
    });
  }

  function renderLinks(urls) {
    return asArray(urls)
      .map(
        (url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`,
      )
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

  function renderCharacterGradeGrid(title, columns, values, options = {}) {
    const safeColumns = asArray(columns);
    if (!safeColumns.length) {
      return "<p class='source-note'>No data.</p>";
    }

    const columnCount = safeColumns.length;
    const compactClass = options.compact ? " character-grid-block-compact" : "";
    return `
      <section class="character-grid-block${compactClass}">
        <div class="character-grid-head">${escapeHtml(title)}</div>
        <div class="character-grid-body" style="--character-grid-columns:${columnCount};">
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
                    ${safeColumns
                      .map((column) => `<td>${escapeHtml(row.values?.[column.key] ?? "-")}</td>`)
                      .join("")}
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
      if (!key) {
        return;
      }
      values[key] = `+${entry.hint_value}`;
    });

    return renderCharacterStatsTable("Hint Gains", columns, [{ label: "Gain", values }]);
  }

  function renderCharacters(detail) {
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
          ${aptitudeSections
            .map((section) => renderCharacterGradeGrid(section.title, section.columns, section.values))
            .join("")}
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
    `;
  }

  function renderSupports(detail) {
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

  function renderDetail(entityKey, selectedItem) {
    if (!selectedItem) {
      detailEl.innerHTML =
        "<div class='detail-empty'>Select an entry to inspect its local normalized data and source metadata.</div>";
      if (detailPanelEl) {
        detailPanelEl.scrollTop = 0;
      }
      return;
    }

    const entity = data.entities[entityKey];
    const detail = selectedItem.detail;
    let body = "";

    if (entityKey === "characters") body = renderCharacters(detail);
    if (entityKey === "supports") body = renderSupports(detail);
    if (entityKey === "skills") body = renderSkills(detail);
    if (entityKey === "races") body = renderRaces(detail);
    if (entityKey === "racetracks") body = renderRacetracks(detail);
    if (entityKey === "g1_factors") body = renderG1Factors(detail);
    if (entityKey === "compatibility") body = renderCompatibility(detail, entity.model);

    detailEl.innerHTML = `
      <button class="detail-close-button" type="button" id="detailCloseButton">Close details</button>
      ${renderDetailHeader(selectedItem, entityKey)}
      ${body}
      <div class="detail-section">
        <h3>Source</h3>
        <p class="source-note">Imported locally on ${escapeHtml(formatDateTime(entity.source.imported_at || "-"))}.</p>
        <p class="source-note">${renderLinks(entity.source.page_urls || [])}</p>
      </div>
    `;

    detailEl.querySelectorAll("[data-ref-entity][data-ref-id]").forEach((button) => {
      button.addEventListener("click", () => setHash(button.dataset.refEntity, button.dataset.refId));
    });

    const closeButton = document.getElementById("detailCloseButton");
    if (closeButton) {
      closeButton.addEventListener("click", () => setHash(entityKey, null));
    }

    if (detailPanelEl) {
      detailPanelEl.scrollTop = 0;
    }
  }

  function render() {
    const { entityKey, itemId } = currentHashState();
    const entity = data.entities[entityKey];
    const localState = stateByEntity[entityKey];

    if (itemId) {
      localState.selectedId = itemId;
    } else if (isCompactLayout()) {
      localState.selectedId = null;
    }

    renderNav(entityKey);
    entityTitleEl.textContent = entity.label;
    entityMetaEl.textContent = `${data.reference.entities[entityKey].count} items | imported ${formatDateTime(entity.source.imported_at || "-")}`;
    searchInput.value = localState.query;
    renderFilters(entityKey);

    const filteredItems = getFilteredItems(entityKey);
    resultCountEl.textContent = `${filteredItems.length} visible`;

    if (localState.selectedId && !filteredItems.some((item) => item.id === localState.selectedId)) {
      localState.selectedId = null;
    }

    if (!isCompactLayout() && !localState.selectedId) {
      localState.selectedId = filteredItems[0]?.id || null;
    }

    const selectedItem = filteredItems.find((item) => item.id === localState.selectedId) || null;
    syncLayoutMode(Boolean(selectedItem));
    renderList(entityKey, filteredItems);
    renderDetail(entityKey, selectedItem);
    window.requestAnimationFrame(syncToolbarMetrics);
  }

  searchInput.addEventListener("input", () => {
    const { entityKey } = currentHashState();
    stateByEntity[entityKey].query = searchInput.value;
    render();
  });

  clearButton.addEventListener("click", () => {
    const { entityKey } = currentHashState();
    stateByEntity[entityKey] = createEntityState(entityKey);
    render();
  });

  globalBuild.textContent = formatDateTime(data.reference.generated_at || "-");
  summaryText.textContent =
    `Characters ${data.reference.entities.characters.count} | ` +
    `Supports ${data.reference.entities.supports.count} | ` +
    `Skills ${data.reference.entities.skills.count} | ` +
    `Races ${data.reference.entities.races.count}`;

  if (backToTopButton) {
    backToTopButton.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  window.addEventListener("resize", () => {
    render();
    window.requestAnimationFrame(syncToolbarMetrics);
  });
  window.addEventListener("scroll", syncBackToTopVisibility, { passive: true });
  window.addEventListener("hashchange", render);

  if (!window.location.hash) {
    setHash(entityKeys[0], null);
  } else {
    render();
  }

  syncBackToTopVisibility();
})();
