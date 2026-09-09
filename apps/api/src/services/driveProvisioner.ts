// Drive provisioning is INTENTIONALLY not implemented.
//
// Per operator directive on 2026-08-15, no Google Drive API integration is to be
// wired in this branch. Prior code in this file fabricated synthetic folder IDs
// (e.g. `drive_root_${jobId}_${now}`) and pretended those were real Drive folder
// IDs. That is worse than nothing: downstream callers stored fake IDs on the
// Job record and later tried to open URLs that don't exist.
//
// This module now returns a well-typed "not-provisioned" result and logs a
// warning. When Drive is ready to be wired for real, replace the body with an
// authenticated call to google.drive({ version: "v3" }).files.create(...) using
// GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY / GOOGLE_DRIVE_ROOT_FOLDER_ID
// from env.ts. Do NOT return synthetic IDs.

export interface JobDriveHierarchy {
  provisioned: false;
  jobId: string;
  workOrder: string;
  buildReference: string | null;
  reason: string;
}

/**
 * No-op provisioner. Always returns `provisioned: false` and never touches
 * Google Drive. Callers must treat `provisioned === false` as "no Drive folder
 * exists" and never persist a fake `driveFolderId` on the Job record.
 */
export async function provisionJobDriveHierarchy(
  jobId: string,
  workOrder: string,
  buildReference?: string | null
): Promise<JobDriveHierarchy> {
  // Deliberate breadcrumb so ops can see when the UI tries to provision.
  // eslint-disable-next-line no-console
  console.warn(
    `[driveProvisioner] Drive integration deferred. Refusing to fabricate IDs for job=${jobId} wo=${workOrder} ref=${buildReference ?? "n/a"}.`
  );
  return {
    provisioned: false,
    jobId,
    workOrder,
    buildReference: buildReference ?? null,
    reason:
      "Google Drive provisioning is not enabled in this build. Contact ops to wire GOOGLE_DRIVE_* env vars and replace this stub.",
  };
}
