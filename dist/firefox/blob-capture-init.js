// blob-capture-init.js
//
// Runs in the MAIN world (the real page's JS realm) at document_start.
// Intercepts URL.createObjectURL and programmatic anchor downloads before
// Claude's bundle executes. When an export is active, captures 100% of
// generated files as base64 Data URLs and suppresses rogue native browser
// "Save As" popups from interrupting the export.
(function () {
  if (window.__claudeExportBlobPatchInstalled) return;
  window.__claudeExportBlobPatchInstalled = true;

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const blobRegistry = new Map(); // objectUrl -> { dataUrl, size, mimeType, timestamp, filename }

  URL.createObjectURL = function (obj) {
    const objectUrl = originalCreateObjectURL(obj);
    try {
      if (obj instanceof Blob || (typeof File !== "undefined" && obj instanceof File)) {
        const reader = new FileReader();
        reader.onload = () => {
          const detail = {
            objectUrl,
            dataUrl: reader.result,
            size: obj.size,
            mimeType: obj.type || "application/octet-stream",
            filename: obj.name || null,
            timestamp: Date.now(),
          };
          blobRegistry.set(objectUrl, detail);

          // Keep cache bounded
          if (blobRegistry.size > 50) {
            const oldest = blobRegistry.keys().next().value;
            blobRegistry.delete(oldest);
          }

          document.dispatchEvent(
            new CustomEvent("__claude_export_blob_captured", { detail })
          );
        };
        reader.readAsDataURL(obj);
      }
    } catch (e) {
      // Best-effort — never break Claude's native download flow
    }
    return objectUrl;
  };

  // Intercept anchor click downloads
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      const href = this.href || "";
      const downloadName = this.getAttribute("download") || this.download || "";
      const isExportActive =
        document.documentElement.getAttribute("data-claude-export-active") === "true";

      if (href && (href.startsWith("blob:") || href.startsWith("data:"))) {
        let detail = blobRegistry.get(href);
        if (!detail) {
          detail = {
            objectUrl: href,
            dataUrl: href.startsWith("data:") ? href : null,
            filename: downloadName || null,
            timestamp: Date.now(),
          };
          blobRegistry.set(href, detail);
        } else if (downloadName) {
          detail.filename = downloadName;
        }

        document.dispatchEvent(
          new CustomEvent("__claude_export_anchor_clicked", { detail })
        );

        // During extension export, suppress the browser's native download
        // prompt so it doesn't open the Save As dialog in whatever random
        // folder the browser last used.
        if (isExportActive) {
          return;
        }
      }
    } catch (e) {
      // Pass-through
    }
    return originalAnchorClick.apply(this, arguments);
  };
})();
