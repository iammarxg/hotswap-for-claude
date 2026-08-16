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
})();
