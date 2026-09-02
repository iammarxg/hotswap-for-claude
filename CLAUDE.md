# HotSwap for Claude - Claude Code Instructions

## Project Overview
HotSwap for Claude is a privacy-first Manifest V3 browser extension that enables seamless management of multiple Claude.ai accounts within a single browser profile. It solves the friction of managing multiple Claude.ai accounts by providing instant hot-swapping without logging out, real-time usage monitoring, session keep-alive, and AI-powered conversation summarization.

## Key Features
- **Instant Hot-Swapping**: Switch between saved Claude accounts without logging out using cookie snapshotting
- **Usage Monitoring**: Real-time 5-hour session and 7-day weekly limit tracking for all account types (Free, Pro, Max, Team)
- **Session Keep-Alive**: Background refreshes to prevent cookie expiration via sequential profile exercising
- **Unified Theme Engine**: Three curated palettes (Midnight, Claude Light, Claude Dark) with zero-flash bootstrap
- **Gemini AI Summarizer**: Context handoff summaries using gemini-3.5-flash-lite copied to clipboard
- **Lossless Chat Exporter**: ZIP archives with full conversation transcript, thoughts, and attachments
- **Privacy-First**: All data stored exclusively in chrome.storage.local - zero telemetry or external dependencies

## Technical Architecture
The extension operates across 4 execution realms with strict security boundaries:

1. **Page Context (claude.ai)**:
   - `blob-capture-init.js` (MAIN world): Intercepts fetch, SSE streams, HTTP 429 errors, ObjectURLs
   - `sse-bridge-content.js` (ISOLATED world): Has chrome.runtime access, listens to window.postMessage

2. **Background Service Worker** (`background.js`):
   - Orchestrates cookies (chrome.cookies), storage (chrome.storage.local), alarms, network requests
   - Manages SSE usage cache, cookie snapshots, usage endpoint queries, session keep-alive

3. **Extension Popup** (`popup.js`/`popup.css`):
   - Renders responsive UI, monitors quota resets, triggers exports and profile swaps
   - Handles account management, settings, tools, and keyboard shortcuts

4. **Injected Export Script** (`export-page-script.js`):
   - Traverses virtualized chat DOM, captures messages, extracts attachments
   - Auto-expands Claude thought processes, handles artifact downloads

## Development & Build Instructions
- Source files: `src/` directory
- Build command: `python package.py` (creates distributable ZIPs in `dist/`)
- Load unpacked: Select `dist/chrome` folder in chrome://extensions
- Publishing: `python scripts/publish_release.py` (creates clean public mirror - always includes CHANGELOG.md)

## Release Guidelines
- **Changelog Attachment**: Every public GitHub release **must** include the CHANGELOG.md file
- **Feature/Bug Changes**: Document all changes in CHANGELOG.md using maximum 1-3 sentences per item (concise, actionable descriptions)
- **Changelog Format**: Follow Keep a Changelog format with clear version headers and categorized sections (Added, Changed, Fixed, etc.)

## Local vs Public Git
This repository maintains a private monorepo with a clean public mirror for open-source distribution:
- **Local/Private**: All files including `src/`, `scripts/`, `website/`, `store-assets/`, `MEMORY.md`, `ROADMAP.md` are kept in the private repository
- **Public Mirror**: Only the extension source (`extension/`), assets, `package.py`, `README.md`, `CHANGELOG.md`, and `.github/workflows/` are published to GitHub
- Files **NOT** to push to public git: `src/`, `scripts/`, `website/`, `store-assets/`, `MEMORY.md`, `ROADMAP.md`, internal development branches
- The `scripts/publish_release.py` script creates a clean export mirror that excludes internal files

## Git Workflow Requirements
- **Private Git**: Frequent commits and pushes to the private repository are **strongly encouraged** to track changes, enable easy rollback of breaking changes, and maintain proper version history
- **Public GitHub**: All commits and pushes to the public GitHub repository **require manual approval** and must go through the official release process using `scripts/publish_release.py`
- Never push private/internal files (`src/`, `scripts/`, etc.) to public GitHub - the publish script handles creating the clean public mirror

## Important Files
- `manifest.json`: Extension configuration, permissions, content scripts, background worker
- `background.js`: Core logic for cookie management, usage tracking, session refresh
- `export-page-script.js`: Conversation DOM scraping and attachment handling
- `popup.js`: UI logic and communication with background worker
- `zip-builder.js`: Lossless ZIP bundler for chat exports
- `ARCHITECTURE.md`: Detailed technical overview (internal)
- `ROADMAP.md`: Feature backlog and architectural principles (internal, gitignored)
- `MEMORY.md`: Project brain and operations manual (internal, gitignored)
- `CHANGELOG.md`: Release notes - **always attached to public GitHub releases**

## Security & Privacy Guarantees
- Zero external telemetry - all data remains in chrome.storage.local
- Local session isolation - tokens never leave browser storage
- No credential logging - direct browser-to-claude.ai exchanges only
- CSP-compliant popup (no inline scripts)
- Minimal required permissions: cookies, storage, tabs, scripting, downloads, alarms
- Host permissions limited to claude.ai and generativelanguage.googleapis.com domains

## Current Version
v1.1.2

## Support
- Website: https://hotswap.jeddah.dev
- Support: support@jeddah.dev
- Chrome Web Store: nnpnmjhealgmnbinplmccegkecabcpdk
- Firefox Add-ons: hotswap-for-claude@extension

## License
Internal source: Private (not for redistribution)
Public mirror: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
See LICENSE file for details.