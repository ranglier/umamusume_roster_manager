// Auto-split from app.js as part of docs/REFACTOR_PLAN.md.
import { applyBuildsDocument, applyLegacyViewPayload, applyRunsDocument, asArray, createEmptyLegacyEditorState, createEmptyLegacyViewPayload, data, defaultEntityKeyForMode, getActiveProfile, getOwnedCharacterOptions, normalizeProfilesIndex, profileGateEl, resetBuildsDocument, resetLegacyViewPayload, resetRunsDocument, setBrowseHash, setHomeHash, state, syncSelectedProfileId } from "./core.js";
import { escapeHtml, formatDateTime } from "./dom-utils.js";
import { apiBinary, apiJson, deleteProfileAndRefresh, importProfileArchive, loadAdminJobs, loadBackups, loadBootstrapStatus, loadProfilesIndex, loadRosterForProfile, loadRosterViewsForProfile, renameProfileAndRefresh, requestRender, requestRenderPreservingScroll } from "../app.js";


export function renderProfilesPage() {
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
      requestRenderPreservingScroll();
    });
  });

  profileGateEl.querySelectorAll("[data-open-profile]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await openProfile(button.dataset.openProfile);
    });
  });
}

export function wizardNeedsReferenceBuild() {
  return Boolean(state.bootstrapStatus?.needs_initial_update || !state.bootstrapStatus?.has_dist_bundle);
}

export function getWizardProgress() {
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

export function getTimedProgress(startedAt, floor, cap, ratePerSecond) {
  const started = startedAt ? new Date(startedAt).getTime() : Date.now();
  const safeStarted = Number.isFinite(started) ? started : Date.now();
  const elapsedSeconds = Math.max(0, (Date.now() - safeStarted) / 1000);
  return Math.min(cap, floor + Math.round(elapsedSeconds * ratePerSecond));
}

export function getUpdateProgress(job) {
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

export function renderJobCheckpointList(job, className) {
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

export function renderWizardPage() {
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
      requestRenderPreservingScroll();
    });
  }

  const wizardRetryBuildButton = document.getElementById("wizardRetryBuildButton");
  if (wizardRetryBuildButton) {
    wizardRetryBuildButton.addEventListener("click", async () => {
      state.wizardBuildAutoStarted = false;
      state.wizardBuildStartedAt = null;
      state.adminStatus = { kind: "idle", message: "" };
      requestRenderPreservingScroll();
    });
  }
}

export function renderAdminPage() {
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
        <button class="sidebar-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="appSidebar" onclick="window.umaSidebar&&window.umaSidebar.toggle()">
          <span class="sidebar-toggle-bars" aria-hidden="true"></span>
        </button>
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
      requestRenderPreservingScroll();
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
      requestRenderPreservingScroll();
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
      requestRenderPreservingScroll();
    });
  });
}


export function downloadProfileExport(profileId) {
  window.location.href = `/api/profiles/${encodeURIComponent(profileId)}/export`;
}

export function downloadBackup(backupId) {
  window.location.href = `/api/admin/backups/${encodeURIComponent(backupId)}`;
}

export async function openProfile(profileId, profilesAlreadyFresh) {
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
  await loadLegacyForProfile(profileId, true);
  await loadBuildsForProfile(profileId, true);
  setHomeHash();
}

export async function runAdminJob(jobType, endpoint) {
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

export async function refreshAdminData(force) {
  await loadAdminJobs(force);
  await loadBackups(force);
  await loadBootstrapStatus(true);
}

export async function loadLegacyForProfile(profileId, force) {
  if (!profileId) {
    resetLegacyViewPayload();
    state.legacyStatus = { kind: "idle", message: "" };
    return;
  }
  if (!force && state.legacyView.profile_id === profileId) {
    return;
  }
  try {
    const payload = await apiJson(`/api/profiles/${encodeURIComponent(profileId)}/legacy-view`);
    applyLegacyViewPayload(payload);
    if (state.legacyStatus.kind === "error" && String(state.legacyStatus.message || "").includes("Legacy inventory")) {
      state.legacyStatus = { kind: "idle", message: "" };
    }
  } catch (error) {
    applyLegacyViewPayload(createEmptyLegacyViewPayload(profileId));
    state.legacyEditor = createEmptyLegacyEditorState();
    state.legacySimulator = {
      main_character_id: "",
      parent_a_legacy_id: "",
      parent_b_legacy_id: "",
      preview: null,
      status: { kind: "idle", message: "" },
    };
    state.legacyStatus = {
      kind: "error",
      message: error.message || "Legacy inventory unavailable for the current local reference.",
    };
    return;
  }
  const ownedCharacters = getOwnedCharacterOptions();
  if (!state.legacySimulator.main_character_id || !ownedCharacters.some((option) => option.value === state.legacySimulator.main_character_id)) {
    state.legacySimulator.main_character_id = ownedCharacters[0]?.value || "";
  }
  if (!state.legacyView.items.some((item) => item.id === state.legacySimulator.parent_a_legacy_id)) {
    state.legacySimulator.parent_a_legacy_id = state.legacyView.items[0]?.id || "";
  }
  if (!state.legacyView.items.some((item) => item.id === state.legacySimulator.parent_b_legacy_id)) {
    state.legacySimulator.parent_b_legacy_id = state.legacyView.items[1]?.id || state.legacyView.items[0]?.id || "";
  }
}

export async function loadBuildsForProfile(profileId, force) {
  if (!profileId) {
    resetBuildsDocument();
    return;
  }
  if (!force && state.buildsProfileId === profileId) {
    return;
  }
  try {
    const payload = await apiJson(`/api/profiles/${encodeURIComponent(profileId)}/builds`);
    state.buildsProfileId = profileId;
    applyBuildsDocument(payload, profileId);
    if (state.buildsStatus.kind === "error") {
      state.buildsStatus = { kind: "idle", message: "" };
    }
  } catch (error) {
    resetBuildsDocument(profileId);
    state.buildsStatus = {
      kind: "error",
      message: error.message || "Build drafts unavailable for the current profile.",
    };
  }
}

export async function loadRunsForProfile(profileId, force) {
  if (!profileId) {
    resetRunsDocument();
    return;
  }
  if (!force && state.runsProfileId === profileId) {
    return;
  }
  try {
    const payload = await apiJson(`/api/profiles/${encodeURIComponent(profileId)}/runs`);
    state.runsProfileId = profileId;
    applyRunsDocument(payload);
    if (state.runsStatus.kind === "error") {
      state.runsStatus = { kind: "idle", message: "" };
    }
  } catch (error) {
    resetRunsDocument(profileId);
    state.runsStatus = {
      kind: "error",
      message: error.message || "Run results unavailable for the current profile.",
    };
  }
}

export async function restoreBackupAndRefresh(backupId) {
  await runAdminJob("Restore", `/api/admin/backups/${encodeURIComponent(backupId)}/restore`);
}
