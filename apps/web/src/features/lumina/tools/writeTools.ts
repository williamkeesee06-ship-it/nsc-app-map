/**
 * Phase 4 — propose-write tools.
 *
 * These tools never mutate anything directly. They enqueue a PendingAction
 * onto luminaStore. The ChatPanel renders a confirmation card; APPLY runs
 * the real write path (api.putDrawing for markup labels) and triggers the
 * write-glow on success.
 *
 * Three propose tools ship in Phase 4:
 *   - proposeMarkupLabel  → fully wired (asbuilt doc is writable today)
 *   - proposeNotesUpdate  → stubbed: returns ok:false with a clear message,
 *                           because Smartsheet notes have no write path yet
 *   - proposeStatusChange → same — Smartsheet status has no write path yet
 *
 * When notes/status acquire a real write path (future phase), this is the
 * only file that has to change: drop the early-return and add a real
 * PendingNotesUpdate / PendingStatusChange enqueue.
 */

import type {
  LuminaTool,
  LuminaToolContext,
  LuminaToolResult,
  PendingMarkupLabel,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// proposeMarkupLabel — REAL write path
// ─────────────────────────────────────────────────────────────────────────────

interface ProposeMarkupLabelInput {
  jobId: string;
  objectId: string;
  label: string;
}

interface ProposeMarkupLabelData {
  queued: true;
  pendingActionId: string;
  jobId: string;
  objectId: string;
  label: string;
}

async function runProposeMarkupLabel(
  input: ProposeMarkupLabelInput,
  ctx: LuminaToolContext
): Promise<LuminaToolResult<ProposeMarkupLabelData>> {
  if (!input.jobId || !input.objectId || typeof input.label !== "string") {
    return {
      ok: false,
      message: "proposeMarkupLabel requires jobId, objectId, and label.",
    };
  }

  const pendingId = `pma_${crypto.randomUUID()}`;
  const action: PendingMarkupLabel = {
    id: pendingId,
    kind: "markupLabel",
    createdAt: Date.now(),
    title: `Label markup ${input.objectId.slice(0, 8)} on ${input.jobId}`,
    diff: [{ field: "label", after: input.label }],
    jobId: input.jobId,
    objectId: input.objectId,
    label: input.label,
  };
  ctx.enqueueAction(action);

  return {
    ok: true,
    message:
      "Queued. Tell Billy verbally that the label change is queued and ask him to approve it on the confirmation card.",
    pendingActionId: pendingId,
    data: {
      queued: true,
      pendingActionId: pendingId,
      jobId: input.jobId,
      objectId: input.objectId,
      label: input.label,
    },
  };
}

export const proposeMarkupLabelTool: LuminaTool<
  ProposeMarkupLabelInput,
  ProposeMarkupLabelData
> = {
  name: "proposeMarkupLabel",
  description:
    "Draft a label change for a markup object. Does NOT write — queues a confirmation card that Billy must approve.",
  kind: "propose",
  run: runProposeMarkupLabel,
};

// ─────────────────────────────────────────────────────────────────────────────
// proposeNotesUpdate — STUB (no write path yet)
// proposeStatusChange — STUB (no write path yet)
//
// We register these so the model gets a clear "not available yet" answer
// instead of silently failing to call an undefined tool. The model is
// expected to relay this verbatim to Billy.
// ─────────────────────────────────────────────────────────────────────────────

interface ProposeNotesUpdateInput {
  jobId: string;
  notes: string;
}

async function runProposeNotesUpdate(
  _input: ProposeNotesUpdateInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<{ available: false }>> {
  return {
    ok: false,
    message:
      "Notes updates aren't wired to Smartsheet yet. Tell Billy: \"I can't write notes back to Smartsheet from here yet — you'll have to edit that one manually for now.\" Do not queue or claim it as done.",
    data: { available: false },
  };
}

export const proposeNotesUpdateTool: LuminaTool<
  ProposeNotesUpdateInput,
  { available: false }
> = {
  name: "proposeNotesUpdate",
  description:
    "Draft a notes update for a job. Does NOT write — queues a confirmation card that Billy must approve.",
  kind: "propose",
  run: runProposeNotesUpdate,
};

interface ProposeStatusChangeInput {
  jobId: string;
  status: string;
}

async function runProposeStatusChange(
  _input: ProposeStatusChangeInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<{ available: false }>> {
  return {
    ok: false,
    message:
      "Status changes aren't wired to Smartsheet yet. Tell Billy: \"I can't push status changes back to Smartsheet from here yet — you'll have to set that one manually for now.\" Do not queue or claim it as done.",
    data: { available: false },
  };
}

export const proposeStatusChangeTool: LuminaTool<
  ProposeStatusChangeInput,
  { available: false }
> = {
  name: "proposeStatusChange",
  description:
    "Draft a status change for a job. Does NOT write — queues a confirmation card that Billy must approve.",
  kind: "propose",
  run: runProposeStatusChange,
};

// Convenience bundle for the registry.
export const writeTools = [
  proposeMarkupLabelTool,
  proposeNotesUpdateTool,
  proposeStatusChangeTool,
];
