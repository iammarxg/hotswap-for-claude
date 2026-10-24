// MAIN-world usage observer. Downloads and DOM prototypes are never intercepted.
(function () {
  if (window.__hotSwapUsageObserverInstalled) return;
  window.__hotSwapUsageObserverInstalled = true;
  // ---------- Completion Stream SSE & 429 Interceptor (Free Plan Usage Engine) ----------

  const COMPLETION_RE = /^https?:\/\/([a-z0-9-]+\.)?claude\.ai\/api\/organizations\/([^/]+)\/chat_conversations\/([^/]+)\/(retry_)?completion/i;
  const COMPLETION_SIMPLE_RE = /\/api\/organizations\/([^/]+)\/.*completion/i;

  function parseSseWindow(win, isExceeded) {
    if (!win) return null;
    let percentage = 0;
    const isExceededStatus = win.status === "exceeded_limit" || isExceeded;
    if (isExceededStatus) {
      percentage = 100;
    } else if (typeof win.utilization === "number") {
      percentage = Math.min(100, Math.max(0, Math.round(win.utilization * 100)));
    } else if (typeof win.percent === "number") {
      percentage = Math.min(100, Math.max(0, Math.round(win.percent)));
    } else {
      return null;
    }

    let resetsAt = null;
    if (typeof win.resets_at === "number") {
      resetsAt = win.resets_at < 1e11 ? win.resets_at * 1000 : win.resets_at;
    } else if (typeof win.resets_at === "string") {
      resetsAt = new Date(win.resets_at).getTime();
    } else if (typeof win.resetsAt === "number") {
      resetsAt = win.resetsAt < 1e11 ? win.resetsAt * 1000 : win.resetsAt;
    } else if (typeof win.resetsAt === "string") {
      resetsAt = new Date(win.resetsAt).getTime();
    }

    return { percentage, resetsAt };
  }

  function parseMessageLimitObject(limitObj, isExceeded) {
    if (!limitObj) return null;
    const windows = limitObj.windows || limitObj;
    let sessionWin = null;
    let weeklyWin = null;

    if (Array.isArray(windows)) {
      sessionWin = windows.find((w) => w.kind === "session" || w.window_type === "five_hour" || w.window_type === "5h");
      weeklyWin = windows.find((w) => w.kind === "weekly_all" || w.window_type === "seven_day" || w.window_type === "7d");
    } else if (typeof windows === "object") {
      sessionWin = windows["5h"] || windows.five_hour || windows.session || null;
      weeklyWin = windows["7d"] || windows.seven_day || windows.weekly || null;
    }

    const session = parseSseWindow(sessionWin, isExceeded);
    const weekly = parseSseWindow(weeklyWin, isExceeded);

    if (!session && !weekly) return null;
    return { session, weekly };
  }

  function postSseLimitsToBridge(orgId, sseLimits) {
    if (!orgId || !sseLimits) return;
    window.postMessage(
      {
        type: "HotSwapSseUsage",
        orgId,
        sseLimits,
      },
      window.location.origin
    );
  }

  async function handle429Rejection(clone, orgId) {
    try {
      const json = await clone.json();
      let limitPayload = null;
      if (json?.error?.message_limit) {
        limitPayload = json.error.message_limit;
      } else if (typeof json?.error?.message === "string") {
        try {
          const parsed = JSON.parse(json.error.message);
          limitPayload = parsed?.message_limit || parsed;
        } catch {}
      }

      if (limitPayload) {
        const limits = parseMessageLimitObject(limitPayload, true);
        if (limits) {
          postSseLimitsToBridge(orgId, limits);
        }
      }
    } catch (e) {}
  }

  async function pumpSseStream(clone, orgId) {
    try {
      const reader = clone.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) processSseChunk(buffer, orgId);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          processSseChunk(buffer.slice(0, boundary), orgId);
          buffer = buffer.slice(boundary + 2);
        }
      }
    } catch (e) {}
  }

  function processSseChunk(chunk, orgId) {
    if (!chunk || !chunk.includes("message_limit")) return;
    const lines = chunk.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const evt = JSON.parse(jsonStr);
          if (evt?.type === "message_limit" || evt?.message_limit) {
            const limitPayload = evt.message_limit || evt;
            const parsed = parseMessageLimitObject(limitPayload, false);
            if (parsed) {
              postSseLimitsToBridge(orgId, parsed);
            }
          }
        } catch (e) {}
      }
    }
  }

  const prevFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await prevFetch.apply(this, args);

    try {
      const input = args[0];
      let url =
        typeof input === "string"
          ? input
          : input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.href
          : "";

      if (url.startsWith("/")) url = window.location.origin + url;

      let orgId = null;
      const match = COMPLETION_RE.exec(url) || COMPLETION_SIMPLE_RE.exec(url);
      if (match) {
        orgId = match[2] || match[1];
      }

      if (orgId) {
        const isSse = response.headers.get("content-type")?.includes("event-stream");
        if (response.ok && response.body && isSse) {
          pumpSseStream(response.clone(), orgId);
        } else if (response.status === 429) {
          handle429Rejection(response.clone(), orgId);
        }
      }
    } catch (e) {}

    return response;
  };
})();
