let nscTabId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[NSC-BG] Message received:", message);

  if (message.type === "START_FILING") {
    nscTabId = sender.tab ? sender.tab.id : null;
    chrome.storage.local.set({ activeTicket: message.payload }, () => {
      chrome.tabs.create({ url: "https://wa.itic.occinc.com" });
      sendResponse({ status: "started" });
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === "FILING_FINISHED") {
    if (nscTabId) {
      chrome.tabs.sendMessage(nscTabId, {
        type: "ITIC_FILING_COMPLETED",
        ticketNumber: message.ticketNumber
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[NSC-BG] Failed to message NSC App tab. Maybe it was closed.");
        }
      });
    }
    chrome.storage.local.remove("activeTicket", () => {
      sendResponse({ status: "cleared" });
    });
    return true;
  }
});
