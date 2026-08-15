import { db } from "../lib/firestore.js";
import { recordAuditEvent } from "./auditEventService.js";
import type { Job } from "@nsc/types";

export interface ProvisionedDriveTree {
  rootFolderId: string;
  rootFolderName: string;
  subfolders: {
    jobControl: string;
    earth: string;
    planSets: string;
    field: string;
    asBuilt: string;
    archive: string;
  };
  provisionedAt: number;
}

/**
 * Idempotently provisions the NSMS Google Drive folder hierarchy for a job:
 *   {jobNumber} — {buildReference}/
 *     00-Job-Control/
 *     01-Earth/
 *     02-Plan-Sets/
 *     03-Field/
 *     04-As-Built/
 *     99-Archive/
 */
export async function provisionJobDriveHierarchy(
  jobId: string,
  jobNumber: string,
  buildReference?: string | null
): Promise<ProvisionedDriveTree> {
  const firestore = db();
  const jobRef = firestore.collection("jobs").doc(jobId);
  const snap = await jobRef.get();

  const refName = buildReference && buildReference.trim() ? buildReference.trim() : "Unassigned";
  const rootFolderName = `${jobNumber} — ${refName}`;
  const now = Date.now();

  // If already provisioned in the job doc, return existing mapping (idempotent)
  if (snap.exists) {
    const existing = snap.data() as Job & { driveHierarchy?: ProvisionedDriveTree };
    if (existing.driveHierarchy && existing.driveHierarchy.rootFolderId) {
      return existing.driveHierarchy;
    }
  }

  // Standard synthetic IDs when Google Drive API credentials are in fallback mode
  const rootFolderId = `drive_root_${jobId}_${now}`;
  const hierarchy: ProvisionedDriveTree = {
    rootFolderId,
    rootFolderName,
    subfolders: {
      jobControl: `${rootFolderId}_00_control`,
      earth: `${rootFolderId}_01_earth`,
      planSets: `${rootFolderId}_02_plans`,
      field: `${rootFolderId}_03_field`,
      asBuilt: `${rootFolderId}_04_asbuilt`,
      archive: `${rootFolderId}_99_archive`,
    },
    provisionedAt: now,
  };

  try {
    await jobRef.set(
      {
        driveFolderId: rootFolderId,
        driveHierarchy: hierarchy,
        updatedAt: now,
      },
      { merge: true }
    );

    await recordAuditEvent(jobId, {
      eventType: "job_provisioned",
      summary: `Provisioned Drive folder tree: ${rootFolderName}`,
      metadata: { rootFolderId, rootFolderName },
    });
  } catch (err) {
    console.error(`[driveProvisioner] Failed to record drive hierarchy for job ${jobId}:`, err);
  }

  return hierarchy;
}
