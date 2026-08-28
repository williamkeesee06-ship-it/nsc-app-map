// NSC App Map bridge (runs on the map app origin).
//
// Official 811 filing path (Roadmap C):
//   1. App opens IticModal → posts NSC_811_JOB_DATA
//   2. This script stores payload in chrome.storage.local
//   3. content-itic.js autofills ITIC (stops at map draw)
//   4. On success, posts NSC_811_FILED_SUCCESS back to the app
//
// Also answers NSC_PING_811 so the app can show "extension connected".
(function () {
  "use strict";

  const CHANNEL = "NSC_811_JOB_DATA";
  const STORAGE_KEY = "nsc811Job";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;

    // Health-check from TicketDetail
    if (data.type === "NSC_PING_811" || data.type === "NSC_PING_EXTENSION") {
      window.postMessage(
        { type: "NSC_PONG_811", extension: "nsc-811-autofill", version: "1.1.0" },
        window.location.origin
      );
      // Back-compat alias used by older UI code
      window.postMessage({ type: "NSC_PONG_EXTENSION" }, window.location.origin);
      return;
    }

    if (data.type !== CHANNEL || !data.payload) return;

    try {
      chrome.storage.local.set({
        [STORAGE_KEY]: data.payload,
        nsc811JobAt: Date.now(),
      });
      console.log("[NSC811] job data captured for ITIC autofill:", data.payload);
    } catch (err) {
      console.warn("[NSC811] failed to store job data:", err);
    }
  });

  // Bridge success from ITIC tab storage back into the React app
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.nsc811Success && changes.nsc811Success.newValue) {
        const success = changes.nsc811Success.newValue;
        console.log("[NSC811] success data received in bridge:", success);
        window.postMessage(
          {
            type: "NSC_811_FILED_SUCCESS",
            payload: success,
          },
          window.location.origin
        );
      }
    });
  } catch (err) {
    console.warn("[NSC811] failed to register storage change listener:", err);
  }
})();
