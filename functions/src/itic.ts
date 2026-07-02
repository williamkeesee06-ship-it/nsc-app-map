// ITIC (WA Utilities Underground Location Center — itic.occinc.com) automation
// via headless Chromium. Runs inside a Gen2 Cloud Function with a long timeout.
//
// IMPORTANT: ITIC's form markup is not publicly documented and changes over
// time. The selectors below are centralised in ITIC_SELECTORS so they can be
// re-verified against the live portal during deployment (see
// README-811-DEPLOY.md → "Verifying ITIC selectors"). The control flow — login,
// fill, capture review, submit, read confirmation — is stable regardless.
import chromium from "@sparticuz/chromium";
import { chromium as playwright, type Browser, type Page } from "playwright-core";
import type { DigTicket, Job, UtilityStatus } from "./types.js";

const ITIC_BASE = "https://wa.itic.occinc.com";

// Single source of truth for the live-portal selectors. Re-verify on deploy.
const ITIC_SELECTORS = {
  usernameInput: "#username, input[name='username']",
  passwordInput: "#pass, input[name='password']",
  loginButton: "button[type='submit'], input[type='submit']",
  newTicketLink: "a:has-text('New Ticket'), a:has-text('Create Ticket')",
  workTypeInput: "select[name='typeOfWork'], #typeOfWork",
  depthInput: "input[name='depth'], #depth",
  remarksInput: "textarea[name='remarks'], #remarks, textarea[name='instructions']",
  durationInput: "input[name='duration'], #duration",
  startDateInput: "input[name='startDate'], #startDate",
  handDigCheckbox: "input[name='handDig'], #handDig",
  boringCheckbox: "input[name='boring'], #directionalBoring",
  explosivesCheckbox: "input[name='explosives'], #explosives",
  whiteLinedCheckbox: "input[name='whiteLined'], #whiteLined",
  reviewButton: "button:has-text('Review'), button:has-text('Preview')",
  submitButton: "button:has-text('Submit'), button:has-text('File Ticket')",
  ticketNumber: ".ticket-number, [data-ticket-number], #ticketNumber",
  // Utility response lookup (used by checkUtilityResponses).
  ticketLookupInput: "input[name='ticketNumber'], #ticketLookup",
  ticketLookupButton: "button:has-text('Look Up'), button:has-text('Search')",
  responseRow: "table.responses tbody tr, .utility-response",
  responseUtilityCell: ".utility-name, td:nth-child(1)",
  responseStatusCell: ".response-status, td:nth-child(2)",
};

export interface IticCredentials {
  username: string;
  password: string;
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
  await page.goto(`${ITIC_BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.fill(ITIC_SELECTORS.usernameInput, creds.username);
  await page.fill(ITIC_SELECTORS.passwordInput, creds.password);
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 60_000 }),
    page.click(ITIC_SELECTORS.loginButton),
  ]);
}

// Map our normalised dig shape into the free-text description ITIC's dig-site
// step expects. We describe the excavation area and let the marking
// instructions (Gemini-authored) carry the locator-facing detail.
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
    ticket.markingInstructions,
  ]
    .filter(Boolean)
    .join(" ");
}

async function setCheckbox(page: Page, selector: string, value: boolean): Promise<void> {
  const box = page.locator(selector).first();
  if ((await box.count()) === 0) return;
  const checked = await box.isChecked().catch(() => false);
  if (checked !== value) await box.click();
}

// Fill the ticket form up to (but not including) final submission. Returns
// nothing; call captureReview() next to snapshot the review screen.
export async function fillTicketForm(page: Page, ticket: DigTicket, job: Job): Promise<void> {
  await page.click(ITIC_SELECTORS.newTicketLink);
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });

  const fillIfPresent = async (selector: string, text: string) => {
    const el = page.locator(selector).first();
    if ((await el.count()) > 0) await el.fill(text);
  };

  await fillIfPresent(ITIC_SELECTORS.workTypeInput, ticket.specs.workType);
  await fillIfPresent(ITIC_SELECTORS.depthInput, ticket.specs.depth);
  await fillIfPresent(ITIC_SELECTORS.durationInput, String(ticket.specs.duration));
  await fillIfPresent(
    ITIC_SELECTORS.startDateInput,
    new Date(ticket.specs.startDate).toISOString().slice(0, 10)
  );
  await fillIfPresent(ITIC_SELECTORS.remarksInput, describeDigSite(ticket, job));

  await setCheckbox(page, ITIC_SELECTORS.handDigCheckbox, ticket.specs.handDigOnly);
  await setCheckbox(page, ITIC_SELECTORS.boringCheckbox, ticket.specs.directionalBoring);
  await setCheckbox(page, ITIC_SELECTORS.explosivesCheckbox, ticket.specs.explosives);
  await setCheckbox(page, ITIC_SELECTORS.whiteLinedCheckbox, ticket.specs.whiteLined);
}

// Advance to the review step and capture a full-page PNG for operator sign-off.
export async function captureReview(page: Page): Promise<Buffer> {
  const reviewBtn = page.locator(ITIC_SELECTORS.reviewButton).first();
  if ((await reviewBtn.count()) > 0) {
    await reviewBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 60_000 });
  }
  return page.screenshot({ fullPage: true, type: "png" });
}

export interface SubmitResult {
  ticketNumber: string;
  confirmationScreenshot: Buffer;
}

// Click the final submit and read back the ITIC-assigned ticket number.
export async function submitTicket(page: Page): Promise<SubmitResult> {
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 120_000 }),
    page.click(ITIC_SELECTORS.submitButton),
  ]);
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
