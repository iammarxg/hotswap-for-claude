import { ENCRYPTED_BACKUP_KIND, validateBackupPassword, validateBackupEnvelope, backupPasswordWarning } from "./backup-crypto.js";
import { readBackupFile, BACKUP_ERROR } from "./backup-schema.js";

// popup.js — no inline scripts (CSP-compliant), talks to background.js
// via chrome.runtime.sendMessage.

const listEl = document.getElementById("profile-list");
const savedEyebrowEl = document.getElementById("saved-eyebrow");
const currentSectionEl = document.getElementById("current-account-section");
const currentListEl = currentSectionEl.querySelector(".profile-list-current");
const statusEl = document.getElementById("status");
const labelInput = document.getElementById("new-label");
const addBtn = document.getElementById("add-btn");
const newAccountBtn = document.getElementById("new-account-btn");
const addAccountToggle = document.getElementById("add-account-toggle");
const addAccountPanel = document.getElementById("add-account-panel");
const warningBox = document.getElementById("warning-box");
const searchSectionEl = document.getElementById("search-section");
const savedAccountsSectionEl = document.getElementById("saved-accounts-section");
const firstAccountOnboardingEl = document.getElementById("first-account-onboarding");
const firstAccountLabelInput = document.getElementById("first-account-label");
const firstAccountSaveBtn = document.getElementById("first-account-save-btn");
const firstAccountLoginBtn = document.getElementById("first-account-login-btn");

// Theme selectors
const themeQuickToggle = document.getElementById("theme-quick-toggle");
const themeCards = document.querySelectorAll(".theme-card");

// Export & Summary selectors
const exportRawBtn = document.getElementById("export-raw-btn");
const summarizeBtn = document.getElementById("summarize-btn");
const optIncludeAttachments = document.getElementById("opt-include-attachments");
const optIncludeSummaryContent = document.getElementById("opt-include-summary-content");
const summaryHub = document.getElementById("summary-hub");
const summaryHubTitle = document.getElementById("summary-hub-title");
const summaryHubMetrics = document.getElementById("summary-hub-metrics");
const copySummaryBtn = document.getElementById("copy-summary-btn");
const togglePreviewBtn = document.getElementById("toggle-preview-btn");
const summaryPreviewDrawer = document.getElementById("summary-preview-drawer");
const summaryPreviewContent = document.getElementById("summary-preview-content");
const geminiKeyStatus = document.getElementById("gemini-key-status");

// Gemini settings selectors
const geminiApiKeyInput = document.getElementById("gemini-api-key-input");
const saveGeminiKeyBtn = document.getElementById("save-gemini-key-btn");
const clearGeminiKeyBtn = document.getElementById("clear-gemini-key-btn");
const geminiKeySettingsStatus = document.getElementById("gemini-key-settings-status");
const geminiLink = document.getElementById("gemini-link");

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

// Maps manifest command names to human-readable descriptions
const COMMAND_LABELS = {
  "quick-switch-1": "Switch to account with most usage left ⚡",
  "cycle-next-account": "Cycle to next account →",
  "cycle-prev-account": "Cycle to previous account ←",
};

// Parses a Chrome shortcut string like "Alt+Shift+Right" into display-friendly kbd tokens.
// On Mac, remaps Alt→⌥ and Shift→⇧.
function parseShortcutToKbds(shortcut) {
  if (!shortcut) return [];
  return shortcut.split("+").map((part) => {
    if (IS_MAC) {
      if (part === "Alt" || part === "MacCtrl") return "⌥";
      if (part === "Shift") return "⇧";
      if (part === "Ctrl") return "⌘";
    }
    const arrowMap = { Left: "←", Right: "→", Up: "↑", Down: "↓" };
    return arrowMap[part] || part;
  });
}

async function loadDynamicShortcuts() {
  if (!shortcutsListEl) return;
  shortcutsListEl.textContent = "";
  try {
    const commands = await chrome.commands.getAll();
    for (const cmd of commands) {
      const label = COMMAND_LABELS[cmd.name];
      if (!label) continue;

      const li = document.createElement("li");

      const labelEl = document.createElement("span");
      labelEl.textContent = label;

      const keysEl = document.createElement("span");
      keysEl.className = "shortcut-keys";

      if (cmd.shortcut) {
        const tokens = parseShortcutToKbds(cmd.shortcut);
        tokens.forEach((token) => {
          const kbd = document.createElement("kbd");
          kbd.textContent = token;
          keysEl.appendChild(kbd);
        });
      } else {
        const unset = document.createElement("kbd");
        unset.className = "shortcut-unset";
        unset.textContent = "not set";
        keysEl.appendChild(unset);
      }

      li.appendChild(labelEl);
      li.appendChild(keysEl);
      shortcutsListEl.appendChild(li);
    }
  } catch (err) {
    // Fallback: show a simple note
    const li = document.createElement("li");
    li.textContent = "Open chrome://extensions/shortcuts to view bindings.";
    shortcutsListEl.appendChild(li);
  }
}

loadDynamicShortcuts();

// Returns the effective limit object for rendering, zeroing out expired quotas.
function getEffectiveLimit(v, now = Date.now()) {
  if (!v || typeof v.percentage !== "number") return null;
  if (v.resetsAt && v.resetsAt <= now) {
    return { ...v, percentage: 0, resetsAt: null };
  }
  return v;
}

// Mirrors background.js's getLeastUsedProfileId(): quick-switch-1 targets
// whichever saved account has the most 5-hour ("session") credit left —
// i.e. the lowest session-limit percentage, not the weekly one. Computed
// here too so the popup can badge the right account without a round trip.
function findQuickSwitchTargetId(profiles) {
  const now = Date.now();
  const withSessionUsage = Object.values(profiles).filter(
    (p) => typeof p.usage?.limits?.session?.percentage === "number"
  );
  if (withSessionUsage.length === 0) return null;
  withSessionUsage.sort((a, b) => {
    const aEff = getEffectiveLimit(a.usage.limits.session, now);
    const bEff = getEffectiveLimit(b.usage.limits.session, now);
    const aPct = aEff ? aEff.percentage : a.usage.limits.session.percentage;
    const bPct = bEff ? bEff.percentage : b.usage.limits.session.percentage;
    return aPct - bPct;
  });
  return withSessionUsage[0].id;
}

const RESUME_PROMPT =
  "I'm continuing a previous Claude conversation. I've attached the full transcript and files — please read them for context, then continue helping me from where we left off without summarizing the past dialogue.";

function sendMessage(message, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({
          ok: false,
          error: "Background service worker timed out. Please reload the extension in chrome://extensions.",
        });
      }
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { ok: false, error: "Empty response from background service worker." });
        }
      });
    } catch (err) {
      if (!settled) {
        clearTimeout(timer);
        settled = true;
        resolve({ ok: false, error: err.message || String(err) });
      }
    }
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
  const all = Object.values(profiles);
  const pinned = all.filter((p) => p.pinned).sort((a, b) => b.updatedAt - a.updatedAt);
  const rest   = all.filter((p) => !p.pinned).sort((a, b) => b.updatedAt - a.updatedAt);
  return [...pinned, ...rest];
}

// Builds the shared contents of a profile row — used for both the
// current-account card and each saved-account list item.
function buildProfileItem(profile, { activeId, isQuickSwitchTarget, isCurrent } = {}) {
  const li = document.createElement("li");
  li.className =
    "profile-item" +
    (isCurrent ? " profile-item-current" : "") +
    (!isCurrent && profile.pinned ? " profile-item-pinned" : "") +
    (!isCurrent && isQuickSwitchTarget ? " profile-item-best" : "");
  li.dataset.id = profile.id;

  const main = document.createElement("div");
  main.className = "profile-main";

  if (!isCurrent && isQuickSwitchTarget) {
    const bestBadge = document.createElement("span");
    bestBadge.className = "best-badge";
    bestBadge.title = `${IS_MAC ? "⌥⇧1" : "Alt+Shift+1"} — switch here, it has the most usage left`;
    bestBadge.textContent = "🔋";
    main.appendChild(bestBadge);
  }

  // Account avatar
  const avatarWrap = document.createElement("div");
  avatarWrap.className = "avatar-wrap";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = initialsFor(profile.label);
  avatarWrap.appendChild(avatar);

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

  // Pinned indicator badge
  if (!isCurrent && profile.pinned) {
    const pinIndicator = document.createElement("span");
    pinIndicator.className = "pin-indicator";
    pinIndicator.title = "Pinned to top";
    pinIndicator.textContent = "📌";
    topRow.appendChild(pinIndicator);
  }

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

  main.appendChild(avatarWrap);
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

  if (!isCurrent) {
    const pinBtn = document.createElement("button");
    pinBtn.className = "icon-btn" + (profile.pinned ? " pin-btn-active" : "");
    pinBtn.title = profile.pinned ? "Unpin" : "Pin to top";
    pinBtn.textContent = profile.pinned ? "📌" : "📍";
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlePin(profile, !profile.pinned);
    });

    actions.appendChild(pinBtn);
  }

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

  const totalAccounts = entries.length;
  const isFirstAccount = totalAccounts === 0;
  firstAccountOnboardingEl.classList.toggle("hidden", !isFirstAccount);
  searchSectionEl.classList.toggle("hidden", isFirstAccount);

  if (isFirstAccount) {
    currentSectionEl.classList.add("hidden");
    savedAccountsSectionEl.classList.add("hidden");
    addAccountPanel.classList.add("hidden");
    warningBox.classList.add("hidden");
    noMatchesEl.classList.add("hidden");
    return;
  }

  searchSectionEl.classList.remove("hidden");

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

  const showSeparation = totalAccounts >= 2;
  if (searchSectionEl) {
    searchSectionEl.classList.toggle("panel-last", !showSeparation);
  }
  if (savedAccountsSectionEl) {
    savedAccountsSectionEl.classList.toggle("hidden", totalAccounts === 1 && saved.length === 0 && !q);
  }

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

// Format the plan consistently in current-account details and saved rows.
function formatSubscriptionTier(tier) {
  return String(tier ?? "")
    .replace(/_/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
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
  if (diff <= 0) return "";

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
  const now = Date.now();
  const entries = LIMIT_ORDER.map((key) => [key, getEffectiveLimit(usage.limits?.[key], now)]).filter(
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
    pct.textContent = `${v.percentage.toFixed(0)}%${resetText ? ` · ${resetText}` : ""}`;

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
    if (usage.subscriptionTier) bits.push(formatSubscriptionTier(usage.subscriptionTier));
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
  const now = Date.now();
  const entries = LIMIT_ORDER.map((key) => [key, getEffectiveLimit(usage.limits?.[key], now)])
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
  if (usage.subscriptionTier) bits.push(formatSubscriptionTier(usage.subscriptionTier));
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
async function handleNewAccount(
  button = newAccountBtn,
  completionMessage = "Log in to the new account in the tab, then come back and click \"Add current account.\""
) {
  button.disabled = true;
  showStatus("Clearing local session (not logging out)…");
  const res = await sendMessage({ type: "PREPARE_NEW_ACCOUNT" });
  button.disabled = false;
  if (!res?.ok) {
    showStatus(res?.error || "Could not prepare a new session.", "error");
    return;
  }
  showStatus(completionMessage, "success");
  await loadProfiles();
}

async function saveCurrentAccount(input, button, options = {}) {
  const label = input.value.trim();
  if (!label) {
    showStatus(options.emptyLabelMessage || "Enter a label for this account first.", "error");
    return false;
  }
  button.disabled = true;
  showStatus("Saving current session…");
  const res = await sendMessage({ type: "ADD_CURRENT_ACCOUNT", label });
  button.disabled = false;
  if (!res?.ok) {
    const noSession = res?.error === "No claude.ai session found. Log in to claude.ai first.";
    showStatus(
      noSession && options.noSessionMessage
        ? options.noSessionMessage
        : res?.error || "Could not save this account. Make sure you're logged into claude.ai in this browser.",
      "error"
    );
    return false;
  }
  input.value = "";
  return res.profile;
}

async function handleAdd() {
  const profile = await saveCurrentAccount(labelInput, addBtn);
  if (!profile) return;
  addAccountPanel.classList.add("hidden");
  warningBox.classList.add("hidden");
  showStatus(`Saved "${profile.label}".`, "success");
  await loadProfiles();
}

async function handleFirstAccountSave() {
  const profile = await saveCurrentAccount(firstAccountLabelInput, firstAccountSaveBtn, {
    emptyLabelMessage: "Give your first account a name before saving it.",
    noSessionMessage: "Sign in to Claude first, then reopen HotSwap to save this account.",
  });
  if (!profile) return;
  showStatus(`Saved "${profile.label}".`, "success");
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

async function handlePin(profile, pinned) {
  const res = await sendMessage({
    type: "PIN_PROFILE",
    profileId: profile.id,
    pinned,
  });
  if (!res?.ok) {
    showStatus(res?.error || "Could not pin account.", "error");
    return;
  }
  await loadProfiles();
}

// ---------- Theme Management ----------
const THEMES = ["midnight", "claude-light", "claude-dark"];

async function applyTheme(themeName) {
  const valid = THEMES.includes(themeName) ? themeName : "midnight";
  document.documentElement.setAttribute("data-theme", valid);
  try {
    localStorage.setItem("hotswap_theme", valid);
  } catch (e) {}
  await chrome.storage.local.set({ theme: valid });

  themeCards.forEach((card) => {
    const isActive = card.dataset.theme === valid;
    card.classList.toggle("active", isActive);
    card.setAttribute("aria-checked", String(isActive));
  });
}

async function initTheme() {
  let active = "midnight";
  try {
    const stored = await chrome.storage.local.get("theme");
    active = stored.theme || localStorage.getItem("hotswap_theme") || "midnight";
  } catch (e) {}
  await applyTheme(active);
}

function handleQuickThemeToggle() {
  const current = document.documentElement.getAttribute("data-theme") || "midnight";
  const currentIndex = THEMES.indexOf(current);
  const nextTheme = THEMES[(currentIndex + 1) % THEMES.length];
  applyTheme(nextTheme);
  showStatus(`Theme switched to ${nextTheme.replace("-", " ")}.`, "info");
}

themeCards.forEach((card) => {
  card.addEventListener("click", () => {
    const target = card.dataset.theme;
    if (target) applyTheme(target);
  });
});

if (themeQuickToggle) {
  themeQuickToggle.addEventListener("click", handleQuickThemeToggle);
}

initTheme();

// ---------- Checkbox Persistence ----------
// Load saved checkbox states on popup open; save on every change.
async function loadCheckboxPrefs() {
  const stored = await chrome.storage.local.get([
    "pref_includeAttachments",
    "pref_includeSummaryContent",
  ]);
  if (optIncludeAttachments) {
    optIncludeAttachments.checked = stored.pref_includeAttachments !== false;
  }
  if (optIncludeSummaryContent) {
    optIncludeSummaryContent.checked = stored.pref_includeSummaryContent !== false;
  }
}

if (optIncludeAttachments) {
  optIncludeAttachments.addEventListener("change", () => {
    chrome.storage.local.set({ pref_includeAttachments: optIncludeAttachments.checked });
  });
}
if (optIncludeSummaryContent) {
  optIncludeSummaryContent.addEventListener("change", () => {
    chrome.storage.local.set({ pref_includeSummaryContent: optIncludeSummaryContent.checked });
  });
}
loadCheckboxPrefs();

// ---------- Gemini Key Status ----------
// Shows a status chip under the Summarize button in the Tools tab.
async function refreshGeminiKeyStatus() {
  if (!geminiKeyStatus) return;
  const result = await sendMessage({ type: "GET_GEMINI_KEY_STATUS" });
  const hasKey = result.ok && result.configured;
  geminiKeyStatus.className = "gemini-key-chip";
  if (!result.ok) {
    geminiKeyStatus.textContent = "⚠️ Check API key storage in Settings.";
    geminiKeyStatus.classList.add("gemini-key-missing");
    geminiKeyStatus.classList.remove("hidden");
  } else if (hasKey) {
    geminiKeyStatus.textContent = "✅ Gemini API key set";
    geminiKeyStatus.classList.add("gemini-key-ok");
    geminiKeyStatus.classList.remove("hidden");
  } else {
    geminiKeyStatus.textContent = "⚠️ Add your Gemini API key in Settings to use this feature.";
    geminiKeyStatus.classList.add("gemini-key-missing");
    geminiKeyStatus.classList.remove("hidden");
  }
}
refreshGeminiKeyStatus();

// ---------- Exporter & Gemini Summarizer ----------

let currentSummaryText = null;

async function copyToClipboard(text, buttonEl, successText = "✓ Copied!") {
  if (!text) return;
  const originalText = buttonEl ? buttonEl.textContent : "";
  try {
    await navigator.clipboard.writeText(text);
    if (buttonEl) {
      buttonEl.textContent = successText;
      setTimeout(() => { buttonEl.textContent = originalText; }, 2000);
    }
    showStatus("Copied to clipboard!", "success");
  } catch (err) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    if (buttonEl) {
      buttonEl.textContent = successText;
      setTimeout(() => { buttonEl.textContent = originalText; }, 2000);
    }
    showStatus("Copied to clipboard!", "success");
  }
}

async function handleExportRaw() {
  if (!exportRawBtn || exportRawBtn.disabled) return;
  exportRawBtn.disabled = true;
  const includeAttachments = optIncludeAttachments ? optIncludeAttachments.checked : true;
  showStatus(
    includeAttachments
      ? "Starting backup (transcript & attachments)…"
      : "Exporting conversation transcript…"
  );
  const options = {
    includeAttachments,
  };

  try {
    const port = chrome.runtime.connect({ name: "export-chat" });
    const pingTimer = setInterval(() => {
      try {
        port.postMessage({ type: "PING" });
      } catch (e) {
        clearInterval(pingTimer);
      }
    }, 4000);

    port.postMessage({ type: "START_EXPORT", options });

    port.onMessage.addListener(async (msg) => {
      if (msg.type === "PROGRESS") {
        showStatus(msg.text || "Exporting conversation…");
      } else if (msg.type === "DONE") {
        clearInterval(pingTimer);
        exportRawBtn.disabled = false;
        const res = msg.info || {};
        const attachmentNote =
          includeAttachments && (res.attachmentsSaved || res.attachmentsFailed)
            ? ` (${res.attachmentsSaved} file(s) saved${res.attachmentsFailed ? `, ${res.attachmentsFailed} failed` : ""})`
            : "";
        showStatus(
          `Exported "${res.title}" (${res.messageCount} turns) — ${res.absolutePath ? `saved to ${res.absolutePath}` : "saved successfully; full path unavailable"}.${attachmentNote}`,
          "success"
        );
        await loadExportLocation();
        try { port.disconnect(); } catch (e) {}
      } else if (msg.type === "ERROR") {
        clearInterval(pingTimer);
        exportRawBtn.disabled = false;
        showStatus(msg.error || "Could not export this chat.", "error");
        try { port.disconnect(); } catch (e) {}
      }
    });

    port.onDisconnect.addListener(() => {
      clearInterval(pingTimer);
      exportRawBtn.disabled = false;
      if (chrome.runtime.lastError) {
        showStatus(chrome.runtime.lastError.message, "error");
      }
    });
  } catch (err) {
    exportRawBtn.disabled = false;
    showStatus(err.message || String(err), "error");
  }
}

async function handleSummarize() {
  if (!summarizeBtn || summarizeBtn.disabled) return;
  const originalText = summarizeBtn.textContent;
  summarizeBtn.disabled = true;
  summarizeBtn.textContent = "⏳ Summarizing with Gemini…";
  showStatus("✨ Asking Gemini to summarize conversation…");

  const options = {
    includeFileContent: optIncludeSummaryContent ? optIncludeSummaryContent.checked : true,
  };
  const res = await sendMessage({ type: "SUMMARIZE_CHAT", options });

  if (!res?.ok) {
    summarizeBtn.disabled = false;
    summarizeBtn.textContent = originalText;
    if (res?.error === "NO_API_KEY") {
      showStatus("No Gemini API key set — add one in the Settings tab.", "error");
    } else {
      showStatus(res?.error || "Could not generate summary.", "error");
    }
    return;
  }

  currentSummaryText = res.summaryText;

  // Populate Summary Hub
  if (summaryHub) {
    if (summaryHubTitle) summaryHubTitle.textContent = res.title || "Claude Conversation";
    if (summaryHubMetrics) summaryHubMetrics.textContent = `${res.messageCount} turns • Gemini AI summary`;
    if (summaryPreviewContent) summaryPreviewContent.textContent = res.summaryText || "";
    summaryHub.classList.remove("hidden");
  }

  // Auto-copy to clipboard and provide clear user feedback
  await copyToClipboard(res.summaryText, copySummaryBtn, "✓ Copied!");

  summarizeBtn.disabled = false;
  summarizeBtn.textContent = "✓ Summary Copied to Clipboard!";
  setTimeout(() => {
    summarizeBtn.textContent = originalText;
  }, 3000);

  showStatus(`✓ Summary for "${res.title}" copied to clipboard!`, "success");
}

function handleCopySummary() {
  if (currentSummaryText) {
    copyToClipboard(currentSummaryText, copySummaryBtn, "✓ Copied!");
  } else {
    showStatus("No summary yet. Click 'Summarize' on a claude.ai chat tab first.", "error");
  }
}

function handleToggleSummaryPreview() {
  if (!summaryPreviewDrawer) return;
  const isHidden = summaryPreviewDrawer.classList.contains("hidden");
  summaryPreviewDrawer.classList.toggle("hidden", !isHidden);
  const arrow = togglePreviewBtn.querySelector(".preview-arrow");
  if (arrow) arrow.textContent = isHidden ? "▴" : "▾";
}

// Passwords live only in this popup and the transient background request.
const backupCreateForm = document.getElementById("backup-create-form");
const backupUnlockForm = document.getElementById("backup-unlock-form");
const backupPassword = document.getElementById("backup-password");
const backupConfirm = document.getElementById("backup-password-confirm");
const backupUnlockPassword = document.getElementById("backup-unlock-password");
const backupStatus = document.getElementById("backup-status");
let pendingBackupRestore = null;
let pendingBackupToken = null;
let pendingBackupLegacy = false;
let backupBusy = false;

function showBackupStatus(text, kind = "") {
  backupStatus.textContent = text;
  backupStatus.className = `backup-feedback ${kind}`;
}

function resetBackupForms() {
  backupCreateForm.reset();
  backupUnlockForm.reset();
  backupCreateForm.classList.add("hidden");
  backupUnlockForm.classList.add("hidden");
  pendingBackupRestore = null;
  pendingBackupToken = null;
  pendingBackupLegacy = false;
  document.getElementById("backup-preview").classList.add("hidden");
  document.getElementById("backup-preview-labels").replaceChildren();
  document.getElementById("backup-password-warning").textContent = "";
  sendMessage({ type: "CANCEL_BACKUP_IMPORT" }).catch(() => {});
}

function setBackupBusy(busy) {
  backupBusy = busy;
  for (const id of ["backup-btn", "restore-btn", "backup-save-btn", "backup-unlock-btn", "backup-cancel-btn", "backup-unlock-cancel-btn", "backup-password", "backup-password-confirm", "backup-unlock-password", "backup-apply-btn", "backup-preview-cancel-btn"]) {
    document.getElementById(id).disabled = busy;
  }
}

function handleBackup() {
  if (backupBusy) return;
  resetBackupForms();
  showBackupStatus("");
  backupCreateForm.classList.remove("hidden");
  backupPassword.focus();
}

async function submitEncryptedBackup(event) {
  event.preventDefault();
  if (backupBusy) return;
  const password = backupPassword.value;
  const confirmation = backupConfirm.value;
  backupPassword.value = "";
  backupConfirm.value = "";
  try {
    validateBackupPassword(password);
    if (password !== confirmation) throw new Error("The backup passwords do not match.");
  } catch (error) {
    showBackupStatus(error.message, "error");
    return;
  }
  backupPassword.value = "";
  backupConfirm.value = "";
  setBackupBusy(true);
  showBackupStatus("Encrypting backup…");
  try {
    const res = await sendMessage({ type: "EXPORT_BACKUP", password });
    if (!res?.ok) throw new Error(res?.error || "Could not create a backup.");
    resetBackupForms();
    showBackupStatus(`Saved ${res.count} account(s) to ${res.filename}. Keep the password safe; you need it to restore.`, "success");
  } catch (error) {
    showBackupStatus(error.message, "error");
  } finally {
    setBackupBusy(false);
  }
}

function handleRestoreClick() {
  if (backupBusy) return;
  resetBackupForms();
  showBackupStatus("");
  restoreFileInput.click();
}

async function restoreBackupData(backupData, password) {
  setBackupBusy(true);
  showBackupStatus(password ? "Unlocking backup…" : "Restoring legacy backup…");
  try {
    const res = await sendMessage({ type: "PREVIEW_BACKUP", backupData, ...(password !== undefined ? { password } : {}) });
    if (!res?.ok) throw new Error(res?.error || "Could not restore from this backup.");
    pendingBackupRestore = null;
    pendingBackupToken = res.token;
    pendingBackupLegacy = res.legacy;
    backupUnlockForm.classList.add("hidden");
    const labels = document.getElementById("backup-preview-labels");
    labels.replaceChildren(...res.labels.map(label => {
      const item = document.createElement("li");
      item.textContent = label;
      return item;
    }));
    document.getElementById("backup-preview-title").textContent = `Import ${res.count} account(s)?`;
    document.getElementById("backup-preview").classList.remove("hidden");
    showBackupStatus(res.legacy ? "This backup uses an older format. After restoring, you can re-export it in the newer format." : "Review the accounts before confirming. Only restore sessions from a source you trust.");
  } catch (error) {
    showBackupStatus(error.message, "error");
  } finally {
    setBackupBusy(false);
  }
}

async function handleRestoreFileSelected() {
  const file = restoreFileInput.files?.[0];
  restoreFileInput.value = "";
  if (!file || backupBusy) return;
  setBackupBusy(true);
  showBackupStatus("Reading backup file…");
  let backupData;
  try {
    backupData = await readBackupFile(file);
    if (backupData.kind === ENCRYPTED_BACKUP_KIND) validateBackupEnvelope(backupData);
  } catch (error) {
    showBackupStatus(error.message, "error");
    return;
  } finally {
    setBackupBusy(false);
  }
  if (backupData?.kind === ENCRYPTED_BACKUP_KIND) {
    pendingBackupRestore = backupData;
    backupUnlockForm.classList.remove("hidden");
    showBackupStatus("This backup is encrypted. Enter its password to restore.");
    backupUnlockPassword.focus();
  } else {
    await restoreBackupData(backupData);
  }
}

async function submitBackupUnlock(event) {
  event.preventDefault();
  if (backupBusy || !pendingBackupRestore) return;
  const password = backupUnlockPassword.value;
  backupUnlockPassword.value = "";
  await restoreBackupData(pendingBackupRestore, password);
}

backupCreateForm.addEventListener("submit", submitEncryptedBackup);
backupUnlockForm.addEventListener("submit", submitBackupUnlock);
backupPassword.addEventListener("input", () => {
  document.getElementById("backup-password-warning").textContent = backupPasswordWarning(backupPassword.value);
});
document.getElementById("backup-apply-btn").addEventListener("click", async () => {
  if (backupBusy || !pendingBackupToken) return;
  const token = pendingBackupToken;
  const legacy = pendingBackupLegacy;
  pendingBackupToken = null;
  setBackupBusy(true);
  try {
    const res = await sendMessage({ type: "IMPORT_BACKUP", token });
    if (!res?.ok) throw new Error(BACKUP_ERROR);
    resetBackupForms();
    showBackupStatus(`Restored ${res.imported} account(s)${res.skipped ? ` (${res.skipped} skipped — no cookies saved)` : ""}.${legacy ? " This backup uses an older format. After restoring, you can re-export it in the newer format." : ""}`, "success");
    await loadProfiles();
  } catch {
    resetBackupForms();
    showBackupStatus(BACKUP_ERROR, "error");
  } finally { setBackupBusy(false); }
});
for (const id of ["backup-cancel-btn", "backup-unlock-cancel-btn", "backup-preview-cancel-btn"]) {
  document.getElementById(id).addEventListener("click", () => {
    resetBackupForms();
    showBackupStatus("");
  });
}
window.addEventListener("pagehide", resetBackupForms);
tabButtons.forEach((button) => button.addEventListener("click", () => {
  if (!backupBusy) resetBackupForms();
}));

refreshAllBtn.addEventListener("click", handleRefreshAll);
addBtn.addEventListener("click", handleAdd);
newAccountBtn.addEventListener("click", () => handleNewAccount());
firstAccountSaveBtn.addEventListener("click", handleFirstAccountSave);
firstAccountLoginBtn.addEventListener("click", () => {
  handleNewAccount(
    firstAccountLoginBtn,
    "Sign in to Claude in the tab, then reopen HotSwap and save your first account."
  );
});
if (exportRawBtn) exportRawBtn.addEventListener("click", handleExportRaw);
if (summarizeBtn) summarizeBtn.addEventListener("click", handleSummarize);
if (copySummaryBtn) copySummaryBtn.addEventListener("click", handleCopySummary);
if (togglePreviewBtn) togglePreviewBtn.addEventListener("click", handleToggleSummaryPreview);
backupBtn.addEventListener("click", handleBackup);
restoreBtn.addEventListener("click", handleRestoreClick);
restoreFileInput.addEventListener("change", handleRestoreFileSelected);
labelInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAdd();
});
firstAccountLabelInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleFirstAccountSave();
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
    // Reload dynamic shortcuts when Settings tab is opened
    if (target === "settings") loadDynamicShortcuts();
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

// ---------- Gemini API Key Management ----------
async function loadGeminiKeySettings() {
  if (!geminiApiKeyInput) return;
  const result = await sendMessage({ type: "GET_GEMINI_KEY_STATUS" });
  geminiApiKeyInput.value = "";
  geminiApiKeyInput.placeholder = result.configured ? "Key saved — paste a replacement…" : "Paste your Gemini API key here…";
  if (geminiKeySettingsStatus) {
    geminiKeySettingsStatus.textContent = !result.ok ? (result.error || "Could not access API key storage.")
      : result.configured ? "✅ API key saved with local encryption." : "No API key saved yet.";
  }
}

async function updateGeminiKey(type) {
  const apiKey = geminiApiKeyInput?.value.trim();
  if (type === "SAVE_GEMINI_KEY" && !apiKey) {
    showStatus("Paste a new API key first.", "error");
    return;
  }
  saveGeminiKeyBtn.disabled = clearGeminiKeyBtn.disabled = true;
  if (geminiApiKeyInput) geminiApiKeyInput.value = "";
  try {
    const result = await sendMessage({ type, ...(type === "SAVE_GEMINI_KEY" ? { apiKey } : {}) });
    if (!result.ok) throw new Error(result.error || "Could not update API key.");
    await loadGeminiKeySettings();
    await refreshGeminiKeyStatus();
    showStatus(type === "SAVE_GEMINI_KEY" ? "Gemini API key encrypted and saved." : "Gemini API key cleared.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    saveGeminiKeyBtn.disabled = clearGeminiKeyBtn.disabled = false;
  }
}

saveGeminiKeyBtn?.addEventListener("click", () => updateGeminiKey("SAVE_GEMINI_KEY"));
clearGeminiKeyBtn?.addEventListener("click", () => updateGeminiKey("CLEAR_GEMINI_KEY"));
window.addEventListener("pagehide", () => { if (geminiApiKeyInput) geminiApiKeyInput.value = ""; });

async function loadExportLocation() {
  const target = document.getElementById("export-save-location");
  if (!target) return;
  try {
    const stored = await chrome.storage.local.get("lastSuccessfulExport");
    target.textContent = stored.lastSuccessfulExport?.directory || "Export a chat to detect the full save location.";
  } catch {
    target.textContent = "Export save location is currently unavailable.";
  }
}
loadExportLocation();

if (geminiLink) {
  geminiLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: "https://ai.google.dev/gemini-api/docs/api-key" });
  });
}

loadGeminiKeySettings();

// ---------- Notifications Toggle ----------

const notificationsToggle = document.getElementById("notifications-toggle");

async function loadNotificationsSettings() {
  if (!notificationsToggle) return;
  const res = await sendMessage({ type: "GET_NOTIFICATIONS_ENABLED" });
  if (res?.ok) {
    notificationsToggle.checked = res.enabled;
  }
}

if (notificationsToggle) {
  notificationsToggle.addEventListener("change", async () => {
    await sendMessage({
      type: "SET_NOTIFICATIONS_ENABLED",
      enabled: notificationsToggle.checked,
    });
  });
}

loadNotificationsSettings();

// ---------- Live UI countdown & auto-reset ticker ----------
// Updates relative countdown phrasings (e.g. "resets in 5m" -> "resets in 4m")
// every 30 seconds while the popup is open, and automatically triggers
// loadProfiles() if any account's reset timestamp elapses so the UI flips
// directly to 0% without needing to close and re-open the extension.
setInterval(() => {
  if (!lastProfiles) return;
  const now = Date.now();
  let hasExpired = false;

  for (const p of Object.values(lastProfiles)) {
    const limits = p.usage?.limits;
    if (!limits) continue;
    for (const lim of Object.values(limits)) {
      if (lim && typeof lim.resetsAt === "number" && lim.resetsAt > 0 && lim.resetsAt <= now) {
        hasExpired = true;
        break;
      }
    }
    if (hasExpired) break;
  }

  if (hasExpired) {
    loadProfiles();
  } else {
    renderProfiles(lastProfiles, lastActiveId, searchInput ? searchInput.value : "");
  }
}, 30000);
