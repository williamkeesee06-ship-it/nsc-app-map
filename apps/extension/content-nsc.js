console.log("[NSC-CS] Content script loaded on NSC Map App");

// Listen for messages from the NSC Web App (React)
window.addEventListener("message", (event) => {
  // Security check: only listen to messages from the same window
  if (event.source !== window) return;

  if (event.data?.type === "NSC_START_ITIC_AUTOMATION") {
    console.log("[NSC-CS] Request to start ITIC automation received", event.data.payload);
    chrome.runtime.sendMessage({
      type: "START_FILING",
      payload: event.data.payload
    }, (response) => {
      console.log("[NSC-CS] Background script responded:", response);
    });
  }
});

// Listen for messages from the Background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[NSC-CS] Message from background:", message);
  if (message.type === "ITIC_FILING_COMPLETED") {
    window.postMessage({
      type: "NSC_ITIC_FILING_COMPLETED",
      ticketNumber: message.ticketNumber
    }, "*");
    sendResponse({ status: "delivered_to_page" });
  }
});
