// blob-capture-init.js
//
// Runs in the MAIN world (the real page's JS realm) at document_start.
// Intercepts URL.createObjectURL and programmatic anchor downloads before
// Claude's bundle executes, allowing 100% of generated attachments,
// artifacts, and exported files to be captured in-memory as base64 Data URLs.
(function () {
  if (window.__claudeExportBlobPatchInstalled) return;
  window.__claudeExportBlobPatchInstalled = true;

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const blobRegistry = new Map(); // objectUrl -> { dataUrl, size, mimeType, timestamp }

  URL.createObjectURL = function (obj) {
    const objectUrl = originalCreateObjectURL(obj);
    try {
      if (obj instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          const detail = {
            objectUrl,
            dataUrl: reader.result,
            size: obj.size,
            mimeType: obj.type || "application/octet-stream",
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
      const href = this.href;
      const downloadName = this.getAttribute("download") || this.download;
      if (href && (href.startsWith("blob:") || href.startsWith("data:"))) {
        const detail = blobRegistry.get(href) || {
          objectUrl: href,
          dataUrl: href.startsWith("data:") ? href : null,
          filename: downloadName,
          timestamp: Date.now(),
        };
        if (downloadName) detail.filename = downloadName;
        document.dispatchEvent(
          new CustomEvent("__claude_export_anchor_clicked", { detail })
        );
      }
    } catch (e) {
      // Pass-through
    }
    return originalAnchorClick.apply(this, arguments);
  };
})();
