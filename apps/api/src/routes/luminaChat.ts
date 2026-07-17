/**
 * LUMINA CHAT — server-side proxy for text-mode chat with Gemini 2.5 Flash.
 *
 * Why server-side: the Gemini API key (GEMINI_API_KEY) must NEVER reach the
 * browser. The client posts a transcript + user message, this route runs one
 * model turn, and returns either (a) a final text reply OR (b) one or more
 * tool calls for the client to execute. The client then re-posts with the
 * tool results, and we loop until the model produces text.
 *
 * This is statelesss — the FULL conversation is sent on every request. That
 * keeps the chat engine simple and lets the UI own the message log (and
 * persist it to Firestore later in Phase 5 — memory layer).
 *
 * Anti-hallucination architecture: the SAME system prompt and tool
 * declarations from luminaLiveToken.ts are reused, so text and voice modes
 * have identical behavior. (Lumina cannot answer with North Sky facts she
 * didn't just retrieve.)
 */

import { Router, type Request, type Response } from "express";
import {
  GoogleGenerativeAI,
  FunctionCallingMode,
  type Content,
  type FunctionDeclaration,
  type Tool,
} from "@google/generative-ai";
import {
  LUMINA_SYSTEM_INSTRUCTION,
  LUMINA_FUNCTION_DECLARATIONS,
} from "../lumina/promptAndTools.js";
import { loadMemoriesForPrompt, type MemoryItem } from "./luminaMemories.js";
import { db } from "../lib/firestore.js";
import type { Job } from "@nsc/types";
import { getEnv } from "../config/env.js";
import { getSheet, buildColumnsById, rowToRecord } from "../lib/smartsheet.js";
import { normalizeRow } from "../services/jobsSync.js";

const router = Router();


// ─────────────────────────────────────────────────────────────────────────────
// Wire types — what the client sends and what we send back.
// Kept narrow on purpose so the chat engine on the client is easy to reason
// about. Multi-tool roundtrips work by sending the next request with the
// previous toolResults appended.
// ─────────────────────────────────────────────────────────────────────────────

interface ClientTextPart {
  role: "user" | "model";
  text: string;
}

interface ClientToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * Gemini 3.x "thinking" models attach a thoughtSignature to each
   * functionCall part. When we re-send the call back on the next turn
   * (so the model sees its own prior intent), we MUST include this
   * signature or the API rejects the request with:
   *   "Function call is missing a thought_signature in functionCall parts"
   * Treat as opaque base64 — pass through unchanged.
   */
  thoughtSignature?: string;
}

interface ClientToolResult {
  id: string;
  name: string;
  /** What dispatchTool returned (ok/message/data). */
  result: { ok: boolean; message?: string; data?: unknown };
}

interface ChatRequestBody {
  /** Prior turns in order. Each turn is either a text exchange or a tool
   *  call/response pair. Both sides come from the client. */
  history: Array<
    | { kind: "text"; role: "user" | "model"; text: string }
    | { kind: "call"; calls: ClientToolCall[] }
    | { kind: "result"; results: ClientToolResult[] }
  >;
  /** The NEW user message (only present on the first request of a turn).
   *  Follow-up requests in the same turn carry tool results in `history`. */
  newUserMessage?: string;
  /** Operator username — pasted into system prompt so Lumina addresses Billy. */
  username?: string;
  /** Dashboard briefing mode — bypasses the chat engine and returns computed
   *  bullets from live Firestore data instead of a Gemini turn. */
  mode?: string;
  contract?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard briefing — deterministic, server-side bullets from live Firestore.
// Reuses this same /lumina/chat route (mode === "dashboard_briefing") rather
// than standing up a parallel endpoint. Bullets are computed at request time;
// nothing is cached.
// ─────────────────────────────────────────────────────────────────────────────

interface BriefingResponse {
  greeting: string;
  bullets: string[];
  modelTurnAt: number;
}

function isTruthyFlag(value: string | null | undefined): boolean {
  return /^(y|yes|true|required|1)/i.test((value ?? "").trim());
}

function isEmpty(value: string | null | undefined): boolean {
  return !value || !value.trim();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = Date.parse(iso.slice(0, 10));
  if (Number.isNaN(d)) return null;
  const start = Date.parse(todayIso());
  return Math.round((d - start) / 86400000);
}

interface Candidate {
  signal: number; // 0 = no signal; higher sorts first
  text: string;
}

async function buildZiplyBriefing(username?: string): Promise<BriefingResponse> {
  const env = getEnv();
  const sheetId = env.ZIPLY_SMARTSHEET_SHEET_ID;
  let ziplyJobs: Job[] = [];

  // Attempt real-time Smartsheet polling
  if (sheetId) {
    try {
      const sheet = await getSheet({}, sheetId);
      const colsById = buildColumnsById(sheet);
      for (const row of sheet.rows) {
        const job = normalizeRow(row, colsById, true);
        if (job) ziplyJobs.push(job);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[lumina/briefing] smartsheet poll failed, falling back to Firestore:", err);
      ziplyJobs = [];
    }
  }

  // Fallback to Firestore if Smartsheet poll was empty or failed
  if (ziplyJobs.length === 0) {
    const snap = await db().collection("jobs").where("customerProject", "==", "Ziply").get();
    snap.forEach((doc) => {
      ziplyJobs.push(doc.data() as Job);
    });
  }

  // Filter to North Metro Area
  const NORTH_METRO_CITIES = [
    "lynnwood",
    "everett",
    "edmonds",
    "lake stevens",
    "snohomish",
    "mukilteo",
    "marysville",
    "arlington",
    "bothell",
    "mill creek",
    "mountlake terrace",
    "woodway",
    "monroe"
  ];

  const northMetroJobs = ziplyJobs.filter((job) => {
    const base = (job.constructionBase ?? "").trim().toLowerCase();
    if (base.includes("north metro") || base.includes("northmetro") || base.includes("n. metro")) {
      return true;
    }
    const city = (job.city ?? "").trim().toLowerCase();
    if (!city) return false;
    if (NORTH_METRO_CITIES.includes(city)) return true;
    return NORTH_METRO_CITIES.some(
      (c) => city === c || city.startsWith(c + " ") || city.startsWith(c + ",") || city.includes(c)
    );
  });

  const candidates: Candidate[] = [];

  // 1 — New Jobs added recently (last 7 days based on dateReceived)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newJobs = northMetroJobs.filter((j) => {
    if (!j.dateReceived) return false;
    const parsed = Date.parse(j.dateReceived);
    return !isNaN(parsed) && parsed >= sevenDaysAgo;
  }).length;
  if (newJobs > 0) {
    candidates.push({
      signal: newJobs * 10, // high priority
      text: `${newJobs} new Ziply job${newJobs === 1 ? "" : "s"} added to the North Metro tracker this week.`,
    });
  }

  // 2 — Active construction jobs (in progress)
  const activeJobs = northMetroJobs.filter((j) => {
    const status = (j.jobStatus ?? "").trim().toLowerCase();
    return status === "in progress" || status === "in-progress" || status === "started";
  }).length;
  if (activeJobs > 0) {
    candidates.push({
      signal: activeJobs,
      text: `${activeJobs} active construction project${activeJobs === 1 ? "" : "s"} currently in progress.`,
    });
  }

  // 3 — Footage completion metrics
  let totalEst = 0;
  let totalComp = 0;
  northMetroJobs.forEach((j) => {
    const status = (j.jobStatus ?? "").trim().toLowerCase();
    if (status === "completed" || status === "complete") return;
    const est = (j.estBoreFt ?? 0) + (j.estPlacingFt ?? 0) + (j.estAerialFt ?? 0);
    const comp = (j.completedBoreFt ?? 0) + (j.completedPlacingFt ?? 0) + (j.completedAerialFt ?? 0);
    if (est > 0) {
      totalEst += est;
      totalComp += comp;
    }
  });
  if (totalEst > 0) {
    const pct = Math.round((totalComp / totalEst) * 100);
    candidates.push({
      signal: 8,
      text: `Footage placed: ${totalComp.toLocaleString()} ft of ${totalEst.toLocaleString()} ft estimated (${pct}% complete).`,
    });
  }

  // 4 — Outstanding Go-Backs / Gig Work from Firestore
  try {
    const gigsSnap = await db().collection("gigs").where("completed", "==", false).get();
    const openGigs = gigsSnap.size;
    if (openGigs > 0) {
      candidates.push({
        signal: openGigs * 4,
        text: `${openGigs} outstanding gig work / go-back task${openGigs === 1 ? "" : "s"} remain open.`,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("failed to count gigs for briefing:", err);
  }

  // 5 — Locates Expiring
  const locatesExpiring = northMetroJobs.filter((j) => {
    if (!j.locateExpires) return false;
    const days = Math.round((j.locateExpires - Date.now()) / (24 * 60 * 60 * 1000));
    return days >= 0 && days <= 7;
  }).length;
  if (locatesExpiring > 0) {
    candidates.push({
      signal: locatesExpiring * 5,
      text: `${locatesExpiring} locate ticket${locatesExpiring === 1 ? "" : "s"} expiring within 7 days.`,
    });
  }

  // 6 — Notes highlights: search for keywords in nscProjectNotes
  const flagWords = ["hold", "blocked", "issue", "irrigation", "damage", "need"];
  const notesAlerts: string[] = [];
  for (const j of northMetroJobs) {
    const notes = (j.nscProjectNotes ?? "").toLowerCase();
    if (flagWords.some((word) => notes.includes(word))) {
      notesAlerts.push(`${j.workOrder || j.jobId}: "${j.nscProjectNotes}"`);
    }
  }
  if (notesAlerts.length > 0) {
    const topAlert = notesAlerts[0];
    candidates.push({
      signal: 6,
      text: `Outstanding task note: ${topAlert}`,
    });
  }

  candidates.sort((a, b) => b.signal - a.signal);
  const bullets =
    candidates.length === 0
      ? ["No critical Ziply updates flagged across North Metro today."]
      : candidates.slice(0, 3).map((c) => c.text);

  return {
    greeting: `Operational briefing: Ziply North Metro area status and outstanding actions.`,
    bullets,
    modelTurnAt: Date.now(),
  };
}

async function buildBriefing(username?: string, contract?: string): Promise<BriefingResponse> {
  if (contract === "Ziply") {
    return buildZiplyBriefing(username);
  }

  const snap = await db().collection("jobs").get();
  const all: Job[] = [];
  snap.forEach((doc) => all.push(doc.data() as Job));

  // Scope to the signed-in supervisor when provided (mirrors the web app's
  // per-supervisor job filter); fall back to all jobs otherwise.
  const u = (username ?? "").trim().toLowerCase();
  const jobs = u
    ? all.filter((j) => (j.constructionSupervisor ?? "").trim().toLowerCase() === u)
    : all;

  const today = todayIso();

  // Five candidate bullets, each computed from real Job fields only. We score
  // each by its signal (the count it reports) and surface the strongest three.
  // No fabrication: a candidate with zero signal is dropped, not padded.
  const candidates: Candidate[] = [];

  // 1 — jobs scheduled today, not yet completed.
  const scheduledToday = jobs.filter(
    (j) => (j.scheduleDate ?? "").slice(0, 10) === today && isEmpty(j.actualCompletionDate)
  ).length;
  if (scheduledToday > 0) {
    candidates.push({
      signal: scheduledToday,
      text: `${scheduledToday} job${scheduledToday === 1 ? "" : "s"} scheduled today.`,
    });
  }

  // 2 — jobs past their schedule date with no completion logged.
  const pastDue = jobs.filter((j) => {
    const d = daysUntil(j.scheduleDate);
    return d !== null && d < 0 && isEmpty(j.actualCompletionDate);
  }).length;
  if (pastDue > 0) {
    candidates.push({
      signal: pastDue,
      text: `${pastDue} job${pastDue === 1 ? "" : "s"} past schedule date with no completion.`,
    });
  }

  // 3 — permit-required jobs scheduled within the next 7 days.
  const permitSoon = jobs.filter((j) => {
    const d = daysUntil(j.scheduleDate);
    return isTruthyFlag(j.permitRequired) && d !== null && d >= 0 && d <= 7;
  }).length;
  if (permitSoon > 0) {
    candidates.push({
      signal: permitSoon,
      text: `${permitSoon} job${permitSoon === 1 ? "" : "s"} require permits within 7 days.`,
    });
  }

  // 4 — jobs requiring traffic control scheduled this week (next 7 days).
  const trafficWeek = jobs.filter((j) => {
    const d = daysUntil(j.scheduleDate);
    return j.trafficControlRequired === true && d !== null && d >= 0 && d <= 7;
  }).length;
  if (trafficWeek > 0) {
    candidates.push({
      signal: trafficWeek,
      text: `${trafficWeek} job${trafficWeek === 1 ? "" : "s"} require traffic control this week.`,
    });
  }

  // 5 — crew double-booked (same foreman on 2+ jobs the same day). Signal is
  // the worst single overlap so it ranks against the count-based bullets.
  const byCrewDay = new Map<string, Set<string>>();
  for (const j of jobs) {
    const crew = (j.constructionCrewForeman ?? "").trim();
    const date = (j.scheduleDate ?? "").slice(0, 10);
    if (!crew || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const key = `${crew}__${date}`;
    const set = byCrewDay.get(key) ?? new Set<string>();
    set.add(j.jobId);
    byCrewDay.set(key, set);
  }
  const conflicts = [...byCrewDay.entries()].filter(([, ids]) => ids.size > 1);
  if (conflicts.length > 0) {
    const [key] = conflicts.sort((a, b) => b[1].size - a[1].size)[0];
    const [crew, date] = key.split("__");
    candidates.push({
      signal: conflicts.length,
      text: `Crew ${crew} double-booked on ${date}.`,
    });
  }
  // 6 — jobs in needs_fielding status.
  const needsFielding = jobs.filter((j) => (j.secondaryJobStatus || "").trim().toLowerCase() === "needs fielding").length;
  if (needsFielding > 0) {
    candidates.push({
      signal: needsFielding,
      text: `${needsFielding} new job${needsFielding === 1 ? "" : "s"} waiting in Needs Fielding.`,
    });
  }

  // Top three by signal strength. If nothing fired, say so plainly.
  candidates.sort((a, b) => b.signal - a.signal);
  const bullets =
    candidates.length === 0
      ? ["Nothing flagged across your jobs. All clear."]
      : candidates.slice(0, 3).map((c) => c.text);

  return {
    greeting: `Operational briefing: current status, jobs, and upcoming requirements.`,
    bullets,
    modelTurnAt: Date.now(),
  };
}

interface ChatResponseBody {
  /** If the model produced text, we return it as the final assistant reply. */
  text?: string;
  /** If the model emitted function calls, the client must run them via
   *  dispatchTool() and re-POST with results in history. */
  toolCalls?: ClientToolCall[];
  /** Echoed back so the client can stitch this into its message log. */
  modelTurnAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — convert client wire shape into Gemini SDK `Content[]`.
// ─────────────────────────────────────────────────────────────────────────────

function toGeminiContents(body: ChatRequestBody): Content[] {
  const out: Content[] = [];
  for (const turn of body.history) {
    if (turn.kind === "text") {
      out.push({
        role: turn.role,
        parts: [{ text: turn.text }],
      });
    } else if (turn.kind === "call") {
      // Model previously emitted function calls — re-encode them so the
      // model sees its own prior intent on the next turn. Preserve
      // thoughtSignature (required by Gemini 3.x thinking models).
      out.push({
        role: "model",
        parts: turn.calls.map((c) => {
          const fc: Record<string, unknown> = { name: c.name, args: c.args };
          if (c.thoughtSignature) {
            fc.thoughtSignature = c.thoughtSignature;
          }
          return { functionCall: fc } as unknown as {
            functionCall: { name: string; args: Record<string, unknown> };
          };
        }),
      });
    } else if (turn.kind === "result") {
      // Client executed the tools — feed the responses back to the model.
      out.push({
        role: "user", // function responses are sent from the "user" side
        parts: turn.results.map((r) => ({
          functionResponse: {
            name: r.name,
            response: r.result as Record<string, unknown>,
          },
        })),
      });
    }
  }
  if (body.newUserMessage) {
    out.push({ role: "user", parts: [{ text: body.newUserMessage }] });
  }
  return out;
}

// LUMINA_TOOLS in luminaLiveToken.ts uses Live API's casing (uppercase TYPE).
// The Generative AI SDK accepts the same FunctionDeclaration shape, but the
// type strings need to be lowercase per SDK contract. Normalize once.
function normalizeToolDeclarations(decls: unknown[]): FunctionDeclaration[] {
  function down(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(down);
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        if (k === "type" && typeof v === "string") {
          next[k] = v.toLowerCase();
        } else {
          next[k] = down(v);
        }
      }
      return next;
    }
    return node;
  }
  return down(decls) as FunctionDeclaration[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

router.post("/lumina/chat", async (req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY not set in environment" });
  }

  const body = req.body as ChatRequestBody | undefined;

  // Dashboard briefing short-circuit — does not need history[] or Gemini.
  if (body?.mode === "dashboard_briefing") {
    try {
      const briefing = await buildBriefing(body.username, body.contract);
      return res.json(briefing);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[lumina/chat] briefing error:", err);
      return res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!body || !Array.isArray(body.history)) {
    return res.status(400).json({ error: "invalid body — history[] required" });
  }

  try {
    const genai = new GoogleGenerativeAI(apiKey);

    const nowStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
    const timeContext = `\n\n=====================================================================\n  SYSTEM CONTEXT\n=====================================================================\nThe current local time (Pacific Time) is: ${nowStr}\n`;

    const baseSys = LUMINA_SYSTEM_INSTRUCTION.replace(
      "Billy Keesee",
      body.username ? `${body.username}` : "Billy Keesee"
    ) + timeContext;

    // Phase 5c — inject any durable memories Lumina has saved for this user.
    // We sort pinned-first, recently-updated next in loadMemoriesForPrompt.
    // Failure to load memories is non-fatal: chat must still work if the
    // Firestore call hiccups.
    let memories: MemoryItem[] = [];
    if (body.username) {
      try {
        memories = await loadMemoriesForPrompt(body.username, 100);
      } catch (memErr) {
        // eslint-disable-next-line no-console
        console.warn("[lumina/chat] memory load failed, continuing:", memErr);
      }
    }
    const sys = memories.length === 0
      ? baseSys
      : `${baseSys}\n\n${formatMemoryBlock(memories)}`;

    const tools: Tool[] = [
      { functionDeclarations: normalizeToolDeclarations(LUMINA_FUNCTION_DECLARATIONS) },
    ];

    const model = genai.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: { role: "system", parts: [{ text: sys }] },
      tools,
      toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    });

    const contents = toGeminiContents(body);
    // Gemini requires the conversation to start with a user turn. If the
    // client sent a transcript that begins with a model entry (e.g. a
    // previous error reply that's still in their chat log), strip it —
    // otherwise we get "function call turn must come immediately after a
    // user turn" on the next round-trip.
    while (contents.length > 0 && contents[0].role !== "user") {
      contents.shift();
    }
    // Also: Gemini will 400 with "function response turn must come
    // immediately after a function call" if the sequence is wrong. The
    // most common cause is a stale `result` whose preceding `call` was
    // dropped (e.g. by the leading-non-user shift above, or by an
    // abort/retry). Walk the contents and drop any functionResponse
    // parts whose immediately-preceding entry isn't a model functionCall
    // for the same name. Belt-and-suspenders before we hand off to SDK.
    const cleaned: Content[] = [];
    for (const c of contents) {
      const isFnResp = c.parts.some((p) => (p as { functionResponse?: unknown }).functionResponse);
      if (isFnResp) {
        const prev = cleaned[cleaned.length - 1];
        const prevHasFnCall =
          prev && prev.role === "model" &&
          prev.parts.some((p) => (p as { functionCall?: unknown }).functionCall);
        if (!prevHasFnCall) {
          // eslint-disable-next-line no-console
          console.warn("[lumina/chat] dropping orphan functionResponse (no preceding functionCall)");
          continue;
        }
      }
      cleaned.push(c);
    }
    // Final guard: if the LAST entry is a model functionCall with no
    // following functionResponse, Gemini won't reject it (it just
    // re-emits), but if the last entry is a model TEXT directly before
    // a fresh request, that's fine. Log the full shape so we can debug
    // future 400s without guessing.
    // eslint-disable-next-line no-console
    console.log("[lumina/chat] sending", {
      contentsLen: cleaned.length,
      shape: cleaned.map((c) => ({
        role: c.role,
        kinds: c.parts.map((p: any) => {
          if ((p as { functionCall?: unknown }).functionCall) return "call:" + ((p as { functionCall: { name: string } }).functionCall.name);
          if ((p as { functionResponse?: unknown }).functionResponse) return "resp:" + ((p as { functionResponse: { name: string } }).functionResponse.name);
          if ((p as { text?: string }).text) return "text(" + ((p as { text: string }).text.length) + ")";
          return "other";
        }),
      })),
    });
    // Run one model turn and pull out either text or function calls. Returns
    // the extracted shape so we can retry once on an empty STOP without
    // duplicating the parsing logic.
    async function runTurn(turnContents: Content[]) {
      const result = await model.generateContent({ contents: turnContents });
      const response = result.response;
      const candidates = response.candidates ?? [];
      const parts = candidates[0]?.content?.parts ?? [];
      const finishReason = candidates[0]?.finishReason;

      // eslint-disable-next-line no-console
      console.log("[lumina/chat] turn complete", {
        finishReason,
        partCount: parts.length,
        partKinds: parts.map((p: any) => {
          if ((p as { functionCall?: unknown }).functionCall) return "call";
          if ((p as { text?: string }).text) return "text";
          return "other";
        }),
        promptFeedback: response.promptFeedback,
      });

      const fnCalls = parts
        .filter((p: any): p is { functionCall: { name: string; args: Record<string, unknown>; thoughtSignature?: string } } =>
          Boolean((p as { functionCall?: unknown }).functionCall)
        )
        .map((p: any) => {
          const fc = p.functionCall;
          // Capture thoughtSignature so the client can echo it back next turn.
          // Required by Gemini 3.x — without it, the follow-up request 400s.
          const tc: ClientToolCall = {
            id: cryptoRandomId(),
            name: fc.name,
            args: (fc.args ?? {}) as Record<string, unknown>,
          };
          if (fc.thoughtSignature) tc.thoughtSignature = fc.thoughtSignature;
          return tc;
        });

      const turnText =
        typeof response.text === "function"
          ? response.text()
          : (parts[0] as { text?: string } | undefined)?.text ?? "";

      return { fnCalls, finishReason, text: turnText || "" };
    }

    let { fnCalls, finishReason, text } = await runTurn(cleaned);

    // Empty STOP — the model finished cleanly but emitted zero text and zero
    // function calls (observed for certain phrasings like "watch ping"). Do
    // ONE retry with the same contents plus a nudge before falling back to a
    // sentinel. Don't retry SAFETY/RECITATION/MAX_TOKENS — those have their
    // own messages and a retry won't help.
    if (fnCalls.length === 0 && !text && finishReason === "STOP") {
      // eslint-disable-next-line no-console
      console.warn("[lumina/chat] empty STOP — retrying once with nudge", {
        contentsLen: cleaned.length,
      });
      const retryContents: Content[] = [
        ...cleaned,
        { role: "user", parts: [{ text: "Please respond." }] },
      ];
      const retry = await runTurn(retryContents);
      if (retry.fnCalls.length > 0 || retry.text) {
        fnCalls = retry.fnCalls;
        text = retry.text;
        finishReason = retry.finishReason;
      }
    }

    if (fnCalls.length > 0) {
      const out: ChatResponseBody = {
        toolCalls: fnCalls,
        modelTurnAt: Date.now(),
      };
      return res.json(out);
    }

    // If the model returned absolutely nothing, surface a useful explanation
    // instead of the silent "(no reply)". Common causes: MAX_TOKENS,
    // SAFETY, RECITATION, or an empty STOP that survived the retry above.
    let finalText = text || "";
    if (!finalText) {
      if (finishReason === "MAX_TOKENS") {
        finalText = "I ran out of room mid-reply (token limit). Try a shorter question or ask me to be brief.";
      } else if (finishReason === "SAFETY") {
        finalText = "My safety filter blocked that reply. Try rephrasing.";
      } else if (finishReason === "RECITATION") {
        finalText = "Reply blocked due to recitation filter.";
      } else if (finishReason && finishReason !== "STOP") {
        finalText = `No reply produced (finish reason: ${finishReason}).`;
      } else {
        finalText = "I couldn't figure out how to respond — try rephrasing or being more specific.";
      }
    }

    const out: ChatResponseBody = {
      text: finalText,
      modelTurnAt: Date.now(),
    };
    return res.json(out);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/chat] error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * Render the stored-memories block appended to the system prompt. Pinned
 * items are visually highlighted with a ☆ so the model can weight them.
 * Kept short — model context dollar value is real.
 */
function formatMemoryBlock(items: MemoryItem[]): string {
  const lines = items.map((m) => {
    const star = m.pinned ? "\u2606 " : "";
    const kind = m.kind && m.kind !== "fact" ? `[${m.kind}] ` : "";
    return `• ${star}${kind}${m.text}`;
  });
  return [
    "=====================================================================",
    "  STORED MEMORIES (durable facts Lumina has saved about Billy)",
    "=====================================================================",
    "These are persistent across sessions. Treat as ground truth about",
    "Billy himself, his preferences, and his shortcuts — NOT as job data.",
    "(Job/markup/photo data still requires a tool call.)",
    "",
    ...lines,
  ].join("\n");
}

function cryptoRandomId(): string {
  // No `crypto.randomUUID` polyfill needed on Node 18+, but be defensive.
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default router;
