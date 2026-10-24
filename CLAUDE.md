# HotSwap for Claude: contributor and agent guide

HotSwap is a Manifest V3 browser extension for Claude account switching, usage monitoring, chat exports, optional Gemini summaries, and encrypted account backups. The runtime uses native browser APIs and ES modules without a bundler or third-party runtime dependencies.

## Start here

1. Inspect `git status --short` and preserve existing work. Check `package.json` for available checks and `extension/manifest.json` for the packaged version and permissions.
2. Edit `extension/` for runtime changes. The ignored `src/` tree is an older private implementation that intentionally differs; copying it over `extension/` would lose newer backup and export work.
3. Read [docs/development.md](docs/development.md) for architecture, focused validation, packaging, and release caveats. For backup changes, also read [the format specification](docs/security/backup-format.md) and [threat model](docs/security/threat-model.md).
4. Run checks appropriate to the change and report which passed, failed, or could not run. Keep documentation aligned with changed behavior; documentation-only edits do not require a release version bump.

## Current development state

Reviewed against this checkout on 2026-10-24:

- The source manifest is **1.3.2**, published on GitHub for Claude's redesigned chat and file-viewer UI. The workflow and all five public assets were verified; browser-store upload kits remain prepared locally. Future publication actions require their own authorization.
- The exporter uses authenticated conversation/file reads, an extension-owned runner, and acknowledged chunks. Focused Node, DOM fallback, installed Brave/Firefox exports and backup smoke checks pass. Live reader checks recovered all nine supplied branches/files. Personal Brave acceptance also passed: the actual exported ZIP preserved 12 turns, 2,000 numbered lines and 43 files with matching hashes; a native individual download completed. See the export notes for evidence.
- For export changes, read [the export development notes](docs/export-development.md), which own the observed Claude routes, completeness rules, and current validation status. Preserve existing local changes rather than restoring the reverted beta wholesale.
- Fleet summary and account color tags were removed in 1.3.0; pinning, themes, per-account usage, notifications, and onboarding remain.

## Invariants

- Account switching clears/restores local cookies. Never invoke Claude's server logout endpoint: it revokes saved sessions.
- MAIN-world scripts have no extension runtime access. Keep injected functions self-contained and use the ISOLATED bridge for page usage events. Treat page-originated data as untrusted.
- Claude SSE windows use `5h` and `7d`; normalize seconds to milliseconds before comparing reset times. Preserve free-plan fallback and elapsed-reset normalization.
- Build popup UI with safe DOM APIs (`textContent`, `createElement`, `replaceChildren`); avoid `innerHTML` assignments and inline executable scripts.
- New backups use format v2. Preserve exact v1 password/AAD semantics, legacy plaintext reads, popup-only backup commands, validated preview, and one-use confirmation before the single profile write. The format specification owns algorithm parameters and limits.
- Gemini keys stay in the background-only encrypted IndexedDB vault. Return configured status to the popup; keep keys, cookies, backup passwords, and raw credential-bearing errors out of logs and fixtures.
- Optional summaries send selected conversation content directly to Google. Account backups, chat ZIPs, and Gemini summaries have different privacy boundaries; chat ZIPs are unencrypted.
- Leave native download behavior intact. Export files through authenticated reads, bind privileged operations to the registered runner/source tab, and report incomplete scans or files explicitly. The document-start script observes usage only.

## Repository and publication boundaries

Tracked contributor material includes `extension/`, `tests/`, `docs/`, root package files, `CLAUDE.md`, public assets, and the release workflow. Inspect the Git index rather than assuming every local file is public.

`src/`, `scripts/`, `website/`, `store-assets/`, `dist/`, `temp/`, `MEMORY.md`, `ROADMAP.md`, and deployment helpers are private or generated local material. Public clones may lack them. Use synthetic account data and conversations for committed fixtures and evidence.

Build and test locally within the task's scope. Pushing commits/tags, triggering release Actions, deploying the website, and store submissions require explicit user authorization for that action. Prior release authorization does not authorize a future release. Published tags/releases remain immutable; use forward-only, non-force publication.

For a release, use semantic versioning and concise entries in `CHANGELOG.md`. Attach the full changelog alongside version-specific notes and browser packages. Refresh corresponding local store kits when private tooling/assets are available. See the release caveats in [docs/development.md](docs/development.md) before invoking the preparation helper.

For website work in a maintainer checkout, start with `website/README.md`; deployment instructions live in `website/DEPLOY-UI.md` (dashboard) and `website/DEPLOY.md` (CLI). Private `MEMORY.md` and `ROADMAP.md` track maintainer handoffs and backlog rather than overriding the checked-in runtime guide.
