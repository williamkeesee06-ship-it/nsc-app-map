// ITIC driver (runs on https://wa.itic.occinc.com/*, incl. inside the app's
// embedded iframe via all_frames:true).
//
// It reuses the user's EXISTING ITIC session (cookies are HttpOnly, so there is
// no session handoff — the iframe just shares the logged-in session). Given the
// job data captured from the app (chrome.storage.local), it:
//   dashboard (/excavatorTickets) → select "2 full business days ticket"
//   /createTicketStep1            → type the address, keyboard-pick the first
//                                   suggestion, then STOP and show a banner so
//                                   the user draws the shape by hand
//   /createTicketStep2            → autofill the known text fields, leaving any
//                                   field we can't positively identify BLANK
//
// Selector logic mirrors the verified server bot (functions/src/itic.ts):
//   - dashboard <select> resolved by the option "2 full business days ticket"
//   - address via keyboard ArrowDown+Enter, NOT a .pac-item click
// The extension NEVER draws the shape or touches Google Maps internals — that
// was the old bot's failure mode.
(function () {
  "use strict";

  const STORAGE_KEY = "nsc811Job";
  const TICKET_TYPE_MATCH = /2\s+full\s+business\s+days/i;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getJob() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (res) => resolve(res && res[STORAGE_KEY]));
      } catch {
        resolve(null);
      }
    });
  }

  // React guards <input>/<textarea> value assignment with its own tracker, so a
  // plain `el.value = x` is ignored. Use the native prototype setter, then fire
  // a bubbling input event so React's synthetic onChange sees the new value.
  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function pressKey(el, key, keyCode) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(
        new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          key,
          code: key,
          keyCode,
          which: keyCode,
        })
      );
    }
  }

  async function waitFor(predicate, timeout = 10000, interval = 250) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = predicate();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  // ── floating status banner ────────────────────────────────────────────────
  function banner(text, tone) {
    const id = "nsc811-banner";
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.style.cssText = [
        "position:fixed",
        "top:12px",
        "left:50%",
        "transform:translateX(-50%)",
        "z-index:2147483647",
        "max-width:520px",
        "padding:10px 16px",
        "border-radius:8px",
        "font:600 13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
        "box-shadow:0 6px 24px rgba(0,0,0,.35)",
        "pointer-events:none",
      ].join(";");
      document.body.appendChild(el);
    }
    const colors =
      tone === "warn"
        ? "background:#5a3b00;color:#ffe0b2;border:1px solid #ffb347"
        : tone === "error"
          ? "background:#5a1f1f;color:#ffd6d6;border:1px solid #ff6b6b"
          : "background:#0d3b2e;color:#c9ffe9;border:1px solid #2fe6a8";
    el.style.cssText += ";" + colors;
    el.textContent = "NSC bot: " + text;
  }

  // getByLabel-equivalent: resolve a form control from its visible label text,
  // falling back to aria-label. Returns null if not confidently found — callers
  // must then leave the field BLANK rather than guess.
  function findByLabel(regex) {
    for (const lab of document.querySelectorAll("label")) {
      if (!regex.test((lab.textContent || "").trim())) continue;
      if (lab.htmlFor) {
        const byId = document.getElementById(lab.htmlFor);
        if (byId) return byId;
      }
      const nested = lab.querySelector("input, textarea, select");
      if (nested) return nested;
    }
    for (const el of document.querySelectorAll("[aria-label]")) {
      if (regex.test(el.getAttribute("aria-label") || "")) return el;
    }
    return null;
  }

  function fillField(regex, value) {
    if (value == null || value === "") return false;
    const el = findByLabel(regex);
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return false;
    el.focus();
    setNativeValue(el, value);
    fireInput(el);
    return true;
  }

  // ── page: dashboard → pick "2 full business days ticket" ────────────────────
  async function runDashboard() {
    // Resolve the create-ticket <select> the same way the server bot does: the
    // one whose option list contains the ticket type (NOT the DataTables length
    // selector, which has only numeric options).
    const select = await waitFor(() => {
      for (const sel of document.querySelectorAll("select")) {
        for (const opt of sel.options) {
          if (TICKET_TYPE_MATCH.test(opt.textContent || "")) return { sel, opt };
        }
      }
      return null;
    }, 15000);

    if (!select) {
      banner("couldn't find the 'Create job ticket' menu — start it manually.", "warn");
      return;
    }
    // Native single-select: setting the value + dispatching change fires the
    // portal's navigation to Step 1. Do NOT click the <select>.
    select.sel.value = select.opt.value;
    select.opt.selected = true;
    select.sel.dispatchEvent(new Event("change", { bubbles: true }));
    banner("opening a 2-day ticket…", "ok");
  }

  // ── page: Step 1 → type address, keyboard-pick suggestion, then STOP ────────
  async function runStep1(job) {
    const input = await waitFor(
      () => document.querySelector('input[placeholder="Search place or address"]'),
      15000
    );
    if (!input) {
      banner("address box not found — type the address yourself.", "warn");
      return;
    }
    const address = (job && job.address) || "";
    if (!address) {
      banner("no address in job data — type the address yourself.", "warn");
      return;
    }

    input.focus();
    setNativeValue(input, "");
    fireInput(input);
    // Type char-by-char so Google Places Autocomplete fires its input handlers.
    for (let i = 0; i < address.length; i++) {
      setNativeValue(input, address.slice(0, i + 1));
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: address[i], inputType: "insertText" })
      );
      await sleep(45);
    }

    // Wait for the suggestion dropdown to actually become visible.
    const pac = await waitFor(() => {
      const c = document.querySelector(".pac-container");
      return c && c.offsetParent !== null && c.querySelector(".pac-item") ? c : null;
    }, 8000);

    if (!pac) {
      banner("couldn't fill address automatically — please type it, then draw your shape.", "warn");
      return;
    }
    await sleep(400);
    // Keyboard nav (NOT a .pac-item click — that races Google's hidden/rebuilt
    // dropdown; keyboard selection is the verified-reliable path).
    pressKey(input, "ArrowDown", 40);
    await sleep(150);
    pressKey(input, "Enter", 13);

    // Address placed. STOP here — the user draws the shape by hand.
    banner("address filled — draw your shape, then hit Next when ready.", "ok");
  }

  // ── page: Step 2 → autofill known text fields only ──────────────────────────
  async function runStep2(job) {
    if (!job) {
      banner("no job data — fill Step 2 manually.", "warn");
      return;
    }
    // Give the Step 2 form a moment to render.
    await waitFor(() => document.querySelector("input, textarea, select"), 10000);

    const filled = [];
    // Verified label selectors from functions/src/itic.ts writeInstructions().
    if (fillField(/work being done for/i, job.excavator || "LUMEN")) filled.push("work-for");
    if (fillField(/work to begin date/i, job.workToBegin)) filled.push("work-to-begin");
    if (fillField(/type of work/i, job.workType)) filled.push("type-of-work");
    if (fillField(/location of work/i, job.markingInstructions)) filled.push("location-of-work");
    if (fillField(/remarks/i, job.markingInstructions)) filled.push("remarks");

    // NOTE: we deliberately do NOT touch fields whose mapping isn't in the job
    // payload / isn't a verified selector — directional drilling, area white
    // lined, excavation equipment, begin time. Leave them for the user rather
    // than guess. Duration is fixed at 45 on 2-day tickets (already correct).
    // TODO(itic): if these become part of the payload, add verified selectors.

    if (filled.length) {
      banner("filled: " + filled.join(", ") + ". Review the rest, then submit.", "ok");
    } else {
      banner("couldn't match Step 2 fields — fill them manually.", "warn");
    }
  }

  async function route() {
    const path = location.pathname;
    const job = await getJob();

    if (/\/excavatorTickets/i.test(path)) {
      if (!job) {
        banner("open ITIC from the NSC app's Request 811 button to enable autofill.", "warn");
        return;
      }
      await runDashboard();
    } else if (/\/createTicketStep1/i.test(path)) {
      await runStep1(job);
    } else if (/\/createTicketStep2/i.test(path)) {
      await runStep2(job);
    } else if (path === "/" || /login/i.test(path)) {
      // Cannot inject a session (HttpOnly cookies); the user logs in once and the
      // session persists for weeks. No credential autofill.
      banner("log in to ITIC once — your session persists, then reopen from the app.", "ok");
    }
  }

  // Storage may arrive slightly after this iframe loads (the app posts the job
  // data on modal open). Re-run once if the payload shows up late on a page
  // that needs it.
  route();
  let reran = false;
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY] || reran) return;
      if (/\/excavatorTickets/i.test(location.pathname)) {
        reran = true;
        route();
      }
    });
  } catch {
    /* storage API unavailable — nothing to do */
  }
})();
