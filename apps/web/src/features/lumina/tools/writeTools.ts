/**
 * Phase 4 + Sprint 1.4 + Sprint 2.1 — propose-write tools.
 *
 * These tools NEVER mutate anything directly. They enqueue a PendingAction
 * onto luminaStore. ChatPanel renders a confirmation card; APPLY runs the
 * real write path and triggers the write-glow on success.
 *
 * Pattern (mirrors proposeMarkupLabel — the original reference):
 *   1. Validate input shape, return ok:false on bad args.
 *   2. Build a PendingAction with a discriminated `kind`.
 *   3. Enqueue via ctx.enqueueAction(action).
 *   4. Return ok:true with the verbatim "Queued. Tell Billy …" message so
 *      the model relays it instead of inventing a confirmation.
 *
 * Live propose tools:
 *   - proposeMarkupLabel  → asbuilt drawing doc (Firestore)
 *   - proposeNotesUpdate  → Smartsheet NSC Project Notes (Sprint 1.4)
 *   - proposeStatusChange → Smartsheet Job Status / Secondary Job Status
 *   - proposeReschedule   → Smartsheet Schedule Date / End Date (Sprint 2.1)
 */

import type {
  LuminaTool,
  LuminaToolContext,
  LuminaToolResult,
  PendingMarkupLabel,
  PendingNotesUpdate,
  PendingReschedule,
  PendingStatusChange,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// proposeMarkupLabel — REAL write path (Firestore asbuilt doc)
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
// proposeNotesUpdate — REAL write path (Smartsheet NSC Project Notes)
// Sprint 1.4. Server stamps the note with "MM/DD/YY - Billy: <text>" so the
// history reads cleanly when multiple notes pile up over a project's life.
// ─────────────────────────────────────────────────────────────────────────────

interface ProposeNotesUpdateInput {
  jobId: string;
  notes: string;
  mode?: "append" | "replace";
}

interface ProposeNotesUpdateData {
  queued: true;
  pendingActionId: string;
  jobId: string;
  notes: string;
  mode: "append" | "replace";
}

async function runProposeNotesUpdate(
  input: ProposeNotesUpdateInput,
  ctx: LuminaToolContext
): Promise<LuminaToolResult<ProposeNotesUpdateData>> {
  if (!input.jobId || typeof input.notes !== "string" || !input.notes.trim()) {
    return {
      ok: false,
      message: "proposeNotesUpdate requires jobId and a non-empty notes string.",
    };
  }
  // Default to "append" — Billy almost never wants to wipe historical notes,
  // and if he does he can say "replace the note with…".
  const mode: "append" | "replace" = input.mode === "replace" ? "replace" : "append";

  const pendingId = `pnu_${crypto.randomUUID()}`;
  const action: PendingNotesUpdate = {
    id: pendingId,
    kind: "notesUpdate",
    createdAt: Date.now(),
    title: `${mode === "append" ? "Append note" : "Replace note"} on ${input.jobId}`,
    diff: [{ field: mode === "append" ? "notes (append)" : "notes (replace)", after: input.notes.trim() }],
    jobId: String(input.jobId),
    notes: input.notes.trim(),
    mode,
  };
  ctx.enqueueAction(action);

  return {
    ok: true,
    message:
      "Queued. Tell Billy verbally that the note is queued and ask him to approve it on the confirmation card.",
    pendingActionId: pendingId,
    data: {
      queued: true,
      pendingActionId: pendingId,
      jobId: String(input.jobId),
      notes: input.notes.trim(),
      mode,
    },
  };
}

export const proposeNotesUpdateTool: LuminaTool<
  ProposeNotesUpdateInput,
  ProposeNotesUpdateData
> = {
  name: "proposeNotesUpdate",
  description:
    "Draft a notes update for a job (Smartsheet NSC Project Notes). Does NOT write — queues a confirmation card that Billy must approve.",
  kind: "propose",
  run: runProposeNotesUpdate,
};

// ─────────────────────────────────────────────────────────────────────────────
// proposeStatusChange — REAL write path (Smartsheet Job Status)
// Sprint 1.4. statusKind defaults to "primary" (Job Status column);
// pass "secondary" to write the Secondary Job Status column instead.
// ─────────────────────────────────────────────────────────────────────────────

interface ProposeStatusChangeInput {
  jobId: string;
  status: string;
  statusKind?: "primary" | "secondary";
}

interface ProposeStatusChangeData {
  queued: true;
  pendingActionId: string;
  jobId: string;
  status: string;
  statusKind: "primary" | "secondary";
}

async function runProposeStatusChange(
  input: ProposeStatusChangeInput,
  ctx: LuminaToolContext
): Promise<LuminaToolResult<ProposeStatusChangeData>> {
  if (!input.jobId || typeof input.status !== "string" || !input.status.trim()) {
    return {
      ok: false,
      message: "proposeStatusChange requires jobId and a non-empty status.",
    };
  }
  const statusKind: "primary" | "secondary" =
    input.statusKind === "secondary" ? "secondary" : "primary";

  const pendingId = `psc_${crypto.randomUUID()}`;
  const action: PendingStatusChange = {
    id: pendingId,
    kind: "statusChange",
    createdAt: Date.now(),
    title: `Set ${statusKind === "secondary" ? "secondary status" : "status"} on ${input.jobId}`,
    diff: [
      {
        field: statusKind === "secondary" ? "Secondary Job Status" : "Job Status",
        after: input.status.trim(),
      },
    ],
    jobId: String(input.jobId),
    status: input.status.trim(),
    statusKind,
  };
  ctx.enqueueAction(action);

  return {
    ok: true,
    message:
      "Queued. Tell Billy verbally that the status change is queued and ask him to approve it on the confirmation card.",
    pendingActionId: pendingId,
    data: {
      queued: true,
      pendingActionId: pendingId,
      jobId: String(input.jobId),
      status: input.status.trim(),
      statusKind,
    },
  };
}

export const proposeStatusChangeTool: LuminaTool<
  ProposeStatusChangeInput,
  ProposeStatusChangeData
> = {
  name: "proposeStatusChange",
  description:
    "Draft a status change for a job (Smartsheet Job Status, or Secondary Job Status when statusKind='secondary'). Does NOT write — queues a confirmation card that Billy must approve.",
  kind: "propose",
  run: runProposeStatusChange,
};

// ─────────────────────────────────────────────────────────────────────────────
// proposeReschedule — REAL write path (Smartsheet Schedule Date / End Date)
// Sprint 2.1. scheduleDate is required (YYYY-MM-DD); endDate is required for
// multi-day jobs. Server refuses if endDate < scheduleDate.
// ─────────────────────────────────────────────────────────────────────────────

interface ProposeRescheduleInput {
  jobId: string;
  scheduleDate: string;
  endDate?: string;
}

interface ProposeRescheduleData {
  queued: true;
  pendingActionId: string;
  jobId: string;
  scheduleDate: string;
  endDate?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function runProposeReschedule(
  input: ProposeRescheduleInput,
  ctx: LuminaToolContext
): Promise<LuminaToolResult<ProposeRescheduleData>> {
  if (!input.jobId) {
    return { ok: false, message: "proposeReschedule requires jobId." };
  }
  if (!input.scheduleDate || !DATE_RE.test(input.scheduleDate)) {
    return {
      ok: false,
      message: "proposeReschedule requires scheduleDate in YYYY-MM-DD format.",
    };
  }
  if (input.endDate && !DATE_RE.test(input.endDate)) {
    return {
      ok: false,
      message: "proposeReschedule endDate must be YYYY-MM-DD when provided.",
    };
  }
  if (input.endDate && input.endDate < input.scheduleDate) {
    return {
      ok: false,
      message: "proposeReschedule endDate cannot be before scheduleDate.",
    };
  }

  const pendingId = `prs_${crypto.randomUUID()}`;
  const diff: Array<{ field: string; after?: string }> = [
    { field: "Schedule Date", after: input.scheduleDate },
  ];
  if (input.endDate) diff.push({ field: "End Date", after: input.endDate });

  const action: PendingReschedule = {
    id: pendingId,
    kind: "reschedule",
    createdAt: Date.now(),
    title: input.endDate
      ? `Reschedule ${input.jobId} → ${input.scheduleDate} to ${input.endDate}`
      : `Reschedule ${input.jobId} → ${input.scheduleDate}`,
    diff,
    jobId: String(input.jobId),
    scheduleDate: input.scheduleDate,
    endDate: input.endDate,
  };
  ctx.enqueueAction(action);

  return {
    ok: true,
    message:
      "Queued. Tell Billy verbally that the reschedule is queued and ask him to approve it on the confirmation card.",
    pendingActionId: pendingId,
    data: {
      queued: true,
      pendingActionId: pendingId,
      jobId: String(input.jobId),
      scheduleDate: input.scheduleDate,
      endDate: input.endDate,
    },
  };
}

export const proposeRescheduleTool: LuminaTool<
  ProposeRescheduleInput,
  ProposeRescheduleData
> = {
  name: "proposeReschedule",
  description:
    "Draft a schedule date move for a job (Smartsheet Schedule Date and optional End Date for multi-day jobs). Does NOT write — queues a confirmation card that Billy must approve.",
  kind: "propose",
  run: runProposeReschedule,
};

// ─────────────────────────────────────────────────────────────────────────────
// proposeJobUpdate — REAL write path (Arbitrary Job Field Mutation)
// God Mode execution tool.
// ─────────────────────────────────────────────────────────────────────────────

interface ProposeJobUpdateInput {
  jobId: string;
  updates: Record<string, any>;
}

interface ProposeJobUpdateData {
  queued: true;
  pendingActionId: string;
  jobId: string;
  updates: Record<string, any>;
}

async function runProposeJobUpdate(
  input: ProposeJobUpdateInput,
  ctx: LuminaToolContext
): Promise<LuminaToolResult<ProposeJobUpdateData>> {
  if (!input.jobId || !input.updates || Object.keys(input.updates).length === 0) {
    return {
      ok: false,
      message: "proposeJobUpdate requires jobId and at least one field to update.",
    };
  }

  const pendingId = `pju_${crypto.randomUUID()}`;
  
  const diff = Object.entries(input.updates).map(([field, after]) => ({
    field,
    after: String(after)
  }));

  const action: import("./types.js").PendingJobUpdate = {
    id: pendingId,
    kind: "jobUpdate",
    createdAt: Date.now(),
    title: `Update fields on ${input.jobId}`,
    diff,
    jobId: String(input.jobId),
    updates: input.updates,
  };
  ctx.enqueueAction(action as any);

  return {
    ok: true,
    message:
      "Queued. Tell Billy verbally that the job update is queued and ask him to approve it on the confirmation card.",
    pendingActionId: pendingId,
    data: {
      queued: true,
      pendingActionId: pendingId,
      jobId: String(input.jobId),
      updates: input.updates,
    },
  };
}

export const proposeJobUpdateTool: LuminaTool<
  ProposeJobUpdateInput,
  ProposeJobUpdateData
> = {
  name: "proposeJobUpdate",
  description:
    "Draft a mutation for ANY field on a job (e.g. assigning a crew, changing a description). Does NOT write — queues a confirmation card that Billy must approve.",
  kind: "propose",
  run: runProposeJobUpdate,
};

// Convenience bundle for the registry.
export const writeTools = [
  proposeMarkupLabelTool,
  proposeNotesUpdateTool,
  proposeStatusChangeTool,
  proposeRescheduleTool,
  proposeJobUpdateTool,
];
