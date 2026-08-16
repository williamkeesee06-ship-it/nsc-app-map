// sheetRegistrationService — Phase 3 (NSMS).
//
// Persists PDF-affine sheet registrations (control points + best-fit transform)
// that let a paper print bind to real WGS84 coordinates. These sit at
//   jobs/{jobId}/sheetRegistrations/{registrationId}
// and are consumed by the client-side print-overlay tooling and by the
// print-overlay → Earth revision bridge to project sheet-space markups onto
// the map.
//
// The transform is stored (not recomputed on the fly) so that revisions and
// audit trails freeze the exact math that the field crew used at capture time.
// Recomputing on read would silently invalidate historical drawings if inputs
// were later edited.
//
// This service is deliberately thin: it does NOT compute the affine here —
// the client uses `printGeoreference.ts` for that, submits the resulting
// SheetRegistration payload, and the server enforces schema + append-only
// semantics. Best-fit numerics stay client-side because they depend on live
// user picking.

import { db } from "../lib/firestore.js";
import type { SheetRegistration } from "@nsc/types";
import { recordAuditEvent } from "./auditEventService.js";

const MAX_CONTROL_POINTS = 32;

function assertControlPoint(
  cp: SheetRegistration["controlPoints"][number],
  idx: number
): void {
  if (
    typeof cp?.sheet?.x !== "number" ||
    typeof cp?.sheet?.y !== "number" ||
    typeof cp?.geographic?.lat !== "number" ||
    typeof cp?.geographic?.lng !== "number"
  ) {
    throw new Error(`controlPoints[${idx}] must have numeric sheet.x/y and geographic.lat/lng`);
  }
  if (cp.sheet.x < 0 || cp.sheet.x > 1 || cp.sheet.y < 0 || cp.sheet.y > 1) {
    throw new Error(`controlPoints[${idx}] sheet coordinates must be normalized to [0,1]`);
  }
  if (
    !Number.isFinite(cp.geographic.lat) ||
    cp.geographic.lat < -90 ||
    cp.geographic.lat > 90 ||
    !Number.isFinite(cp.geographic.lng) ||
    cp.geographic.lng < -180 ||
    cp.geographic.lng > 180
  ) {
    throw new Error(`controlPoints[${idx}] geographic lat/lng out of WGS84 bounds`);
  }
}

function assertTransform(t: SheetRegistration["transform"]): void {
  if (
    !t ||
    !Number.isFinite(t.scale) ||
    !Number.isFinite(t.rotationRad) ||
    !Number.isFinite(t.tx) ||
    !Number.isFinite(t.ty)
  ) {
    throw new Error("transform must have finite numeric scale/rotationRad/tx/ty");
  }
  if (t.scale <= 0) throw new Error("transform.scale must be > 0");
}

function validate(reg: Omit<SheetRegistration, "id" | "createdAt">): void {
  if (!reg.jobId) throw new Error("jobId required");
  if (!reg.documentId) throw new Error("documentId required");
  if (!Number.isInteger(reg.pageNumber) || reg.pageNumber < 1) {
    throw new Error("pageNumber must be a positive integer");
  }
  if (!["corner", "control-point", "warp"].includes(reg.method)) {
    throw new Error(`unknown method: ${reg.method}`);
  }
  if (!Array.isArray(reg.controlPoints) || reg.controlPoints.length < 2) {
    throw new Error("controlPoints must contain at least 2 points");
  }
  if (reg.controlPoints.length > MAX_CONTROL_POINTS) {
    throw new Error(`controlPoints exceeds max ${MAX_CONTROL_POINTS}`);
  }
  reg.controlPoints.forEach(assertControlPoint);
  assertTransform(reg.transform);
  if (reg.rmsError !== undefined && (!Number.isFinite(reg.rmsError) || reg.rmsError < 0)) {
    throw new Error("rmsError must be a non-negative finite number");
  }
  if (!["low", "medium", "high"].includes(reg.confidence)) {
    throw new Error(`unknown confidence: ${reg.confidence}`);
  }
  if (!reg.createdBy) throw new Error("createdBy required");
}

/**
 * Persist a sheet registration and emit an audit event. Registrations are
 * append-only: new captures for the same page produce a new registration
 * document. The client picks which registration is "active" via a separate
 * lookup (most recent by page, or explicit selection).
 */
export async function createSheetRegistration(
  input: Omit<SheetRegistration, "id" | "createdAt">
): Promise<SheetRegistration> {
  validate(input);
  const jobRef = db().collection("jobs").doc(input.jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) throw new Error(`Job ${input.jobId} not found`);

  const now = Date.now();
  const id = `sr_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const stored: SheetRegistration = { ...input, id, createdAt: now };

  await jobRef.collection("sheetRegistrations").doc(id).set(stored);

  await recordAuditEvent(input.jobId, {
    eventType: "sheet_registered",
    summary: `Sheet ${input.documentId} page ${input.pageNumber} registered (${input.method}, ${input.confidence} confidence)`,
    userEmail: input.createdBy,
    metadata: {
      registrationId: id,
      documentId: input.documentId,
      pageNumber: input.pageNumber,
      method: input.method,
      confidence: input.confidence,
      rmsError: input.rmsError ?? null,
      controlPointCount: input.controlPoints.length,
    },
  });

  return stored;
}

export async function listSheetRegistrations(
  jobId: string,
  filter?: { documentId?: string; pageNumber?: number }
): Promise<SheetRegistration[]> {
  let q: FirebaseFirestore.Query = db()
    .collection("jobs")
    .doc(jobId)
    .collection("sheetRegistrations");
  if (filter?.documentId) q = q.where("documentId", "==", filter.documentId);
  if (filter?.pageNumber !== undefined) q = q.where("pageNumber", "==", filter.pageNumber);
  const snap = await q.get();
  return snap.docs
    .map((d) => d.data() as SheetRegistration)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteSheetRegistration(
  jobId: string,
  registrationId: string,
  deletedBy: string
): Promise<{ ok: true }> {
  const ref = db()
    .collection("jobs")
    .doc(jobId)
    .collection("sheetRegistrations")
    .doc(registrationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Sheet registration ${registrationId} not found`);
  const reg = snap.data() as SheetRegistration;

  await ref.delete();
  await recordAuditEvent(jobId, {
    eventType: "sheet_registered", // reuse channel; metadata carries the delete flag
    summary: `Sheet registration ${registrationId} deleted (${reg.documentId} page ${reg.pageNumber})`,
    userEmail: deletedBy,
    metadata: {
      registrationId,
      documentId: reg.documentId,
      pageNumber: reg.pageNumber,
      action: "deleted",
    },
  });
  return { ok: true };
}
