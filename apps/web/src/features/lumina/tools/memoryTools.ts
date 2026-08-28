/**
 * Phase 5 — Lumina memory tools.
 *
 * Two tools:
 *   - recallMemory     → READ. Lists what Lumina already knows about the
 *                        operator. The server ALSO injects these into the
 *                        system prompt on every chat turn, but a tool exists
 *                        so Lumina can intentionally "list what you remember"
 *                        when asked, or fetch a fresh copy mid-conversation.
 *
 *   - proposeMemorySave → PROPOSE. Queues a confirmation card so Billy must
 *                         tap APPLY before anything writes to Firestore.
 *                         Mirrors the Phase 4 propose-* contract exactly.
 *
 * Deletion / pinning happens through the Memory UI panel (Phase 5d) — not
 * through a tool. Rationale: the model should never silently delete what
 * the operator told it to remember; manual UI keeps that explicit.
 */

import { api } from "../../../lib/api.js";
import type {
  LuminaTool,
  LuminaToolContext,
  LuminaToolResult,
  PendingMemorySave,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// recallMemory — read all of Billy's stored memories
// ─────────────────────────────────────────────────────────────────────────────

interface RecallMemoryInput {
  /** Optional substring filter — case-insensitive contains match on text. */
  query?: string;
  /** Optional kind filter ("fact" | "pref" | "shortcut" | custom). */
  kind?: string;
}

interface RecallMemoryData {
  count: number;
  items: Array<{
    id: string;
    text: string;
    kind: string;
    pinned: boolean;
    updatedAt: number;
  }>;
}

async function runRecallMemory(
  input: RecallMemoryInput,
  ctx: LuminaToolContext
): Promise<LuminaToolResult<RecallMemoryData>> {
  if (!ctx.username) {
    return {
      ok: false,
      message: "No operator username — can't load memories.",
    };
  }
  try {
    const { items } = await api.listMemories(ctx.username);

    // Filter client-side. Memory sets are small (≤200 items) so this is fine.
    const q = (input.query || "").trim().toLowerCase();
    const kindFilter = (input.kind || "").trim().toLowerCase();
    const filtered = items.filter((m) => {
      if (q && !m.text.toLowerCase().includes(q)) return false;
      if (kindFilter && m.kind.toLowerCase() !== kindFilter) return false;
      return true;
    });

    // Pinned first, then most-recently-updated.
    filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    return {
      ok: true,
      message: `Recalled ${filtered.length} memor${filtered.length === 1 ? "y" : "ies"}.`,
      data: {
        count: filtered.length,
        items: filtered.map((m) => ({
          id: m.id,
          text: m.text,
          kind: m.kind,
          pinned: m.pinned,
          updatedAt: m.updatedAt,
        })),
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: `recallMemory failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const recallMemoryTool: LuminaTool<RecallMemoryInput, RecallMemoryData> = {
  name: "recallMemory",
  description:
    "List durable memories Lumina has stored about Billy (facts, preferences, shortcuts). Optional substring or kind filter. Memories also auto-load into Lumina's system prompt on every turn — call this only when Billy explicitly asks 'what do you remember' or you need to filter to a specific bucket.",
  kind: "read",
  run: runRecallMemory,
};

// ─────────────────────────────────────────────────────────────────────────────
// proposeMemorySave — queue a confirmation card; APPLY actually writes
// ─────────────────────────────────────────────────────────────────────────────

interface ProposeMemorySaveInput {
  /** Verbatim text Lumina wants to remember (≤500 chars; server clamps). */
  text: string;
  /** Bucket — defaults to "fact" if the model omits it. */
  kind?: string;
}

interface ProposeMemorySaveData {
  queued: true;
  pendingActionId: string;
  text: string;
  kind: string;
}

async function runProposeMemorySave(
  input: ProposeMemorySaveInput,
  ctx: LuminaToolContext
): Promise<LuminaToolResult<ProposeMemorySaveData>> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) {
    return {
      ok: false,
      message: "proposeMemorySave requires non-empty text.",
    };
  }
  const kind = (input.kind || "fact").toLowerCase().trim().slice(0, 32) || "fact";

  const pendingId = `pms_${crypto.randomUUID()}`;
  const action: PendingMemorySave = {
    id: pendingId,
    kind: "memorySave",
    createdAt: Date.now(),
    title: `Remember: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`,
    diff: [{ field: kind, after: text }],
    text,
    memoryKind: kind,
  };
  ctx.enqueueAction(action);

  return {
    ok: true,
    message:
      "Queued. Tell Billy verbally that the memory is queued and ask him to approve it on the confirmation card.",
    pendingActionId: pendingId,
    data: {
      queued: true,
      pendingActionId: pendingId,
      text,
      kind,
    },
  };
}

export const proposeMemorySaveTool: LuminaTool<
  ProposeMemorySaveInput,
  ProposeMemorySaveData
> = {
  name: "proposeMemorySave",
  description:
    "Draft a durable memory for Lumina to keep about Billy (a fact, preference, or shortcut). Does NOT write — queues a confirmation card that Billy must approve. Use when Billy says 'remember that…', 'don't forget…', or states a durable preference Lumina should carry forward.",
  kind: "propose",
  run: runProposeMemorySave,
};

export const memoryTools = [recallMemoryTool, proposeMemorySaveTool];
