// 811 automation entry points (Firebase Functions Gen2).
//
//   fileTicketBot         callable — fill ITIC form, capture review screenshot,
//                         move ticket to Review (does NOT submit)
//   confirmAndSubmit      callable — after operator sign-off, file with ITIC and
//                         record the assigned locate number
//   checkUtilityResponses callable — scrape member responses for a filed ticket
//   dailySweep            scheduled — 6am Pacific: expire/renew + poll responses
//   onTicketFiled         Firestore trigger — Smartsheet write-back on Filed
//
// Playwright + Chromium make these heavy: 2 GiB / 540 s. They deploy separately
// from the Vercel web/api workspaces (see README-811-DEPLOY.md).
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import type { Browser } from "playwright-core";

import type { DigTicket, Job, UtilityStatus } from "./types.js";
import {
  launchBrowser,
  login,
  fillTicketForm,
  captureReview,
  submitTicket,
  checkUtilityResponses as scrapeResponses,
} from "./itic.js";
import { uploadScreenshot } from "./storage.js";
import { writeLocateBack } from "./smartsheet.js";
import { notify } from "./notifications.js";

initializeApp();

const ITIC_USERNAME = defineSecret("ITIC_USERNAME");
const ITIC_PASSWORD = defineSecret("ITIC_PASSWORD");
const SMARTSHEET_ACCESS_TOKEN = defineSecret("SMARTSHEET_ACCESS_TOKEN");
const PUSHOVER_TOKEN = defineSecret("PUSHOVER_TOKEN");
const PUSHOVER_USER = defineSecret("PUSHOVER_USER");

const HEAVY = { memory: "2GiB" as const, timeoutSeconds: 540, region: "us-west1" };
const DAY_MS = 24 * 60 * 60 * 1000;

function db() {
  return getFirestore();
}

async function loadTicketAndJob(ticketId: string): Promise<{ ticket: DigTicket; job: Job }> {
  const tDoc = await db().collection("digTickets").doc(ticketId).get();
  if (!tDoc.exists) throw new HttpsError("not-found", `Ticket ${ticketId} not found`);
  const ticket = tDoc.data() as DigTicket;
  const jDoc = await db().collection("jobs").doc(ticket.jobId).get();
  if (!jDoc.exists) throw new HttpsError("not-found", `Job ${ticket.jobId} not found`);
  return { ticket, job: jDoc.data() as Job };
}

function iticCreds() {
  return { username: ITIC_USERNAME.value(), password: ITIC_PASSWORD.value() };
}

// ── fileTicketBot ────────────────────────────────────────────────────────────
// Fills the ITIC form and captures a review screenshot for operator sign-off.
// Leaves the ticket in Review; confirmAndSubmit does the actual filing.
export const fileTicketBot = onCall(
  { ...HEAVY, secrets: [ITIC_USERNAME, ITIC_PASSWORD] },
  async (req) => {
    const ticketId = req.data?.ticketId as string | undefined;
    if (!ticketId) throw new HttpsError("invalid-argument", "ticketId is required");

    const { ticket, job } = await loadTicketAndJob(ticketId);
    const botRunId = `run-${Date.now()}`;
    const ref = db().collection("digTickets").doc(ticketId);
    await ref.update({ status: "Filing", "automation.botRunId": botRunId });

    let browser: Browser | null = null;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await login(page, iticCreds());
      await fillTicketForm(page, ticket, job);
      const png = await captureReview(page);
      const url = await uploadScreenshot(ticketId, "review", png);

      await ref.update({
        status: "Review",
        "automation.reviewScreenshotUrl": url,
        "automation.botErrors": [],
      });
      return { ok: true, status: "Review", reviewScreenshotUrl: url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("fileTicketBot failed", { ticketId, message });
      await ref.update({
        status: "Failed",
        "automation.botErrors": [...(ticket.automation.botErrors ?? []), message],
      });
      throw new HttpsError("internal", `Bot failed: ${message}`);
    } finally {
      await browser?.close();
    }
  }
);

// ── confirmAndSubmit ─────────────────────────────────────────────────────────
// Operator has reviewed the screenshot. Re-run fill and submit (Cloud Functions
// are stateless between invocations so we cannot reuse the review session), read
// the assigned ticket number, and flip to Filed. The onTicketFiled trigger then
// performs the Smartsheet write-back.
export const confirmAndSubmit = onCall(
  { ...HEAVY, secrets: [ITIC_USERNAME, ITIC_PASSWORD] },
  async (req) => {
    const ticketId = req.data?.ticketId as string | undefined;
    if (!ticketId) throw new HttpsError("invalid-argument", "ticketId is required");

    const { ticket, job } = await loadTicketAndJob(ticketId);
    if (ticket.status !== "Review") {
      throw new HttpsError("failed-precondition", `Ticket must be in Review, is ${ticket.status}`);
    }
    const ref = db().collection("digTickets").doc(ticketId);
    await ref.update({ status: "Filing" });

    let browser: Browser | null = null;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await login(page, iticCreds());
      await fillTicketForm(page, ticket, job);
      await captureReview(page);
      const { ticketNumber, confirmationScreenshot } = await submitTicket(page);
      const url = await uploadScreenshot(ticketId, "confirmation", confirmationScreenshot);

      const now = Date.now();
      const startsAt = now + 2 * DAY_MS;
      const expiresAt = startsAt + ticket.specs.duration * DAY_MS;
      await ref.update({
        status: "Filed",
        ticketNumber: ticketNumber || ticket.ticketNumber,
        "automation.confirmationScreenshotUrl": url,
        "automation.filedAt": now,
        "dates.submittedAt": now,
        "dates.startsAt": startsAt,
        "dates.expiresAt": expiresAt,
      });
      return { ok: true, status: "Filed", ticketNumber };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("confirmAndSubmit failed", { ticketId, message });
      await ref.update({
        status: "Failed",
        "automation.botErrors": [...(ticket.automation.botErrors ?? []), message],
      });
      throw new HttpsError("internal", `Submit failed: ${message}`);
    } finally {
      await browser?.close();
    }
  }
);

// Merge freshly-scraped responses into the stored list (scrape wins on match).
function mergeStatuses(existing: UtilityStatus[], scraped: UtilityStatus[]): UtilityStatus[] {
  const byName = new Map(existing.map((s) => [s.utility.toLowerCase(), s]));
  for (const s of scraped) byName.set(s.utility.toLowerCase(), s);
  return [...byName.values()];
}

function computeReady(statuses: UtilityStatus[], startDate: number): boolean {
  const allResolved =
    statuses.length > 0 && statuses.every((s) => s.status === "marked" || s.status === "clear");
  return allResolved && Date.now() >= startDate;
}

async function pollResponsesInto(
  browser: Browser,
  ticketId: string,
  ticket: DigTicket
): Promise<void> {
  if (!ticket.ticketNumber) return;
  const page = await browser.newPage();
  try {
    await login(page, iticCreds());
    const scraped = await scrapeResponses(page, ticket.ticketNumber);
    if (scraped.length === 0) {
      await db().collection("digTickets").doc(ticketId).update({ lastCheckedAt: Date.now() });
      return;
    }
    const merged = mergeStatuses(ticket.utilityStatuses, scraped);
    const wasReady = ticket.readyToDig;
    const readyToDig = computeReady(merged, ticket.specs.startDate);
    await db().collection("digTickets").doc(ticketId).update({
      utilityStatuses: merged,
      lastCheckedAt: Date.now(),
      readyToDig,
    });
    if (readyToDig && !wasReady) {
      await notify({
        kind: "ready-to-dig",
        title: "Ready to dig",
        body: `Ticket ${ticket.ticketNumber} — all utilities responded.`,
        ticketId,
        jobId: ticket.jobId,
      });
    }
  } finally {
    await page.close();
  }
}

// ── checkUtilityResponses ────────────────────────────────────────────────────
export const checkUtilityResponses = onCall(
  { ...HEAVY, secrets: [ITIC_USERNAME, ITIC_PASSWORD, PUSHOVER_TOKEN, PUSHOVER_USER] },
  async (req) => {
    const ticketId = req.data?.ticketId as string | undefined;
    if (!ticketId) throw new HttpsError("invalid-argument", "ticketId is required");
    const { ticket } = await loadTicketAndJob(ticketId);

    let browser: Browser | null = null;
    try {
      browser = await launchBrowser();
      await pollResponsesInto(browser, ticketId, ticket);
      const fresh = (await db().collection("digTickets").doc(ticketId).get()).data() as DigTicket;
      return { ok: true, utilityStatuses: fresh.utilityStatuses, readyToDig: fresh.readyToDig };
    } finally {
      await browser?.close();
    }
  }
);

// ── dailySweep ───────────────────────────────────────────────────────────────
// 6am Pacific. Transitions Active→Expiring (≤3 days out) and →Expired (past
// expiry), then polls utility responses for still-open tickets.
export const dailySweep = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "America/Los_Angeles",
    ...HEAVY,
    secrets: [ITIC_USERNAME, ITIC_PASSWORD, PUSHOVER_TOKEN, PUSHOVER_USER],
  },
  async () => {
    const now = Date.now();
    const snap = await db()
      .collection("digTickets")
      .where("status", "in", ["Filed", "Active", "Expiring"])
      .get();
    const tickets = snap.docs.map((d) => d.data() as DigTicket);

    for (const ticket of tickets) {
      const ref = db().collection("digTickets").doc(ticket.id);
      const expiresAt = ticket.dates.expiresAt;

      // Filed becomes Active once the 48hr start window passes.
      if (ticket.status === "Filed" && ticket.dates.startsAt && now >= ticket.dates.startsAt) {
        await ref.update({ status: "Active" });
      }

      if (expiresAt) {
        if (now >= expiresAt && ticket.status !== "Expired") {
          await ref.update({ status: "Expired" });
          await notify({
            kind: "ticket-expired",
            title: "Ticket expired",
            body: `Ticket ${ticket.ticketNumber || ticket.id} expired. Re-file to renew.`,
            ticketId: ticket.id,
            jobId: ticket.jobId,
          });
          continue;
        }
        if (now >= expiresAt - 3 * DAY_MS && ticket.status === "Active") {
          await ref.update({ status: "Expiring" });
          await notify({
            kind: "ticket-expiring",
            title: "Ticket expiring soon",
            body: `Ticket ${ticket.ticketNumber || ticket.id} expires within 3 days.`,
            ticketId: ticket.id,
            jobId: ticket.jobId,
          });
        }
      }
    }

    // Poll responses for tickets still awaiting utilities (best-effort).
    const open = tickets.filter(
      (t) => t.ticketNumber && !t.readyToDig && t.status !== "Expired"
    );
    if (open.length > 0) {
      let browser: Browser | null = null;
      try {
        browser = await launchBrowser();
        for (const t of open) {
          try {
            await pollResponsesInto(browser, t.id, t);
          } catch (err) {
            logger.warn("dailySweep poll failed", { ticketId: t.id, err: String(err) });
          }
        }
      } finally {
        await browser?.close();
      }
    }
  }
);

// ── onTicketFiled ────────────────────────────────────────────────────────────
// Smartsheet write-back + filed notification when a ticket enters Filed.
export const onTicketFiled = onDocumentUpdated(
  {
    document: "digTickets/{ticketId}",
    secrets: [SMARTSHEET_ACCESS_TOKEN, PUSHOVER_TOKEN, PUSHOVER_USER],
    region: "us-west1",
  },
  async (event) => {
    const before = event.data?.before.data() as DigTicket | undefined;
    const after = event.data?.after.data() as DigTicket | undefined;
    if (!after) return;
    if (before?.status === "Filed" || after.status !== "Filed") return; // only the transition

    const jobDoc = await db().collection("jobs").doc(after.jobId).get();
    const job = jobDoc.exists ? (jobDoc.data() as Job) : null;

    if (job) {
      try {
        const wrote = await writeLocateBack({
          job,
          ticketNumber: after.ticketNumber,
          expiresAt: after.dates.expiresAt,
        });
        if (!wrote) logger.warn("Smartsheet row not found for job", { jobId: job.jobId });
      } catch (err) {
        logger.error("Smartsheet write-back failed", { jobId: job.jobId, err: String(err) });
      }
    }

    await notify({
      kind: "ticket-filed",
      title: "Ticket filed with ITIC",
      body: `Locate ${after.ticketNumber || after.id} filed for ${
        job?.workOrder ?? after.jobId
      }.`,
      ticketId: after.id,
      jobId: after.jobId,
    });
  }
);
