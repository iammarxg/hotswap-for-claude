# HotSwap for Claude (v1.1.0)

A Manifest V3 browser extension for quickly hot-swapping between multiple Claude.ai account sessions, tracking live 5-hour & weekly limits, keeping sessions active, and exporting conversations to Markdown.

- **Website**: [https://hotswap.jeddah.dev](https://hotswap.jeddah.dev)
- **Chrome Web Store**: [Extension Link](https://chromewebstore.google.com/detail/hotswap-for-claude/nnpnmjhealgmnbinplmccegkecabcpdk) (ID: `nnpnmjhealgmnbinplmccegkecabcpdk`)
- **Support**: `support@jeddah.dev`

---


## How it works

Claude.ai's auth cookies are `HttpOnly`, so the extension can't read/write
them from a content script — it uses the `chrome.cookies` API from a
background service worker instead:

1. **Add current account** — snapshots every cookie currently set for
   `claude.ai` / `*.claude.ai` and saves it as a named profile in
   `chrome.storage.local`.
2. **Switch account** — before switching, it re-snapshots the profile you're
   leaving (in case tokens rotated), clears all claude.ai cookies from the
   browser, writes in the target profile's saved cookies, then reloads any
   open claude.ai tab (or opens one).
3. **Rename / Remove** — manage saved profiles from the popup.

No cookie names are hardcoded — the extension captures whatever cookies
exist under the domain, so it should keep working even if Claude changes
its auth cookie names.

## Design notes

The popup follows a small, deliberate visual concept rather than default
styling: since this tool is fundamentally about swapping between session
"badges," the UI leans into a badge/access-panel look —

- Each saved account renders as a square ID-chip with monospace initials,
  not a generic circular avatar.
- The active account gets a left accent bar + a small "● Active" tag,
  standing in for a status light rather than a highlighted row.
- Section headers ("Add / switch", "Resume elsewhere", "Backup") are
  monospace, uppercase, letter-spaced eyebrows — a nod to panel labeling.
- Dark surface (`#1b1d22`) with a warm brass accent (`#c98a3e`), chosen
  specifically to avoid the cream-background/terracotta-accent combo that's
  become a generic "AI-built" tell (that terracotta is literally
  Anthropic's own UI accent color).
- All color pairings are checked against WCAG AA contrast (see the ratios
  in git history/commit notes) — nothing sacrifices legibility for the
  aesthetic.

If you extend the UI further, keep new elements to this same restrained
plan rather than introducing a second accent color or a different type
treatment — the whole point is that it reads as one considered piece, not
a stack of default components.

## Newer features

- **Account email shown under each label** — read from claude.ai's own user
  menu (`span[data-testid="user-menu-header"]`), not guessed. Captured when
  you click **Add current account** and refreshed whenever the active
  profile is re-synced (e.g. before switching away). Because the email only
  ever renders once the menu is opened, capturing it briefly opens and
  closes that menu programmatically — you may see it flash for an instant.
  If claude.ai's menu markup changes, this will quietly stop finding the
  email rather than error; the label still works fine without it.
- **Session-health dot** next to each label — green (looks current), amber
  (a saved cookie expires within 3 days), red (already expired, no cookies,
  or restore likely to fail), grey (session-only cookies, can't tell without
  switching to it). This is computed from the saved cookies' own
  `expirationDate` metadata, with no network calls — hover the dot for
  detail. It's a heuristic, not a guarantee: claude.ai can revoke a session
  server-side before the cookie's own expiry (e.g. a password change), and
  that isn't detectable this way.
- **Custom color tag per account** — click the small circle next to
  rename/remove to pick a color; it becomes that badge's left stripe at all
  times (not just while active), so accounts stay visually distinct at a
  glance. Purely cosmetic, stored locally.
- **Search/filter** — the search box above the list filters by label or
  email as you type.
- **Keyboard shortcuts** — listed on the popup's Settings tab, with key labels
  shown for your OS (`Option`/`⌥` on Mac, `Alt` on Windows/Linux).
  `Alt+Shift+1` jumps to whichever saved account has the most usage left
  (checked fresh each time, based on the 5-hour session limit — not the
  weekly one); `Alt+Shift+←`/`→` cycles through all accounts in
  most-recently-used order. Rebind any of them from the Settings tab's "Edit
  shortcuts…" link (opens `chrome://extensions/shortcuts`).

### Usage display (5h/weekly limits) — read directly from claude.ai's own API

Claude.ai's own page has no native "Session (5h): 77%, resets in 4h 30m" UI
anywhere in its markup, but the web app itself gets that data from
somewhere to decide when to show its own "approaching your limit"
banners — the same `/api/organizations/{orgId}/usage` endpoint it calls.
This extension calls it directly instead, so it no longer depends on a
separate extension (previously: Claude Usage Tracker by lugia19) being
installed at all.

How it works:
- Reads the org ID from the `lastActiveOrg` cookie already captured in
  that profile's saved session (falling back to `/api/organizations` if
  that cookie is somehow missing), then calls that org's `/usage`
  endpoint for session (5h), weekly, and per-model weekly limits.
- Works for **any** saved profile, not just the one currently active in
  the browser. For a non-active profile, this briefly swaps the browser's
  claude.ai cookies to that profile's session, makes the request, then
  swaps back — invisibly (no tab reload) and in well under a second. A
  claude.ai tab making its own requests during that narrow window could
  theoretically see the wrong account briefly; this is a known, accepted
  tradeoff for checking usage without actually switching accounts.
- Captured at the same points as before: when you click **Add current
  account**, and whenever the active profile is re-synced (e.g. right
  before switching away). A **↻** button next to every account lets you
  refresh it on demand.
- The popup shows the single most-pressing limit inline (color-coded:
  quiet under 70%, amber 70–89%, red 90%+), with every limit plus "as of
  Xm/h ago" in the hover tooltip — the number is only as fresh as the
  last time it was fetched, so it can go stale for accounts you haven't
  checked in a while.

### Session keep-alive (automatic cookie refresh)

Claude.ai session cookies expire after some weeks. If a saved profile
isn't switched to before then, its cookie snapshot goes stale and
restoring it fails — you'd have to log back in and re-save the profile.
This feature prevents that by periodically "exercising" each saved
session in the background:

- A `chrome.alarms` timer fires on a configurable schedule (default:
  every 12 hours). For each saved profile, it briefly swaps the
  browser's claude.ai cookies to that profile's session (same invisible
  pattern the usage checker already uses — no tab reload, under a
  second), makes a lightweight `GET /api/organizations` request so the
  server processes the session cookies (and issues any Set-Cookie
  refreshes/rotations), then re-snapshots the now-current cookies back
  into storage.
- Also refreshes usage data for every profile while each session is
  live, so usage numbers stay current even for accounts you haven't
  switched to in a while.
- Enabled by default; configurable from the **Session keep-alive**
  section on the popup's **Settings** tab — choose an interval (4h / 8h /
  12h / 24h / 48h), toggle it off entirely, or click **Refresh all
  sessions now** for an immediate manual run.
- Each profile's health-dot tooltip shows when it was last refreshed.
- If a session has already expired (e.g. revoked server-side), the
  refresh will fail gracefully for that profile and continue with the
  rest — the health dot will still show it as expired.

## Workspace & File Structure

```
hotswap-for-claude-extension/
├── src/                          # Development & open-source source tree
│   ├── manifest.json            # MV3 manifest
│   ├── background.js            # Core service worker & keepalive engine
│   ├── blob-capture-init.js     # Early MAIN world blob proxy
│   ├── export-page-script.js    # In-page conversation DOM scraper
│   ├── popup.html               # Popup UI (Accounts, Tools, Settings tabs)
│   ├── popup.js                 # Popup client logic
│   ├── popup.css                # Popup styling & macOS width lock
│   ├── icons/                   # Extension icons (16px, 48px, 128px)
│   ├── LICENSE                  # Creative Commons CC BY-NC 4.0 License
│   ├── README.md                # Documentation & usage guide
│   └── ARCHITECTURE.md          # Comprehensive architecture & release guide
│
├── dist/                         # Clean production build for Chrome Web Store
│   ├── manifest.json
│   ├── background.js
│   ├── blob-capture-init.js
│   ├── export-page-script.js
│   ├── popup.html / popup.js / popup.css
│   └── icons/
│
└── store-assets/                # Versioned store assets & release zip snapshots
    └── v1.0.0/
        ├── hotswap-for-claude-v1.0.0.zip # Package snapshot for store upload
        ├── icon512.png / icon128.png     # Store listing icons
        ├── promo_small_440x280.png       # Small promo tile (440x280, 24-bit RGB)
        ├── promo_marquee_1400x560.png    # Marquee promo banner (1400x560, 24-bit RGB)
        └── screenshot_*.png              # 1280x800 showcase screenshots
```

## Exporting a chat to resume on another account

Click **Export this chat** while viewing a claude.ai conversation
(`claude.ai/chat/...`). This:

1. Injects a script into the page that reads the already-rendered
   conversation DOM (scrolling up first to force any lazy-loaded older
   messages to appear).
2. Converts it to a clean Markdown transcript, message by message.
3. Detects files linked to each message — user-uploaded attachments and
   Claude-generated artifacts — and downloads any with a real fetchable
   URL into an `attachments/` subfolder, referenced inline under the
   message that carried them.
4. Saves everything into one folder:
   ```
   claude-chat-export-<title>-<timestamp>/
   ├── transcript.md
   └── attachments/
       ├── 01-report.pdf
       └── 02-screenshot.png
   ```

**No Claude API calls happen during export** — steps 1–4 only read the page
DOM and the browser's download mechanism, so it costs zero tokens/credits.

To resume elsewhere: on the other account, start a new chat, **attach
`transcript.md` and anything relevant from `attachments/`**, and click
**Copy resume prompt** in the popup to get a ready-made kickoff message to
paste alongside them. Claude reads it once as an attachment, instead of you
re-explaining the whole backstory across several messages — meaningfully
cheaper than pasting it inline, and *much* cheaper than typing it all out
again by hand.

### Attachment detection — what it can and can't capture

File detection is best-effort, same spirit as the message scraping:

- **Images and direct file links** with a real `https://` URL get
  downloaded automatically.
- **Attachment chips / artifact cards without a directly loadable URL**
  (e.g. content that only renders once you click to open it) are still
  recorded by name in the transcript, flagged as "referenced only" — you
  may need to open them manually in the original chat and copy the content
  over if you need it.
- Some downloads can fail even with a URL present — e.g. a signed URL that
  expired, or a resource Chrome's download manager can't reach. These are
  listed in the transcript with the original link rather than silently
  dropped.
- `blob:` URLs (temporary, page-local image previews) are intentionally
  skipped, since they stop working the moment the page context changes and
  can't be exported.

### Troubleshooting export

- **"No messages found on this page"**: as of v1.2.1 the scraper's primary
  strategy looks for `[role="article"][aria-label^="Message "]` turn
  wrappers (verified against a real claude.ai page) and reads role from
  Claude's screen-reader-only heading ("You said: ..." / "Claude
  responded: ..."), falling back to `data-testid="user-message"` if that
  heading is missing. If Claude changes its markup again and this stops
  working, open DevTools on a claude.ai conversation, inspect a message
  bubble, and update `findMessageElements()` in `export-page-script.js` —
  older `.font-user-message`/`.font-claude-message` and
  `data-testid="user-turn"`/`"agent-turn"` selectors are kept as fallbacks
  but are no longer what claude.ai actually renders.
- **Attachments aren't showing up**: the attachment heuristics
  (`findAttachmentsIn()` in `export-page-script.js`) look for `<img>` tags,
  file-like `<a href>` links, and elements with `attachment`/`artifact` in
  their `data-testid`/class name. If Claude's markup uses different
  patterns, inspect an attachment chip in DevTools and adjust the selectors
  there.
- **Missing older messages**: the export scrolls to the top of the
  conversation a few times to trigger lazy-loading before scraping. For
  very long conversations you may need to scroll up manually first, then
  export.
- **Formatting looks a bit off**: the HTML→Markdown conversion is
  intentionally simple (paragraphs, code blocks with language tags, lists,
  bold/italic, links). It won't perfectly reproduce complex formatting like
  tables or nested artifacts, but it preserves the substance of the
  conversation.

## Load it locally (unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `hotswap-for-claude` folder.
5. Pin the extension from the toolbar puzzle-piece icon for easy access.

## Updating without losing your saved accounts

`chrome.storage.local` (where saved accounts live) already survives normal
updates — **as long as you update it the same way each time**:

✅ **Do this:** extract the new version's files into the *exact same
folder path* you originally loaded, overwriting the old files, then click
the **reload icon** (⟳) on the extension's card in `chrome://extensions`.

❌ **Not this:** clicking **Remove** and then **Load unpacked** again — this
deletes the extension entirely, storage included. Extracting a new zip to
a *different* folder has the same effect, because Chrome derives an
unpacked extension's ID from its folder path — a new path means a "new"
extension with empty storage, even though the code is identical.

If you're not sure which folder you originally loaded, check the **ID**
field on the extension's card in `chrome://extensions` before and after
updating — if it changes, your storage did reset, and you'll need the
backup below.

### Backup / restore (the safety net)

Regardless of how carefully you update, it's worth keeping a backup:

1. Click **Download backup** in the popup — saves a `.json` file with all
   your saved accounts' session cookies.
2. If storage ever does reset (or you switch machines), click **Restore
   from backup** and select that file. Restored accounts get added
   alongside anything already saved — nothing existing gets overwritten.

**This file is as sensitive as a password** — it contains raw session
cookies, and anyone who has it can access those Claude.ai accounts as you
until the sessions expire or are revoked. Keep it out of shared drives,
cloud sync folders you don't fully trust, or anywhere else other people
could reach it, and delete it once you've restored from it.

## Using it

1. Log into claude.ai with your first account in a normal tab.
2. Click the extension icon → type a label (e.g. "Work") → **Add current
   account**.
3. Click **Start new account (keeps others logged in)**. This clears
   cookies locally so you get a fresh login page — it does **not** call
   claude.ai's logout endpoint.
4. Log into your second account in the tab that opens.
5. Click the extension icon → label it (e.g. "Personal") → **Add current
   account**.
6. You can now click either saved account in the popup to switch between
   them instantly — cookies are swapped and the claude.ai tab reloads.

### ⚠️ Do not use claude.ai's own "Log out" button to switch accounts

This is the #1 cause of "switching logs me out instead of switching."

Claude.ai's own logout button calls a server endpoint that **revokes the
session token**, not just deletes the cookie in your browser. Once that
happens, no amount of cookie-restoring by this extension can bring the
session back — the token itself is dead, not just missing locally.

Always use the extension's **Start new account** button instead when you
want to log into a different account. It clears cookies locally only,
leaving your other saved sessions' tokens untouched and still valid.

If you already used claude.ai's logout button and a saved profile now
shows "session expired" behavior after switching, there's no way to
recover that session through the extension — log in again under that
account and click **Add current account** to re-save a fresh, valid
session.

## Known limitations / things to sanity-check

- **Cookie scope**: Claude may set some cookies on `claude.ai` and others on
  related subdomains (e.g. an auth or console subdomain). The extension
  currently captures `claude.ai` and `*.claude.ai`. If you find some part of
  the session isn't carried over, check DevTools → Application → Cookies for
  any other relevant domain and add it to the `DOMAINS` array in
  `background.js`.
- **Session expiry**: if a saved profile's session has expired (e.g. logged
  out server-side, or tokens rotated elsewhere), switching to it will still
  restore the old cookies, but claude.ai may show you logged out. In that
  case, log back in under that profile and click **Add current account**
  again with the same label to refresh the snapshot (or delete and re-add).
- **Single browser profile only**: cookies are stored per saved "account,"
  not per Chrome profile — this extension is meant to live inside one
  Chrome profile and switch the claude.ai session within it.
- **Placeholder icons**: the icons in `icons/` are simple generated
  placeholders — swap them out for your own branding if you'd like.

## Permissions used

- `cookies` — read/write/remove claude.ai session cookies.
- `storage` — persist saved account profiles locally (`chrome.storage.local`,
  never synced or sent anywhere).
- `tabs` — reload/open the claude.ai tab after switching, and find the
  active tab to export from.
- `scripting` — inject the read-only scraping function into the claude.ai
  page when you click "Export this chat".
- `downloads` — save exported chat transcripts/attachments and account
  backup files to disk.
- `alarms` — schedule periodic background session refresh so saved
  accounts' cookies don't expire while unused.
- `host_permissions` — scoped to `https://claude.ai/*` and
  `https://*.claude.ai/*` only.

All data stays on your machine in `chrome.storage.local` — nothing is sent
to any external server, and background alarms are used solely to keep your local sessions refreshed.

## License

This project's open-source developer code is licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](./LICENSE).
- Free for individuals, non-commercial use, forking, and contributing.
- Commercial use requires a commercial license. Contact repository maintainers for commercial licensing inquiries.
