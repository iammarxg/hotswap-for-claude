# Backup threat model

## Assets and boundaries

Backups contain saved account cookie snapshots, including potentially active Claude session credentials, labels, email and usage metadata. A cookie can grant account access without the account password. Treat exported files and their passwords as credentials. No password reset/recovery mechanism exists for backup encryption.

`background.js:getProfiles/saveProfiles` reads/writes raw profiles in **chrome.storage.local, without application encryption**. The separate Gemini IndexedDB vault is encrypted with a browser-held key; it is not account-snapshot encryption and its API key is not exported. File encryption protects exported backups, not all data at rest on the device. User-confirmed import intentionally persists restored session snapshots as the product requires.

## Adversaries

| Adversary | Protection and limit |
| --- | --- |
| File thief | AES-256-GCM with PBKDF2-SHA-256 slows offline guessing. Long, unique passwords dominate security. No server or telemetry receives the password. |
| Offline guesser | A fresh random salt prevents shared precomputation. PBKDF2 is not memory-hard and specialized hardware can attack guesses in parallel. 600000 iterations is a floor, not a password-strength guarantee. |
| File modifier | GCM authentication and strict parameter validation reject corrupt ciphertext and valid-format header edits. v2 additionally binds the full supported header in AAD. v1 preserves its original fixed AAD. |
| Malicious valid backup creator | Encryption cannot establish who created a file: an attacker can choose their own password and session. Complete schema/domain validation and explicit labels/count preview prevent automatic application; users must still trust the backup's source. Labels themselves are untrusted and rendered with textContent. |
| Compromised browser/OS or malware | Out of scope for export encryption: attackers can read storage, capture input, use live sessions, alter the extension, inspect process memory or intercept plaintext. Non-extractable keys restrict API export, not a compromised execution environment. |

## Remaining risks and deliberate tradeoffs

* Ciphertext length reveals approximate payload size; no padding is added.
* PBKDF2 is not memory-hard. Argon2id was considered, but not adopted without the required installed Chrome/Firefox CSP, lifecycle, maintained vendored implementation and low-end timing/memory evidence. WASM adds a dependency and is generally slower than equivalent native implementation; no such performance claim was measured here because no Argon2 binary ships. No new dependency/name/version/hash/update policy applies to this implementation.
* JS strings/objects and browser IPC/internal WebCrypto copies cannot be reliably wiped. Explicit byte buffers are cleared and password fields are cleared before any submit validation; cancellation/navigation clears forms. The staged plaintext clone expires or is discarded and is never written before confirmation.
* Import writes one profiles storage item. Test coverage models a failed storage commit without a preceding partial write. Real browser crash/disk failure durability is not established by a unit test. Other existing account operations are not globally transactional with import; they can race concurrent storage writers. This change does not redesign unrelated account storage.
* Worker restart during preview loses its confirmation token, safely requiring the user to unlock again. PBKDF2 remains in the existing background context; a long-running or interrupted request must be retried. No Argon2 job is launched in a bare worker. Installed-browser popup/worker shutdown and interrupted-download tests remain release validation items.
* Cookie names are open-ended by product design: only syntax and size are bounded, while domains are explicitly limited to Claude. A closed name list cannot preserve the current capture contract. Newly introduced cookie/schema fields require an intentional compatibility review instead of silent acceptance.
* v1 cryptography stays byte compatible. New structural/schema limits can reject old files containing malformed, oversized, unexpected profile fields; no claim is made that every historically arbitrary input is safe or restorable. Committed authentic-writer fixtures and both browsers' generated v1 round trips provide bounded compatibility evidence.
* Advisory strength checks are simple and cannot estimate offline cracking cost. No strength-estimation dependency or optional passphrase generator is included.

## Dependency and policy review

No new runtime/development package dependencies, no WASM, no remote code loading, no CSP or permission expansion. All new imports are packaged local modules. Existing optional Gemini network features are outside backup crypto and unchanged. The implementation is consistent with the remote-code restrictions in [Chrome MV3 policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements) and [Firefox Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/); this is a source review, **not** a store certification or reviewer acceptance claim. No store submission was made.

Reconsidering Argon2 requires pinned source/binary/license review (including embedded C), integrity hashes and update policy, both installed-extension CSP tests, a stable page/Worker context, low-end benchmarks and peak memory measurements. [hash-wasm](https://github.com/Daninet/hash-wasm) was inspected as a candidate (top-level MIT license; embedded source licenses still need review), but no version was selected, vendored or certified as meeting that gate.
