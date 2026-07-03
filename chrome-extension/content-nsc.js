// NSC App Map bridge (runs on https://nsc-app-map.vercel.app/*).
//
// The web app posts the current job's 811 data over window.postMessage on the
// NSC_811_JOB_DATA channel when the "Open ITIC" modal opens. We stash it into
// chrome.storage.local so the ITIC-side content script (running inside the
// embedded iframe, a different origin) can read it and drive the autofill.
//
// ITIC cookies are HttpOnly, so there is no session handoff here — the iframe
// simply reuses the user's existing wa.itic.occinc.com session. This bridge
// only moves the *job data*.
(function () {
  "use strict";

  const CHANNEL = "NSC_811_JOB_DATA";
  const STORAGE_KEY = "nsc811Job";

  window.addEventListener("message", (event) => {
    // Only trust messages from this same page (the app posts to its own window).
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== CHANNEL || !data.payload) return;

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
})();
