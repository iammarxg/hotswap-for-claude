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
const searchSectionEl = document.getElementById("search-section");
const savedAccountsSectionEl = document.getElementById("saved-accounts-section");
const fleetOverviewEl = document.getElementById("fleet-overview");

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

// 8-color palette for account tagging. Values chosen to be visually distinct
// across all three themes (Midnight / Claude Light / Claude Dark).
const ACCOUNT_COLORS = [
  { hex: "#ef4444", label: "Red" },
  { hex: "#f97316", label: "Orange" },
  { hex: "#eab308", label: "Yellow" },
  { hex: "#22c55e", label: "Green" },
  { hex: "#3b82f6", label: "Blue" },
  { hex: "#a855f7", label: "Purple" },
  { hex: "#ec4899", label: "Pink" },
  { hex: "#6b7280", label: "Gray" },
];

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

  // Avatar with optional color dot overlay
  const avatarWrap = document.createElement("div");
  avatarWrap.className = "avatar-wrap";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = initialsFor(profile.label);
  // Tint avatar background when a color tag is set
  if (profile.color) {
    avatar.style.background = profile.color + "33"; // 20% opacity tint
    avatar.style.color = profile.color;
    avatar.style.borderColor = profile.color + "66";

    const colorDot = document.createElement("span");
    colorDot.className = "avatar-color-dot";
    colorDot.style.background = profile.color;
    colorDot.title = `Color tag — click 🎨 to change`;
    avatarWrap.appendChild(colorDot);
  }
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

  // Color tag button (palette picker toggle) — not shown for the current account card
  if (!isCurrent) {
    const colorBtn = document.createElement("button");
    colorBtn.className = "icon-btn";
    colorBtn.title = "Set color tag";
    colorBtn.textContent = "🎨";
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const existing = li.querySelector(".color-picker-strip");
      if (existing) {
        existing.remove();
        return;
      }
      li.appendChild(buildColorPicker(profile));
    });

    const pinBtn = document.createElement("button");
    pinBtn.className = "icon-btn" + (profile.pinned ? " pin-btn-active" : "");
    pinBtn.title = profile.pinned ? "Unpin" : "Pin to top";
    pinBtn.textContent = profile.pinned ? "📌" : "📍";
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlePin(profile, !profile.pinned);
    });

    actions.appendChild(pinBtn);
    actions.appendChild(colorBtn);
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

// Builds an inline color-picker strip that appears below a profile item.
// Clicking a swatch calls SET_PROFILE_COLOR then refreshes the list.
function buildColorPicker(profile) {
  const strip = document.createElement("div");
  strip.className = "color-picker-strip";
  strip.addEventListener("click", (e) => e.stopPropagation());

  for (const { hex, label } of ACCOUNT_COLORS) {
    const swatch = document.createElement("button");
    swatch.className = "color-swatch" + (profile.color === hex ? " color-swatch-active" : "");
    swatch.title = label;
    swatch.style.background = hex;
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      handleSetColor(profile, hex);
    });
    strip.appendChild(swatch);
  }

  // "Clear" swatch
  const clearSwatch = document.createElement("button");
  clearSwatch.className = "color-swatch color-swatch-clear" + (!profile.color ? " color-swatch-active" : "");
  clearSwatch.title = "No color";
  clearSwatch.textContent = "×";
  clearSwatch.addEventListener("click", (e) => {
    e.stopPropagation();
    handleSetColor(profile, null);
  });
  strip.appendChild(clearSwatch);

  return strip;
}

// Fleet Capacity Overview — renders an aggregate bar across all saved profiles
// showing how many accounts are ready / cooling down / exhausted.
// Visible only when ≥ 2 accounts have session usage data.
function renderFleetOverview(profiles) {
  if (!fleetOverviewEl) return;

  const all = Object.values(profiles);
  const withSession = all.filter(
    (p) => typeof p.usage?.limits?.session?.percentage === "number"
  );

  // Need at least 2 accounts with data to make the fleet bar useful
  if (withSession.length < 2) {
    fleetOverviewEl.classList.add("hidden");
    fleetOverviewEl.textContent = "";
    return;
  }

  const now = Date.now();
  let ready = 0, cooling = 0, exhausted = 0;
  let soonestReset = Infinity;
  let totalFree = 0;

  for (const p of withSession) {
    const session = p.usage.limits.session;
    const pct = session.percentage;
    totalFree += Math.max(0, 100 - pct);

    if (pct >= 100 || (session.resetsAt && session.resetsAt > now)) {
      exhausted++;
      if (session.resetsAt && session.resetsAt > now) {
        soonestReset = Math.min(soonestReset, session.resetsAt);
      }
    } else if (pct >= 80) {
      cooling++;
    } else {
      ready++;
    }
  }

  const avgFree = Math.round(totalFree / withSession.length);

  fleetOverviewEl.textContent = "";
  fleetOverviewEl.classList.remove("hidden");

  const parts = [];

  if (ready > 0) {
    const el = document.createElement("span");
    el.className = "fleet-stat fleet-stat-ready";
    el.textContent = `${ready} ready`;
    parts.push(el);
  }
  if (cooling > 0) {
    const el = document.createElement("span");
    el.className = "fleet-stat fleet-stat-cooling";
    el.textContent = `${cooling} limited`;
    parts.push(el);
  }
  if (exhausted > 0) {
    const el = document.createElement("span");
    el.className = "fleet-stat fleet-stat-exhausted";
    const resetNote = soonestReset < Infinity
      ? ` · resets ${formatResetsIn(soonestReset, "session")}`
      : "";
    el.textContent = `${exhausted} exhausted${resetNote}`;
    parts.push(el);
  }

  const avgEl = document.createElement("span");
  avgEl.className = "fleet-stat fleet-stat-avg";
  avgEl.textContent = `${avgFree}% avg free`;
  parts.push(avgEl);

  const label = document.createElement("span");
  label.className = "fleet-label";
  label.textContent = "Fleet";
  fleetOverviewEl.appendChild(label);

  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "fleet-sep";
      sep.textContent = " · ";
      fleetOverviewEl.appendChild(sep);
    }
    fleetOverviewEl.appendChild(parts[i]);
  }
}

function renderProfiles(profiles, activeId, query = "") {
  listEl.textContent = "";
  const entries = sortedEntries(profiles);
  // The quick-switch-1 target is picked by usage data (least 5-hour
  // credit used), not by list position, so compute it once up front —
  // stays stable while searching, same as background.js's own lookup.
  const quickSwitchTargetId = findQuickSwitchTargetId(profiles);

  // Render the fleet capacity overview bar
  renderFleetOverview(profiles);

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

  const totalAccounts = entries.length;
  const showSeparation = totalAccounts >= 2;
  if (searchSectionEl) {
    searchSectionEl.classList.toggle("panel-last", !showSeparation);
  }
  if (savedAccountsSectionEl) {
    savedAccountsSectionEl.classList.toggle("hidden", totalAccounts === 1 && saved.length === 0 && !q);
  }

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

async function handleSetColor(profile, color) {
  const res = await sendMessage({
    type: "SET_PROFILE_COLOR",
    profileId: profile.id,
    color: color || null,
  });
  if (!res?.ok) {
    showStatus(res?.error || "Could not set color.", "error");
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
  const stored = await chrome.storage.local.get("geminiApiKey");
  const hasKey = !!(stored.geminiApiKey || "").trim();
  geminiKeyStatus.className = "gemini-key-chip";
  if (hasKey) {
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

    port.onMessage.addListener((msg) => {
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
          `Exported "${res.title}" (${res.messageCount} turns) — saved to Downloads/${res.filename}.${attachmentNote}`,
          "success"
        );
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
  const stored = await chrome.storage.local.get("geminiApiKey");
  const key = (stored.geminiApiKey || "").trim();
  geminiApiKeyInput.value = key ? "••••••••••••••••" : "";
  if (geminiKeySettingsStatus) {
    if (key) {
      geminiKeySettingsStatus.textContent = "✅ API key is set.";
    } else {
      geminiKeySettingsStatus.textContent = "No API key saved yet.";
    }
  }
}

if (saveGeminiKeyBtn) {
  saveGeminiKeyBtn.addEventListener("click", async () => {
    if (!geminiApiKeyInput) return;
    const raw = geminiApiKeyInput.value.trim();
    if (!raw || raw === "••••••••••••••••") {
      showStatus("Paste a new API key first.", "error");
      return;
    }
    await chrome.storage.local.set({ geminiApiKey: raw });
    await loadGeminiKeySettings();
    await refreshGeminiKeyStatus();
    showStatus("Gemini API key saved.", "success");
  });
}

if (clearGeminiKeyBtn) {
  clearGeminiKeyBtn.addEventListener("click", async () => {
    await chrome.storage.local.remove("geminiApiKey");
    if (geminiApiKeyInput) geminiApiKeyInput.value = "";
    await loadGeminiKeySettings();
    await refreshGeminiKeyStatus();
    showStatus("Gemini API key cleared.", "success");
  });
}

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

