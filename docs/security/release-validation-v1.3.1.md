# v1.3.1 remaining release checks

2026-10-15. User authorized running only necessary remaining checks, then GitHub publication. This supplements the historical [implementation report](validation-report.md); the earlier crypto/fixture/tamper/1000-export tests and benchmarks were not repeated.

## Installed extension checks

Real production builds were temporarily installed into disposable browser profiles with synthetic profiles/cookies/passwords only. No real Claude session or user backup was opened. Downloads were constrained to the temporary test directories. No browser-store publication is included in this GitHub release.

* `tests/installed-chrome.cjs`: headless Chromium 153.0.8010.12, real MV3 service worker and toolbar popup, controlled through an existing Playwright runtime and CDP. The exact version is in [installed-chrome-results.json](installed-chrome-results.json).
* `tests/installed-firefox.mjs`: installed Firefox 157.0.1, real MV3 background document and toolbar popup, controlled through Firefox's built-in loopback WebDriver BiDi. Firefox requires `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` in that disposable browser process to automate extension URLs. Actual popup DOM/API objects are reached through `browser.extension.getViews`, so runtime sender validation is not mocked.
* No new package dependency was installed. The Chromium runner accepts `PLAYWRIGHT_MODULE` (existing module path) and `CHROMIUM_BINARY` (existing browser binary); otherwise it uses a standard locally available `playwright` module/browser. Firefox accepts `FIREFOX_BINARY`.

Observed final output of `rtk proxy node tests/installed-chrome.cjs` (before replacing machine-specific defaults with the equivalent environment overrides):

```text
PASS invalid export clears both password fields
PASS actual popup v2 export reports success only after download completion
PASS download completed inside isolated test directory
PASS downloaded v2 file decrypts with its confirmed password
PASS wrong password leaves actual browser storage untouched
PASS valid restore previews account labels without applying sessions
PASS cancel preview leaves storage untouched
PASS explicit confirmation adds account atomically through real runtime messages
PASS v1 restore uses legacy password and shows manual re-export notice
PASS original-code v1 fixture imports through installed extension
PASS closing actual popup discards pending confirmation
PASS worker termination loses staged import safely without storage mutation
PASS actual storage quota failure leaves every existing account unchanged
PASS cancelled actual download is not presented as successful export
PASS browser confirms interrupted download state
```

Observed final output of `rtk proxy node tests/installed-firefox.mjs`:

```text
PASS actual Firefox popup exports encrypted v2 after download completion
PASS download completed inside isolated Firefox test directory
PASS actual Firefox download decrypts as v2
PASS Firefox wrong password leaves storage unchanged
PASS Firefox shows preview without applying sessions
PASS Firefox cancellation leaves storage unchanged
PASS Firefox confirmation applies through actual popup runtime messages
PASS Firefox v1 restore previews with manual re-export notice
PASS Firefox installed add-on restores original-writer v1 fixture
PASS closing Firefox popup invalidates staged import without storage changes
PASS Firefox background restart discards pending import safely
PASS Firefox interrupted export never reports success
PASS Firefox browser confirms interrupted download state
```

Both runners exited 0. The saved JSON files contain the final successful checks, not results from earlier harness attempts. Chromium storage-failure testing uses the **real storage quota**: fill the isolated store to near its limit, preview a larger profile, confirm, observe failure and verify all pre-existing accounts are byte-for-byte unchanged; remove test filler afterward.

## Confirmed Firefox download defect, diagnosis and fix

The installed Firefox test went red repeatedly on actual popup export before any download existed. Targeted probes recorded only stage names, sender-validation booleans, error type, and an API diagnostic with every string argument replaced by a redaction marker. Sender validation and WebCrypto import/derive/encrypt all succeeded. `downloads.download` then synchronously rejected the **data URL** with `Access denied for URL [REDACTED TEST ARGUMENT]`.

The production fix is confined to `background.js:exportProfilesBackup`: when `URL.createObjectURL` exists (Firefox background document), create an extension-owned Blob URL containing only the encrypted JSON. Keep it alive through download settlement and revoke in finally on success/interruption/rejection. Chromium's service worker lacks createObjectURL, so it retains its working data URL path. No crypto format, password handling, permission or CSP change.

The same failing Firefox installed test now passes, including real interrupted download handling. A focused unit regression covers Blob lifetime/revocation on successful, interrupted and rejected downloads, plus the service-worker data URL fallback. Mozilla documents [using Blob URLs for generated download data](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Working_with_files) and [revoking only after download completion](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download). Temporary diagnostic probes were removed from the runner; no production probe/log was added.

Actual focused regression output:

```text
rtk proxy node --test tests/regressions.test.mjs
ok 1 - cookie restore rejection never logs credential values or raw exceptions
ok 2 - invalid export attempt clears password and confirmation fields
ok 3 - runtime boundary rejects content-script and non-popup backup commands; only a preview token authorizes import
ok 4 - backup download uses document Blob URLs until settlement, revokes on failure, and supports service-worker fallback
# tests 4
# pass 4
# fail 0
# duration_ms 99.4186
```

The earlier Firefox test failures after the download fix were harness issues: enabling the documented automation access to extension URLs, and waiting for the asynchronous background reload to actually finish. The final restart test observes the old background's transient marker disappear before attempting the stale token. A Chromium harness variable redeclaration and popup-close/open race were likewise fixed before final successful execution. No production lifecycle workaround was added.

## Release preparation

Manifest and CHANGELOG now select **v1.3.1** (maintenance release version explicitly selected by the maintainer). `scripts/publish_release.py --prepare` is the existing official local release path; its private allowlist was extended narrowly for the user-requested public `package.json`, synthetic `tests/` and `docs/security/`. Private source/scripts/store-assets stay untracked and are not published. The preparer audits tracked paths, builds both production ZIPs and refreshes `store-assets/v1.3.1` with browser packages, icons, promo images, screenshots, descriptions, changelog and notes.

After the Firefox fix, the official preparer was rerun successfully and both store kits were refreshed. Final package hashes and byte counts are in [release-package-results.json](release-package-results.json). `tests/release-packages.py` checks ZIP CRCs, exact file allowlists, every packaged source byte, MV3 browser-specific manifests, local module imports, default ZIP equivalence and store-kit package identity.

```text
rtk proxy python scripts/publish_release.py --prepare
Target Version: v1.3.1
Building Chrome production variant...
  [+] Created archive: .../dist/hotswap-for-claude-chrome-v1.3.1.zip (91,407 bytes)
Building Firefox production variant...
  [+] Created archive: .../dist/hotswap-for-claude-firefox-v1.3.1.zip (91,498 bytes)
Rendered five Firefox marketing graphics at 2400x1800, matching the Chrome feature designs.
v1.3.1 prepared locally. No commits, tags, pushes, or releases created.

rtk proxy python tests/release-packages.py
PASS chrome: ZIP integrity, exact source files, manifest, local imports, refreshed store-kit package
PASS firefox: ZIP integrity, exact source files, manifest, local imports, refreshed store-kit package
PASS v1.3.1: all three release ZIPs, changelog and release notes ready

rtk proxy node tests/check-syntax.mjs
Syntax checks passed for 23 JavaScript modules. No lint/type-check tooling exists in the baseline repository.

rtk git diff --check
(no output, exit 0)
```

No already-passed expensive crypto or benchmark suite was repeated. Installed-browser checks cover the unchanged runtime JavaScript. Renumbering changes manifest metadata, a test fixture version and documentation; package validation is rerun for the replacement version. The local ZIP checksums are provenance for these local archives, not a prediction of CI ZIP hashes: ZIP timestamps/host newline conventions can change whole-archive digests without changing the source.

## Updated acceptance status / remaining limits

Installed Chromium/Firefox popup/API export and original-writer v1/v2 restore, explicit confirmation, cancellation, popup closure, background restart and interrupted-download checks are **met**. Actual Chromium quota failure preserves all accounts. Sudden OS/power-loss/disk-corruption durability is still not claimed. Cross-browser crypto restore had already passed in the preceding implementation phase.

No low-end hardware is available, so no new low-end benchmark is claimed and PBKDF2 stays at 600000. Argon2 is not adopted. No linter/type-check configuration exists; syntax checks cover the new runners. Formal CWS/AMO reviewer certification, store submission and exhaustive visual/accessibility/fuzz testing are not performed. These are not silently relabeled as passed by the GitHub release.
