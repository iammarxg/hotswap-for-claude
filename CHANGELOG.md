# Changelog

All notable changes to **HotSwap for Claude** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v1.1.0] - 2026-08-31

### 🎨 Unified Theme Engine, Universal Gemini AI Summarizer & Lossless Chat Bundler

#### 🎨 Unified Theme Engine (3 Curated Palettes)
- **Midnight (Signature Default)**: High-contrast slate/obsidian palette (`#0d1117` / `#161b22`) with electric cyan & sapphire accents (`#58a6ff`).
- **Claude Light**: Authentic Claude.ai light mode aesthetic (`#FAF9F5` / `#FFFFFF`) with warm terracotta/clay accents (`#D97757`).
- **Claude Dark**: Authentic Claude.ai dark mode aesthetic (`#1F1E1D` / `#2B2A27`) with warm clay highlights.
- **Zero-Flash Bootstrap**: Synchronous pre-render theme bootstrap applying CSS custom variables instantly with 0ms FOUT.
- **Header Theme Toggle**: 1-click quick theme cycling button directly in the popup header.
- **Visual Theme Selector**: Settings tab features interactive theme cards with live color swatch indicators.
- **Typography Overhaul**: Standardized system font stack with aligned font-weight hierarchy (`600` titles, `500` labels, `400` body).

#### 🤖 Universal Gemini AI Context Handoff Summarizer
- **Native Gemini Integration**: Direct client-to-API summarization powered by Google's `gemini-3.5-flash-lite`.
- **Domain-Agnostic Context Handoff**: Generates high-density markdown briefs for any topic (coding, research, writing, business) structured to let a brand-new account resume work seamlessly:
  - 🎯 Core Objective & Topic
  - 📌 Context, Tools & Key References
  - 🚫 User Preferences, Constraints & Exclusions (including things the user explicitly does **NOT** want)
  - 💡 Key Decisions & Discoveries
  - 📦 What Was Produced / Accomplished
  - ⏭️ Current State & Next Steps (Handoff)
- **Zero File Download Overhead**: Summary extraction runs purely in memory (`skipDownloads: true`), leaving your system files untouched and copying markdown output straight to clipboard.
- **File & Code Content Option**: Optional inclusion of attached file and code artifact contents (capped at 30,000 chars) into the Gemini context window.
- **Local API Key Security**: User enters their own Gemini API key in Settings; stored securely in `chrome.storage.local` with zero telemetry.
- **Summary Hub & Preview Drawer**: Instant post-summarization hub with 1-click clipboard copy and collapsible markdown preview.

#### 📦 Lossless Chat Bundler & Workflow Enhancements
- **Separated Tool Suite**: `📄 Export Chat` (full offline ZIP backup) and `📋 Summarize Chat` (clipboard text summary) clearly distinguished.
- **Lossless In-Memory ZIP Bundler (`zip-builder.js`)**: Traverses virtualized chat DOM without truncation, auto-expands Claude 3.7 / extended thinking streams, and packages artifacts into a single `.zip` file with zero third-party dependencies.
- **Informative Settings UI**: Non-interactive save path display indicating the default destination (`Downloads/HotSwap-Claude-Exports/`).
- **Dynamic Shortcut Display**: Settings tab queries `chrome.commands.getAll()` live to render user's actual browser-configured keybindings.
- **Preference Persistence**: Checkbox toggles remember their state across popup sessions.
- **Hardened UI Message Bus**: Added timeout guards and `chrome.runtime.lastError` handling to prevent popup freezing.

---

## [v1.0.1] - 2026-08-23

### 🚨 Emergency Fix: Free Plan Usage Tracking

Anthropic's `GET /api/organizations/{orgId}/usage` endpoint returns HTTP 200 with all limit fields null and empty `limits: []` for accounts on the Claude Free plan. This release implements real-time usage extraction from chat completion streams and refused-send error responses.

#### ✨ Changes & Improvements
- **SSE Stream Interceptor**: Injected fetch hook in `blob-capture-init.js` intercepts `POST /api/organizations/{orgId}/chat_conversations/{chatId}/completion` and asynchronously extracts live 5-hour (`5h`) and 7-day (`7d`) usage windows from SSE `message_limit` events.
- **Refused Send (HTTP 429) Handling**: Extracts `message_limit` from 429 rate-limit responses and clamps session utilization to 100% when `status === "exceeded_limit"`, ensuring users see an accurate cap rather than stale under-reported usage.
- **ISOLATED World Bridge**: Added `sse-bridge-content.js` to cross the MV3 realm boundary and securely forward usage payloads to the background service worker.
- **Persistent Monotonic Cache**: Added `storeSseUsage` in `background.js` with an 8-day TTL and monotonicity protection against rounding jitter within the same reset window.
- **Graceful Fallback**: `fetchUsageForActiveSession()` falls back to unexpired SSE usage on `claude_free` accounts when the `/usage` endpoint reports null limits.
- **Informative UI Notice**: Popup displays `"Send a message on Claude.ai to view your current free-plan limits."` if no chat messages have been sent yet.

#### 🙏 Credits & Attribution
Special thanks and attribution to **[@lugia19](https://github.com/lugia19)** ([Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension)) for the research and reference implementation of free-plan stream usage extraction and 429 refusal parsing:
- [`a398f5f`](https://github.com/lugia19/Claude-Usage-Extension/commit/a398f5fb1e82d7843251fbd26633b91b0a672d60) — *feat: tell free-plan users why the usage UI is empty*
- [`fccc98b`](https://github.com/lugia19/Claude-Usage-Extension/commit/fccc98b80996ad2970dccdfd0d87f8fc4d2bdc0e) — *feat: source free-plan usage from the completion stream*
- [`2eb00b6`](https://github.com/lugia19/Claude-Usage-Extension/commit/2eb00b679cc211bed9aa1cc230c810392dfa16f2) — *feat: read usage from a refused send, so the free plan sees its own limit*

---

## [v1.0.0] - 2026-08-21

### Initial Release
- Multi-account session switching on Claude.ai without getting logged out.
- Real-time 5-hour session and weekly usage quota tracking.
- Session keepalive with periodic background cookie refreshing.
- Single-turn and multi-turn chat export to Markdown with attachment handling.
- Keyboard shortcuts for rapid account cycling and least-used account switching.
