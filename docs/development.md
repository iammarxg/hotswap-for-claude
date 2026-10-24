# Development guide

Read [the shared contributor instructions](../CLAUDE.md) first. Scripts and manifests remain authoritative for command options and version values.

## Setup and source map

Use a recent Node.js with native Web Crypto, `node:test`, and global WebSocket support (Node 22 or newer is a practical baseline), plus Python 3. The root project has no npm dependencies to install. Browser automation needs an existing Playwright installation and browser; Playwright is not declared in the root package.

Examples show ordinary commands. In environments configured for RTK, prefix them with `rtk` (or `rtk proxy` for raw output), following the host's instructions.

| Path | Responsibility |
| --- | --- |
| `extension/background.js` | Cookie switching, usage cache/alarms, credentials, backup dispatch, export jobs and downloads |
| `extension/blob-capture-init.js` | MAIN-world document-start completion SSE and HTTP 429 observer; no download interception |
| `extension/sse-bridge-content.js` | ISOLATED-world bridge from page messages to background |
| `extension/popup.html`, `popup.css`, `popup.js` | Accounts, settings, tools, backup confirmation, export controls/progress |
| `extension/export-page-script.js`, `export-reader.js` | Serialized MAIN reader, authenticated file streams and DOM fallback |
| `extension/export-data.js` | Pure branch normalization, file identities and Markdown generation |
| `extension/export-jobs.js` | Registered source/runner orchestration, popup reconnect and session coordination |
| `extension/export-runner.*`, `export-staging.js` | Extension-owned job UI, temporary IndexedDB chunks and ZIP download |
| `extension/zip-builder.js` | Blob-backed stored ZIP construction with classic ZIP bounds checks |
| `extension/export-location.js` | Last successful download location |
| `extension/transcript-summarizer.js` | Gemini handoff prompt construction |
| `extension/backup-crypto.js`, `backup-schema.js`, `backup-restore.js` | Crypto, bounds/schema, staged preview and confirmed import |
| `extension/secret-vault.js` | Background-only atomic encrypted IndexedDB credential storage/migration |
| `tests/` | Node regression/crypto tests, installed-browser backup checks and release-package validation |
| `docs/security/` | Backup specification, threat model and dated evidence |
| `package.py`, `.github/workflows/release.yml` | Browser packages and tag-driven release workflow |

The ignored `src/` tree is historical private source, not a required build input. Private `scripts/` contains maintainer checks and store-kit tooling; inspect each script because some still target that older implementation.

## Execution and export flow

The page's MAIN world owns DOM/blob access; the ISOLATED content script owns the runtime bridge. Background owns privileged cookies, storage, downloads, secrets, and orchestration. Popup initiates operations and displays results. Functions passed through `chrome.scripting.executeScript` are serialized: injected scraper code must work without module-scope closures or imports.

Export jobs use an inactive extension-owned runner tab, independent of popup lifetime. Background binds it to a source tab/chat/organization, relays MAIN reads, and coordinates cookie-changing usage/session operations. Popup progress uses the `export-chat` port and reconnects on opening. Cancellation aborts the registered reader and only the job's own final download.

The primary reader uses Claude's conversation response and original file endpoints. The DOM fallback traverses overlapping viewports and checks indexed coverage instead of jumping between endpoints. See [export development](export-development.md) before changing readers, file routes, chunk transfer or completeness rules.

Exports contain `transcript.md`, optional `attachments/`, and `export-report.json`. Failed recovery produces an `_INCOMPLETE` ZIP and warning; intentional attachment exclusion does not count as failure. Original uploads and generated files use stable identities rather than filenames. Binary chunks are staged temporarily in IndexedDB, and the runner downloads a Blob-backed ZIP without final base64 conversion.

## Validation by change

For JavaScript changes, run syntax checks and the relevant Node tests:

```sh
npm run check
node --test tests/regressions.test.mjs
```

`npm test` runs all `tests/*.test.mjs`, including real crypto and a 1,000-export uniqueness test that can take several minutes. For a focused backup iteration, run the suite without that expensive case:

```sh
node --test --test-skip-pattern="1000 actual" tests/backup.test.mjs tests/regressions.test.mjs tests/vectors.test.mjs
```

Run the full suite for crypto/randomness changes affecting the skipped case. `npm run benchmark` measures actual KDF work; a fast workstation result does not establish low-end performance. Keep v1 fixtures tied to `tests/legacy-original.mjs`; regeneration is intentional compatibility work, not routine setup.

For export changes, run `npm run test:export` and `node --test tests/regressions.test.mjs`, then the DOM/installed Brave/Firefox checks and live Brave workflow described in [export development](export-development.md). Synthetic fixtures cannot establish live Claude compatibility. Keep validation status current as evidence is collected.

For installed backup/popup/runtime checks:

```sh
python package.py
npm run test:installed:chrome
npm run test:installed:firefox
```

Chrome uses `PLAYWRIGHT_MODULE` and optional `CHROMIUM_BINARY`. Firefox uses built-in WebDriver BiDi and optional `FIREFOX_BINARY` (default is a Windows path). Both create isolated profiles and write `docs/security/installed-*-results.json`; inspect evidence diffs. `tests/run-browsers.py` is a separate Windows-oriented loopback crypto harness; inspect its CLI/browser assumptions before running.

There is no root linter, type checker, bundler, or npm build script. A missing browser/runtime is an unmet prerequisite, not a passing check. Existing reports are dated evidence: `docs/security/browser-results.json` records an earlier unsuccessful attempt; `browser-results-verified.json` records the later verified run.

## Building packages

`python package.py` copies current `extension/` into `dist/chrome/` and `dist/firefox/`, transforms manifests per browser, and creates three versioned ZIPs (Chrome, Firefox and Chrome-equivalent default). Chromium uses a module service worker; Firefox uses module background scripts. The source manifest carries both declarations. The packager validates the description's 132-character limit.

Browser output directories are replaced on rebuild. Load Chromium's directory in `chrome://extensions` or `brave://extensions`; load `dist/firefox/manifest.json` through Firefox's temporary add-on workflow.

The source manifest remains 1.3.2 for development. The exporter passed the focused, installed-browser and live acceptance checks recorded in [export development](export-development.md). Local builds and passing checks do not publish packages.

## Release preparation in a maintainer checkout

`scripts/package.py` builds from `extension/` and refreshes separate Chrome/Firefox store kits; it does not synchronize `src/`. Stable kits live under `store-assets/v{manifest-version}/chrome/` and `firefox/`. Preserve historical published artifacts.

`python scripts/publish_release.py --prepare` is local-only: it audits prospective public files, builds kits, and extracts notes. It creates no commits, tags, pushes or releases. The shared policy in `tests/release_policy.py` explicitly allows the contributor entry points and development/export guides, while keeping private source, scripts, live exports and maintainer notes excluded. The audit includes non-ignored untracked files and skips deliberate deletions. Run `python tests/release_policy.py` and its `--audit` mode when changing publication paths.

`python tests/release-packages.py` checks ZIPs against current source and private store copies, current release-note/changelog content, listing policy, five correctly sized screenshots per browser and both upload kits. It requires the official preparer and writes `docs/security/release-package-results.json`; the root packager alone does not create every prerequisite. Text comparisons normalize Windows line endings where appropriate.

The release workflow builds on pushes to `main`, `v*` tags and manual dispatch. Only matching `v{manifest-version}` tags publish; main/manual runs build. It runs the public path-policy checks and ordinary packager with `prerelease: false`. It does not run Node/browser checks. Before an authorized release, validate separately and verify all five attachments: three ZIPs, `CHANGELOG.md`, and `RELEASE_NOTES.md`.

Update this guide when changing prerequisites, public-file policy, runtime ownership or build identity. Update `CHANGELOG.md` for user-visible changes and the backup specification when its protocol changes. Maintainer handoffs belong in ignored `MEMORY.md` and future work in ignored `ROADMAP.md`.
