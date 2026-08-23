# Changelog

All notable changes to **HotSwap for Claude** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
