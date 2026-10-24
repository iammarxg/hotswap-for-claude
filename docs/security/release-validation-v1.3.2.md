# v1.3.2 release candidate validation

2026-10-24. The maintainer requested local preparation for publication and a GitHub release. Publication, tagging, pushing and store submission remain separate actions.

## Runtime evidence

The export repair passed 29 focused Node checks, nine actual-reader DOM fallback checks, 14 installed Brave export checks and seven installed Firefox export checks. Chrome/Brave backup smoke passed 15 checks and Firefox backup smoke passed 13. Syntax checks cover 34 JavaScript modules. Existing crypto algorithms and backup formats were unchanged; previously passing expensive crypto/randomness checks were not repeated.

The maintainer's personal Brave session supplied live validation of nine conversation branches and all 26 referenced files. Dedicated Sonnet 5.5 Medium tests covered generated and uploaded formats, two same-named originals, an empty file, deterministic binary content and retried-answer selection. The actual HotSwap ZIP exported in the personal profile passed 45 entry CRCs, all 43 file hashes, all attachment links, the active branch, 12 turns and exactly 2,000 numbered lines. Native individual download completion was observed independently. [Export development](../export-development.md) owns the technical details and limits; personal content, identifiers and artifacts remain in ignored local storage.

## Publication and package checks

- `tests/release_policy.py`: three regression checks cover the explicit contributor-doc allowlist, private paths and traversal rejection. Its audit includes prospective untracked public files and deliberate deletions. The same checks run in the GitHub release workflow.
- The local preparer rebuilds all three extension ZIPs, refreshes separate Chrome/Firefox upload kits and extracts the current changelog section into release notes.
- `tests/release-packages.py` verifies archive CRCs, exact runtime bytes, browser manifests, module dependencies, default/Chrome equivalence, current notes/changelog, store package identity, listing policy, five correctly sized screenshots per browser and both upload kits. [Package hashes](release-package-results.json) record the local ZIPs.
- The store renderer uses the current popup with fictional data and a mocked export port. Five Chrome screenshots are 1280×800; five Firefox graphics are 2400×1800. Existing published release folders are preserved. The listing reflects the 12-character confirmed backup-password requirement and current export behavior.

The new note-content check caught stale v1.3.1 notes left after an earlier preparer interruption; the completed preparation replaced them. Comparisons normalize text line endings while package and changelog copies remain byte-checked.

## GitHub release materials

The release is titled **HotSwap for Claude v1.3.2**, dated October 24, 2026. The matching tag is `v1.3.2`, with the version-specific release body extracted from `CHANGELOG.md`. Required release assets are:

1. `hotswap-for-claude-chrome-v1.3.2.zip`
2. `hotswap-for-claude-firefox-v1.3.2.zip`
3. `hotswap-for-claude-v1.3.2.zip`
4. `CHANGELOG.md`
5. `RELEASE_NOTES.md`

At preparation time, remote `main` was `86d04618c12d7f7f6a235a7cac37d5bc572d1aae` and no remote `v1.3.2` tag existed. A local release-candidate snapshot can be based on that revision without rewriting the maintainer's existing beta commit or working tree. The workflow publishes only on an authorized matching tag push; ordinary main/manual builds do not publish. Local ZIP timestamps and platform line endings can change whole-archive hashes in CI without changing packaged source bytes.
