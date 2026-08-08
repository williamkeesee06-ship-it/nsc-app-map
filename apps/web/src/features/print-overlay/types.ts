import type { Job } from "@nsc/types";

export interface MapImageOverlay {
  id: string;
  mapProjectId: string;
  jobId?: string;
  title: string;
  description?: string;
  imageUri: string;
  presetKey?: "preset_foundation" | "preset_civil" | "preset_electrical" | "preset_commercial";
  southWestLat: number;
  southWestLng: number;
  northEastLat: number;
  northEastLng: number;
  opacity: number;
  rotationDegrees: number;
  isVisible: boolean;
  isAnchored: boolean;
  printDocumentId?: string;
  pageNumber?: number;
}

export type GISJob = Job & {
  id: string; // mapped to jobId
  jobNumber: string; // mapped to workOrder
  jobName: string; // mapped to customerProject or workOrder
};

export function adaptJobToGISJob(job: Job): GISJob {
  return {
    ...job,
    id: job.jobId,
    jobNumber: job.workOrder,
    jobName: job.customerProject || job.workOrder,
  };
}
