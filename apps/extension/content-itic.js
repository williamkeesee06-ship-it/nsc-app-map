console.log("[NSC-ITIC] ITIC content script loaded.");

// Helper to inject code into the page world (needed to trigger jQuery events)
function injectPageWorldCode(fn, args) {
  const script = document.createElement("script");
  script.textContent = `(${fn.toString()})(${JSON.stringify(args || {})});`;
  document.documentElement.appendChild(script);
  script.remove();
}

// Create a notification banner at the top of the ITIC page
let bannerEl = null;
function showBanner(message, type = "info") {
  if (bannerEl) bannerEl.remove();

  bannerEl = document.createElement("div");
  bannerEl.style.position = "fixed";
  bannerEl.style.top = "0";
  bannerEl.style.left = "0";
  bannerEl.style.width = "100%";
  bannerEl.style.padding = "12px 20px";
  bannerEl.style.zIndex = "999999";
  bannerEl.style.fontWeight = "bold";
  bannerEl.style.fontSize = "16px";
  bannerEl.style.fontFamily = "sans-serif";
  bannerEl.style.boxShadow = "0 2px 10px rgba(0,0,0,0.2)";
  bannerEl.style.display = "flex";
  bannerEl.style.justifyContent = "space-between";
  bannerEl.style.alignItems = "center";
  bannerEl.style.boxSizing = "border-box";

  if (type === "success") {
    bannerEl.style.backgroundColor = "#22c55e";
    bannerEl.style.color = "#ffffff";
  } else if (type === "warning") {
    bannerEl.style.backgroundColor = "#eab308";
    bannerEl.style.color = "#1e293b";
  } else {
    bannerEl.style.backgroundColor = "#1d4ed8";
    bannerEl.style.color = "#ffffff";
  }

  const textSpan = document.createElement("span");
  textSpan.innerText = message;
  bannerEl.appendChild(textSpan);

  const closeBtn = document.createElement("button");
  closeBtn.innerText = "✕";
  closeBtn.style.background = "none";
  closeBtn.style.border = "none";
  closeBtn.style.color = "inherit";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.fontSize = "18px";
  closeBtn.style.padding = "0 8px";
  closeBtn.onclick = () => bannerEl.remove();
  bannerEl.appendChild(closeBtn);

  document.body.appendChild(bannerEl);
}

// Mapped equipment mapping logic matching the backend itic.ts
const EQUIPMENT_MAP = {
  auger: "Auger",
  backhoe: "Backhoe/Trackhoe",
  trackhoe: "Backhoe/Trackhoe",
  excavator: "Backhoe/Trackhoe",
  boring: "Directional Drilling",
  "directional boring": "Directional Drilling",
  "directional drilling": "Directional Drilling",
  bulldozer: "Bulldozer",
  dozer: "Bulldozer",
  drilling: "Drilling",
  explosives: "Explosives",
  "farm equipment": "Farm Equipment",
  grader: "Grader/Scraper",
  scraper: "Grader/Scraper",
  "hand tools": "Hand Tools",
  hand: "Hand Tools",
  milling: "Milling",
  probing: "Probing Device",
  "probing device": "Probing Device",
  trencher: "Trencher",
  vacuum: "Vacuum Equipment",
  "vacuum equipment": "Vacuum Equipment",
};

function mapEquipment(equipmentList) {
  const out = new Set();
  for (const e of equipmentList || []) {
    const key = e.trim().toLowerCase();
    out.add(EQUIPMENT_MAP[key] || "Unknown/Other");
  }
  return [...out];
}

// Core execution function running periodically
async function runAutomation() {
  chrome.storage.local.get(["activeTicket", "step1_done", "step2_done"], async (store) => {
    const ticket = store.activeTicket;
    if (!ticket) return;

    const url = window.location.href;

    // ── LOGIN PAGE ──────────────────────────────────────────────────────────
    if (url.includes("/login") || document.querySelector('input[placeholder="Username"]')) {
      // Look for credentials saved in storage if they exist
      chrome.storage.local.get(["iticUsername", "iticPassword"], (creds) => {
        const usernameInput = document.querySelector('input[placeholder="Username"]');
        const passwordInput = document.querySelector('input[placeholder="Password"]');
        const loginButton = document.querySelector('button'); // First button or matches log in

        if (usernameInput && passwordInput && creds.iticUsername && creds.iticPassword) {
          usernameInput.value = creds.iticUsername;
          passwordInput.value = creds.iticPassword;
          usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
          passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
          showBanner("NSC Copilot: Logging you in...", "info");
          setTimeout(() => {
            const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Log in"));
            if (btn) btn.click();
          }, 500);
        } else {
          showBanner("NSC Copilot: Please log in to your ITIC account.", "warning");
        }
      });
      return;
    }

    // ── DASHBOARD PAGE ───────────────────────────────────────────────────────
    if (url.includes("/excavatorTickets") || document.querySelector("select option[value*='business days']")) {
      showBanner("NSC Copilot: Starting ticket creation...", "info");
      
      const select = Array.from(document.querySelectorAll("select")).find(s => {
        return Array.from(s.options).some(o => o.text.includes("2 full business days"));
      });

      if (select) {
        select.value = Array.from(select.options).find(o => o.text.includes("2 full business days")).value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        
        // Find split-button "Create job ticket" or "Create"
        const createButton = Array.from(document.querySelectorAll("button")).find(b => 
          b.textContent.includes("Create") || b.textContent.includes("Go")
        );
        if (createButton) {
          setTimeout(() => createButton.click(), 500);
        }
      }
      return;
    }

    // ── STEP 1: LOCATES / DRAW ───────────────────────────────────────────────
    if (url.includes("Step1") || document.querySelector('input[placeholder="Search place or address"]')) {
      if (store.step1_done) {
        showBanner("NSC Copilot: Address searched. Please draw your locates on the map, then click Next.", "warning");
        return;
      }

      const addressInput = document.querySelector('input[placeholder="Search place or address"]');
      if (addressInput) {
        showBanner("NSC Copilot: Searching address...", "info");
        addressInput.focus();
        addressInput.value = ticket.address;
        addressInput.dispatchEvent(new Event("input", { bubbles: true }));

        // Trigger Google places suggestions selection
        setTimeout(() => {
          // Trigger keydowns to select the first autocomplete option
          const keydownDown = new KeyboardEvent("keydown", { keyCode: 40, bubbles: true });
          const keydownEnter = new KeyboardEvent("keydown", { keyCode: 13, bubbles: true });
          addressInput.dispatchEvent(keydownDown);
          setTimeout(() => {
            addressInput.dispatchEvent(keydownEnter);
            chrome.storage.local.set({ step1_done: true });
            showBanner("NSC Copilot: Address found! Please draw the locates and click Next.", "success");
          }, 500);
        }, 1500);
      }
      return;
    }

    // ── STEP 2: DETAILS FORM ─────────────────────────────────────────────────
    if (url.includes("Step2") || document.querySelector("textarea#location")) {
      if (store.step2_done) {
        showBanner("NSC Copilot: Step 2 autofilled. Review the details, and click Next to submit.", "warning");
        return;
      }

      showBanner("NSC Copilot: Autofilling ticket details...", "info");

      // Set marking instructions
      const locTextarea = document.querySelector("textarea#location");
      if (locTextarea) {
        locTextarea.value = ticket.markingInstructions || "";
        locTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      }

      // Set remarks/hazards
      const remarksTextarea = document.querySelector("textarea#remarks1");
      if (remarksTextarea) {
        remarksTextarea.value = ticket.markingInstructions; // default to marking
        remarksTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      }

      // Set work type
      const workTypeInput = document.querySelector("input#type_of_work");
      if (workTypeInput) {
        workTypeInput.value = ticket.workType || "PED SWAP";
        workTypeInput.dispatchEvent(new Event("input", { bubbles: true }));
      }

      // Set directional boring select
      const boringSelect = document.querySelector("select#boring");
      if (boringSelect) {
        boringSelect.value = ticket.directionalBoring ? "Yes" : "No";
        boringSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Set white lined select
      const whiteLinedSelect = document.querySelector("select#area_marked");
      if (whiteLinedSelect) {
        whiteLinedSelect.value = ticket.whiteLined ? "Yes" : "No";
        whiteLinedSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Set work done for
      const forField = document.querySelector("input#work_done_for");
      if (forField) {
        forField.value = ticket.workDoneFor || "LUMEN";
        forField.dispatchEvent(new Event("input", { bubbles: true }));
      }

      // Inject Page World JS to set Date and Multiselect equipment via jQuery
      const mappedEquipment = mapEquipment(ticket.equipment);
      injectPageWorldCode(({ dateStr, options }) => {
        const jq = window.$ || window.jQuery;
        if (!jq) return;

        // Start Date
        const dateEl = document.querySelector("input#tkt-A-start-date");
        if (dateEl) {
          let targetDate = "";
          const dp = jq(dateEl).data("datepicker");
          if (dp && dp.settings && dp.settings.minDate) {
            const minDate = dp.settings.minDate;
            if (minDate instanceof Date) {
              const m = String(minDate.getMonth() + 1).padStart(2, "0");
              const d = String(minDate.getDate()).padStart(2, "0");
              const y = minDate.getFullYear();
              targetDate = `${m}/${d}/${y}`;
            } else if (typeof minDate === "string") {
              targetDate = minDate;
            }
          }
          if (!targetDate) {
            const msg = jq("#tkt-A").data("msg");
            if (msg && msg.tm_default_str) {
              targetDate = msg.tm_default_str.split(" ")[0];
            }
          }
          if (!targetDate) targetDate = dateStr;
          
          dateEl.value = targetDate;
          jq(dateEl).trigger("change");
        }

        // Time
        const timeEl = document.querySelector("input#timepicker");
        if (timeEl) {
          timeEl.value = "12:00 AM";
          jq(timeEl).trigger("change");
        }

        // Equipment Select
        const selectEl = document.querySelector("select#type_of_equipment");
        if (selectEl) {
          Array.from(selectEl.options).forEach(opt => {
            opt.selected = options.some(o => opt.text.toLowerCase().replace(/\s+/g, "") === o.toLowerCase().replace(/\s+/g, ""));
          });
          jq(selectEl).trigger("change");
          if (jq(selectEl).multiselect) {
            jq(selectEl).multiselect("refresh");
          }
        }
      }, { dateStr: ticket.workToBeginDate, options: mappedEquipment });

      chrome.storage.local.set({ step2_done: true });
      showBanner("NSC Copilot: Step 2 autofilled! Please review and click Next.", "success");
      return;
    }

    // ── STEP 3: SUBMIT / CONFIRMATION ────────────────────────────────────────
    if (url.includes("Step3")) {
      showBanner("NSC Copilot: Final review step. Click Submit to file the ticket.", "warning");
      return;
    }

    // Check if we are on the confirmation screen or if ticket number is present
    const bodyText = document.body.innerText || "";
    let ticketNumber = "";
    
    // Check ticket number selectors
    const numEl = document.querySelector(".ticket-number, [data-ticket-number], #ticketNumber");
    if (numEl) {
      ticketNumber = numEl.textContent.trim();
    }
    
    if (!ticketNumber) {
      const m = bodyText.match(/ticket\s*(?:#|number|no\.?)\s*:?\s*([A-Z0-9-]{5,})/i) || bodyText.match(/\b(\d{8,})\b/);
      if (m) ticketNumber = m[1].trim();
    }

    if (ticketNumber && ticketNumber.length >= 5) {
      showBanner(`NSC Copilot: Found Ticket #${ticketNumber}! Syncing back to NSC App...`, "success");
      chrome.runtime.sendMessage({
        type: "FILING_FINISHED",
        ticketNumber: ticketNumber
      }, () => {
        chrome.storage.local.remove(["step1_done", "step2_done"]);
      });
    }
  });
}

// Run immediately and every 1.5 seconds
runAutomation();
setInterval(runAutomation, 1500);
