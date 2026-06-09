/**
 * LUMINA CHAT — server-side proxy for text-mode chat with Gemini 3.5 Flash.
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
      // model sees its own prior intent on the next turn.
      out.push({
        role: "model",
        parts: turn.calls.map((c) => ({
          functionCall: { name: c.name, args: c.args },
        })),
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
  if (!body || !Array.isArray(body.history)) {
    return res.status(400).json({ error: "invalid body — history[] required" });
  }

  try {
    const genai = new GoogleGenerativeAI(apiKey);

    // System prompt — same locks as Live mode, with username swapped in.
    const baseSys = LUMINA_SYSTEM_INSTRUCTION.replace(
      "Billy Keesee",
      body.username ? `${body.username}` : "Billy Keesee"
    );

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
      model: "gemini-3.5-flash",
      systemInstruction: { role: "system", parts: [{ text: sys }] },
      tools,
      // No automatic function calling — we do roundtrips through the client
      // so the same dispatchTool registry runs in both text and voice modes.
      toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      },
    });

    const contents = toGeminiContents(body);
    const result = await model.generateContent({ contents });
    const response = result.response;

    // Pull out either text or function calls.
    const candidates = response.candidates ?? [];
    const parts = candidates[0]?.content?.parts ?? [];

    const fnCalls = parts
      .filter((p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
        Boolean((p as { functionCall?: unknown }).functionCall)
      )
      .map((p) => ({
        id: cryptoRandomId(),
        name: p.functionCall.name,
        args: (p.functionCall.args ?? {}) as Record<string, unknown>,
      }));

    if (fnCalls.length > 0) {
      const out: ChatResponseBody = {
        toolCalls: fnCalls,
        modelTurnAt: Date.now(),
      };
      return res.json(out);
    }

    const text =
      typeof response.text === "function" ? response.text() : (parts[0] as { text?: string } | undefined)?.text ?? "";

    const out: ChatResponseBody = {
      text: text || "",
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
