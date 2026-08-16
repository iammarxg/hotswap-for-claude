// blob-capture-init.js
//
// Runs in the MAIN world (the real page's JS realm, not the isolated
// content-script world) at document_start — before claude.ai's own bundle
// has loaded or executed a single line. That timing is the whole point:
// if this override installs after Claude's bundle has already run, any
// reference Claude's own code cached to the original URL.createObjectURL
// (e.g. `const c = URL.createObjectURL` at module init, which minified
// bundlers do routinely) would keep pointing at the untouched original,
// and our override would never see those calls — confirmed by testing:
// the export flow correctly found and clicked Claude's real Download
// button, but a same-turn createObjectURL override installed later never
// fired ("blob captured: false" on every attempt). Installing here, before
// Claude's code exists at all, means every reference Claude's code takes —
// cached or not — resolves to our wrapped version, because there is no
// "original" left to cache by the time its bundle runs.
//
// export-page-script.js runs later, in the isolated content-script world,
// which does NOT share this window object — so state can't be handed over
// directly. Instead this dispatches a DOM CustomEvent (the DOM itself is
// shared across worlds) carrying the already-base64-encoded file the
// moment it's ready, and export-page-script.js just listens for it.
(function () {
  if (window.__claudeExportBlobPatchInstalled) return;
  window.__claudeExportBlobPatchInstalled = true;

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);

  URL.createObjectURL = function (obj) {
    const objectUrl = originalCreateObjectURL(obj);
    try {
      if (obj instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          document.dispatchEvent(
            new CustomEvent("__claude_export_blob_captured", {
              detail: {
                objectUrl,
                dataUrl: reader.result,
                size: obj.size,
                mimeType: obj.type,
              },
            })
          );
        };
        // Best-effort — if reading fails for any reason, we simply never
        // dispatch the event and export-page-script.js's wait times out,
        // falling back to its existing native-download-capture path.
        reader.readAsDataURL(obj);
      }
    } catch (e) {
      // Never let our instrumentation break Claude's own download flow.
    }
    return objectUrl;
  };
})();
