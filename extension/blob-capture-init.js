// blob-capture-init.js
// Runs in the MAIN world at document_start on https://claude.ai/*
// 1. Hooks URL.createObjectURL and HTMLAnchorElement.prototype.click for in-memory chat export capture.
// 2. Hooks window.fetch to capture live completion SSE streams and HTTP 429 rate limit errors for Free Plan usage tracking.

(function () {
  if (window.__claudeExportBlobPatchInstalled) return;
  window.__claudeExportBlobPatchInstalled = true;

  window.__claudeExportBlobRegistry = new Map();
  window.__claudeLastCapturedBlob = null;

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);

  URL.createObjectURL = function (obj) {
    const objectUrl = originalCreateObjectURL(obj);
    try {
      const isBlob =
        obj &&
        (obj instanceof Blob ||
          (typeof File !== "undefined" && obj instanceof File) ||
          (typeof obj.size === "number" && typeof obj.slice === "function"));
      if (isBlob) {
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
        window.__claudeLastCapturedBlob = item;

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
    } catch (e) {}
    return objectUrl;
  };

  URL.revokeObjectURL = function (url) {
    try {
      const isExportActive =
        document.documentElement.getAttribute("data-claude-export-active") === "true";
      if (isExportActive) {
        setTimeout(() => {
          try {
            originalRevokeObjectURL(url);
          } catch (e) {}
        }, 30000);
        return;
      }
    } catch (e) {}
    return originalRevokeObjectURL(url);
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

    if (!item.dataUrl && (href.startsWith("blob:") || href.startsWith("http"))) {
      fetch(href)
        .then((r) => r.blob())
        .then((b) => {
          item.blob = b;
          item.mimeType = b.type || item.mimeType;
          const reader = new FileReader();
          reader.onload = () => {
            item.dataUrl = reader.result;
          };
          reader.readAsDataURL(b);
        })
        .catch(() => {});
    }

    return item;
  }

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = function (tag, options) {
    const el = originalCreateElement(tag, options);
    if (typeof tag === "string" && tag.toLowerCase() === "a") {
      try {
        const origDispatch = el.dispatchEvent.bind(el);
        el.dispatchEvent = function (event) {
          const isExportActive =
            document.documentElement.getAttribute("data-claude-export-active") === "true";
          captureAnchorDetails(el);
          if (isExportActive) {
            try {
              event.preventDefault?.();
              event.stopPropagation?.();
            } catch (e) {}
            return false;
          }
          return origDispatch(event);
        };
        const origClick = el.click.bind(el);
        el.click = function () {
          const isExportActive =
            document.documentElement.getAttribute("data-claude-export-active") === "true";
          captureAnchorDetails(el);
          if (isExportActive) {
            return;
          }
          return origClick();
        };
      } catch (e) {}
    }
    return el;
  };

  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      const isExportActive =
        document.documentElement.getAttribute("data-claude-export-active") === "true";
      const href = this.getAttribute("href") || this.href || "";

      if (href) {
        captureAnchorDetails(this);
        // Suppress native browser download prompt during active export so files are packed
        // neatly into the export ZIP rather than creating stray browser downloads.
        if (isExportActive) {
          return;
        }
      }
    } catch (e) {}
    return originalAnchorClick.apply(this, arguments);
  };

  const originalAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function (child) {
    try {
      if (
        child &&
        (child.tagName === "A" || child.nodeName === "A") &&
        (child.hasAttribute?.("download") || child.download)
      ) {
        captureAnchorDetails(child);
        const downloadName = child.getAttribute("download") || child.download || "";
        window.__claudeExportedFilenames = window.__claudeExportedFilenames || new Map();
        if (downloadName) {
          window.__claudeExportedFilenames.set(downloadName.toLowerCase(), Date.now());
        }
        const normName = (downloadName || "").toLowerCase();
        const lastExportedAt = window.__claudeExportedFilenames.get(normName);
        const isRecentlyExported = lastExportedAt && Date.now() - lastExportedAt < 15000;
        const isExportActive =
          document.documentElement.getAttribute("data-claude-export-active") === "true";
        if (isExportActive || isRecentlyExported) {
          child.click = function () {
            captureAnchorDetails(child);
            return false;
          };
          try {
            child.addEventListener(
              "click",
              (e) => {
                captureAnchorDetails(child);
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                return false;
              },
              true
            );
          } catch (e) {}
        }
      }
    } catch (e) {}
    return originalAppendChild.call(this, child);
  };

  document.addEventListener(
    "click",
    (e) => {
      const isExportActive =
        document.documentElement.getAttribute("data-claude-export-active") === "true";
      if (!isExportActive) return;

      let el = e.target;
      while (el && el !== document.documentElement) {
        if (el.tagName === "A" && (el.href || el.getAttribute("href"))) {
          captureAnchorDetails(el);
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        el = el.parentElement;
      }
    },
    true
  );

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
