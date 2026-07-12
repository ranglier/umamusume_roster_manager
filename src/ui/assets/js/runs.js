import { BUILD_APTITUDE_FIELDS, BUILD_APTITUDE_GRADES, BUILD_STAT_FIELDS, asArray, getBuildReferenceLabel, getRunsForBuild, setPrepHash, state } from "./core.js";
import { clampNumber, escapeHtml } from "./dom-utils.js";
import { apiJson, requestRender, requestRenderPreservingScroll } from "../app.js";
import { loadRunsForProfile } from "./admin.js";

// A run captures the real outcome of executing a build. It lives inside the
// build editor as a "Runs" tab (build_id is mandatory), so this module only
// exposes the tab body + its CRUD wiring, plus two pure helpers that the test
// suite pins down (computeRunDelta / seedRunFromBuild).

export const RUN_OUTCOME_OPTIONS = [
  { value: "untested", label: "Untested" },
  { value: "win", label: "Win" },
  { value: "loss", label: "Loss" },
];

// Snapshot a build's planned values as the starting point of a run: the user
// then edits down to what actually happened. Pure — no DOM, no I/O.
export function seedRunFromBuild(buildEntry) {
  const build = buildEntry || {};
  return {
    build_id: String(build.id || ""),
    target_id: String(build.target_id || ""),
    character_id: String(build.character_id || ""),
    scenario_id: String(build.scenario_id || ""),
    running_style: String(build.running_style || ""),
    support_deck: asArray(build.support_deck).slice(0, 6),
    legacy_pair: { ...(build.legacy_pair || {}) },
    final_stats: { ...(build.target_stats || {}) },
    final_aptitudes: { ...(build.target_aptitudes || {}) },
    learned_skills: [...asArray(build.required_skills), ...asArray(build.optional_skills)].map(String),
    outcome: "untested",
    notes: "",
    custom_tags: [],
  };
}

// Plan (build) vs real (run): numeric stat gaps, aptitude changes, and which
// planned required skills went unlearned. Pure — takes plain objects in, plain
// data out, so it is unit-tested directly.
export function computeRunDelta(buildEntry, runEntry) {
  const build = buildEntry || {};
  const run = runEntry || {};

  const plannedStats = build.target_stats || {};
  const actualStats = run.final_stats || {};
  const stats = BUILD_STAT_FIELDS
    .filter((field) => plannedStats[field.key] != null || actualStats[field.key] != null)
    .map((field) => {
      const planned = typeof plannedStats[field.key] === "number" ? plannedStats[field.key] : null;
      const actual = typeof actualStats[field.key] === "number" ? actualStats[field.key] : null;
      return {
        key: field.key,
        label: field.label,
        planned,
        actual,
        delta: planned != null && actual != null ? actual - planned : null,
      };
    });

  const plannedApt = build.target_aptitudes || {};
  const actualApt = run.final_aptitudes || {};
  const aptitudes = BUILD_APTITUDE_FIELDS
    .filter((field) => plannedApt[field.key] || actualApt[field.key])
    .map((field) => ({
      key: field.key,
      label: field.label,
      planned: plannedApt[field.key] || null,
      actual: actualApt[field.key] || null,
      changed: String(plannedApt[field.key] || "") !== String(actualApt[field.key] || ""),
    }));

  const learned = new Set(asArray(run.learned_skills).map(String));
  const required = asArray(build.required_skills).map(String);
  const optional = asArray(build.optional_skills).map(String);
  const plannedSkills = new Set([...required, ...optional]);
  const missingRequired = required.filter((id) => !learned.has(id));
  const extraSkills = [...learned].filter((id) => !plannedSkills.has(id));

  return { stats, aptitudes, missingRequired, extraSkills };
}

function renderRunDeltaPanel(buildEntry, runEntry) {
  const delta = computeRunDelta(buildEntry, runEntry);

  const statRows = delta.stats
    .map((stat) => {
      const plannedText = stat.planned != null ? String(stat.planned) : "-";
      const actualText = stat.actual != null ? String(stat.actual) : "-";
      let deltaText = "-";
      let tone = "neutral";
      if (stat.delta != null) {
        deltaText = stat.delta > 0 ? `+${stat.delta}` : String(stat.delta);
        tone = stat.delta > 0 ? "positive" : stat.delta < 0 ? "negative" : "neutral";
      }
      return `
        <tr>
          <th scope="row">${escapeHtml(stat.label)}</th>
          <td>${escapeHtml(plannedText)}</td>
          <td>${escapeHtml(actualText)}</td>
          <td class="run-delta-${tone}">${escapeHtml(deltaText)}</td>
        </tr>
      `;
    })
    .join("");

  const statTable = statRows
    ? `
      <table class="run-delta-table">
        <thead><tr><th scope="col">Stat</th><th scope="col">Plan</th><th scope="col">Real</th><th scope="col">Δ</th></tr></thead>
        <tbody>${statRows}</tbody>
      </table>
    `
    : "<p class='source-note'>No planned or recorded stats to compare yet.</p>";

  const aptChanges = delta.aptitudes.filter((apt) => apt.changed);
  const aptMarkup = aptChanges.length
    ? `<p class="run-delta-note">Aptitude changes: ${aptChanges
        .map((apt) => `${escapeHtml(apt.label)} ${escapeHtml(apt.planned || "-")}→${escapeHtml(apt.actual || "-")}`)
        .join(", ")}</p>`
    : "";

  const missingMarkup = delta.missingRequired.length
    ? `<p class="run-delta-note run-delta-negative">Missing required skills (${delta.missingRequired.length}): ${delta.missingRequired
        .map((id) => escapeHtml(getBuildReferenceLabel("skills", id)))
        .join(", ")}</p>`
    : `<p class="run-delta-note run-delta-positive">All planned required skills learned.</p>`;

  return `
    <div class="run-delta">
      <h5>Plan vs real</h5>
      ${statTable}
      ${aptMarkup}
      ${missingMarkup}
    </div>
  `;
}

function renderRunSkillChecklist(buildEntry, runEntry) {
  const required = asArray(buildEntry.required_skills).map(String);
  const optional = asArray(buildEntry.optional_skills).map(String);
  const seen = new Set();
  const planned = [];
  [...required, ...optional].forEach((id) => {
    if (!seen.has(id)) {
      seen.add(id);
      planned.push({ id, required: required.includes(id) });
    }
  });

  if (!planned.length) {
    return "<p class='source-note'>This build has no planned skills to tick off.</p>";
  }

  const learned = new Set(asArray(runEntry.learned_skills).map(String));
  return `
    <div class="run-skill-checklist">
      ${planned
        .map((skill) => `
          <label class="run-skill-option">
            <input type="checkbox" data-run-skill value="${escapeHtml(skill.id)}" ${learned.has(skill.id) ? "checked" : ""}>
            <span>${escapeHtml(getBuildReferenceLabel("skills", skill.id))}${skill.required ? " <em>(required)</em>" : ""}</span>
          </label>
        `)
        .join("")}
    </div>
  `;
}

function renderRunCard(buildEntry, runEntry) {
  const statInputs = BUILD_STAT_FIELDS
    .map((field) => `
      <label class="field-stack run-stat-field">
        <span>${escapeHtml(field.label)}</span>
        <input type="number" min="0" max="2500" step="1" data-run-stat="${escapeHtml(field.key)}" value="${escapeHtml(runEntry.final_stats?.[field.key] != null ? String(runEntry.final_stats[field.key]) : "")}">
      </label>
    `)
    .join("");

  const aptInputs = BUILD_APTITUDE_FIELDS
    .map((field) => `
      <label class="field-stack run-apt-field">
        <span>${escapeHtml(field.label)}</span>
        <select data-run-apt="${escapeHtml(field.key)}">
          ${BUILD_APTITUDE_GRADES
            .map((grade) => `<option value="${escapeHtml(grade)}" ${(runEntry.final_aptitudes?.[field.key] || "") === grade ? "selected" : ""}>${grade ? escapeHtml(grade) : "—"}</option>`)
            .join("")}
        </select>
      </label>
    `)
    .join("");

  const outcomeOptions = RUN_OUTCOME_OPTIONS
    .map((option) => `<option value="${escapeHtml(option.value)}" ${runEntry.outcome === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
    .join("");

  return `
    <div class="run-card" data-run-card="${escapeHtml(runEntry.id)}">
      <div class="run-card-head">
        <label class="field-stack run-outcome-field">
          <span>Outcome</span>
          <select data-run-field="outcome">${outcomeOptions}</select>
        </label>
        <span class="run-card-id">${escapeHtml(runEntry.id)}</span>
      </div>
      <div class="run-stat-grid">${statInputs}</div>
      <div class="run-apt-grid">${aptInputs}</div>
      <div class="run-card-block">
        <span class="run-card-label">Skills learned</span>
        ${renderRunSkillChecklist(buildEntry, runEntry)}
      </div>
      <label class="field-stack field-stack-full">
        <span>Notes</span>
        <textarea rows="2" data-run-field="notes" placeholder="Matchup notes, what to change next run">${escapeHtml(runEntry.notes || "")}</textarea>
      </label>
      ${renderRunDeltaPanel(buildEntry, runEntry)}
      <div class="roster-actions run-card-actions">
        <button type="button" class="button-strong" data-run-action="save" data-run-id="${escapeHtml(runEntry.id)}">Save run</button>
        <button type="button" class="button-danger" data-run-action="delete" data-run-id="${escapeHtml(runEntry.id)}">Delete run</button>
      </div>
    </div>
  `;
}

export function renderBuildRunsPanel(buildEntry) {
  const runs = getRunsForBuild(buildEntry.id);
  const statusKind = state.runsStatus?.kind || "idle";
  const statusText = state.runsStatus?.message || "Runs are stored locally for the active profile.";
  const statusLine = `<p class="source-note ${statusKind === "error" ? "error-text" : ""}">${escapeHtml(statusText)}</p>`;

  const listMarkup = runs.length
    ? runs.map((runEntry) => renderRunCard(buildEntry, runEntry)).join("")
    : "<p class='source-note'>No run logged yet. Log a run to snapshot this build's plan, then edit it down to what actually happened.</p>";

  return `
    <div class="build-runs">
      <p class="source-note">Record the real outcome of a run against this build. A new run starts as a copy of the plan; edit the stats, ticked skills and outcome to match reality, and the delta below shows the gap.</p>
      <div class="roster-actions">
        <button type="button" class="button-strong" data-run-action="log">Log a run</button>
        ${buildEntry.target_id ? `<button type="button" class="button-secondary" data-run-action="prep" data-target-id="${escapeHtml(String(buildEntry.target_id))}">Compare in CM Prep →</button>` : ""}
      </div>
      ${statusLine}
      <div class="build-runs-list">${listMarkup}</div>
    </div>
  `;
}

async function reloadRuns() {
  if (state.activeProfileId) {
    await loadRunsForProfile(state.activeProfileId, true);
  }
}

async function logRunFromBuild(buildEntry) {
  if (!state.activeProfileId || !buildEntry?.id) {
    return;
  }
  state.runsStatus = { kind: "saving", message: "Logging run locally..." };
  requestRender();
  try {
    await apiJson(`/api/profiles/${encodeURIComponent(state.activeProfileId)}/runs`, {
      method: "POST",
      body: JSON.stringify(seedRunFromBuild(buildEntry)),
    });
    await reloadRuns();
    state.runsStatus = { kind: "saved", message: "Logged a new run from the plan." };
  } catch (error) {
    state.runsStatus = { kind: "error", message: error.message || "Could not log the run." };
  }
  requestRenderPreservingScroll();
}

function collectRunPayload(buildEntry, runId, cardEl) {
  const finalStats = {};
  cardEl.querySelectorAll("[data-run-stat]").forEach((input) => {
    const raw = String(input.value || "").trim();
    if (raw !== "") {
      finalStats[input.dataset.runStat] = clampNumber(raw, 0, 2500, 0);
    }
  });

  const finalAptitudes = {};
  cardEl.querySelectorAll("[data-run-apt]").forEach((select) => {
    const value = String(select.value || "").trim().toUpperCase();
    if (value) {
      finalAptitudes[select.dataset.runApt] = value;
    }
  });

  const checkedPlanned = Array.from(cardEl.querySelectorAll("[data-run-skill]:checked")).map((input) => String(input.value));
  // Preserve any learned skills that were not part of the plan (the checklist
  // only lists planned skills, so extras would otherwise be dropped on save).
  const planned = new Set([...asArray(buildEntry.required_skills), ...asArray(buildEntry.optional_skills)].map(String));
  const existing = getRunsForBuild(buildEntry.id).find((entry) => entry.id === runId);
  const extras = asArray(existing?.learned_skills).map(String).filter((id) => !planned.has(id));
  const learnedSkills = [...new Set([...checkedPlanned, ...extras])];

  return {
    outcome: String(cardEl.querySelector('[data-run-field="outcome"]')?.value || "untested"),
    notes: String(cardEl.querySelector('[data-run-field="notes"]')?.value || "").trim(),
    final_stats: finalStats,
    final_aptitudes: finalAptitudes,
    learned_skills: learnedSkills,
  };
}

async function saveRunEdits(buildEntry, runId, cardEl) {
  if (!state.activeProfileId || !runId || !cardEl) {
    return;
  }
  state.runsStatus = { kind: "saving", message: "Saving run locally..." };
  requestRender();
  try {
    await apiJson(`/api/profiles/${encodeURIComponent(state.activeProfileId)}/runs/${encodeURIComponent(runId)}`, {
      method: "PATCH",
      body: JSON.stringify(collectRunPayload(buildEntry, runId, cardEl)),
    });
    await reloadRuns();
    state.runsStatus = { kind: "saved", message: "Saved run locally." };
  } catch (error) {
    state.runsStatus = { kind: "error", message: error.message || "Could not save the run." };
  }
  requestRenderPreservingScroll();
}

async function deleteRunEntry(runId) {
  if (!state.activeProfileId || !runId) {
    return;
  }
  try {
    await apiJson(`/api/profiles/${encodeURIComponent(state.activeProfileId)}/runs/${encodeURIComponent(runId)}`, {
      method: "DELETE",
    });
    await reloadRuns();
    state.runsStatus = { kind: "saved", message: "Deleted run." };
  } catch (error) {
    state.runsStatus = { kind: "error", message: error.message || "Could not delete the run." };
  }
  requestRenderPreservingScroll();
}

export function attachBuildRunsListeners(buildEntry) {
  const panel = document.querySelector('[data-build-tab-panel="runs"]');
  if (!panel) {
    return;
  }

  const logButton = panel.querySelector('[data-run-action="log"]');
  if (logButton) {
    logButton.addEventListener("click", () => logRunFromBuild(buildEntry));
  }

  const prepButton = panel.querySelector('[data-run-action="prep"]');
  if (prepButton) {
    prepButton.addEventListener("click", () => setPrepHash(prepButton.dataset.targetId));
  }

  panel.querySelectorAll('[data-run-action="save"]').forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest("[data-run-card]");
      if (card) {
        saveRunEdits(buildEntry, button.dataset.runId, card);
      }
    });
  });

  panel.querySelectorAll('[data-run-action="delete"]').forEach((button) => {
    button.addEventListener("click", () => deleteRunEntry(button.dataset.runId));
  });
}
