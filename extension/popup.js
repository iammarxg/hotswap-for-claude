// popup.js — no inline scripts (CSP-compliant), talks to background.js
// via chrome.runtime.sendMessage.

const listEl = document.getElementById("profile-list");
const savedEyebrowEl = document.getElementById("saved-eyebrow");
const currentSectionEl = document.getElementById("current-account-section");
const currentListEl = currentSectionEl.querySelector(".profile-list-current");
const emptyEl = document.getElementById("empty-state");
const statusEl = document.getElementById("status");
const labelInput = document.getElementById("new-label");
const addBtn = document.getElementById("add-btn");
const newAccountBtn = document.getElementById("new-account-btn");
const addAccountToggle = document.getElementById("add-account-toggle");
const addAccountPanel = document.getElementById("add-account-panel");
const warningBox = document.getElementById("warning-box");
const exportBtn = document.getElementById("export-btn");
const copyPromptBtn = document.getElementById("copy-prompt-btn");
const backupBtn = document.getElementById("backup-btn");
const restoreBtn = document.getElementById("restore-btn");
const restoreFileInput = document.getElementById("restore-file-input");
const searchInput = document.getElementById("account-search");
const noMatchesEl = document.getElementById("no-matches");
const noMatchesQueryEl = document.getElementById("no-matches-query");
const shortcutsListEl = document.getElementById("shortcuts-list");
const editShortcutsBtn = document.getElementById("edit-shortcuts-btn");
const refreshAllBtn = document.getElementById("refresh-all-btn");
const versionTag = document.getElementById("version-tag");
versionTag.textContent = `v${chrome.runtime.getManifest().version}`;
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

// Chrome's "Alt+Shift+…" bindings are physically Option+Shift on a Mac
// keyboard, so the on-screen labels should match what's actually printed
// on the key, not the manifest's literal (Windows/Linux-flavored) string.
const IS_MAC = /mac/i.test(
  navigator.userAgentData?.platform || navigator.platform || navigator.userAgent
);
const MOD_KEY = IS_MAC ? "⌥" : "Alt";
const SHIFT_KEY = IS_MAC ? "⇧" : "Shift";

const SHORTCUTS = [
  {
    label: "Switch to the account with the most usage left",
    keys: [MOD_KEY, SHIFT_KEY, "1"],
  },
  {
    label: "Cycle to next account",
    keys: [MOD_KEY, SHIFT_KEY, "→"],
  },
  {
    label: "Cycle to previous account",
    keys: [MOD_KEY, SHIFT_KEY, "←"],
  },
];

function renderShortcutsList() {
  if (!shortcutsListEl) return;
  shortcutsListEl.textContent = "";
  for (const { label, keys } of SHORTCUTS) {
    const li = document.createElement("li");

    const labelEl = document.createElement("span");
    labelEl.textContent = label;

    const keysEl = document.createElement("span");
    keysEl.className = "shortcut-keys";
    keys.forEach((k, i) => {
      const kbd = document.createElement("kbd");
      kbd.textContent = k;
      keysEl.appendChild(kbd);
    });

    li.appendChild(labelEl);
    li.appendChild(keysEl);
    shortcutsListEl.appendChild(li);
  }
}
renderShortcutsList();

// Mirrors background.js's getLeastUsedProfileId(): quick-switch-1 targets
// whichever saved account has the most 5-hour ("session") credit left —
// i.e. the lowest session-limit percentage, not the weekly one. Computed
// here too so the popup can badge the right account without a round trip.
function findQuickSwitchTargetId(profiles) {
  const withSessionUsage = Object.values(profiles).filter(
    (p) => typeof p.usage?.limits?.session?.percentage === "number"
  );
  if (withSessionUsage.length === 0) return null;
  withSessionUsage.sort(
    (a, b) => a.usage.limits.session.percentage - b.usage.limits.session.percentage
  );
  return withSessionUsage[0].id;
}

const RESUME_PROMPT =
  "I'm continuing a previous Claude conversation. I've attached the full transcript and files — please read them for context, then continue helping me from where we left off without summarizing the past dialogue.";

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

function showStatus(text, kind = "info") {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  statusEl.classList.remove("hidden");
}

function clearStatus() {
  statusEl.classList.add("hidden");
}

function initialsFor(label) {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "?";
}

const HEALTH_LABEL = {
  valid: "Session looks current",
  "expiring-soon": "A saved cookie expires soon — may need re-adding after",
  expired: "Likely expired — switching may fail; re-log in and re-save",
  unknown: "Can't tell from session-only cookies without switching to it",
};

// Cache of the last full (unfiltered) load, so the search box can
// re-render without another round trip to the background worker.
let lastProfiles = {};
let lastActiveId = null;

function sortedEntries(profiles) {
  return Object.values(profiles).sort((a, b) => b.updatedAt - a.updatedAt);
}

// Builds the shared contents of a profile row — used for both the
// current-account card and each saved-account list item.
function buildProfileItem(profile, { activeId, isQuickSwitchTarget, isCurrent } = {}) {
  const li = document.createElement("li");
  li.className =
    "profile-item" +
    (isCurrent ? " profile-item-current" : "") +
    (!isCurrent && isQuickSwitchTarget ? " profile-item-best" : "");
  li.dataset.id = profile.id;

  const main = document.createElement("div");
  main.className = "profile-main";

  if (!isCurrent && isQuickSwitchTarget) {
    const bestBadge = document.createElement("span");
    bestBadge.className = "best-badge";
    bestBadge.title = `${MOD_KEY}+${SHIFT_KEY}+1 — switch here, it has the most usage left`;
    bestBadge.textContent = "🔋";
    main.appendChild(bestBadge);
  }

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = initialsFor(profile.label);

  const labelWrap = document.createElement("div");
  labelWrap.className = "profile-label-wrap";

  const topRow = document.createElement("div");
  topRow.style.display = "flex";
  topRow.style.alignItems = "center";
  topRow.style.gap = "5px";

  const health = profile.health || { status: "unknown" };
  const healthDot = document.createElement("span");
  healthDot.className = `health-dot health-${health.status}`;
  let healthTitle = HEALTH_LABEL[health.status] || "";
  if (profile.lastRefreshedAt) {
    healthTitle += `\nLast refreshed: ${timeAgo(profile.lastRefreshedAt)}`;
  }
  healthDot.title = healthTitle;

  const labelSpan = document.createElement("span");
  labelSpan.className = "profile-label";
  labelSpan.textContent = profile.label;

  topRow.appendChild(healthDot);
  topRow.appendChild(labelSpan);
  labelWrap.appendChild(topRow);

  if (profile.email) {
    const emailSpan = document.createElement("span");
    emailSpan.className = "profile-email";
    emailSpan.textContent = profile.email;
    labelWrap.appendChild(emailSpan);
  }

  if (profile.usage?.limits) {
    const usageEl = isCurrent
      ? buildUsageDetail(profile.usage)
      : buildUsageCompact(profile.usage);
    if (usageEl) labelWrap.appendChild(usageEl);
  }

  main.appendChild(avatar);
  main.appendChild(labelWrap);

  const actions = document.createElement("div");
  actions.className = "profile-actions";

  const renameBtn = document.createElement("button");
  renameBtn.className = "icon-btn";
  renameBtn.title = "Rename";
  renameBtn.textContent = "✎";
  renameBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleRename(profile);
  });

  const removeBtn = document.createElement("button");
  removeBtn.className = "icon-btn";
  removeBtn.title = "Remove";
  removeBtn.textContent = "🗑";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleRemove(profile);
  });

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "icon-btn";
  refreshBtn.title = "Refresh usage";
  refreshBtn.textContent = "↻";
  refreshBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleRefreshUsage(profile);
  });
  actions.appendChild(refreshBtn);
  actions.appendChild(renameBtn);
  actions.appendChild(removeBtn);

  li.appendChild(main);
  li.appendChild(actions);

  if (!isCurrent) {
    li.addEventListener("click", () => handleSwitch(profile));
  }

  return li;
}

function renderProfiles(profiles, activeId, query = "") {
  listEl.textContent = "";
  const entries = sortedEntries(profiles);
  // The quick-switch-1 target is picked by usage data (least 5-hour
  // credit used), not by list position, so compute it once up front —
  // stays stable while searching, same as background.js's own lookup.
  const quickSwitchTargetId = findQuickSwitchTargetId(profiles);

  // The active account gets its own distinctive card at the top of the
  // popup, pulled out of the regular saved-accounts list below it.
  const current = entries.find((profile) => profile.id === activeId);
  const saved = entries.filter((profile) => profile.id !== activeId);

  if (current) {
    currentSectionEl.classList.remove("hidden");
    currentListEl.textContent = "";
    currentListEl.appendChild(
      buildProfileItem(current, { activeId, isCurrent: true })
    );
  } else {
    currentSectionEl.classList.add("hidden");
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? saved.filter(
        (profile) =>
          profile.label.toLowerCase().includes(q) ||
          (profile.email || "").toLowerCase().includes(q)
      )
    : saved;

  emptyEl.classList.toggle("hidden", entries.length > 0);
  savedEyebrowEl.classList.toggle("hidden", saved.length === 0);
  noMatchesEl.classList.toggle("hidden", !(saved.length > 0 && q && visible.length === 0));
  if (saved.length > 0 && q && visible.length === 0) {
    noMatchesQueryEl.textContent = query.trim();
  }

  for (const profile of visible) {
    const li = buildProfileItem(profile, {
      activeId,
      isQuickSwitchTarget: profile.id === quickSwitchTargetId,
    });
    listEl.appendChild(li);
  }
}

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const LIMIT_LABELS = {
  session: "Session (5h)",
  weekly: "Weekly",
  sonnetWeekly: "Sonnet weekly",
  opusWeekly: "Opus weekly",
  fableWeekly: "Fable weekly",
};

// Short forms for the always-visible compact chips on non-active accounts —
// these need to stay narrow since several can sit on one line.
const SHORT_LIMIT_LABELS = {
  session: "5h",
  weekly: "Wk",
  sonnetWeekly: "Sonnet Wk",
  opusWeekly: "Opus Wk",
  fableWeekly: "Fable Wk",
};

// Order limits should appear in for the current account's full detail view —
// the 5h session limit first, then weekly, then any model-scoped weekly caps.
const LIMIT_ORDER = ["session", "weekly", "sonnetWeekly", "opusWeekly", "fableWeekly"];

function heatFor(percentage) {
  return percentage >= 90 ? "usage-hot" : percentage >= 70 ? "usage-warm" : "usage-cool";
}

// Keys that reset on the ~5h session cycle vs the ~7-day weekly cycle —
// each cycle gets its own "resets in" phrasing (see formatResetsIn).
const SESSION_LIMIT_KEYS = new Set(["session"]);

function formatResetsIn(ms, key) {
  if (!ms) return "";
  const diff = ms - Date.now();
  if (diff <= 0) return "resets soon";

  const totalMinutes = Math.round(diff / 60000);

  if (SESSION_LIMIT_KEYS.has(key)) {
    // 5h limit: "resets in Xh Ym", or just "resets in Ym" under 1h.
    if (totalMinutes < 60) return `resets in ${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `resets in ${hours}h ${mins}m` : `resets in ${hours}h`;
  }

  // Weekly (or model-scoped weekly) limit: "resets in Xd Xh", or
  // "resets in Xh Xm" under 1 day.
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `resets in ${hours}h ${mins}m`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `resets in ${days}d ${hours}h` : `resets in ${days}d`;
}

// Full, fully-readable usage breakdown — used ONLY for the current active
// account. Every active limit (session + weekly + any model-scoped weekly
// caps) gets its own row with a label, percentage, reset time, and its own
// progress bar, so nothing is hidden behind a hover tooltip.
function buildUsageDetail(usage) {
  const entries = LIMIT_ORDER.map((key) => [key, usage.limits?.[key]]).filter(
    ([, v]) => v && typeof v.percentage === "number"
  );
  if (entries.length === 0) {
    const notice = document.createElement("div");
    notice.className = "usage-notice";
    if (usage.subscriptionTier === "claude_free" || !usage.subscriptionTier || usage.subscriptionTier === "free") {
      notice.textContent = "Send a message on Claude.ai to view your current free-plan limits.";
    } else {
      notice.textContent = "Usage data unavailable. Try reloading Claude.ai.";
    }
    return notice;
  }

  const wrap = document.createElement("div");
  wrap.className = "usage-detail";

  for (const [key, v] of entries) {
    const heat = heatFor(v.percentage);
    const resetText = formatResetsIn(v.resetsAt, key);

    const row = document.createElement("div");
    row.className = "usage-detail-row";

    const top = document.createElement("div");
    top.className = "usage-detail-top";

    const label = document.createElement("span");
    label.className = "usage-detail-label";
    label.textContent = LIMIT_LABELS[key] || key;

    const pct = document.createElement("span");
    pct.className = `usage-detail-pct ${heat}`;
    pct.textContent = `${v.percentage.toFixed(0)}%${resetText ? ` · ${resetText}` : ""}`;

    top.appendChild(label);
    top.appendChild(pct);

    const track = document.createElement("span");
    track.className = "usage-bar-track";
    const fill = document.createElement("span");
    fill.className = `usage-bar-fill ${heat}`;
    fill.style.width = `${Math.min(100, Math.max(0, v.percentage))}%`;
    track.appendChild(fill);

    row.appendChild(top);
    row.appendChild(track);
    wrap.appendChild(row);
  }

  if (usage.subscriptionTier || usage.capturedAt) {
    const meta = document.createElement("div");
    meta.className = "usage-detail-tier";
    const bits = [];
    if (usage.subscriptionTier) bits.push(usage.subscriptionTier.replace(/_/g, " "));
    if (usage.capturedAt) bits.push(`as of ${timeAgo(usage.capturedAt)}`);
    meta.textContent = bits.join(" · ");
    wrap.appendChild(meta);
  }

  return wrap;
}

// Compact usage for saved (non-active) accounts — every active limit shown
// as its own always-visible percentage chip plus its reset countdown,
// rather than only the worst one with the rest tucked behind a hover
// tooltip.
function buildUsageCompact(usage) {
  const entries = LIMIT_ORDER.map((key) => [key, usage.limits?.[key]])
    .filter(([, v]) => v && typeof v.percentage === "number")
    .map(([key, v]) => ({ key, ...v }));
  if (entries.length === 0) return null;

  const wrap = document.createElement("span");
  wrap.className = "profile-usage-compact";

  for (const e of entries) {
    const heat = heatFor(e.percentage);
    const resetText = formatResetsIn(e.resetsAt, e.key);

    const row = document.createElement("span");
    row.className = "usage-compact-row";

    const chip = document.createElement("span");
    chip.className = `usage-chip ${heat}`;
    chip.textContent = `${SHORT_LIMIT_LABELS[e.key] || e.key} ${e.percentage.toFixed(0)}%`;
    row.appendChild(chip);

    if (resetText) {
      const reset = document.createElement("span");
      reset.className = "usage-text";
      reset.textContent = resetText;
      row.appendChild(reset);
    }

    wrap.appendChild(row);
  }

  const meta = document.createElement("span");
  meta.className = "usage-text";
  const bits = [];
  if (usage.subscriptionTier) bits.push(usage.subscriptionTier.replace(/_/g, " "));
  bits.push(`as of ${timeAgo(usage.capturedAt)}`);
  meta.textContent = bits.join(" · ");
  wrap.appendChild(meta);

  return wrap;
}

async function loadProfiles() {
  const res = await sendMessage({ type: "GET_PROFILES" });
  if (!res?.ok) {
    showStatus(res?.error || "Failed to load accounts.", "error");
    return;
  }
  clearStatus();
  lastProfiles = res.profiles;
  lastActiveId = res.activeId;
  renderProfiles(lastProfiles, lastActiveId, searchInput.value);
}

async function handleRefreshUsage(profile) {
  showStatus(`Checking usage for "${profile.label}"…`);
  const res = await sendMessage({ type: "REFRESH_USAGE", profileId: profile.id });
  if (!res?.ok) {
    showStatus(res?.error || "Could not refresh usage.", "error");
    return;
  }
  clearStatus();
  await loadProfiles();
}

// Refreshes usage for every saved account in one go, instead of clicking
// each account's own refresh icon in turn. Runs in background.js
// sequentially (it has to briefly swap cookies per non-active account), so
// this can take a few seconds with several accounts saved.
async function handleRefreshAll() {
  if (refreshAllBtn.disabled) return;
  refreshAllBtn.disabled = true;
  refreshAllBtn.classList.add("spinning");
  showStatus("Refreshing usage for all accounts…");
  const res = await sendMessage({ type: "REFRESH_ALL_USAGE" });
  refreshAllBtn.disabled = false;
  refreshAllBtn.classList.remove("spinning");
  if (!res?.ok) {
    showStatus(res?.error || "Could not refresh usage.", "error");
    return;
  }
  if (res.failed > 0) {
    showStatus(
      `Refreshed ${res.refreshed} account(s), ${res.failed} failed.`,
      "error"
    );
  } else {
    showStatus(`Refreshed usage for ${res.refreshed} account(s).`, "success");
  }
  await loadProfiles();
}

async function handleSwitch(profile) {
  showStatus(`Switching to "${profile.label}"…`);
  const res = await sendMessage({
    type: "SWITCH_PROFILE",
    profileId: profile.id,
  });
  if (!res?.ok) {
    showStatus(res?.error || "Could not switch account.", "error");
    return;
  }
  if (res.warning) {
    showStatus(res.warning, "error");
  } else {
    showStatus(`Switched to "${profile.label}".`, "success");
  }
  await loadProfiles();
}

// Safe way to make room for a new login: clears cookies locally without
// ever calling claude.ai's logout endpoint, so no existing session gets
// revoked. Opens a clean claude.ai tab for the user to log in.
async function handleNewAccount() {
  newAccountBtn.disabled = true;
  showStatus("Clearing local session (not logging out)…");
  const res = await sendMessage({ type: "PREPARE_NEW_ACCOUNT" });
  newAccountBtn.disabled = false;
  if (!res?.ok) {
    showStatus(res?.error || "Could not prepare a new session.", "error");
    return;
  }
  showStatus(
    "Log in to the new account in the tab, then come back and click \"Add current account.\"",
    "success"
  );
  await loadProfiles();
}

async function handleAdd() {
  const label = labelInput.value.trim();
  if (!label) {
    showStatus("Enter a label for this account first.", "error");
    return;
  }
  addBtn.disabled = true;
  showStatus("Saving current session…");
  const res = await sendMessage({ type: "ADD_CURRENT_ACCOUNT", label });
  addBtn.disabled = false;
  if (!res?.ok) {
    showStatus(
      res?.error ||
        "Could not save this account. Make sure you're logged into claude.ai in this browser.",
      "error"
    );
    return;
  }
  labelInput.value = "";
  addAccountPanel.classList.add("hidden");
  warningBox.classList.add("hidden");
  showStatus(`Saved "${res.profile.label}".`, "success");
  await loadProfiles();
}

async function handleRename(profile) {
  const newLabel = prompt("Rename account:", profile.label);
  if (newLabel === null) return; // cancelled
  const res = await sendMessage({
    type: "RENAME_PROFILE",
    profileId: profile.id,
    label: newLabel,
  });
  if (!res?.ok) {
    showStatus(res?.error || "Could not rename account.", "error");
    return;
  }
  await loadProfiles();
}

async function handleRemove(profile) {
  const confirmed = confirm(`Remove "${profile.label}"? This can't be undone.`);
  if (!confirmed) return;
  const res = await sendMessage({
    type: "REMOVE_PROFILE",
    profileId: profile.id,
  });
  if (!res?.ok) {
    showStatus(res?.error || "Could not remove account.", "error");
    return;
  }
  showStatus(`Removed "${profile.label}".`, "success");
  await loadProfiles();
}

// Reads the current claude.ai tab's rendered conversation and saves it as
// a Markdown file. No Claude API calls happen here — this only touches the
// page DOM and the filesystem, so it costs zero tokens/credits.
async function handleExport() {
  exportBtn.disabled = true;
  showStatus("Reading the conversation and thoughts on this tab…");
  const res = await sendMessage({ type: "EXPORT_CHAT" });
  exportBtn.disabled = false;
  if (!res?.ok) {
    showStatus(res?.error || "Could not export this chat.", "error");
    return;
  }
  const attachmentNote =
    res.attachmentsSaved || res.attachmentsFailed
      ? ` (${res.attachmentsSaved} attachment(s) saved${res.attachmentsFailed ? `, ${res.attachmentsFailed} failed` : ""})`
      : "";
  showStatus(
    `Exported "${res.title}" (${res.messageCount} turns) as "${res.filename}".${attachmentNote}`,
    "success"
  );
  copyPromptBtn.classList.remove("hidden");
}

async function handleCopyPrompt() {
  try {
    await navigator.clipboard.writeText(RESUME_PROMPT);
    showStatus("Resume prompt copied — paste it alongside the attached file.", "success");
  } catch (err) {
    // Clipboard API can be flaky in extension popups depending on focus
    // timing; fall back to the older execCommand approach.
    const textarea = document.createElement("textarea");
    textarea.value = RESUME_PROMPT;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showStatus("Resume prompt copied — paste it alongside the attached file.", "success");
  }
}

// Downloads a JSON file containing every saved profile's cookies. This is
// the safety net for extension updates/reinstalls that reset
// chrome.storage.local (see README — usually caused by removing and
// re-loading the extension, or the unpacked folder's path changing).
async function handleBackup() {
  backupBtn.disabled = true;
  showStatus("Preparing backup…");
  const res = await sendMessage({ type: "EXPORT_BACKUP" });
  backupBtn.disabled = false;
  if (!res?.ok) {
    showStatus(res?.error || "Could not create a backup.", "error");
    return;
  }
  showStatus(
    `Saved ${res.count} account(s) to ${res.filename}. Keep this file private — delete it once restored.`,
    "success"
  );
}

function handleRestoreClick() {
  restoreFileInput.click();
}

async function handleRestoreFileSelected() {
  const file = restoreFileInput.files?.[0];
  restoreFileInput.value = ""; // allow re-selecting the same file later
  if (!file) return;

  restoreBtn.disabled = true;
  showStatus("Reading backup file…");

  let backupData;
  try {
    const text = await file.text();
    backupData = JSON.parse(text);
  } catch (err) {
    restoreBtn.disabled = false;
    showStatus("That file isn't valid JSON — is it the right backup file?", "error");
    return;
  }

  const res = await sendMessage({ type: "IMPORT_BACKUP", backupData });
  restoreBtn.disabled = false;
  if (!res?.ok) {
    showStatus(res?.error || "Could not restore from this backup.", "error");
    return;
  }
  const skippedNote = res.skipped ? ` (${res.skipped} skipped — no cookies saved)` : "";
  showStatus(`Restored ${res.imported} account(s)${skippedNote}.`, "success");
  await loadProfiles();
}

refreshAllBtn.addEventListener("click", handleRefreshAll);
addBtn.addEventListener("click", handleAdd);
newAccountBtn.addEventListener("click", handleNewAccount);
exportBtn.addEventListener("click", handleExport);
copyPromptBtn.addEventListener("click", handleCopyPrompt);
backupBtn.addEventListener("click", handleBackup);
restoreBtn.addEventListener("click", handleRestoreClick);
restoreFileInput.addEventListener("change", handleRestoreFileSelected);
labelInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAdd();
});

searchInput.addEventListener("input", () => {
  renderProfiles(lastProfiles, lastActiveId, searchInput.value);
});

addAccountToggle.addEventListener("click", () => {
  const willShow = addAccountPanel.classList.contains("hidden");
  addAccountPanel.classList.toggle("hidden");
  warningBox.classList.toggle("hidden", !willShow);
  if (willShow) labelInput.focus();
});

editShortcutsBtn.addEventListener("click", () => {
  sendMessage({ type: "OPEN_SHORTCUTS_PAGE" });
});

// Purely visual routing between tabs — no other state changes.
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    tabButtons.forEach((b) => {
      const isActive = b.dataset.tab === target;
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-selected", String(isActive));
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.tab !== target);
    });
  });
});

loadProfiles();

// ---------- Auto-refresh session keep-alive UI ----------

const autoRefreshToggle = document.getElementById("auto-refresh-toggle");
const autoRefreshInterval = document.getElementById("auto-refresh-interval");
const lastRefreshInfo = document.getElementById("last-refresh-info");
const refreshSessionsBtn = document.getElementById("refresh-sessions-btn");

async function loadAutoRefreshSettings() {
  const res = await sendMessage({ type: "GET_AUTO_REFRESH_SETTINGS" });
  if (!res?.ok) return;
  autoRefreshToggle.checked = res.enabled;
  autoRefreshInterval.value = String(res.intervalHours);
  autoRefreshInterval.disabled = !res.enabled;
  if (res.lastRefreshedAt) {
    lastRefreshInfo.textContent = `Last refreshed: ${timeAgo(res.lastRefreshedAt)}`;
  } else {
    lastRefreshInfo.textContent = "Not yet refreshed";
  }
}

async function handleAutoRefreshChange() {
  const enabled = autoRefreshToggle.checked;
  const intervalHours = parseInt(autoRefreshInterval.value, 10);
  autoRefreshInterval.disabled = !enabled;
  await sendMessage({ type: "SET_AUTO_REFRESH", enabled, intervalHours });
}

async function handleRefreshSessions() {
  if (refreshSessionsBtn.disabled) return;
  refreshSessionsBtn.disabled = true;
  showStatus("Refreshing all sessions…");
  const res = await sendMessage({ type: "REFRESH_ALL_SESSIONS" });
  refreshSessionsBtn.disabled = false;
  if (!res?.ok) {
    showStatus(res?.error || "Could not refresh sessions.", "error");
    return;
  }
  if (res.failed > 0) {
    showStatus(
      `Refreshed ${res.refreshed} session(s), ${res.failed} failed.`,
      "error"
    );
  } else {
    showStatus(`Refreshed ${res.refreshed} session(s).`, "success");
  }
  await loadAutoRefreshSettings();
  await loadProfiles();
}

autoRefreshToggle.addEventListener("change", handleAutoRefreshChange);
autoRefreshInterval.addEventListener("change", handleAutoRefreshChange);
refreshSessionsBtn.addEventListener("click", handleRefreshSessions);

loadAutoRefreshSettings();

// ---------- Export directory setting ----------
const exportParentInput = document.getElementById("export-parent-input");
const browseFolderBtn = document.getElementById("browse-folder-btn");
const resetFolderBtn = document.getElementById("reset-folder-btn");
const exportPreviewPath = document.getElementById("export-preview-path");

const DEFAULT_EXPORT_FOLDER = "HotSwap-Claude-Exports";

function normalizeExportPath(raw) {
  if (!raw) return DEFAULT_EXPORT_FOLDER;
  let cleaned = raw.trim().replace(/\\+/g, "/");

  // If user pasted a full absolute path, extract the part inside Downloads
  const dlMatch = cleaned.match(/(?:^|\/|\\)Downloads\/(.+)$/i);
  if (dlMatch && dlMatch[1]) {
    cleaned = dlMatch[1];
  } else {
    // Strip drive letters, leading/trailing slashes, and ../ traversals
    cleaned = cleaned.replace(/^[a-zA-Z]:\/?/, "").replace(/^[\/.]+/, "").replace(/[\/.]+$/, "");
  }

  cleaned = cleaned.replace(/\/{2,}/g, "/").trim();
  return cleaned || DEFAULT_EXPORT_FOLDER;
}

function updateExportPreview(folderName) {
  if (!exportPreviewPath) return;
  const safe = folderName || DEFAULT_EXPORT_FOLDER;
  exportPreviewPath.textContent = "Target: ";
  const codeEl = document.createElement("code");
  codeEl.textContent = `Downloads/${safe}/<ChatTitle>_<Date>_<ID>.zip`;
  exportPreviewPath.appendChild(codeEl);
}

async function loadExportFolderSetting() {
  if (!exportParentInput) return;
  const stored = await chrome.storage.local.get("exportParentFolder");
  const folder = stored.exportParentFolder || DEFAULT_EXPORT_FOLDER;
  exportParentInput.value = folder;
  updateExportPreview(folder);
}

if (exportParentInput) {
  exportParentInput.addEventListener("input", () => {
    const val = normalizeExportPath(exportParentInput.value);
    updateExportPreview(val);
  });

  exportParentInput.addEventListener("change", async () => {
    const val = normalizeExportPath(exportParentInput.value);
    exportParentInput.value = val;
    await chrome.storage.local.set({ exportParentFolder: val });
    updateExportPreview(val);
    showStatus(`Export folder set to "Downloads/${val}/".`, "success");
  });
}

if (browseFolderBtn) {
  browseFolderBtn.addEventListener("click", async () => {
    try {
      if (typeof window.showDirectoryPicker === "function") {
        const dirHandle = await window.showDirectoryPicker({ mode: "read" });
        if (dirHandle && dirHandle.name) {
          const folderName = normalizeExportPath(dirHandle.name);
          exportParentInput.value = folderName;
          await chrome.storage.local.set({ exportParentFolder: folderName });
          updateExportPreview(folderName);
          showStatus(`Export folder set to "Downloads/${folderName}/".`, "success");
        }
      } else {
        exportParentInput.focus();
        showStatus("Type or paste your desired folder path below.", "info");
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        exportParentInput.focus();
      }
    }
  });
}

if (resetFolderBtn) {
  resetFolderBtn.addEventListener("click", async () => {
    exportParentInput.value = DEFAULT_EXPORT_FOLDER;
    await chrome.storage.local.set({ exportParentFolder: DEFAULT_EXPORT_FOLDER });
    updateExportPreview(DEFAULT_EXPORT_FOLDER);
    showStatus(`Export folder reset to "Downloads/${DEFAULT_EXPORT_FOLDER}/".`, "success");
  });
}

loadExportFolderSetting();

