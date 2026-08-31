import { exportClaudeConversationInPage } from "./export-page-script.js";
import { SimpleZip } from "./zip-builder.js";

// ---------- Free Plan SSE Usage Cache & Monotonic Fallback ----------
const SSE_USAGE_KEY = "hotswap_sse_usage";
const SSE_USAGE_TTL_MS = 8 * 24 * 60 * 60 * 1000; // 8 days (weekly window TTL)
const SSE_SAME_WINDOW_TOLERANCE_MS = 15 * 1000; // 15 seconds

async function getStoredSseUsageMap() {
  const data = await chrome.storage.local.get([SSE_USAGE_KEY]);
  return data[SSE_USAGE_KEY] || {};
}

function mergeSseWindow(previous, incoming) {
  if (!incoming) return previous || null;
  if (!previous) return incoming;

  // If in the same window (same reset time within tolerance), protect against downward rounding jitter
  const sameWindow =
    Math.abs((previous.resetsAt || 0) - (incoming.resetsAt || 0)) < SSE_SAME_WINDOW_TOLERANCE_MS;
  if (sameWindow && incoming.percentage < previous.percentage) {
    return previous;
  }
  return incoming;
}

export async function storeSseUsage(orgId, incomingLimits) {
  if (!orgId || !incomingLimits) return;

  const sseMap = await getStoredSseUsageMap();
  const prev = sseMap[orgId] || {};

  const merged = {
    session: mergeSseWindow(prev.session, incomingLimits.session),
    weekly: mergeSseWindow(prev.weekly, incomingLimits.weekly),
    capturedAt: Date.now(),
  };

  sseMap[orgId] = merged;
  await chrome.storage.local.set({ [SSE_USAGE_KEY]: sseMap });

  // If this org belongs to a saved profile or active session, update its usage immediately
  const profiles = await getProfiles();
  let updated = false;
  for (const [id, prof] of Object.entries(profiles)) {
    // Check if profile cookies match this orgId or if active
    const orgCookie = prof.cookies?.find((c) => c.name === "lastActiveOrg")?.value;
    if (orgCookie === orgId || id === (await getActiveProfileId())) {
      if (prof.usage?.subscriptionTier === "claude_free" || !prof.usage?.subscriptionTier) {
        prof.usage = {
          limits: {
            session: merged.session,
            weekly: merged.weekly,
            sonnetWeekly: null,
            opusWeekly: null,
            fableWeekly: null,
          },
          subscriptionTier: prof.usage?.subscriptionTier || "claude_free",
          capturedAt: Date.now(),
        };
        updated = true;
      }
    }
  }
  if (updated) {
    await saveProfiles(profiles);
    await updateBadge();
  }
}
// background.js — MV3 service worker
// Handles all cookie capture / restore logic for claude.ai account switching,
// plus chat export so a conversation can be resumed on another account.
// Popup and background communicate via chrome.runtime.sendMessage.

const DOMAINS = ["claude.ai", ".claude.ai"]; // apex + wildcard subdomain cookies
const STORAGE_KEY = "profiles";       // chrome.storage.local: { [profileId]: Profile }
const ACTIVE_KEY = "activeProfileId"; // chrome.storage.local: string | null

/**
 * A Profile looks like:
 * {
 *   id: string,
 *   label: string,
 *   cookies: chrome.cookies.Cookie[],  // raw snapshot
 *   createdAt: number,
 *   updatedAt: number
 * }
 */

// ---------- Cookie helpers ----------

// Pull every cookie Chrome currently holds for claude.ai (all subdomains).
// We deliberately don't hardcode cookie names (e.g. "sessionKey") since
// Claude's auth cookie names/scopes can change without notice. Grabbing
// everything under the domain is the robust approach.
async function getAllClaudeCookies() {
  const results = [];
  for (const domain of DOMAINS) {
    const cookies = await chrome.cookies.getAll({ domain });
    results.push(...cookies);
  }
  // De-dupe by name+domain+path (apex and wildcard queries can overlap)
  const seen = new Set();
  const deduped = [];
  for (const c of results) {
    const key = `${c.name}|${c.domain}|${c.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(c);
    }
  }
  return deduped;
}

// Remove all claude.ai cookies from the browser (used before restoring a
// different profile, so stale cookies from the previous account don't linger).
async function clearAllClaudeCookies() {
  const cookies = await getAllClaudeCookies();
  await Promise.all(
    cookies.map((c) => {
      const protocol = c.secure ? "https:" : "http:";
      // chrome.cookies.remove needs a URL that matches the cookie's scope.
      const url = `${protocol}//${c.domain.replace(/^\./, "")}${c.path}`;
      return chrome.cookies.remove({ url, name: c.name }).catch(() => {
        // Some cookies (e.g. host-only with unusual paths) can fail to
        // resolve a matching URL. Non-fatal — log and move on.
        console.warn("Could not remove cookie", c.name, c.domain);
      });
    })
  );
}

// Write a saved cookie snapshot back into the browser.
// Returns { succeeded, failed } counts so callers can detect a partial or
// total restore failure instead of assuming success.
async function setCookies(cookies) {
  let succeeded = 0;
  const failed = [];
  for (const c of cookies) {
    const protocol = c.secure ? "https:" : "http:";
    const domain = c.domain.replace(/^\./, "");
    const url = `${protocol}//${domain}${c.path}`;

    const details = {
      url,
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite || "unspecified",
      // Only set expirationDate for persistent cookies; session cookies
      // (c.session === true) must omit it or Chrome rejects the call.
      ...(c.session ? {} : { expirationDate: c.expirationDate }),
      // Host-only cookies must NOT set "domain"; others need the leading dot
      // preserved so Chrome scopes them to the right subdomain set.
      ...(c.hostOnly ? {} : { domain: c.domain }),
    };

    try {
      const result = await chrome.cookies.set(details);
      if (result) {
        succeeded++;
      } else {
        // chrome.cookies.set resolves to null (no throw) on rejection by
        // the cookie store, e.g. invalid domain/secure combos.
        failed.push(c.name);
        console.warn("Cookie store rejected", c.name, details);
      }
    } catch (err) {
      failed.push(c.name);
      console.warn("Failed to set cookie", c.name, err);
    }
  }
  return { succeeded, failed };
}

// ---------- Storage helpers ----------

async function getProfiles() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

async function saveProfiles(profiles) {
  await chrome.storage.local.set({ [STORAGE_KEY]: profiles });
}

async function getActiveProfileId() {
  const data = await chrome.storage.local.get(ACTIVE_KEY);
  return data[ACTIVE_KEY] || null;
}

async function setActiveProfileId(id) {
  await chrome.storage.local.set({ [ACTIVE_KEY]: id });
}

// ---------- Email capture ----------
//
// claude.ai doesn't expose the account email anywhere in the static page —
// it only renders it inside the user menu dropdown once opened
// (span[data-testid="user-menu-header"], confirmed from a real page dump).
// There's no other place on the page (no embedded JSON, no other DOM node)
// that carries it, so the only reliable way to read it is to open that
// menu, read the text, and close it again. This runs in the page context
// via chrome.scripting.executeScript and briefly flashes the menu open —
// there's no way around that without the menu having rendered already.
function readAccountEmailInPage() {
  return new Promise((resolve) => {
    const HEADER_SELECTOR = '[data-testid="user-menu-header"]';
    const BUTTON_SELECTOR = '[data-testid="user-menu-button"]';

    const existing = document.querySelector(HEADER_SELECTOR);
    if (existing) {
      resolve(existing.textContent.trim() || null);
      return;
    }

    const button = document.querySelector(BUTTON_SELECTOR);
    if (!button) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      // Close the menu again so we don't leave the UI in a different state
      // than we found it. Escape is what claude.ai's own menu listens for.
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      resolve(value);
    };

    button.click();

    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      const header = document.querySelector(HEADER_SELECTOR);
      if (header) {
        clearInterval(poll);
        finish(header.textContent.trim() || null);
      } else if (attempts > 20) {
        // ~1s of polling — menu never opened (layout changed, or blocked)
        clearInterval(poll);
        finish(null);
      }
    }, 50);
  });
}

// Best-effort: finds an active claude.ai tab and reads its account email.
// Never throws — callers treat a null/failed result as "couldn't tell",
// not as an error, since this is a nice-to-have, not core functionality.
async function captureEmailFromActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
    const tab = tabs.find((t) => t.active) || tabs[0];
    if (!tab) return null;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readAccountEmailInPage,
    });
    return results?.[0]?.result || null;
  } catch (err) {
    console.warn("Could not read account email from page", err);
    return null;
  }
}

// ---------- Usage (read directly from claude.ai's own API) ----------
//
// claude.ai's page itself has no visible usage UI, but it does have the
// data: the web app calls these same endpoints to decide when to show its
// own "approaching limit" banners. This calls them directly rather than
// depending on a separate extension (Claude Usage Tracker) to compute and
// render numbers we then scrape back out of the DOM — that only ever
// worked for whichever account happened to be active in the browser right
// now, and broke the moment that extension wasn't installed.
//
// The tradeoff: reading usage for a profile that ISN'T currently active
// means briefly swapping the browser's claude.ai cookies to that
// profile's session, making the request, then swapping back — see
// getUsageForProfile(). That's invisible to the user (no tab reload,
// under a second) but if a claude.ai tab is actively making its own
// requests during that window, it could briefly see the wrong account.
// Accepted tradeoff for being able to check usage without switching.

const CLAUDE_API_BASE = "https://claude.ai/api";

async function claudeApiGet(path) {
  const response = await fetch(`${CLAUDE_API_BASE}${path}`, {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(`claude.ai API request failed (${response.status}) for ${path}`);
  }
  return response.json();
}

// Mirrors Claude Usage Tracker's tier-detection heuristic (its own comment:
// "Tiers are... really weird now") — org capability flags don't map onto
// tiers 1:1, so this combines a few indicators the same way it does.
function computeSubscriptionTier(org) {
  if (!org) return "claude_free";
  const capabilities = org.capabilities || [];
  const hasMax = capabilities.includes("claude_max");
  const hasPro = capabilities.includes("claude_pro");
  const isTeam = !!org.raven_type;
  const rateLimitTier = org.rate_limit_tier || "default_claude_ai";

  if (isTeam) return "claude_team";
  if (hasMax) return rateLimitTier.includes("5x") ? "claude_max_5x" : "claude_max_20x";
  if (hasPro) return "claude_pro";
  return "claude_free";
}

// Same limit keys/shape as Claude Usage Tracker's UsageData, kept minimal
// (percentage + reset time only — no token-cost estimation, since that
// needs per-message tokenization this extension has no reason to do).
function parseUsageLimits(apiResponse) {
  const toResetsAt = (iso) => (iso ? new Date(iso).getTime() : null);
  const parseOldLimit = (obj) =>
    obj ? { percentage: obj.utilization, resetsAt: toResetsAt(obj.resets_at) } : null;

  if (Array.isArray(apiResponse?.limits) && apiResponse.limits.length > 0) {
    const scopedKeyByModel = { fable: "fableWeekly", sonnet: "sonnetWeekly", opus: "opusWeekly" };
    const limits = { session: null, weekly: null, sonnetWeekly: null, opusWeekly: null, fableWeekly: null };
    for (const entry of apiResponse.limits) {
      const value = { percentage: entry.percent, resetsAt: toResetsAt(entry.resets_at) };
      if (entry.kind === "session") limits.session = value;
      else if (entry.kind === "weekly_all") limits.weekly = value;
      else if (entry.kind === "weekly_scoped") {
        const model = entry.scope?.model?.display_name?.toLowerCase();
        const key = model ? scopedKeyByModel[model] : null;
        if (key) limits[key] = value;
      }
    }
    return limits;
  }

  return {
    session: parseOldLimit(apiResponse?.five_hour),
    weekly: parseOldLimit(apiResponse?.seven_day),
    sonnetWeekly: parseOldLimit(apiResponse?.seven_day_sonnet),
    opusWeekly: parseOldLimit(apiResponse?.seven_day_opus),
    fableWeekly: null,
  };
}

// Fetches usage limits + a subscription-tier label for whichever account's
// cookies are CURRENTLY live in the browser. Doesn't touch cookies itself —
// callers (getUsageForProfile) are responsible for having the right
// session in place first.
async function fetchUsageForActiveSession() {
  let orgId = (await getAllClaudeCookies()).find((c) => c.name === "lastActiveOrg")?.value || null;
  if (!orgId) {
    const orgs = await claudeApiGet("/organizations");
    orgId = Array.isArray(orgs) ? orgs[0]?.uuid : null;
  }
  if (!orgId) {
    throw new Error("Could not determine this account's organization.");
  }

  const usageResponse = await claudeApiGet(`/organizations/${orgId}/usage`);
  const limits = parseUsageLimits(usageResponse);

  let subscriptionTier = "claude_free";
  try {
    const bootstrap = await claudeApiGet(`/bootstrap/${orgId}/app_start?statsig_hashing_algorithm=djb2`);
    const org = bootstrap?.account?.memberships?.find((m) => m.organization?.uuid === orgId)?.organization;
    subscriptionTier = computeSubscriptionTier(org);
  } catch (err) {
    console.warn("Could not determine subscription tier", err);
  }

  // Free Plan Fallback: When /usage answers with nulls/empty on claude_free
  if (subscriptionTier === "claude_free" && !limits.session && !limits.weekly) {
    const sseMap = await getStoredSseUsageMap();
    const sseData = sseMap[orgId];
    if (sseData) {
      if (sseData.session?.resetsAt && sseData.session.resetsAt > Date.now()) {
        limits.session = sseData.session;
      }
      if (sseData.weekly?.resetsAt && sseData.weekly.resetsAt > Date.now()) {
        limits.weekly = sseData.weekly;
      }
    }
  }

  return { limits, subscriptionTier, orgId };
}

// Fetches usage for ANY saved profile, not just the active one. If it's not
// the account currently live in the browser, this swaps cookies to it,
// makes the request, then swaps back to whatever was live before —
// without reloading any tab, so it's not visibly a "switch."
async function getUsageForProfile(profileId) {
  const profiles = await getProfiles();
  const target = profiles[profileId];
  if (!target) throw new Error("Profile not found.");
  if (!target.cookies || target.cookies.length === 0) {
    throw new Error(`"${target.label}" has no saved session to check usage for.`);
  }

  const activeId = await getActiveProfileId();
  const isActive = activeId === profileId;
  let liveCookiesToRestore = null;

  if (!isActive) {
    liveCookiesToRestore = await getAllClaudeCookies();
    await clearAllClaudeCookies();
    await setCookies(target.cookies);
  }

  try {
    const { limits, subscriptionTier } = await fetchUsageForActiveSession();
    const usage = { limits, subscriptionTier, capturedAt: Date.now() };
    const freshProfiles = await getProfiles();
    if (freshProfiles[profileId]) {
      freshProfiles[profileId].usage = usage;
      await saveProfiles(freshProfiles);
    }
    return usage;
  } finally {
    if (!isActive) {
      await clearAllClaudeCookies();
      if (liveCookiesToRestore && liveCookiesToRestore.length > 0) {
        await setCookies(liveCookiesToRestore);
      }
    }
  }
}

// ---------- Session health (heuristic, no network calls) ----------
//
// We can't know for certain whether a saved profile's session is still
// valid without actually restoring it (which would log the user into
// that account). Instead we look at the cookie snapshot's own metadata:
// persistent cookies carry an expirationDate we already stored, so we can
// flag ones that have expired or are expiring soon without touching the
// network. This is necessarily a heuristic — claude.ai can revoke a
// session (e.g. via password change) before the cookie's own expiry, and
// that isn't detectable this way.
const HEALTH_SOON_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

function computeProfileHealth(profile) {
  const cookies = profile.cookies || [];
  if (cookies.length === 0) {
    return { status: "expired", detail: "No cookies were saved for this account." };
  }

  const persistent = cookies.filter((c) => !c.session && typeof c.expirationDate === "number");
  if (persistent.length === 0) {
    // All session-only cookies — can't read an expiry, so we don't know.
    return { status: "unknown", detail: "Session-only cookies — expiry can't be checked without switching to it." };
  }

  const now = Date.now() / 1000; // chrome cookie dates are in seconds
  const earliestExpiry = Math.min(...persistent.map((c) => c.expirationDate));
  if (earliestExpiry < now) {
    return { status: "expired", detail: "At least one saved cookie has already expired." };
  }
  if (earliestExpiry - now < HEALTH_SOON_MS / 1000) {
    return {
      status: "expiring-soon",
      detail: `A saved cookie expires ${new Date(earliestExpiry * 1000).toLocaleDateString()}.`,
    };
  }
  return { status: "valid", detail: "Saved cookies look current." };
}

// ---------- Core actions ----------

// Snapshot whatever session is currently live in the browser and save it
// as a new named profile.
async function addCurrentAccount(label) {
  const cookies = await getAllClaudeCookies();
  if (cookies.length === 0) {
    throw new Error("No claude.ai session found. Log in to claude.ai first.");
  }
  const email = await captureEmailFromActiveTab();
  const id = crypto.randomUUID();
  const profiles = await getProfiles();
  profiles[id] = {
    id,
    label: label?.trim() || "Untitled account",
    email: email || null,
    usage: null,
    color: null,
    cookies,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveProfiles(profiles);
  await setActiveProfileId(id);
  // Best-effort — this account is now the active one, so no cookie swap is
  // needed, but don't let a usage-fetch hiccup block adding the account.
  try {
    await getUsageForProfile(id);
  } catch (err) {
    console.warn("Could not fetch usage for newly added account", err);
  }
  return (await getProfiles())[id];
}

// Before switching away, refresh the currently active profile's cookie
// snapshot so any session-token rotation isn't lost.
async function syncActiveProfile() {
  const activeId = await getActiveProfileId();
  if (!activeId) return;
  const profiles = await getProfiles();
  if (!profiles[activeId]) return;
  const cookies = await getAllClaudeCookies();
  if (cookies.length > 0) {
    profiles[activeId].cookies = cookies;
    profiles[activeId].updatedAt = Date.now();
    const email = await captureEmailFromActiveTab();
    if (email) profiles[activeId].email = email;
    await saveProfiles(profiles);
    try {
      await getUsageForProfile(activeId);
    } catch (err) {
      console.warn("Could not refresh usage while syncing active profile", err);
    }
  }
}

// IMPORTANT: this locally clears cookies from the browser only. It never
// calls claude.ai's logout endpoint, so it does NOT revoke any session
// token server-side. This is the safe way to make room for logging into a
// second account without invalidating the first one.
//
// Using claude.ai's own "Log out" button instead of this will revoke that
// session's token on the server — after that, restoring the old cookie
// value can't bring the session back, because the token itself is dead,
// not just missing locally. That's the #1 cause of "switching logs me out."
async function prepareForNewAccount() {
  // Save whatever is currently live so it isn't lost.
  await syncActiveProfile();
  await clearAllClaudeCookies();
  await setActiveProfileId(null);

  // Send the user to a clean login page for the new account. Navigating
  // (not just reloading) is important — a reload can hang onto the old
  // account's cached page until the user manually refreshes.
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url: "https://claude.ai/login" });
  } else {
    await chrome.tabs.create({ url: "https://claude.ai/login" });
  }
}

// Switch to a given saved profile: sync out the old session, clear cookies,
// write in the new session's cookies, then reload the active claude.ai tab.
async function switchToProfile(profileId) {
  const profiles = await getProfiles();
  const target = profiles[profileId];
  if (!target) throw new Error("Profile not found.");

  if (!target.cookies || target.cookies.length === 0) {
    throw new Error(
      `"${target.label}" has no saved cookies to restore. Log into that account manually, then re-save it.`
    );
  }

  await syncActiveProfile();
  await clearAllClaudeCookies();
  const { succeeded, failed } = await setCookies(target.cookies);
  await setActiveProfileId(profileId);

  // Reload (or open) a claude.ai tab so the new session takes effect.
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  if (tabs.length > 0) {
    for (const tab of tabs) {
      await chrome.tabs.reload(tab.id);
    }
  } else {
    await chrome.tabs.create({ url: "https://claude.ai/" });
  }

  let warning = null;
  if (succeeded === 0) {
    warning =
      "None of this profile's cookies could be restored. The session is likely expired or was revoked (e.g. by logging out via claude.ai's own button). Log in again under this account and re-save it.";
  } else if (failed.length > 0) {
    warning = `${failed.length} of ${target.cookies.length} cookies failed to restore (${failed.join(
      ", "
    )}). The session may still be logged out — if so, re-save this account after logging in again.`;
  }

  return { profile: target, warning };
}

async function removeProfile(profileId) {
  const profiles = await getProfiles();
  delete profiles[profileId];
  await saveProfiles(profiles);
  const activeId = await getActiveProfileId();
  if (activeId === profileId) {
    await setActiveProfileId(null);
  }
}

async function renameProfile(profileId, newLabel) {
  const profiles = await getProfiles();
  if (!profiles[profileId]) throw new Error("Profile not found.");
  profiles[profileId].label = newLabel.trim() || profiles[profileId].label;
  profiles[profileId].updatedAt = Date.now();
  await saveProfiles(profiles);
}

// Custom color tag — purely cosmetic, doesn't touch updatedAt so it
// doesn't reshuffle the list's sort order just from re-coloring a badge.
async function setProfileColor(profileId, color) {
  const profiles = await getProfiles();
  if (!profiles[profileId]) throw new Error("Profile not found.");
  profiles[profileId].color = color || null;
  await saveProfiles(profiles);
}

// Same sort the popup uses (most-recently-active first), so
// cycle-next-account/cycle-prev-account step through accounts in the same
// order they're listed in the popup.
async function getSortedProfileIds() {
  const profiles = await getProfiles();
  return Object.values(profiles)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => p.id);
}

// quick-switch-1's target: whichever saved account has the most 5-hour
// ("session") credit left, i.e. the lowest session-limit percentage —
// not the weekly limit, since that's the one that actually blocks you
// mid-session. Falls back to the most-recently-active account if no
// profile has cached usage data yet (e.g. right after install).
async function getLeastUsedProfileId() {
  const profiles = await getProfiles();
  const withSessionUsage = Object.values(profiles).filter(
    (p) => typeof p.usage?.limits?.session?.percentage === "number"
  );

  if (withSessionUsage.length === 0) {
    const ordered = await getSortedProfileIds();
    return ordered[0] || null;
  }

  withSessionUsage.sort(
    (a, b) => a.usage.limits.session.percentage - b.usage.limits.session.percentage
  );
  return withSessionUsage[0].id;
}

// A very rough "is this session likely still valid" check — a real session
// should have a non-trivial number of cookies. This is a heuristic only;
// the popup treats profiles with 0 cookies restored as "expired".
async function checkActiveSessionHealth() {
  const cookies = await getAllClaudeCookies();
  return cookies.length > 0;
}

// ---------- Backup / restore ----------
//
// chrome.storage.local already survives normal "reload" updates of an
// unpacked extension. It only appears to "reset" when either (a) the
// extension is removed and re-loaded rather than reloaded in place, or
// (b) the unpacked folder's path changes between updates — Chrome derives
// an unpacked extension's ID from its folder path, so a new path means a
// new extension with empty storage, even though the code is the same.
//
// This backup/restore pair is a safety net for both cases (and for moving
// to a different machine entirely), independent of doing the update the
// "right" way.

// The exported file contains raw session cookies — functionally as
// sensitive as a password. It's written to the user's own Downloads
// folder only; nothing is sent anywhere.
async function exportProfilesBackup() {
  const profiles = await getProfiles();
  const list = Object.values(profiles);
  if (list.length === 0) {
    throw new Error("No saved accounts to back up yet.");
  }

  const backup = {
    kind: "hotswap-for-claude-backup",
    exportedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    warning:
      "This file contains raw session cookies for your saved accounts — treat it like a password. Delete it once you've restored from it.",
    profiles: list,
  };

  const json = JSON.stringify(backup, null, 2);
  const filename = `hotswap-for-claude-backup-${Date.now()}.json`;
  const dataUrl = "data:application/json;charset=utf-8," + encodeURIComponent(json);
  const downloadId = await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
  const settled = await waitForDownloadSettled(downloadId);
  if (!settled.ok) {
    throw new Error(`The backup file didn't finish saving (${settled.error}).`);
  }

  return { count: list.length, filename };
}

// Adds profiles from a backup file into current storage rather than
// replacing it outright, so restoring doesn't clobber accounts added since
// the backup was taken. Imported profiles get fresh IDs so they can't
// collide with (or silently overwrite) anything already saved.
async function importProfilesBackup(backupData) {
  if (!backupData || !Array.isArray(backupData.profiles)) {
    throw new Error("This doesn't look like a valid HotSwap for Claude backup file.");
  }

  const profiles = await getProfiles();
  let imported = 0;
  let skipped = 0;

  for (const p of backupData.profiles) {
    if (!p || !Array.isArray(p.cookies) || p.cookies.length === 0) {
      skipped++;
      continue;
    }
    const id = crypto.randomUUID();
    profiles[id] = {
      id,
      label: p.label ? String(p.label).slice(0, 40) : "Restored account",
      cookies: p.cookies,
      createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
      updatedAt: Date.now(),
    };
    imported++;
  }

  await saveProfiles(profiles);
  return { imported, skipped };
}

// ---------- Auto-refresh (keep sessions alive) ----------
//
// Claude.ai session cookies expire after some weeks. If a saved profile
// isn't switched to before its cookies expire, the snapshot goes stale
// and restoring it fails. This system periodically "exercises" each
// saved session by briefly swapping its cookies in, making a lightweight
// API call (which causes the server to process — and potentially rotate
// or extend — the session tokens via Set-Cookie headers), then
// re-snapshotting the now-fresh cookies back into storage.
//
// Uses chrome.alarms so the schedule persists even when the MV3 service
// worker is killed and restarted. The cookie-swap pattern is identical
// to getUsageForProfile() — invisible, under a second, no tab reload.

const AUTO_REFRESH_ALARM = "auto-refresh-sessions";
const AUTO_REFRESH_ENABLED_KEY = "autoRefreshEnabled";
const AUTO_REFRESH_INTERVAL_KEY = "autoRefreshIntervalHours";
const LAST_AUTO_REFRESH_KEY = "lastAutoRefreshAt";
const DEFAULT_REFRESH_INTERVAL_HOURS = 12;

// Exercises one profile's session: swaps cookies in (if not already
// active), hits a lightweight endpoint so the server refreshes/extends
// the session tokens, re-snapshots the now-current cookies, and
// optionally refreshes usage data while the session is live.
async function refreshProfileSession(profileId) {
  const profiles = await getProfiles();
  const target = profiles[profileId];
  if (!target) throw new Error("Profile not found.");
  if (!target.cookies || target.cookies.length === 0) {
    throw new Error(`"${target.label}" has no saved cookies to refresh.`);
  }

  const activeId = await getActiveProfileId();
  const isActive = activeId === profileId;
  let liveCookiesToRestore = null;

  if (!isActive) {
    liveCookiesToRestore = await getAllClaudeCookies();
    await clearAllClaudeCookies();
    await setCookies(target.cookies);
  }

  try {
    // Hit a lightweight endpoint to exercise the session. The server
    // processes our session cookies and may respond with Set-Cookie
    // headers that rotate or extend them — Chrome applies those
    // automatically, so the cookie jar now holds refreshed values.
    await claudeApiGet("/organizations");

    // Re-snapshot whatever cookies are now in the jar — these are the
    // refreshed versions with (hopefully) extended expiry.
    const freshCookies = await getAllClaudeCookies();
    if (freshCookies.length > 0) {
      const freshProfiles = await getProfiles();
      if (freshProfiles[profileId]) {
        freshProfiles[profileId].cookies = freshCookies;
        freshProfiles[profileId].lastRefreshedAt = Date.now();
        freshProfiles[profileId].updatedAt = Date.now();
        await saveProfiles(freshProfiles);
      }
    }

    // While we have this session live, also refresh usage data — avoids
    // needing a separate swap cycle just for usage.
    try {
      const { limits, subscriptionTier } = await fetchUsageForActiveSession();
      const freshProfiles = await getProfiles();
      if (freshProfiles[profileId]) {
        freshProfiles[profileId].usage = {
          limits,
          subscriptionTier,
          capturedAt: Date.now(),
        };
        await saveProfiles(freshProfiles);
      }
    } catch (usageErr) {
      // Usage is secondary — don't fail the whole refresh for it.
      console.warn("Could not refresh usage during session refresh for", target.label, usageErr);
    }
  } finally {
    if (!isActive) {
      await clearAllClaudeCookies();
      if (liveCookiesToRestore && liveCookiesToRestore.length > 0) {
        await setCookies(liveCookiesToRestore);
      }
    }
  }
}

async function refreshAllProfileSessions() {
  const profiles = await getProfiles();
  const profileIds = Object.keys(profiles);
  if (profileIds.length === 0) return { refreshed: 0, failed: 0, errors: [] };

  let refreshed = 0;
  const errors = [];

  // Sequential — cookie jar is shared, concurrent swaps would clobber
  // each other (same constraint as REFRESH_ALL_USAGE).
  for (const id of profileIds) {
    try {
      await refreshProfileSession(id);
      refreshed++;
    } catch (err) {
      errors.push(`${profiles[id]?.label || id}: ${err.message || err}`);
    }
  }

  await chrome.storage.local.set({ [LAST_AUTO_REFRESH_KEY]: Date.now() });

  if (errors.length > 0) {
    console.warn("Auto-refresh session errors:", errors);
  }

  return { refreshed, failed: errors.length, errors };
}

async function getAutoRefreshSettings() {
  const data = await chrome.storage.local.get([
    AUTO_REFRESH_ENABLED_KEY,
    AUTO_REFRESH_INTERVAL_KEY,
    LAST_AUTO_REFRESH_KEY,
  ]);
  return {
    enabled: data[AUTO_REFRESH_ENABLED_KEY] !== false, // default: enabled
    intervalHours: data[AUTO_REFRESH_INTERVAL_KEY] || DEFAULT_REFRESH_INTERVAL_HOURS,
    lastRefreshedAt: data[LAST_AUTO_REFRESH_KEY] || null,
  };
}

async function setupAutoRefresh() {
  const { enabled, intervalHours } = await getAutoRefreshSettings();

  await chrome.alarms.clear(AUTO_REFRESH_ALARM);

  if (enabled) {
    chrome.alarms.create(AUTO_REFRESH_ALARM, {
      delayInMinutes: intervalHours * 60,
      periodInMinutes: intervalHours * 60,
    });
    console.log(`[auto-refresh] alarm set: every ${intervalHours}h`);
  } else {
    console.log("[auto-refresh] disabled — alarm cleared.");
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_REFRESH_ALARM) {
    console.log("[auto-refresh] alarm fired — refreshing all sessions…");
    try {
      const result = await refreshAllProfileSessions();
      console.log("[auto-refresh] complete:", result);
    } catch (err) {
      console.warn("[auto-refresh] failed:", err);
    }
  }
});

// Set up the alarm on install/update. Alarms persist across service-worker
// restarts, so this only needs to run on lifecycle events.
chrome.runtime.onInstalled.addListener(() => {
  setupAutoRefresh();
});

// ---------- Chat export ----------

const DEFAULT_EXPORT_PARENT = "HotSwap-Claude-Exports";

function sanitizeFilename(s) {
  return s
    .replace(/[^a-z0-9\-_ ]+/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 45) || "chat";
}

function formatExportFolderName(title, chatId) {
  const cleanTitle = sanitizeFilename(title);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const cleanId = (chatId || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 8) || "chat";
  return `${cleanTitle}_${dateStr}_${cleanId}`;
}

// Attachment filenames come pre-sanitized from the page script (slashes,
// colons etc. already stripped) but may keep their dot — unlike
// sanitizeFilename() above, this one preserves it so extensions survive.
function extensionFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.([a-z0-9]{2,5})$/i);
    return match ? `.${match[1]}` : "";
  } catch {
    return "";
  }
}

function ensureExtension(filename, url, type) {
  if (/\.[a-z0-9]{2,5}$/i.test(filename)) return filename;
  if (type === "text") return filename + ".txt";
  return filename + (extensionFromUrl(url) || (type === "image" ? ".png" : ""));
}

function waitForDownloadSettled(downloadId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      clearTimeout(timer);
      resolve(result);
    };
    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") finish({ ok: true });
      else if (delta.state?.current === "interrupted") {
        finish({ ok: false, error: delta.error?.current || "interrupted" });
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id: downloadId }, (items) => {
      const item = items?.[0];
      if (!item) return;
      if (item.state === "complete") finish({ ok: true });
      else if (item.state === "interrupted") finish({ ok: false, error: item.error || "interrupted" });
    });
    const timer = setTimeout(() => finish({ ok: false, error: "timed_out" }), timeoutMs);
  });
}

async function downloadAttachmentFile(url, relativePath) {
  try {
    const downloadId = await chrome.downloads.download({ url, filename: relativePath, saveAs: false });
    const result = await waitForDownloadSettled(downloadId);
    if (!result.ok) console.warn("Attachment download interrupted", url, result.error);
    return result.ok;
  } catch (err) {
    console.warn("Attachment download failed", url, err);
    return false;
  }
}

function buildMarkdownTranscript(data) {
  const lines = [];

  // 1. AI-Facing Context Header
  lines.push("<!-- SYSTEM CONTEXT FOR CLAUDE:");
  lines.push("This file contains the complete transcript of a prior Claude conversation.");
  lines.push("Instructions:");
  lines.push("1. Absorb all context, decisions, code, thinking processes, and attached files from this transcript.");
  lines.push("2. Continue directly from the final turn without summarizing or re-explaining the past dialogue.");
  lines.push("3. Respond to the user's latest query as a seamless continuation of this session.");
  lines.push("-->");
  lines.push("");

  // 2. Human Quick Guide
  lines.push(`# ${data.title}`);
  lines.push("");
  lines.push("> **To resume this conversation in another account:**");
  lines.push("> 1. Attach this `transcript.md` (and any files from `attachments/`) to your first message.");
  lines.push('> 2. Paste: *"Please read the attached transcript and continue our session from where it left off."*');
  lines.push(">");
  lines.push(`> *Exported from claude.ai on ${new Date(data.exportedAt).toLocaleString()} • Original URL: ${data.url}*`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 3. Message Turns with Claude Thoughts
  for (const m of data.messages) {
    lines.push(m.role === "user" ? "## 🧑 User" : "## 🤖 Claude");
    lines.push("");

    if (m.thought && m.thought.text) {
      if (!m.text || !m.text.trim()) {
        lines.push("*Note: Generation stopped before final response. Preserved thought process below:*");
        lines.push("");
        lines.push("<details open>");
        lines.push(`<summary>💭 <b>Claude Thought Process</b> (${m.thought.duration || "Incomplete Turn"})</summary>`);
        lines.push("");
        lines.push(m.thought.text);
        lines.push("");
        lines.push("</details>");
        lines.push("");
      } else {
        lines.push("<details>");
        lines.push(`<summary>💭 <b>Claude Thought Process</b> (${m.thought.duration || "Internal Reasoning"})</summary>`);
        lines.push("");
        lines.push(m.thought.text);
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
    }

    if (m.text && m.text.trim()) {
      lines.push(m.text.trim());
      lines.push("");
    }

    if (m.attachments && m.attachments.length > 0) {
      lines.push("**Attached:**");
      for (const att of m.attachments) {
        if (att.localPath) {
          lines.push(`- [${att.filename}](${att.localPath})`);
        } else if (att.url) {
          lines.push(`- ${att.filename} — [Original Link](${att.url})`);
        } else {
          lines.push(`- ${att.filename} — *(Referenced in message)*`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function withCapturedDownloads(work) {
  const captured = [];
  const onCreated = (item) => captured.push(item);
  chrome.downloads.onCreated.addListener(onCreated);
  try {
    const result = await work();
    return { result, captured };
  } finally {
    chrome.downloads.onCreated.removeListener(onCreated);
  }
}

function looksLikeSameFile(expectedFilename, downloadItem) {
  const norm = (s) =>
    (s || "")
      .split(/[\\/]/)
      .pop()
      .replace(/\s?\(\d+\)(?=\.[a-z0-9]+$)/i, "")
      .toLowerCase();
  return norm(expectedFilename) === norm(downloadItem.filename);
}

async function resolveNativeDownload(att, capturedDownloads, usedIds, exportFolder, localName) {
  const unclaimed = capturedDownloads.filter((item) => !usedIds.has(item.id));
  let match = unclaimed.find((item) => looksLikeSameFile(att.filename, item));

  if (!match && att.nativeDownloadTriggeredAt != null) {
    const withStart = unclaimed
      .filter((item) => item.startTime)
      .map((item) => ({ item, delta: Math.abs(new Date(item.startTime).getTime() - att.nativeDownloadTriggeredAt) }))
      .filter(({ delta }) => delta <= 10000)
      .sort((a, b) => a.delta - b.delta);
    if (withStart.length > 0) match = withStart[0].item;
  }
  if (!match) return { localPath: null, nativeDownloadPath: null };

  usedIds.add(match.id);
  const settled = await waitForDownloadSettled(match.id);
  if (!settled.ok) return { localPath: null, nativeDownloadPath: null };

  const items = await new Promise((resolve) =>
    chrome.downloads.search({ id: match.id }, resolve)
  );
  const finalItem = items?.[0] || match;
  const bestUrl = finalItem.finalUrl || finalItem.url;

  if (!bestUrl || bestUrl.startsWith("blob:")) {
    return { localPath: null, nativeDownloadPath: finalItem.filename || null };
  }

  const relativePath = `${exportFolder}/attachments/${localName}`;
  const relocated = await downloadAttachmentFile(bestUrl, relativePath);
  if (relocated) {
    try {
      await new Promise((resolve) => chrome.downloads.removeFile(match.id, resolve));
    } catch {}
    chrome.downloads.erase({ id: match.id }, () => {});
    return { localPath: `attachments/${localName}`, nativeDownloadPath: null };
  }

  return { localPath: null, nativeDownloadPath: finalItem.filename || null };
}

// Scrapes the conversation DOM and saves it locally as a single ZIP bundle. Zero tokens spent.
async function exportActiveChat(options = {}) {
  const includeAttachments = options.includeAttachments !== false;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !/^https:\/\/claude\.ai\/chat\//.test(tab.url)) {
    throw new Error(
      "Open a claude.ai conversation tab first (a URL like claude.ai/chat/...), then click Export."
    );
  }

  const { result } = await withCapturedDownloads(() =>
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: exportClaudeConversationInPage,
    })
  );
  const injectionResult = result?.[0]?.result;

  if (!injectionResult || !injectionResult.messages || injectionResult.messages.length === 0) {
    throw new Error(
      "No messages found on this page. Claude's page layout may have changed since this extension was built."
    );
  }

  const parentFolder = DEFAULT_EXPORT_PARENT;
  const chatSubfolder = formatExportFolderName(injectionResult.title, injectionResult.chatId);
  const zipFilename = `${parentFolder}/${chatSubfolder}.zip`;

  // Assign local relative paths for all attachments if enabled
  let attachmentIndex = 0;
  if (includeAttachments) {
    for (const m of injectionResult.messages) {
      for (const att of m.attachments || []) {
        if (!att.url && !att.dataUrl && !att.pastedText) {
          att.localPath = null;
          continue;
        }
        attachmentIndex++;
        const localName = `${String(attachmentIndex).padStart(2, "0")}-${ensureExtension(
          att.filename,
          att.url,
          att.pastedText ? "text" : att.type
        )}`;
        att.localName = localName;
        att.localPath = `attachments/${localName}`;
      }
    }
  } else {
    for (const m of injectionResult.messages) {
      for (const att of m.attachments || []) {
        att.localPath = null;
      }
    }
  }

  // Build the in-memory ZIP bundle
  const zip = new SimpleZip();
  const markdown = buildMarkdownTranscript(injectionResult);
  zip.addFile("transcript.md", markdown);

  // Add attachments (if enabled and deduplicated by entry path)
  let attachmentsSaved = 0;
  let attachmentsFailed = 0;

  if (includeAttachments) {
    const addedZipEntries = new Set();

    for (const m of injectionResult.messages) {
      for (const att of m.attachments || []) {
        if (!att.localName) continue;
        const entryPath = `attachments/${att.localName}`;
        if (addedZipEntries.has(entryPath)) continue;
        addedZipEntries.add(entryPath);

        if (att.dataUrl) {
          try {
            const base64Index = att.dataUrl.indexOf(",");
            if (base64Index !== -1) {
              const base64 = att.dataUrl.slice(base64Index + 1);
              const binaryStr = atob(base64);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              zip.addFile(entryPath, bytes);
              attachmentsSaved++;
            } else {
              att.localPath = null;
              attachmentsFailed++;
            }
          } catch (err) {
            att.localPath = null;
            attachmentsFailed++;
          }
        } else if (att.pastedText) {
          try {
            zip.addFile(entryPath, att.pastedText);
            attachmentsSaved++;
          } catch (err) {
            att.localPath = null;
            attachmentsFailed++;
          }
        } else if (att.url) {
          try {
            const res = await fetch(att.url);
            if (res.ok) {
              const buffer = await res.arrayBuffer();
              zip.addFile(entryPath, buffer);
              attachmentsSaved++;
            } else {
              att.localPath = null;
              attachmentsFailed++;
            }
          } catch (err) {
            att.localPath = null;
            attachmentsFailed++;
          }
        }
      }
    }
  }

  // Trigger one single download for the entire ZIP bundle
  const zipDataUrl = zip.toDataUrl();
  const downloadId = await chrome.downloads.download({
    url: zipDataUrl,
    filename: zipFilename,
    saveAs: false,
  });

  const settled = await waitForDownloadSettled(downloadId);
  if (!settled.ok) {
    throw new Error(`The export zip bundle failed to save (${settled.error}).`);
  }

  return {
    messageCount: injectionResult.messages.length,
    title: injectionResult.title,
    folder: parentFolder,
    filename: zipFilename,
    attachmentsSaved,
    attachmentsFailed,
  };
}

// Scrapes conversation DOM and calls Gemini API to produce an intelligent summary.
// Returns the summary text directly — no file download.
async function summarizeChatWithGemini(options = {}) {
  const includeFileContent = options.includeFileContent !== false;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !/^https:\/\/claude\.ai\/chat\//.test(tab.url)) {
    throw new Error(
      "Open a claude.ai conversation tab first (a URL like claude.ai/chat/...), then click Summarize."
    );
  }

  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: exportClaudeConversationInPage,
    args: [{ skipDownloads: true }],
  });
  const injectionResult = injectionResults?.[0]?.result;

  if (!injectionResult || !injectionResult.messages || injectionResult.messages.length === 0) {
    throw new Error(
      "No messages found on this page. Claude's page layout may have changed since this extension was built."
    );
  }

  const stored = await chrome.storage.local.get("geminiApiKey");
  const apiKey = (stored.geminiApiKey || "").trim();
  if (!apiKey) {
    throw new Error("NO_API_KEY");
  }

  // Build conversation text from DOM-extracted messages
  const messages = injectionResult.messages || [];
  let convText = "";
  for (const m of messages) {
    const role = m.role === "user" ? "User" : "Claude";
    if (m.thought && m.thought.text) {
      convText += `\n[Claude thinking: ${m.thought.text.slice(0, 300)}...]\n`;
    }
    if (m.text) {
      convText += `\n${role}: ${m.text}\n`;
    }
  }

  // Build optional file/code content section (capped at 30,000 chars total)
  let fileSection = "";
  if (includeFileContent) {
    let fileChars = 0;
    const MAX_FILE_CHARS = 30000;
    const fileParts = [];
    for (const m of messages) {
      for (const att of m.attachments || []) {
        if (fileChars >= MAX_FILE_CHARS) break;
        if (att.pastedText) {
          const remaining = MAX_FILE_CHARS - fileChars;
          const excerpt = att.pastedText.slice(0, remaining);
          fileParts.push(`--- File: ${att.filename || "attachment"} ---\n${excerpt}`);
          fileChars += excerpt.length;
        }
      }
      if (fileChars >= MAX_FILE_CHARS) break;
    }
    if (fileParts.length > 0) {
      fileSection = `\n\n--- ATTACHED FILES & CODE ---\n${fileParts.join("\n\n")}`;
    }
  }

  const prompt = `You are an expert AI assistant creating an executive context handoff summary of a Claude.ai conversation.

The primary goal of this summary is to allow a brand new AI assistant (or human collaborator) to immediately understand everything that was discussed, decided, or created, and seamlessly continue working from where the previous session left off without missing any context.

Adapt naturally to whatever topic this conversation is about (coding, research, creative writing, analysis, design, planning, math, business, etc.).

Capture essential concrete details, exact names, choices, user preferences, and dislikes. Do NOT include generic fluff.

Structure your summary using the following markdown sections:

## 🎯 Core Objective & Topic
- Clear summary of what the conversation set out to achieve, the main topic or problem, and overall scope.

## 📌 Context, Tools & Key References
- Specific tools, technologies, concepts, frameworks, sources, formulas, or methodologies chosen and referenced in the dialogue.

## 🚫 User Preferences, Constraints & Exclusions
- Explicit guidelines and requirements from the user.
- Specific things the user **does NOT want**, rejected ideas/approaches, and boundaries.

## 💡 Key Decisions & Discoveries
- Important choices made, conclusions reached, problems solved, and the rationale behind them.

## 📦 What Was Produced / Accomplished
- Concrete deliverables created or modified (code, text, data models, files, outlines, answers, solutions). Name specific items and details.

## ⏭️ Current State & Next Steps (Handoff)
- Exactly where the conversation stopped, what is currently working/done, and what needs to be worked on next so a new session can seamlessly continue.

--- CONVERSATION TRANSCRIPT (${messages.length} turns) ---
${convText}${fileSection}`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2500, temperature: 0.2 },
    }),
  });

  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      errMsg = errBody?.error?.message || errMsg;
    } catch {}
    if (response.status === 400 && errMsg.toLowerCase().includes("api key")) {
      throw new Error("Invalid Gemini API key. Please check the key in Settings.");
    }
    if (response.status === 403) {
      throw new Error("Gemini API access denied. Make sure the Gemini API is enabled for your key at ai.google.dev.");
    }
    if (response.status === 429) {
      throw new Error("Gemini API rate limit reached. Please try again in a moment.");
    }
    throw new Error(`Gemini API error: ${errMsg}`);
  }

  const data = await response.json();
  const summaryText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!summaryText.trim()) {
    throw new Error("Gemini returned an empty response. Please try again.");
  }

  return {
    messageCount: messages.length,
    title: injectionResult.title,
    summaryText,
  };
}



// ---------- Keyboard shortcuts ----------
//
// Bindings live in manifest.json's "commands" block; users can rebind them
// from chrome://extensions/shortcuts (surfaced via the Tools page in the
// popup). cycle-next/prev walk the popup's list order (most-recently-active
// first); quick-switch-1 instead targets whichever account has the most
// 5-hour credit left, recomputed fresh each time it's pressed.
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === "cycle-next-account" || command === "cycle-prev-account") {
      const orderedIds = await getSortedProfileIds();
      if (orderedIds.length === 0) return;
      const activeId = await getActiveProfileId();
      const currentIndex = orderedIds.indexOf(activeId);
      const delta = command === "cycle-next-account" ? 1 : -1;
      const nextIndex =
        currentIndex === -1
          ? 0
          : (currentIndex + delta + orderedIds.length) % orderedIds.length;
      await switchToProfile(orderedIds[nextIndex]);
      return;
    }

    if (command === "quick-switch-1") {
      const targetId = await getLeastUsedProfileId();
      if (targetId) await switchToProfile(targetId);
    }
  } catch (err) {
    // Commands have no UI to report to — log only.
    console.warn("Keyboard shortcut failed", command, err);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "SSE_USAGE_UPDATE": {
          await storeSseUsage(message.orgId, message.sseLimits);
          sendResponse({ ok: true });
          break;
        }
        case "GET_PROFILES": {
          const profiles = await getProfiles();
          const activeId = await getActiveProfileId();
          // Health is computed fresh each time (cheap, no storage write)
          // rather than cached, since "now" keeps moving.
          const withHealth = {};
          for (const [id, p] of Object.entries(profiles)) {
            withHealth[id] = { ...p, health: computeProfileHealth(p) };
          }
          sendResponse({ ok: true, profiles: withHealth, activeId });
          break;
        }
        case "ADD_CURRENT_ACCOUNT": {
          const profile = await addCurrentAccount(message.label);
          sendResponse({ ok: true, profile });
          break;
        }
        case "SWITCH_PROFILE": {
          const { profile, warning } = await switchToProfile(message.profileId);
          sendResponse({ ok: true, profile, warning });
          break;
        }
        case "PREPARE_NEW_ACCOUNT": {
          await prepareForNewAccount();
          sendResponse({ ok: true });
          break;
        }
        case "REMOVE_PROFILE": {
          await removeProfile(message.profileId);
          sendResponse({ ok: true });
          break;
        }
        case "RENAME_PROFILE": {
          await renameProfile(message.profileId, message.label);
          sendResponse({ ok: true });
          break;
        }
        case "SET_PROFILE_COLOR": {
          await setProfileColor(message.profileId, message.color);
          sendResponse({ ok: true });
          break;
        }
        case "REFRESH_USAGE": {
          try {
            const usage = await getUsageForProfile(message.profileId);
            sendResponse({ ok: true, usage });
          } catch (err) {
            sendResponse({ ok: false, error: err.message || String(err) });
          }
          break;
        }
        case "REFRESH_ALL_USAGE": {
          const profiles = await getProfiles();
          let refreshed = 0;
          const errors = [];
          // Sequential on purpose: getUsageForProfile briefly swaps the
          // browser's live cookies for each non-active account, so running
          // these concurrently could interleave and clobber each other.
          for (const id of Object.keys(profiles)) {
            try {
              await getUsageForProfile(id);
              refreshed++;
            } catch (err) {
              errors.push(`${profiles[id]?.label || id}: ${err.message || err}`);
            }
          }
          if (errors.length > 0) console.warn("REFRESH_ALL_USAGE errors", errors);
          sendResponse({ ok: true, refreshed, failed: errors.length, errors });
          break;
        }
        case "OPEN_SHORTCUTS_PAGE": {
          await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
          sendResponse({ ok: true });
          break;
        }
        case "CHECK_SESSION_HEALTH": {
          const healthy = await checkActiveSessionHealth();
          sendResponse({ ok: true, healthy });
          break;
        }
        case "EXPORT_BACKUP": {
          const info = await exportProfilesBackup();
          sendResponse({ ok: true, ...info });
          break;
        }
        case "IMPORT_BACKUP": {
          const info = await importProfilesBackup(message.backupData);
          sendResponse({ ok: true, ...info });
          break;
        }
        case "SUMMARIZE_CHAT": {
          const info = await summarizeChatWithGemini(message.options || {});
          sendResponse({ ok: true, ...info });
          break;
        }
        case "EXPORT_CHAT": {
          const info = await exportActiveChat(message.options || {});
          sendResponse({ ok: true, ...info });
          break;
        }
        case "GET_AUTO_REFRESH_SETTINGS": {
          const settings = await getAutoRefreshSettings();
          sendResponse({ ok: true, ...settings });
          break;
        }
        case "SET_AUTO_REFRESH": {
          const updates = {};
          if (typeof message.enabled === "boolean") {
            updates[AUTO_REFRESH_ENABLED_KEY] = message.enabled;
          }
          if (typeof message.intervalHours === "number" && message.intervalHours > 0) {
            updates[AUTO_REFRESH_INTERVAL_KEY] = message.intervalHours;
          }
          await chrome.storage.local.set(updates);
          await setupAutoRefresh();
          const settings = await getAutoRefreshSettings();
          sendResponse({ ok: true, ...settings });
          break;
        }
        case "REFRESH_ALL_SESSIONS": {
          try {
            const result = await refreshAllProfileSessions();
            sendResponse({ ok: true, ...result });
          } catch (err) {
            sendResponse({ ok: false, error: err.message || String(err) });
          }
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true; // keep the message channel open for the async response
});
