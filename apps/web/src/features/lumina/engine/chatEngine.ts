/**
 * Lumina chat engine — orchestrates one user turn through the server-side
 * Gemini proxy and the client-side tool registry.
 *
 * Flow:
 *   1. User sends a message → engine pushes it to luminaStore.
 *   2. Engine POSTs /api/lumina/chat with the full history + new message.
 *   3. Server runs gemini-3.5-flash. If the model emits function calls,
 *      engine dispatches each via dispatchTool() (read tools hit /api,
 *      nav tools drive the map, propose-* enqueue confirmation cards),
 *      collects results, and re-POSTs.
 *   4. Loop until the model returns text → push as a Lumina message.
 *
 * Anti-loop guard: MAX_ROUNDS bounds how many tool roundtrips we'll do
 * per user turn so a bad prompt can't burn the model in a cycle.
 */

import type {
  ChatMessage,
  ToolTrace,
} from "../store/luminaStore.js";
import { dispatchTool } from "../tools/index.js";
import type { LuminaToolContext } from "../tools/types.js";

const MAX_ROUNDS = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Wire types — must mirror apps/api/src/routes/luminaChat.ts
// ─────────────────────────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface ToolResult {
  id: string;
  name: string;
  result: { ok: boolean; message?: string; data?: unknown };
}

type HistoryEntry =
  | { kind: "text"; role: "user" | "model"; text: string }
  | { kind: "call"; calls: ToolCall[] }
  | { kind: "result"; results: ToolResult[] };

interface ChatResponseBody {
  text?: string;
  toolCalls?: ToolCall[];
  modelTurnAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// History conversion — luminaStore.ChatMessage[] → wire HistoryEntry[].
// We don't try to replay tool calls — the store only holds final messages.
// (If the user just typed something, the immediately-prior call/result
// pairs are passed to runUserTurn via the local `live` array.)
// ─────────────────────────────────────────────────────────────────────────────

function messagesToHistory(messages: ChatMessage[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const m of messages) {
    out.push({
      kind: "text",
      role: m.role === "user" ? "user" : "model",
      text: m.text,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers exposed to the chat panel.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatEngineDeps {
  /** All previously-rendered messages (the user just-typed message NOT yet
   *  in this array — pass it as `newUserMessage`). */
  priorMessages: ChatMessage[];
  newUserMessage: string;
  username: string;
  /** Tool dispatch context (map bridge, action queue). */
  toolCtx: LuminaToolContext;
  /** Called when the engine has the final text reply ready. */
  onAssistantMessage: (msg: ChatMessage) => void;
  /** Called per tool call so the UI can show a trace strip. */
  onToolTrace: (trace: ToolTrace) => void;
  /** Called to flip the orb state during the turn. */
  setOrbState: (s: "idle" | "thinking" | "error" | "queued") => void;
  /** Optional abort signal so a next user turn can cut off a stale one. */
  signal?: AbortSignal;
}

export async function runUserTurn(deps: ChatEngineDeps): Promise<void> {
  const { priorMessages, newUserMessage, username, toolCtx } = deps;
  const baseHistory = messagesToHistory(priorMessages);
  // `live` carries the in-turn tool call/result pairs for re-POST.
  const live: HistoryEntry[] = [];
  // The first request carries the user message; subsequent ones don't.
  let firstRequest = true;
  let assistantId: string | null = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    deps.setOrbState("thinking");
    let body: ChatResponseBody;
    try {
      const res = await fetch("/api/lumina/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: deps.signal,
        body: JSON.stringify({
          history: [...baseHistory, ...live],
          newUserMessage: firstRequest ? newUserMessage : undefined,
          username,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`/api/lumina/chat ${res.status}: ${errText.slice(0, 240)}`);
      }
      body = (await res.json()) as ChatResponseBody;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[lumina/engine] chat request failed", err);
      deps.setOrbState("error");
      deps.onAssistantMessage({
        id: crypto.randomUUID(),
        role: "lumina",
        text:
          err instanceof Error && err.name === "AbortError"
            ? "Cancelled."
            : `I hit an error reaching the chat service. ${
                err instanceof Error ? err.message : String(err)
              }`,
        at: Date.now(),
      });
      return;
    }
    firstRequest = false;

    // ── Tool calls — dispatch each, push results, loop ──────────────────
    if (body.toolCalls && body.toolCalls.length > 0) {
      live.push({ kind: "call", calls: body.toolCalls });

      const results: ToolResult[] = [];
      for (const call of body.toolCalls) {
        const t0 = performance.now();
        const r = await dispatchTool(call.name, call.args, toolCtx);
        const ms = Math.round(performance.now() - t0);
        const trace: ToolTrace = {
          toolName: call.name,
          argsSummary: summarizeArgs(call.args),
          ok: r.ok,
          ms,
          message: r.message,
          at: Date.now(),
        };
        deps.onToolTrace(trace);
        results.push({
          id: call.id,
          name: call.name,
          result: {
            ok: r.ok,
            message: r.message,
            data: r.data,
          },
        });
        // If any tool queued a pending action, flip the orb to queued so
        // Billy sees there's a card waiting. The engine keeps going so the
        // model can produce its "queued — check the card" reply.
        if (r.pendingActionId) deps.setOrbState("queued");
      }
      live.push({ kind: "result", results });
      continue;
    }

    // ── Final text reply ────────────────────────────────────────────────
    const text = body.text?.trim() || "(no reply)";
    if (!assistantId) assistantId = crypto.randomUUID();
    deps.onAssistantMessage({
      id: assistantId,
      role: "lumina",
      text,
      at: body.modelTurnAt ?? Date.now(),
    });
    deps.setOrbState("idle");
    return;
  }

  // Hit the round cap.
  deps.onAssistantMessage({
    id: crypto.randomUUID(),
    role: "lumina",
    text: "I got stuck calling tools — too many rounds. Try rephrasing.",
    at: Date.now(),
  });
  deps.setOrbState("error");
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args ?? {});
  if (keys.length === 0) return "";
  const first = keys[0];
  const v = args[first];
  const str = typeof v === "string" ? v : JSON.stringify(v);
  const short = str.length > 24 ? `${str.slice(0, 24)}…` : str;
  return keys.length === 1 ? `${first}=${short}` : `${first}=${short}, …`;
}
