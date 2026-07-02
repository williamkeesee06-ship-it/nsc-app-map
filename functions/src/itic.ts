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
// Contract preserved from the previous implementation:
//   fillTicketForm  — dashboard → Step 1 → Step 2, fills everything, STOPS on
//                     Step 2 without advancing (i.e. no submit).
//   captureReview   — advances Step 2 → Step 3 and screenshots the review page.
//                     This is the "fill + review" stopping point (fileTicketBot).
//   submitTicket    — clicks Submit on Step 3 (only confirmAndSubmit calls this).
import chromium from "@sparticuz/chromium";
import { chromium as playwright, type Browser, type Page } from "playwright-core";
import type { DigShape, DigTicket, Job, LatLng, UtilityStatus } from "./types.js";

const ITIC_BASE = "https://wa.itic.occinc.com";
const STEP_TIMEOUT = 30_000; // per-action timeout (ms)

// Single source of truth for the live-portal selectors. Re-verify on deploy.
const ITIC_SELECTORS = {
  // Login page.
  usernameInput: 'input[placeholder="Username"]',
  passwordInput: 'input[placeholder="Password"]',
  loginButton: 'button:has-text("Log in")',
  // Dashboard: the create-ticket control is the LAST <select> on the page.
  createTicketSelect: "select",
  // Step 1 — mark location.
  addressSearch: 'input[placeholder="Search place or address"]',
  placeSuggestion: ".pac-item",
  drawPanelButton: 'img[src*="draw"]',
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
function mapWorkType(raw: string): string {
  switch (raw.trim().toUpperCase()) {
    case "MEC":
      return "MECHANICAL EXCAVATION";
    case "HAND":
      return "HAND DIGGING";
    case "BORE":
      return "DIRECTIONAL BORING";
    default:
      return raw;
  }
}

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
// The map's lat/lng→pixel projection is not reliably reachable from a headless
// context, so polygon vertex-clicking is fragile. We use the sanctioned fallback
// (README task item 6): search the ticket's address and use "Radius excavation"
// with a radius that bounds the stored shape. Marking convention: White paint.
async function markLocation(page: Page, ticket: DigTicket, job: Job): Promise<void> {
  const address = (job.address ?? "").trim();
  const radiusFt = computeRadiusFt(ticket.shape);

  await step(page, `Step 1: address search "${address}"`, async () => {
    if (!address) throw new Error("Job has no address to search for on the ITIC map");
    await page.locator(ITIC_SELECTORS.addressSearch).fill(address);
    await page.locator(ITIC_SELECTORS.placeSuggestion).first().click();
  });

  await step(page, "Step 1: opening drawing panel", async () => {
    await page.locator(ITIC_SELECTORS.drawPanelButton).first().click();
  });

  await step(page, `Step 1: Radius excavation (radius ~${radiusFt} ft)`, async () => {
    await page.getByText("Radius excavation", { exact: false }).first().click();
    // Enter the radius if the flow exposes a numeric input for it (best-effort).
    const radiusInput = page.locator('input[type="number"]').first();
    if ((await radiusInput.count()) > 0) {
      await radiusInput.fill(String(radiusFt));
    }
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
    const d = new Date(specs.startDate);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dateStr = `${mm}/${dd}/${d.getFullYear()}`;
    const dateField = page.getByLabel(/work to begin date/i);
    if ((await dateField.count()) > 0) await dateField.fill(dateStr);
  });

  await step(page, "Step 2: type of work", async () => {
    const tow = page.getByLabel(/type of work/i);
    if ((await tow.count()) > 0) await tow.fill(mapWorkType(specs.workType));
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
    if ((await forField.count()) > 0) await forField.fill("NORTHSKY COMMUNICATIONS");
  });
}

// Fill the ticket wizard up to (but not including) final submission. Ends on
// Step 2 (filled). Call captureReview() next to advance to Step 3 and snapshot.
export async function fillTicketForm(page: Page, ticket: DigTicket, job: Job): Promise<void> {
  page.setDefaultTimeout(STEP_TIMEOUT);

  await step(page, `Dashboard: selecting ticket type "${DEFAULT_TICKET_TYPE}"`, async () => {
    const select = page.locator(ITIC_SELECTORS.createTicketSelect).last();
    await select.selectOption({ label: DEFAULT_TICKET_TYPE });
    await select.click();
    await page.waitForURL("**/createTicketStep1", { timeout: STEP_TIMEOUT });
  });

  await markLocation(page, ticket, job);
  await writeInstructions(page, ticket, job);
}

// Advance Step 2 → Step 3 (review) and capture a full-page PNG for sign-off.
// This is the "fill + review" stop point: fileTicketBot ends here and does NOT
// submit; only confirmAndSubmit continues to submitTicket().
export async function captureReview(page: Page): Promise<Buffer> {
  page.setDefaultTimeout(STEP_TIMEOUT);
  await step(page, "Step 2: Next → Step 3 (review)", async () => {
    await page.getByRole("button", { name: /next/i }).click();
    await page.waitForURL("**/createTicketStep3", { timeout: STEP_TIMEOUT });
  });
  return page.screenshot({ fullPage: true, type: "png" });
}

export interface SubmitResult {
  ticketNumber: string;
  confirmationScreenshot: Buffer;
}

// Click the final submit on Step 3 and read back the ITIC-assigned number.
export async function submitTicket(page: Page): Promise<SubmitResult> {
  page.setDefaultTimeout(STEP_TIMEOUT);
  await step(page, "Step 3: submitting ticket", async () => {
    await page.click(ITIC_SELECTORS.submitButton);
    await page.waitForLoadState("networkidle", { timeout: 120_000 });
  });
  const numEl = page.locator(ITIC_SELECTORS.ticketNumber).first();
  const ticketNumber =
    (await numEl.count()) > 0 ? ((await numEl.textContent())?.trim() ?? "") : "";
  const confirmationScreenshot = await page.screenshot({ fullPage: true, type: "png" });
  return { ticketNumber, confirmationScreenshot };
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
