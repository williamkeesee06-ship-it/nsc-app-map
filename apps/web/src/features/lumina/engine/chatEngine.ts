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
import { request } from "../../../lib/api.js";

const MAX_ROUNDS = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Wire types — must mirror apps/api/src/routes/luminaChat.ts
// ─────────────────────────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Opaque signature from Gemini 3.x thinking models. Echo back unchanged
   *  on the next request — without it the API rejects the followup. */
  thoughtSignature?: string;
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

// Heuristic: text turns produced by the engine's own error stub. These
// must never be replayed back to Gemini — they're sentinels we wrote to
// the UI, not real model output, and they create invalid turn sequences.
const ERROR_STUB_PATTERNS: RegExp[] = [
  /^I hit an error/i,
  /^Cancelled\.?$/i,
  /^I got stuck calling tools/i,
  /^\(no reply\)$/i,
  /^\(empty reply from model\)$/i,
  /^I couldn't figure out how to respond/i,
  /^My safety filter blocked/i,
  /^Reply blocked due to recitation/i,
  /^I ran out of room mid-reply/i,
  /^No reply produced \(finish reason:/i,
];

function isErrorStub(text: string): boolean {
  const trimmed = text.trim();
  return ERROR_STUB_PATTERNS.some((p) => p.test(trimmed));
}

function messagesToHistory(messages: ChatMessage[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const m of messages) {
    // Drop our own error stubs — they're UI sentinels, not model output,
    // and replaying them to Gemini corrupts the turn sequence.
    if (m.role !== "user" && isErrorStub(m.text)) continue;
    out.push({
      kind: "text",
      role: m.role === "user" ? "user" : "model",
      text: m.text,
    });
  }
  // Gemini requires history to start with a user turn (a model turn first
  // throws "function call turn must come immediately after a user turn"
  // once a tool call lands). Strip any leading model entries so a previous
  // error-message reply doesn't poison the next turn.
  while (out.length > 0 && out[0].kind === "text" && out[0].role === "model") {
    out.shift();
  }
  // Belt-and-suspenders: collapse any model→model run by dropping the
  // earlier one. Gemini occasionally rejects back-to-back model turns
  // when one is empty.
  for (let i = out.length - 1; i > 0; i--) {
    const prev = out[i - 1];
    const cur = out[i];
    if (
      prev.kind === "text" &&
      cur.kind === "text" &&
      prev.role === "model" &&
      cur.role === "model"
    ) {
      out.splice(i - 1, 1);
    }
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
  drawingState?: any;
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
  // Fold the just-typed user message into baseHistory once — then every
  // round-trip sends the same complete prefix + accumulating tool turns.
  // (Previously newUserMessage was only attached on round 1; round 2's
  // request lost the user question entirely, leaving Gemini with
  // model-text → model-functionCall, which is invalid.)
  const baseHistory: HistoryEntry[] = [
    ...messagesToHistory(priorMessages),
    { kind: "text", role: "user", text: newUserMessage },
  ];
  // `live` carries the in-turn tool call/result pairs for re-POST.
  const live: HistoryEntry[] = [];
  let assistantId: string | null = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    deps.setOrbState("thinking");
    let body: ChatResponseBody;
    try {
      body = await request<ChatResponseBody>("/api/lumina/chat", {
        method: "POST",
        signal: deps.signal,
        body: JSON.stringify({
          // Send the full prefix on every round so the API can run
          // statelessly. The user message is already in baseHistory so
          // we never pass newUserMessage as a separate field anymore.
          history: [...baseHistory, ...live],
          username,
          drawingContext: deps.drawingState ? {
            activeTool: deps.drawingState.activeTool,
            selectedIds: Array.from(deps.drawingState.selectedIds || []),
            objectsCount: deps.drawingState.objects?.length || 0,
            dirty: deps.drawingState.dirty,
            targetWorkOrder: deps.drawingState.targetWorkOrder,
            selectedObjects: (deps.drawingState.objects || []).filter((o: any) => 
              deps.drawingState.selectedIds?.has(o.id)
            ).map((o: any) => ({
              id: o.id,
              tool: o.tool,
              properties: o.properties,
              geometry: o.geometry
            }))
          } : null
        }),
      });
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
    const text =
      body.text?.trim() ||
      "I couldn't figure out how to respond — try rephrasing or being more specific.";
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
