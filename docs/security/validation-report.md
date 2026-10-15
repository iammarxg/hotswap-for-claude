# Encryption hardening implementation and validation

Date: 2026-10-15. Baseline `157c59a`; Phase 0 was committed **before behavior changes**, in `c694b7b`. Changes are local; nothing was pushed or published. The real backup supplied by the user was not read/decrypted, copied, logged or committed. Every fixture is synthetic.

## Files changed

* `docs/security/encryption-audit-notes.md`: baseline file/function/line trace, history findings and severity assessment.
* `extension/backup-crypto.js`: permanent v1 reader semantics; v2 AES-256-GCM/header AAD/NFKC writer/reader, bounded parameters and password policy.
* `extension/backup-schema.js`: named limits, canonical structure/duplicate JSON detection, file-size guard and bounded payload/cookie schema.
* `extension/backup-restore.js`: private staged preview, two-minute expiry, cancellation and one-use confirmation before one storage commit.
* `extension/background.js`: restrict backup commands to the popup, dispatch preview/confirm/cancel, redact cookie restore logs and import/export exceptions.
* `extension/popup.js`: clear password fields on every submit, validate before unlock, render labels safely and require confirmation.
* `extension/popup.html`: preview controls, twelve-character password guidance, advisory strength warning and threat/recovery copy.
* `package.json`: dependency-free Node test/check/benchmark entry points (baseline had no JS test framework).
* `tests/backup.test.mjs`: crypto/format/schema/atomicity/confirmation/expiry/uniqueness coverage.
* `tests/regressions.test.mjs`: confirmed logging/password-retention regressions and real message-handler authorization tests.
* `tests/vectors.test.mjs`: verified RFC PBKDF2 and Wycheproof AES-GCM known-answer checks.
* `tests/legacy-original.mjs`: byte-for-byte original encrypt/decrypt module from `157c59a`, only used in tests.
* `tests/generate-fixtures.mjs`: reproduces fake v1 fixtures using that original code.
* `tests/fixtures/v1-ascii.json`: authentic original-writer fixture with public throwaway short password and fake cookies.
* `tests/fixtures/v1-unicode-nfd.json`: authentic original-writer fixture preserving decomposed Unicode password bytes.
* `tests/fixtures/v1-spaces.json`: authentic original-writer fixture preserving leading/trailing password spaces.
* `tests/helpers.mjs`: synthetic payload generation and public throwaway password.
* `tests/check-syntax.mjs`: syntax validation for shipped JS and test modules.
* `tests/benchmark.mjs`: three warmups, thirty fresh-salt KDF measurements, workstation metadata.
* `tests/browser.html`: local browser-engine test entry point.
* `tests/browser.mjs`: packaged module v1/v2/fixture/cross-browser checks, CSP probe and fresh-salt benchmark.
* `tests/run-browsers.py`: loopback runner with isolated temporary Chrome/Firefox profiles, no external package dependency.
* `docs/security/browser-results-verified.json`: final successful browser-engine checks and raw benchmark values.
* `docs/security/browser-results.json`: retained evidence of an earlier failed browser launch/test attempt; **not a successful result**.
* `docs/security/node-test-results.tap`: complete final TAP output for the 18 tests other than the separately passed 1000-export test.
* `docs/security/backup-format.md`: byte-exact formats, AAD layout, bounds/schema, errors and compatibility rules.
* `docs/security/threat-model.md`: threat boundaries, local storage finding, dependency/policy review and remaining limitations.
* `docs/security/release-notes.md`: user-facing unreleased change and legacy-restore guidance.
* `README.md`: current v2/password/preview behavior and specification link.
* `CHANGELOG.md`: unreleased format/import changes and confirmed defect fixes; no release version bump or publication.

`dist/` is ignored build output; final Chrome and Firefox ZIPs were generated from the changed source. Existing 1.3.0 packaging metadata is retained for local testing; these are not published replacement releases.

## Confirmed defects and corrections

| Severity | Baseline evidence | Correction / regression evidence |
| --- | --- | --- |
| High | `background.js:importProfilesBackup` copied unvalidated cookie arrays, with no source confirmation | Complete schema/domain restrictions plus preview token; tests reject encrypted malicious payload, block writes before confirmation, and cover cancellation, expiry, replay and failed commit |
| Medium | `background.js:setCookies:178` logged cookie details including values on rejection; 182 forwarded raw exceptions to logs | Static messages without objects/raw exceptions; exact old rejection-path test failed before the fix and passes afterward |
| Low | `popup.js:submitEncryptedBackup:1109` returned on validation failure with password fields populated | Clear both fields immediately after reading and before validation; exact test failed before the fix and passes afterward |

No confirmed weak randomness, reused salt/IV/key, AES under 256 bits, extractable derived key or GCM tag bypass. V1 **already had fixed AAD**; none of those primitives were replaced. The header was not AAD-bound, hence explicit v2 rather than changing legacy decryption.

## KDF gate and external evidence

Decision: **v2 WebCrypto PBKDF2-HMAC-SHA-256, 600000 iterations**, with authenticated header. No Argon2id dependency or support is introduced; an Argon2id envelope fails validation before crypto.

1. Reviewed [hash-wasm](https://github.com/Daninet/hash-wasm) as a possible maintained WASM implementation and its [MIT top-level license](https://github.com/Daninet/hash-wasm/blob/master/LICENSE). Embedded implementation licensing, a selected pinned release, integrity hash and active-maintenance audit were **not established**, so no claim is made that this candidate satisfies the vetted-library gate.
2. The current manifest has no explicit CSP. [Chrome default CSP documentation](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) disables WASM without `wasm-unsafe-eval`; [Mozilla's CSP documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_security_policy) describes the same opt-in. Both browser engines **experimentally rejected a minimal WASM module under an equivalent HTTP script-src self policy**. This is useful evidence, **not** proof from an installed MV3 extension or a test of a vendored Argon2 library. No CSP relaxation was added merely to bypass the gate.
3. Existing backup crypto runs in the background realm. No stable extension page/offscreen/Worker Argon2 execution path, shutdown test, low-end timing or Argon2 peak-memory test was established. Because all gate conditions are required, incomplete evidence selects the explicit PBKDF2 fallback; it does not justify a claim that Argon2 is impossible on MV3.
4. Rechecked [OWASP Password Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): Argon2id minima include 19456 KiB/t=2/p=1 or 47104 KiB/t=1/p=1. [RFC 9106 section 4](https://www.rfc-editor.org/rfc/rfc9106.html#section-4) describes a 64 MiB/t=3/**p=4** recommendation for constrained environments; it does not establish the prompt's p=1 suggestion as its recommended vector. No Argon2 parameters are relied upon by this implementation.
5. Retained 600000 because there is **no low-end target device available**. A fast development machine does not establish a higher safe iteration count or the desired 0.5–1 s low-end latency. The v1 allowlist remains exactly `{600000}` from available git history; v2 permits 600000–5000000.

## Actual executed commands and outputs

Shell commands use the requested `rtk` prefix. The environment prints an unrelated PowerShell `InitializeDefaultDrives` warning on sandboxed commands; exit codes/output below determine results.

Before changing behavior:

```text
rtk proxy node --test tests/regressions.test.mjs
not ok 1 - cookie restore rejection never logs credential values or raw exceptions
not ok 2 - invalid export attempt clears password and confirmation fields
# tests 2
# pass 0
# fail 2
```

After the initial implementation (real cryptography, no KDF stub for uniqueness):

```text
rtk proxy node tests/generate-fixtures.mjs
Generated 3 synthetic v1 fixtures using the unmodified original encryptor.

rtk proxy node --test tests/backup.test.mjs
ok 13 - 1000 actual v2 exports have unique salts and IVs (real PBKDF2)
  duration_ms: 213289.6686
1..13
# tests 13
# pass 13
# fail 0
# duration_ms 225433.6646
```

Subsequent regression run after plaintext-cleanup/file-error-path hardening, without unnecessarily repeating the already-passed costly uniqueness test:

```text
rtk proxy node --test --test-skip-pattern="1000 actual" tests/backup.test.mjs tests/regressions.test.mjs tests/vectors.test.mjs
1..16
# tests 16
# pass 16
# fail 0
# duration_ms 12460.6625
```

After adding expiry/immutable-preview and expanded rejection-boundary coverage:

```text
rtk proxy node --test --test-name-pattern="header validation|file guard|schema rejects|preview pins" tests/backup.test.mjs
ok 1 - header validation rejects malformed fields without any WebCrypto calls; iteration bomb <100ms
ok 2 - file guard, canonical structure and duplicate-sensitive parsing
ok 3 - schema rejects unknown keys, wrong types, cookie scope/name and oversized fields
ok 4 - preview pins its clone, expires and rejects superseded asynchronous previews without writes
# tests 4
# pass 4
# fail 0
# duration_ms 712.9006
```

Final authorization/regression/syntax/build checks:

```text
rtk proxy node --test tests/regressions.test.mjs
ok 1 - cookie restore rejection never logs credential values or raw exceptions
ok 2 - invalid export attempt clears password and confirmation fields
ok 3 - runtime boundary rejects content-script and non-popup backup commands; only a preview token authorizes import
# tests 3
# pass 3
# fail 0
# duration_ms 104.1098

rtk proxy node tests/check-syntax.mjs
Syntax checks passed for 21 JavaScript modules. No lint/type-check tooling exists in the baseline repository.

rtk proxy python package.py
Target Version: v1.3.0
Building Chrome production variant...
  [+] Created archive: .../dist/hotswap-for-claude-chrome-v1.3.0.zip (91,272 bytes)
Building Firefox production variant...
  [+] Created archive: .../dist/hotswap-for-claude-firefox-v1.3.0.zip (91,364 bytes)
Packaging complete!

rtk git diff --check
(no output, exit 0)
```

The build path prefixes above are shortened for readability; the filenames, byte counts and result lines are actual observed output. Across these runs, **19 distinct current test cases passed** (14 backup + 3 regressions + 2 vectors). This is not a claim that one final full `npm test` run produced 19 passes: the commands and versions tested are recorded separately. The initial fixture test run had a test-file syntax error (`await` inside a non-async callback); it was corrected before the recorded successful runs.

Final combined run, launched through a prefixed Python subprocess wrapper to save the full output in [node-test-results.tap](node-test-results.tap):

```text
node --test --test-skip-pattern=1000\ actual tests/backup.test.mjs tests/regressions.test.mjs tests/vectors.test.mjs
1..18
# tests 18
# pass 18
# fail 0
# duration_ms 12419.1538
```

The skip-pattern above was one subprocess argument (`--test-skip-pattern=1000 actual`); the shown shell escape is only explanatory. The separately executed 1000-export test also passed, as recorded above.

Browser checks executed with `rtk proxy python tests/run-browsers.py` using isolated temporary profiles. Sandbox browser launch returned no result; the first unsandboxed attempt also failed because Windows served `.mjs` as text/plain. Explicit JavaScript MIME mappings fixed the harness. Raw failed results remain in `browser-results.json`. Final successful run in `browser-results-verified.json`:

```text
Chrome 155: v1/v2 round trips 0 / 1024 / 1048576 bytes; 3 v1 fixtures; v2 NFKC; ok: true
Firefox 157: decrypt Chrome export; same round trips/fixtures/NFKC; ok: true
Chrome 155: decrypt Firefox export; ok: true
Both: wasmUnderEquivalentCSP: blocked
```

These are **real browser-engine WebCrypto checks against production build modules served over loopback**, not mocked crypto; they are **not installed extension UI/worker/store checks**. Browser results preceded the final move of random generation into the existing encryption try/finally and generic file-read catch; the crypto parameters, AAD and encoding are identical. The subsequent Node suite covers those final source changes.

Primary-source vector verification: [RFC 7914 section 11](https://www.rfc-editor.org/rfc/rfc7914.html#section-11), both PBKDF2-HMAC-SHA-256 vectors; [Wycheproof AES-GCM test case 2](https://github.com/C2SP/wycheproof/blob/main/testvectors_v1/aes_gcm_test.json), encrypt/decrypt/AAD/tag. Direct NIST ZIP fetch failed due sandbox DNS; no NIST-vector test is claimed. Wycheproof satisfies the requested published AES-GCM-vector alternative.

## Benchmarks

All measurements use `performance.now()`, 3 warmups, at least 30 measured derivations, fresh random salt on each measured run. Median averages the middle two of 30 sorted samples; p95 is the nearest-rank 29th sample. Device: **AMD Ryzen 7 5700X3D, 32 GiB RAM, Windows x64**. This is the only device available and is **not low-end**. Browser tests used headless isolated profiles, loopback secure-context WebCrypto, not installed extension pages.

| Runtime | KDF | Median ms | p95 ms | Peak memory |
| --- | --- | ---: | ---: | --- |
| Chrome 155.0.0.0 | PBKDF2-SHA-256 / 600000 / AES-256 | 95.75 | 136.10 | Not measured |
| Firefox 157.0 | PBKDF2-SHA-256 / 600000 / AES-256 | 108 | 119 | Not measured |
| Node 22.19.0 | PBKDF2-SHA-256 / 600000 / AES-256 | 266.19 | 288.48 | Not measured |
| Low-end device | — | **Not available** | **Not available** | — |
| Argon2id | Not used | Not run | Not run | Not run |

The first repeated-identical-input Firefox benchmark returned median 0 ms/p95 1 ms; that anomalous result was **discarded**, not used to select costs. Cache effects are a possible explanation, not a proven diagnosis. Fresh-salt measurements above are the recorded results relevant to export behavior. No extrapolation to mobile/low-end targets is made.

## Acceptance checklist

| Phase / acceptance item | Status | Evidence or gap |
| --- | --- | --- |
| 0: full export/import trace before edits; passwords/KDF/randomness/AAD/parsing/payload/errors/history, file/function/line references | **Met** | Baseline audit committed as c694b7b before behavior changes; v1 raw UTF-8/AES-256/non-extractability/fixed AAD verified |
| 0: all shipped iteration values | **Partially met** | Available local branch history shows only 600000 for this kind; unseen remote history/binary archives not audited |
| 0: defects with severity | **Met** | High/medium/low findings above |
| 1: fix only confirmed critical categories; regressions fail before/pass after | **Met** | Credential logging and password-field retention tests observed red then green; no invented primitive replacement |
| 2: 16 MiB before file read; strict object/kind/version/unknown/duplicate/base64 validation | **Met** | Named limit, lexical duplicate pass after JSON grammar validation, file.text-not-called spy, encoded-text guard |
| 2: bounded v1/v2 parameters and salt/IV/tag/ciphertext; huge iterations rejected <100 ms before KDF | **Met** | Header matrix spies importKey; zero WebCrypto calls, threshold assertion passed |
| 2: nonempty import password, cap 1024, no trim | **Met** | Boundary tests, spaced fixture and exact v1 encoding |
| 2: explicit payload schema, cookie domains and closed cookie-name allowlist | **Partially met** | Types/keys/bounds/domain/syntax enforced; closed-name list conflicts with all-name capture contract and is intentionally not guessed |
| 2: preview/explicit confirmation; no preconfirmation writes; atomic failure behavior | **Met in automated module tests; browser durability partial** | Private cloned payload/token, expiry/cancel/replay/runtime-boundary tests, one storage item write; crash/disk-failure behavior not established |
| 2: generic wrong-password/tamper/truncation errors; no raw exception leakage | **Met** | Crypto/schema/message errors sanitized; future-version message intentionally separate |
| 3: evaluate Argon2 gate in order and record evidence | **Partially met** | Candidate and license/CSP reviewed; equivalent-CSP probes in both engines; installed-extension/library/lifecycle/low-end gates not established, therefore explicit PBKDF2 fallback |
| 3: v2 AES-256, fresh salt/IV, shared exact header AAD, NFKC only for v2, non-extractable keys | **Met** | Known-answer/independent AAD/Unicode/1000-real-export tests and code |
| 3: minimum 12, confirmation, visible warning, recovery/session/device copy | **Met** | UI and shared policy; optional passphrase button omitted |
| 3: PBKDF2 ≥600000, tune to low-end target 0.5–1 s | **Partially met** | 600000 retained; no low-end device available, so target cannot be verified |
| 4: explicit dispatch/no downgrade; v1 notice/manual-only re-export | **Met** | Cross-version tests and popup notice; originals never written |
| 4: older version rejects v2 without data changes | **Met with wording caveat** | Original reader rejection tested; old wording is generic unsupported/invalid, cannot retroactively say update |
| 4: interrupted export cannot report success; import atomic | **Partially met** | Existing download-settlement wait retained; model-tested import; actual interrupted browser download/shutdown not exercised |
| 5: v1/v2 sizes/Unicode/original fixtures; header/tag/ciphertext/parameter tamper; malformed inputs/password bounds | **Met for implemented formats** | Node matrices and both engines' 0/1 KiB/1 MiB round trips/fixtures; no Argon2 tests needed |
| 5: known-answer tests verified against primary sources | **Met** | Both RFC 7914 section 11 vectors and published Wycheproof AES-GCM vector |
| 5: 1000 export salt/IV uniqueness | **Met** | Actual PBKDF2 export loop passed, 213289.6686 ms |
| 5: no secret leakage; payload/cookie/confirmation tests | **Met in harnesses** | Console/storage spies, byte-buffer erasure/non-extractability assertions, rejected-cookie logs, authorization/preview/expiry tests |
| 5: Chrome/Firefox round trips and cross-browser restore | **Met for packaged crypto modules; installed extension partial** | Real engine results JSON; no installed extension UI/API/lifecycle test |
| 5: 30-run device/browser benchmarks, median/p95 and memory | **Partially met** | Real Chrome/Firefox/workstation values above; low-end and Argon2 memory unavailable/not applicable |
| 5: lint/type-check/unit tests/production builds | **Partially met** | Node tests/syntax checks and both builds passed; baseline has no linter, TypeScript config or type-check command |
| 6: format/threat model/limitations/changelog/release notes | **Met** | Linked documents and README/CHANGELOG updates |
| 6: dependency and remote-code/store-policy review | **Met as source review; certification not claimed** | Zero dependencies, local-only new modules, no added permission/CSP; no CWS/AMO submission/reviewer validation |

## Not executed / remaining release work

* Installed Chrome/Firefox extension import/export UI, runtime-message serialization against actual APIs, popup closure/worker termination, interrupted download and real storage failure/crash tests. Module/harness checks do not substitute for those.
* Low-end-device benchmark target and memory profiling: no low-end hardware available, no Argon2 binary included.
* Argon2 vendoring/integrity/license/update-policy and RFC Argon2id vector: not applicable to selected PBKDF2 implementation; adoption gate not met.
* Dedicated lint/type-check commands: none existed; no heavy tooling/dependency added just to manufacture a passing check. JS syntax checked in all 21 modules.
* Formal CWS/AMO validation or publication: not performed; version bump/store assets and deployment intentionally not part of this local hardening change.
* Full UI visual/accessibility review, exhaustive fuzzing, and every browser API cookie field variation are not claimed. No real backup/password was requested or needed for fixtures.

Open risks include password guessing, ciphertext length leakage, unencrypted saved-session storage, JS memory-erasure limits, worker lifetime retries, concurrent non-import storage writers and the documented open-ended cookie-name compatibility tradeoff. See [threat-model.md](threat-model.md). These outstanding checks mean this is **not a claim that every phase is production-release complete**.
