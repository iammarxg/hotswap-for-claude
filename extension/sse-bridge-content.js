// sse-bridge-content.js
// Runs in the ISOLATED content script world on https://claude.ai/*
// Bridges window.postMessage from MAIN world (blob-capture-init.js) to the background service worker.

(function () {
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type !== "HotSwapSseUsage") return;

    const { orgId, sseLimits } = event.data;
    if (orgId && sseLimits && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "SSE_USAGE_UPDATE",
        orgId,
        sseLimits,
      }).catch(() => {});
    }
  });
})();
