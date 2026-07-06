// ITIC (WA Utilities Underground Location Center — wa.itic.occinc.com)
// automation via headless Chromium. Runs inside a Gen2 Cloud Function with a
// long timeout.
//
// The live portal is a single-page wizard, NOT a classic multi-field form:
//   Login → /excavatorTickets (dashboard) → /createTicketStep1 (mark location)
//         → /createTicketStep2 (instructions) → /createTicketStep3 (review/submit)
//
// The "create a ticket" affordance on the dashboard is a native <select>
// (styled as a split-button "Create job ticket"), not a link/button. Selectors
// are centralised in ITIC_SELECTORS so they can be re-verified against the live
// portal during deployment (README-811-DEPLOY.md → "Verifying ITIC selectors").
//
// Flow (auto-submit end-to-end, no operator review pause):
//   fillTicketForm  — dashboard → Step 1 (precise shape trace) → Step 2 (fill).
//   submitAndConfirm— advances Step 2 → Step 3, clicks Submit, reads back the
//                     assigned ticket number + expiration, and captures a PDF of
//                     the confirmation page.
import chromium from "@sparticuz/chromium";
import { chromium as playwright, type Browser, type Locator, type Page } from "playwright-core";
import type { DigShape, DigTicket, Job, LatLng, UtilityStatus } from "./types.js";

const ITIC_BASE = "https://wa.itic.occinc.com";
const STEP_TIMEOUT = 30_000; // per-action timeout (ms)

// Single source of truth for the live-portal selectors. Re-verify on deploy.
const ITIC_SELECTORS = {
  // Login page.
  usernameInput: 'input[placeholder="Username"]',
  passwordInput: 'input[placeholder="Password"]',
  loginButton: 'button:has-text("Log in")',
  // Dashboard: the create-ticket control is a native <select> styled as a
  // "Create job ticket" split-button. It is NOT the last <select> on the page
  // (that's the DataTables length selector). It is resolved at runtime by
  // findCreateTicketSelect(), which tries a chain of intuitive fingerprints.
  // Step 1 — mark location.
  addressSearch: 'input[placeholder="Search place or address"]',
  placeSuggestion: ".pac-item",
  drawPanelButton: 'img[src*="draw-white"]',
  // The Google Maps canvas container on Step 1. Multiple candidates are tried in
  // order so a markup change on the portal doesn't break the projection lookup.
  mapContainer: '#map, .gm-style, div[aria-label="Map"], div[role="region"][aria-label*="Map"]',
  // Step 3 — review/submit + confirmation number.
  submitButton: 'button:has-text("Submit")',
  ticketNumber: ".ticket-number, [data-ticket-number], #ticketNumber",
  // Utility response lookup (used by checkUtilityResponses).
  ticketLookupInput: "input[name='ticketNumber'], #ticketLookup",
  ticketLookupButton: "button:has-text('Look Up'), button:has-text('Search')",
  responseRow: "table.responses tbody tr, .utility-response",
  responseUtilityCell: ".utility-name, td:nth-child(1)",
  responseStatusCell: ".response-status, td:nth-child(2)",
};

// Default ticket type. "2 full business days" is our normal, non-emergency case.
const DEFAULT_TICKET_TYPE = "2 full business days ticket";

export interface IticCredentials {
  username: string;
  password: string;
}

// ── small mapping tables ───────────────────────────────────────────────────
// Our stored equipment strings → the ITIC listbox option labels.
const EQUIPMENT_MAP: Record<string, string> = {
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

function mapEquipment(equipment: string[]): string[] {
  const out = new Set<string>();
  for (const e of equipment ?? []) {
    const key = e.trim().toLowerCase();
    out.add(EQUIPMENT_MAP[key] ?? "Unknown/Other");
  }
  return [...out];
}

// ── geometry helpers ─────────────────────────────────────────────────────────
const EARTH_RADIUS_FT = 20_902_231; // mean Earth radius in feet

function feetBetween(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Radius (ft) approximating the dig area as a circle. For a stored radius we use
// it directly; otherwise we bound the shape with its bounding-circle (half the
// diagonal of the bounds box) so the "Radius excavation" flow safely covers it.
function computeRadiusFt(shape: DigShape): number {
  if (shape.type === "radius" && shape.radiusFt) return Math.round(shape.radiusFt);
  const b = shape.bounds;
  const sw: LatLng = { lat: b.swLat, lng: b.swLng };
  const ne: LatLng = { lat: b.neLat, lng: b.neLng };
  return Math.max(10, Math.round(feetBetween(sw, ne) / 2));
}

// ── date helpers ─────────────────────────────────────────────────────────────
// Soonest allowed start = today + N business days (weekends skipped). Federal
// holidays are NOT skipped yet — a simple weekend skip is acceptable for v1.
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}

function formatMDY(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// ── map projection helpers ─────────────────────────────────────────────────
// Convert a lat/lng to a pixel offset within the map container using the live
// latLngToPixel is removed in favor of direct center-clicking which is more robust.

// Poll until the live Google Maps projection is reachable so lat/lng→pixel
// conversion won't throw. getProjection() is undefined until the
// projection_changed event fires, which trails the map's first idle + tile
// load; picking the shape tool happens well before that, causing the race this
// gate closes. Uses the same map-handle discovery as latLngToPixel.
async function waitForMapProjection(page: Page, timeoutMs = 30_000): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const w = window as any;
        const map =
          (w.oimc && w.oimc.map && w.oimc.map.googleMap) ||
          ((document.querySelector("#oimc_mapCanvas") as any)?.__gm?.map);
        if (!map || typeof map.getProjection !== "function") return false;
        const proj = map.getProjection();
        return !!proj && typeof proj.fromLatLngToPoint === "function";
      },
      null,
      { timeout: timeoutMs, polling: 250 }
    );
  } catch (err) {
    // Dump the state of each candidate handle so a timeout is diagnosable from
    // the Firebase Function logs (which path was missing).
    const diag = await page
      .evaluate(() => ({
        hasOimc: !!(window as any).oimc,
        hasOimcMap: !!(window as any).oimc?.map,
        hasGoogleMap: !!(window as any).oimc?.map?.googleMap,
        hasCanvas: !!document.querySelector("#oimc_mapCanvas"),
        hasGm: !!(document.querySelector("#oimc_mapCanvas") as any)?.__gm,
      }))
      .catch(() => null);
    console.error(`[ITIC] waitForMapProjection timed out. Map handle diagnostics: ${JSON.stringify(diag)}`);
    throw err;
  }
}

// Click a lat/lng on the map canvas. Throws if the projection is unreachable so
// the caller can fall back to the address-search + radius flow.
async function clickLatLng(page: Page, lat: number, lng: number, dblclick = false): Promise<void> {
  // Center the map on the target LatLng first.
  // This ensures the point is visible on the screen and positioned correctly relative to the canvas.
  await page.evaluate(
    ({ lat, lng }) => {
      const w = window as any;
      const map =
        (w.oimc && w.oimc.map && w.oimc.map.googleMap) ||
        ((document.querySelector("#oimc_mapCanvas") as any)?.__gm?.map);
      if (map && w.google && w.google.maps) {
        map.setCenter(new w.google.maps.LatLng(lat, lng));
      }
    },
    { lat, lng }
  );

  // Give the map a moment to finish centering and render tiles
  await page.waitForTimeout(500);

  // Since the map was centered on (lat, lng), that coordinate is positioned exactly in the center of the canvas.
  // We can calculate the exact center pixel of the map canvas container element.
  const pos = await page.evaluate(() => {
    const el = document.querySelector("#oimc_mapCanvas") || document.querySelector("#map");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.width / 2), y: Math.round(r.height / 2) };
  });

  if (!pos) throw new Error("Map canvas element not found for center pixel click");

  const map = page.locator(ITIC_SELECTORS.mapContainer).first();
  if (dblclick) await map.dblclick({ position: pos, force: true });
  else await map.click({ position: pos, force: true });
}

// ── step wrapper: logging + screenshot-on-failure ────────────────────────────
// Logs each step, and on failure attaches a full-page screenshot to the thrown
// error (index.ts uploads it) so the failure state is visible in Cloud logs.
async function step<T>(page: Page, label: string, fn: () => Promise<T>): Promise<T> {
  console.log(`[ITIC] ${label}`);
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ITIC] FAILED at "${label}": ${message}`);
    try {
      const png = await page.screenshot({ fullPage: true, type: "png" });
      const wrapped = err instanceof Error ? err : new Error(message);
      (wrapped as Error & { screenshot?: Buffer }).screenshot = png;
      throw wrapped;
    } catch (shotErr) {
      if (shotErr === err) throw err;
      throw err instanceof Error ? err : new Error(message);
    }
  }
}

// Launch headless Chromium tuned for the Cloud Functions sandbox.
export async function launchBrowser(): Promise<Browser> {
  return playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

export async function login(page: Page, creds: IticCredentials): Promise<void> {
  page.setDefaultTimeout(STEP_TIMEOUT);
  await step(page, "Login: loading portal", async () => {
    await page.goto(`${ITIC_BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  });
  await step(page, "Login: entering credentials", async () => {
    await page.fill(ITIC_SELECTORS.usernameInput, creds.username);
    await page.fill(ITIC_SELECTORS.passwordInput, creds.password);
  });
  await step(page, "Login: submitting + awaiting dashboard", async () => {
    await page.click(ITIC_SELECTORS.loginButton);
    await page.waitForURL("**/excavatorTickets", { timeout: 60_000 });
  });
}

// Human-readable dig-site description used for the Remarks field.
function describeDigSite(ticket: DigTicket, job: Job): string {
  const s = ticket.shape;
  const geom =
    s.type === "radius"
      ? `${Math.round(s.radiusFt ?? 0)} ft radius circle`
      : s.type === "route"
        ? `${Math.round(s.perimeterFt / 2)} ft route, ${Math.round(s.widthFt ?? 0)} ft wide`
        : `polygon, ${Math.round(s.areaSqFt).toLocaleString()} sq ft`;
  return [
    `Work Order ${job.workOrder ?? job.jobId} at ${job.address ?? "site"}.`,
    `Excavation: ${geom} (approx ${Math.round(s.areaSqFt).toLocaleString()} sq ft).`,
  ]
    .filter(Boolean)
    .join(" ");
}

// ── Step 1: mark the dig location ─────────────────────────────────────────────
// Match the stored shape on ITIC precisely rather than converting everything to
// a bounding circle:
//   radius  → "Radius excavation": click the center, enter radiusFt.
//   route   → "Route excavation": click each path vertex in order.
//   polygon → "Other": click each vertex, then close the ring.
// Precise tracing depends on the live Google Maps projection being reachable
// (latLngToPixel). If it is not, we fall back to the address-search + radius
// bounding flow so filing still succeeds. Marking convention: White paint.
async function traceCircle(page: Page, shape: DigShape): Promise<void> {
  const center = shape.center ?? {
    lat: (shape.bounds.swLat + shape.bounds.neLat) / 2,
    lng: (shape.bounds.swLng + shape.bounds.neLng) / 2,
  };
  const radiusFt = computeRadiusFt(shape);
  await waitForMapProjection(page);
  // Tool already selected in the "opening drawing panel" step; just drop points.
  await clickLatLng(page, center.lat, center.lng);
  
  const radiusInput = page.locator("#oimc_circleRadius, input[type='number']").first();
  await radiusInput.waitFor({ state: "visible", timeout: 5000 });
  
  // Robust typing sequence: focus, click, type sequentially, and trigger keypresses (Enter & Tab)
  // to ensure all event listeners (input, change, keydown, keypress, keyup, blur) on the page fire correctly.
  await radiusInput.focus();
  await radiusInput.click();
  await radiusInput.fill("");
  await radiusInput.pressSequentially(String(radiusFt), { delay: 100 });
  await radiusInput.press("Enter");
  await radiusInput.press("Tab");
  
  // Wait a moment for the map drawing engine to render the circle
  await page.waitForTimeout(500);
}

async function traceRoute(page: Page, shape: DigShape): Promise<void> {
  const path = shape.path?.length ? shape.path : shape.vertices;
  if (path.length < 2) throw new Error("Route shape has fewer than 2 path points");
  await waitForMapProjection(page);
  // Tool already selected in the "opening drawing panel" step; just drop points.
  for (let i = 0; i < path.length; i++) {
    // Double-click the final vertex to finish the polyline.
    await clickLatLng(page, path[i].lat, path[i].lng, i === path.length - 1);
  }
}

async function tracePolygon(page: Page, shape: DigShape): Promise<void> {
  const verts = shape.vertices;
  if (verts.length < 3) throw new Error("Polygon shape has fewer than 3 vertices");
  await waitForMapProjection(page);
  // Tool already selected (incl. "Proceed to create polygon") in the opener step.
  for (const v of verts) await clickLatLng(page, v.lat, v.lng);
  // Close the ring: double-click the first vertex (standard polygon-close gesture).
  await clickLatLng(page, verts[0].lat, verts[0].lng, true);
}

async function traceShape(page: Page, shape: DigShape): Promise<void> {
  if (shape.type === "radius") return traceCircle(page, shape);
  if (shape.type === "route") return traceRoute(page, shape);
  return tracePolygon(page, shape);
}

async function markLocation(page: Page, ticket: DigTicket, job: Job): Promise<void> {
  const address = (job.address ?? "").trim();
  const shape = ticket.shape;

  await step(page, `Step 1: address search "${address}"`, async () => {
    if (!address) throw new Error("Job has no address to search for on the ITIC map");
    // Google Places Autocomplete appends ONE persistent .pac-container to <body>
    // and toggles it between display:none/block. Clicking a .pac-item races the
    // element while it's still hidden from a prior invocation, so we drive the
    // selection with the keyboard instead (verified reliable on the live portal).
    const addressInput = page.locator(ITIC_SELECTORS.addressSearch);
    await addressInput.click();
    await addressInput.fill(address);
    // Wait for the suggestions to actually become VISIBLE (not merely attached).
    await page.locator(".pac-container").first().waitFor({ state: "visible", timeout: 10_000 });
    // Give Google's async suggestions a beat to populate.
    await page.waitForTimeout(500);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    // Give the map a beat to zoom to the geocoded location before we later wait
    // for the drawing-tool opener to become visible.
    await page.waitForTimeout(1_500);
    // Confirm the selection landed. Prefer the ZIP appearing in the input value;
    // if the address has no ZIP, fall back to the pac-container going hidden
    // again (Google sets display:none once a suggestion is chosen).
    const zip = address.match(/\b\d{5}\b/)?.[0];
    if (zip) {
      await page.waitForFunction(
        (z) => {
          const el = document.querySelector(
            'input[placeholder="Search place or address"]',
          ) as HTMLInputElement | null;
          return !!el && el.value.includes(z);
        },
        zip,
        { timeout: 10_000 },
      );
    } else {
      await page.locator(".pac-container").first().waitFor({ state: "hidden", timeout: 10_000 });
    }
    // Let the map settle on the searched location before reading its projection.
    await page.waitForTimeout(2_000);
  });

  await step(page, "Step 1: opening drawing panel", async () => {
    // Two-step opener. The "Click for drawing tool" banner (draw-white.svg) is
    // injected after geocoding but can be display:none / opacity:0 during the map
    // zoom animation, so wait for VISIBLE (not mere DOM attachment) before click.
    const drawOpener = page.locator(ITIC_SELECTORS.drawPanelButton).first();
    await drawOpener.waitFor({ state: "visible", timeout: 15_000 });
    await drawOpener.click();

    // Pick the ITIC tool that matches the stored shape so fidelity is preserved.
    // The menu icons are circle-tool / route-tool / polygon-tool — NOT draw*.svg.
    const toolSelector =
      shape.type === "radius"
        ? 'a:has(img[src*="circle-tool"])'
        : shape.type === "route"
          ? 'a:has(img[src*="route-tool"])'
          : 'a:has(img[src*="polygon-tool"])';
    const toolButton = page.locator(toolSelector).first();
    await toolButton.waitFor({ state: "visible", timeout: 10_000 });
    await toolButton.click();

    // Polygon ("Other") pops a confirmation dialog that must be dismissed.
    if (shape.type === "polygon") {
      const proceedBtn = page.locator('button:has-text("Proceed to create polygon")');
      await proceedBtn.waitFor({ state: "visible", timeout: 5_000 });
      await proceedBtn.click();
    }
  });

  await step(page, `Step 1: tracing ${shape.type} shape`, async () => {
    // The matching tool is already selected in the opener step, so trace the
    // stored shape exactly. Never fall back to a different shape (e.g. a bounding
    // radius) — shape fidelity is required: radius=radius, route=route,
    // polygon=polygon. If tracing fails, the step wrapper screenshots and
    // rethrows so the run fails loudly rather than filing a wrong-shape ticket.
    await traceShape(page, shape);
  });

  await step(page, 'Step 1: "Mark around" → White paint', async () => {
    const markAround = page.getByLabel(/mark around/i);
    if ((await markAround.count()) > 0) {
      await markAround.selectOption({ label: "White paint" }).catch(async () => {
        await markAround.selectOption({ label: "White paint (default)" }).catch(() => {});
      });
    }
  });

  await step(page, "Step 1: Next → Step 2", async () => {
    await page.getByRole("button", { name: /next/i }).click();
    await page.waitForURL("**/createTicketStep2", { timeout: STEP_TIMEOUT });
  });
}

// ── Step 2: write instructions ────────────────────────────────────────────────
async function writeInstructions(page: Page, ticket: DigTicket, job: Job): Promise<void> {
  const specs = ticket.specs;

  await step(page, "Step 2: location of work + remarks", async () => {
    const loc = page.getByLabel(/location of work/i);
    if ((await loc.count()) > 0) await loc.fill(ticket.markingInstructions ?? "");
    const remarks = page.getByLabel(/remarks/i);
    if ((await remarks.count()) > 0) {
      await remarks.fill(ticket.hazardsWarning || describeDigSite(ticket, job));
    }
  });

  await step(page, "Step 2: work-begin date", async () => {
    // Soonest allowed start = today + 2 business days, at midnight (12:00 AM).
    const start = addBusinessDays(new Date(), 2);
    const dateField = page.getByLabel(/work to begin date/i);
    if ((await dateField.count()) > 0) await dateField.fill(formatMDY(start));
    const timeField = page.getByLabel(/^at$|begin time|work to begin time/i);
    if ((await timeField.count()) > 0) await timeField.fill("12:00 AM");
  });

  await step(page, "Step 2: type of work", async () => {
    // Pass the user-typed work type through verbatim — no MEC/HAND/BORE mapping.
    const tow = page.getByLabel(/type of work/i);
    if ((await tow.count()) > 0) await tow.fill(specs.workType);
  });

  await step(page, "Step 2: directional drilling / white lined", async () => {
    const drilling = page.getByLabel(/directional drilling/i);
    if ((await drilling.count()) > 0) {
      await drilling.selectOption({ label: specs.directionalBoring ? "Yes" : "No" });
    }
    const whiteLined = page.getByLabel(/area white lined/i);
    if ((await whiteLined.count()) > 0) {
      await whiteLined.selectOption({ label: specs.whiteLined ? "Yes" : "No" });
    }
  });

  await step(page, "Step 2: excavation equipment", async () => {
    const listbox = page.getByRole("listbox", { name: /excavation equipment/i });
    if ((await listbox.count()) === 0) return;
    for (const label of mapEquipment(specs.equipment)) {
      const opt = listbox.getByRole("option", { name: label, exact: false }).first();
      if ((await opt.count()) > 0) {
        await opt.click();
      } else {
        console.log(`[ITIC] Step 2: equipment option not found: "${label}"`);
      }
    }
  });

  await step(page, "Step 2: work being done for", async () => {
    const forField = page.getByLabel(/work being done for/i);
    if ((await forField.count()) > 0) await forField.fill("LUMEN");
  });
}

// Resolve the dashboard's "Create job ticket" <select>. We filter the page's
// <select> elements down to the one whose option list contains the exact ticket
// type we pick. That option list uniquely identifies the create-ticket control
// and avoids the DataTables pagination-length <select>, which also lives on the
// dashboard but has only numeric options.
function findCreateTicketSelect(page: Page): Locator {
  return page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: DEFAULT_TICKET_TYPE }) });
}

// Fill the ticket wizard through Step 2. Call submitAndConfirm() next to advance
// to Step 3, submit, and read back the assigned ticket number + expiration.
export async function fillTicketForm(page: Page, ticket: DigTicket, job: Job): Promise<void> {
  page.setDefaultTimeout(STEP_TIMEOUT);

  await step(page, "Dashboard: awaiting /excavatorTickets readiness", async () => {
    // The dashboard may still be rendering when we arrive from login. Wait for
    // the URL, network to settle, and the ticket table to paint before hunting
    // for the create-ticket <select>.
    console.log("[ITIC] Dashboard: waiting for URL **/excavatorTickets");
    await page.waitForURL("**/excavatorTickets", { timeout: STEP_TIMEOUT });
    console.log("[ITIC] Dashboard: waiting for network idle");
    await page.waitForLoadState("networkidle", { timeout: STEP_TIMEOUT });
    console.log("[ITIC] Dashboard: waiting for ticket table to be visible");
    await page.locator("table").first().waitFor({ state: "visible", timeout: STEP_TIMEOUT });
    console.log("[ITIC] Dashboard: ready");
  });

  await step(page, `Dashboard: selecting ticket type "${DEFAULT_TICKET_TYPE}"`, async () => {
    console.log("[ITIC] Dashboard: resolving create-ticket <select>");
    const select = findCreateTicketSelect(page);
    await select.waitFor({ state: "attached", timeout: STEP_TIMEOUT });
    console.log(`[ITIC] Dashboard: selecting option "${DEFAULT_TICKET_TYPE}"`);
    // Native single-select: choosing the option fires a change event that the
    // portal handles by navigating to Step 1. Do NOT .click() the <select> —
    // clicking only toggles the dropdown open and times out waiting for it to
    // become actionable (this was the original 30s-timeout bug).
    await select.selectOption({ label: DEFAULT_TICKET_TYPE });

    console.log("[ITIC] Dashboard: awaiting navigation to /createTicketStep1");
    try {
      await page.waitForURL("**/createTicketStep1**", { timeout: 5_000 });
    } catch {
      // A few portal builds require an explicit click on the split-button area
      // that visually pairs with the <select> to commit the navigation. Dump
      // the visible buttons for diagnostics, then click the paired button as a
      // last resort.
      if (/createTicketStep1/.test(page.url())) return;
      console.warn("[ITIC] Dashboard: URL did not change within 5s after selectOption");
      const buttons = await page.locator("button:visible").all();
      const labels = await Promise.all(
        buttons.map(async (b, i) => `[${i}] "${((await b.textContent()) ?? "").trim()}"`)
      );
      console.warn(`[ITIC] Dashboard: visible buttons:\n${labels.join("\n")}`);
      const pair = page
        .locator(
          'button:has-text("Create job ticket"), button:has-text("Create"), button:has-text("Go")'
        )
        .first();
      if ((await pair.count()) > 0) {
        console.warn("[ITIC] Dashboard: clicking paired button as last-resort");
        await pair.click().catch(() => {});
      }
      await page.waitForURL("**/createTicketStep1**", { timeout: 15_000 });
    }
  });

  await markLocation(page, ticket, job);
  await writeInstructions(page, ticket, job);
}

export interface SubmitResult {
  ticketNumber: string;
  expirationDate: string; // MM/DD/YYYY as scraped from the confirmation, if found
  confirmationScreenshot: Buffer;
  confirmationPdf: Buffer;
}

// Pull the ITIC-assigned ticket number + expiration off the confirmation page.
// Prefer the dedicated selectors; fall back to flexible regex over page text.
async function extractConfirmation(
  page: Page
): Promise<{ ticketNumber: string; expirationDate: string }> {
  let ticketNumber = "";
  const numEl = page.locator(ITIC_SELECTORS.ticketNumber).first();
  if ((await numEl.count()) > 0) {
    ticketNumber = ((await numEl.textContent()) ?? "").trim();
  }

  const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
  if (!ticketNumber) {
    const m =
      bodyText.match(/ticket\s*(?:#|number|no\.?)\s*:?\s*([A-Z0-9-]{5,})/i) ??
      bodyText.match(/\b(\d{8,})\b/);
    if (m) ticketNumber = m[1].trim();
  }

  let expirationDate = "";
  const expMatch =
    bodyText.match(/expir\w*\s*(?:date)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i) ??
    bodyText.match(/valid\s*(?:through|until)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (expMatch) expirationDate = expMatch[1].trim();

  return { ticketNumber, expirationDate };
}

// Advance Step 2 → Step 3, submit the ticket, read back the assigned number +
// expiration, and capture a Letter-format PDF of the confirmation page.
export async function submitAndConfirm(page: Page): Promise<SubmitResult> {
  page.setDefaultTimeout(STEP_TIMEOUT);
  await step(page, "Step 2: Next → Step 3 (review)", async () => {
    await page.getByRole("button", { name: /next/i }).click();
    await page.waitForURL("**/createTicketStep3", { timeout: STEP_TIMEOUT });
  });

  await step(page, "Step 3: submitting ticket", async () => {
    await page.click(ITIC_SELECTORS.submitButton);
    await page.waitForLoadState("networkidle", { timeout: 120_000 });
  });

  const { ticketNumber, expirationDate } = await extractConfirmation(page);
  const confirmationScreenshot = await page.screenshot({ fullPage: true, type: "png" });
  const confirmationPdf = Buffer.from(
    await page.pdf({ format: "Letter", printBackground: true })
  );
  return { ticketNumber, expirationDate, confirmationScreenshot, confirmationPdf };
}

// ITIC free-text response → our UtilityStatus enum.
function mapResponseStatus(raw: string): UtilityStatus["status"] {
  const t = raw.toLowerCase();
  if (t.includes("clear") || t.includes("no conflict") || t.includes("no facilities")) return "clear";
  if (t.includes("marked") || t.includes("located") || t.includes("complete")) return "marked";
  if (t.includes("conflict") || t.includes("hold")) return "conflict";
  if (t.includes("progress") || t.includes("pending")) return "in-progress";
  return "pending";
}

// Look a filed ticket up and scrape each utility member's current response.
export async function checkUtilityResponses(
  page: Page,
  ticketNumber: string
): Promise<UtilityStatus[]> {
  const lookup = page.locator(ITIC_SELECTORS.ticketLookupInput).first();
  if ((await lookup.count()) > 0) {
    await lookup.fill(ticketNumber);
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 60_000 }),
      page.click(ITIC_SELECTORS.ticketLookupButton),
    ]);
  }
  const now = Date.now();
  const rows = page.locator(ITIC_SELECTORS.responseRow);
  const count = await rows.count();
  const out: UtilityStatus[] = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const utility = (
      (await row.locator(ITIC_SELECTORS.responseUtilityCell).first().textContent()) ?? ""
    ).trim();
    const statusText = (
      (await row.locator(ITIC_SELECTORS.responseStatusCell).first().textContent()) ?? ""
    ).trim();
    if (!utility) continue;
    out.push({
      utility,
      status: mapResponseStatus(statusText),
      respondedAt: now,
      lastCheckedAt: now,
      notes: statusText || undefined,
    });
  }
  return out;
}
