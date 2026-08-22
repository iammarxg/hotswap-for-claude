// blob-capture-init.js
//
// Runs in the MAIN world (the real page's JS realm) at document_start.
// Hooks URL.createObjectURL, anchor clicks, and global click dispatchers to
// capture 100% of binary file exports in memory and suppress rogue native
// browser "Save As" prompts during chat exports.

(function () {
  if (window.__claudeExportBlobPatchInstalled) return;
  window.__claudeExportBlobPatchInstalled = true;

  window.__claudeExportBlobRegistry = new Map(); // objectUrl -> { objectUrl, blob, dataUrl, filename, mimeType, timestamp }
  window.__claudeLastCapturedBlob = null;

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);

  URL.createObjectURL = function (obj) {
    const objectUrl = originalCreateObjectURL(obj);
    try {
      if (obj instanceof Blob || (typeof File !== "undefined" && obj instanceof File)) {
        const item = {
          objectUrl,
          blob: obj,
          dataUrl: null,
          size: obj.size,
          mimeType: obj.type || "application/octet-stream",
          filename: obj.name || null,
          timestamp: Date.now(),
        };
        window.__claudeExportBlobRegistry.set(objectUrl, item);

        // Pre-read into dataUrl
        const reader = new FileReader();
        reader.onload = () => {
          item.dataUrl = reader.result;
        };
        reader.readAsDataURL(obj);

        if (window.__claudeExportBlobRegistry.size > 100) {
          const oldest = window.__claudeExportBlobRegistry.keys().next().value;
          window.__claudeExportBlobRegistry.delete(oldest);
        }
      }
    } catch (e) {
      // Best-effort
    }
    return objectUrl;
  };

  function captureAnchorDetails(a) {
    const href = a.getAttribute("href") || a.href || "";
    const downloadName = a.getAttribute("download") || a.download || "";
    if (!href) return null;

    let item = window.__claudeExportBlobRegistry.get(href);
    if (!item) {
      item = {
        objectUrl: href,
        blob: null,
        dataUrl: href.startsWith("data:") ? href : null,
        filename: downloadName || null,
        mimeType: "application/octet-stream",
        timestamp: Date.now(),
      };
      window.__claudeExportBlobRegistry.set(href, item);
    }
    if (downloadName) {
      item.filename = downloadName;
    }
    window.__claudeLastCapturedBlob = item;
    return item;
  }

  // 1. Hook programmatic HTMLAnchorElement.prototype.click
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      const isExportActive =
        document.documentElement.getAttribute("data-claude-export-active") === "true";
      const href = this.getAttribute("href") || this.href || "";

      if (href && (href.startsWith("blob:") || href.startsWith("data:"))) {
        captureAnchorDetails(this);
        if (isExportActive) {
          return; // Suppress native browser download dialog during export
        }
      }
    } catch (e) {
      // Pass-through
    }
    return originalAnchorClick.apply(this, arguments);
  };

  // 2. Capture-phase global click interceptor for event-dispatched downloads
  document.addEventListener(
    "click",
    (e) => {
      const isExportActive =
        document.documentElement.getAttribute("data-claude-export-active") === "true";
      if (!isExportActive) return;

      const a = e.target?.closest?.("a[download], a[href^='blob:'], a[href^='data:']");
      if (a) {
        captureAnchorDetails(a);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  // 3. Hook window.fetch to capture completion stream SSE & 429 rate limit usage limits (Free Plan support)
  function parseSseWindow(win, isExceeded) {
    if (!win) return null;
    let percentage = 0;
    if (win.status === "exceeded_limit" || isExceeded) {
      percentage = 100;
    } else if (typeof win.utilization === "number") {
      percentage = Math.min(100, Math.max(0, Math.round(win.utilization * 100)));
    } else if (typeof win.percent === "number") {
      percentage = Math.min(100, Math.max(0, Math.round(win.percent)));
    } else {
      return null;
    }
    const resetsAt = win.resets_at ? new Date(win.resets_at).getTime() : null;
    return { percentage, resetsAt };
  }

  function parseSseLimitsPayload(payload, isExceeded) {
    if (!payload) return null;
    const windows = payload.windows || payload;
    let sessionWin = null;
    let weeklyWin = null;

    if (Array.isArray(windows)) {
      sessionWin = windows.find((w) => w.kind === "session" || w.window_type === "five_hour");
      weeklyWin = windows.find((w) => w.kind === "weekly_all" || w.window_type === "seven_day");
    } else if (typeof windows === "object") {
      sessionWin = windows.five_hour || windows.session || null;
      weeklyWin = windows.seven_day || windows.weekly || null;
    }

    const session = parseSseWindow(sessionWin, isExceeded);
    const weekly = parseSseWindow(weeklyWin, isExceeded);

    if (!session && !weekly) return null;
    return { session, weekly };
  }

  function dispatchSseUsageUpdate(orgId, sseLimits) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "SSE_USAGE_UPDATE",
          orgId,
          sseLimits,
        }).catch(() => {});
      }
    } catch (e) {}

    window.dispatchEvent(
      new CustomEvent("HotSwapSseUsageUpdate", {
        detail: { orgId, sseLimits },
      })
    );
  }

  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await originalFetch.apply(this, arguments);

    try {
      const urlStr = typeof input === "string" ? input : input instanceof Request ? input.url : "";
      if (urlStr && urlStr.includes("/completion")) {
        const orgMatch = urlStr.match(/\/organizations\/([a-f0-9-]+)\//i);
        const orgId = orgMatch ? orgMatch[1] : null;

        // Case A: HTTP 200 SSE stream
        if (response.ok && response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
          const [stream1, stream2] = response.body.tee();
          (async () => {
            try {
              const reader = stream2.getReader();
              const decoder = new TextDecoder();
              let buffer = "";

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (trimmed.startsWith("data:")) {
                    const dataStr = trimmed.slice(5).trim();
                    if (!dataStr || dataStr === "[DONE]") continue;
                    try {
                      const eventData = JSON.parse(dataStr);
                      const limitPayload =
                        eventData.message_limit ||
                        eventData.message?.message_limit ||
                        eventData.windows;
                      if (limitPayload && orgId) {
                        const parsed = parseSseLimitsPayload(limitPayload, false);
                        if (parsed) dispatchSseUsageUpdate(orgId, parsed);
                      }
                    } catch (e) {}
                  }
                }
              }
            } catch (err) {}
          })();

          return new Response(stream1, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }

        // Case B: HTTP 429 Refused Send (Rate limit exceeded)
        if (response.status === 429) {
          response.clone().json().then((errJson) => {
            try {
              let limitPayload = null;
              if (errJson?.error?.message_limit) {
                limitPayload = errJson.error.message_limit;
              } else if (typeof errJson?.error?.message === "string") {
                try {
                  const nested = JSON.parse(errJson.error.message);
                  limitPayload = nested?.message_limit || nested;
                } catch (e) {}
              }

              if (limitPayload && orgId) {
                const parsed = parseSseLimitsPayload(limitPayload, true);
                if (parsed) dispatchSseUsageUpdate(orgId, parsed);
              }
            } catch (e) {}
          }).catch(() => {});
        }
      }
    } catch (e) {}

    return response;
  };

})();
