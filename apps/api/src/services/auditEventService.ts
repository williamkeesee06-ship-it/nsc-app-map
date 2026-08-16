import { db } from "../lib/firestore.js";

export interface AuditEventPayload {
  eventType:
    | "job_created"
    | "job_provisioned"
    | "geometry_created"
    | "geometry_updated"
    | "geometry_deleted"
    | "geometry_restored"
    | "earth_published"
    | "earth_submission_received"
    | "earth_revision_approved"
    | "earth_revision_rejected"
    | "document_uploaded"
    | "sheet_registered"
    | "smartsheet_synced";
  summary: string;
  userId?: string;
  userEmail?: string;
  metadata?: Record<string, unknown>;
}

export interface StoredAuditEvent extends AuditEventPayload {
  id: string;
  jobId: string;
  timestamp: number;
}

/**
 * Append-only immutable audit event logger for NSMS.
 * Stores events under jobs/{jobId}/events/{eventId}.
 */
export async function recordAuditEvent(
  jobId: string,
  event: AuditEventPayload
): Promise<StoredAuditEvent> {
  const timestamp = Date.now();
  const eventId = `evt_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;
  const storedEvent: StoredAuditEvent = {
    id: eventId,
    jobId,
    timestamp,
    ...event,
  };

  try {
    const firestore = db();
    const eventRef = firestore.collection("jobs").doc(jobId).collection("events").doc(eventId);
    await eventRef.set(storedEvent);
  } catch (err) {
    console.error(`[auditEventService] Failed to write audit event ${eventId} for job ${jobId}:`, err);
  }

  return storedEvent;
}

/**
 * Fetch chronological audit timeline for a job.
 */
export async function listJobAuditEvents(
  jobId: string,
  limit = 100
): Promise<StoredAuditEvent[]> {
  try {
    const firestore = db();
    const snap = await firestore
      .collection("jobs")
      .doc(jobId)
      .collection("events")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snap.docs.map((d) => d.data() as StoredAuditEvent);
  } catch (err) {
    console.error(`[auditEventService] Failed to list audit events for job ${jobId}:`, err);
    return [];
  }
}
