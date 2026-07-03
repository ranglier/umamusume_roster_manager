// Auto-split from app.js as part of docs/REFACTOR_PLAN.md.
import { asArray, data, inlineMediaEntityKeys, legacyEntityKey, state } from "./core.js";


export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function hashText(value) {
  const text = String(value ?? "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function badgePalette(badge) {
  const hash = hashText(badge);
  const hue = hash % 360;
  return {
    bg: `hsla(${hue}, 78%, 58%, 0.16)`,
    border: `hsla(${hue}, 84%, 64%, 0.3)`,
    text: `hsl(${hue}, 92%, 78%)`,
  };
}

export function renderBadge(badge, extraClass) {
  const palette = badgePalette(badge);
  return `<span class="badge ${extraClass || ""}" style="--badge-bg:${palette.bg};--badge-border:${palette.border};--badge-text:${palette.text};">${escapeHtml(badge)}</span>`;
}

export function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}


export function getMediaEntries(media) {
  return Object.values(media || {}).filter((asset) => asset && asset.src);
}

export function getPrimaryMedia(media, preferredRoles) {
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

export function resolveMediaAssetSrc(src) {
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

export function renderImageAsset(asset, cssClass, loadingMode) {
  if (!asset?.src) {
    return "";
  }
  return `<img class="${cssClass}" src="${escapeHtml(resolveMediaAssetSrc(asset.src))}" alt="${escapeHtml(asset.alt || "")}" loading="${escapeHtml(loadingMode || "lazy")}">`;
}

export function getResultMediaRoles(entityKey) {
  if (entityKey === legacyEntityKey) {
    return ["portrait", "icon"];
  }
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

export function renderResultMedia(item, entityKey, inline) {
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

export function renderResultTop(item, entityKey) {
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


export function getDetailMediaEntries(item, entityKey) {
  const entries = getMediaEntries(item.media);
  if (entityKey === "supports") {
    return entries.filter((asset) => asset.role === "cover");
  }
  return entries;
}

export function renderDetailMedia(item, entityKey) {
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

export function shouldInlineDetailMedia(entityKey) {
  return entityKey === "characters" || entityKey === "supports";
}

export function renderDetailHeader(item, entityKey, extraBadges) {
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

export function renderLinks(urls) {
  return asArray(urls)
    .map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`)
    .join("<br>");
}

export function renderSimpleList(items, valueSelector) {
  const values = asArray(items).map(valueSelector).filter(Boolean);
  if (!values.length) {
    return "<p class='source-note'>None</p>";
  }
  return `<ul class="list-inline">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}


export function renderReferenceList(items) {
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

export function renderLinkedSkillList(items) {
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

export function tableFromRows(rows) {
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


export function renderFlagBadgeList(values) {
  const entries = asArray(values).filter(Boolean);
  if (!entries.length) {
    return "<p class='source-note'>None</p>";
  }
  return `<div class="badge-row">${entries.map((entry) => renderBadge(entry)).join("")}</div>`;
}

export function clampRatio(current, max, options = {}) {
  const min = options.min || 0;
  const currentNumber = Number(current);
  const maxNumber = Number(max);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(maxNumber) || maxNumber <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, (currentNumber - min) / Math.max(1, maxNumber - min)));
}

export function renderProgressMetric(label, displayValue, ratio, tone = "cyan") {
  const percent = Math.round(Math.max(0, Math.min(1, Number(ratio) || 0)) * 100);
  return `
    <div class="progress-metric progress-metric-${escapeHtml(tone)}">
      <div class="progress-metric-head">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(displayValue)}</strong>
      </div>
      <div class="progress-metric-track">
        <span style="width:${percent}%"></span>
      </div>
    </div>
  `;
}

export function renderStatePill(label, value, tone = "neutral") {
  return `
    <div class="state-pill state-pill-${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}


export function clampNumber(rawValue, min, max, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function parseRosterTokenList(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, entries) => entries.indexOf(entry) === index);
}
