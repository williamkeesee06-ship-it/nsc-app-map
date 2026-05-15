// Shared types for NSC APP MAP — used by both web and api workspaces.

export type LatLng = { lat: number; lng: number };

export type PointType =
  | "MH"
  | "HH"
  | "POLE"
  | "VAULT"
  | "CLOSURE"
  | "A_TAG"
  | "PHOTO_PIN"
  | "OTHER";

export interface MapPoint {
  id: string;
  type: PointType;
  position: LatLng;
  label?: string;
  notes?: string;
  createdAt: number; // epoch ms
}

export type LineCategory = "PLACED" | "REMOVED";

export interface MapLine {
  id: string;
  category: LineCategory;
  path: LatLng[];
  label?: string;
  createdAt: number;
}

export interface Viewport {
  center: LatLng;
  zoom: number;
}

// One document per job at jobs/{jobId}/asbuilt/current
export interface AsbuiltDoc {
  jobId: string;
  points: MapPoint[];
  lines: MapLine[];
  viewport?: Viewport;
  updatedAt: number;
  schemaVersion: 1;
}

export const emptyAsbuilt = (jobId: string): AsbuiltDoc => ({
  jobId,
  points: [],
  lines: [],
  updatedAt: Date.now(),
  schemaVersion: 1,
});

// ---- Phase 2: Smartsheet-backed job records ----

// Geocode cache result stored alongside the job so we don't re-bill Google
// every sync. We re-geocode only if the source address string changes.
export interface JobGeocode {
  lat: number;
  lng: number;
  formattedAddress: string;
  sourceAddress: string; // the exact "Address, City, ZipCode" string we sent
  cachedAt: number;
  status: "OK" | "ZERO_RESULTS" | "ERROR";
  errorMessage?: string;
}

// One document per job at jobs/{jobId}. Identity is the Smartsheet "Work Order".
export interface Job {
  jobId: string; // sanitized version of Work Order (used as Firestore doc id)
  workOrder: string; // original Work Order string
  smartsheetRowId: number;
  // Tracker presence: true if the row is still on Billy's tracker.
  // We never delete jobs once added — we just flip this to false.
  inTracker: boolean;
  // Job-card fields, sourced from Smartsheet columns (display values).
  jobStatus: string | null;
  secondaryJobStatus: string | null;
  workType: string | null; // raw comma-separated string
  workTypeTags: string[]; // split + trimmed for filter chips
  constructionSupervisor: string | null;
  constructionManager: string | null;
  constructionBase: string | null;
  customerProject: string | null;
  wireCenter: string | null;
  address: string | null;
  city: string | null;
  zipCode: string | null;
  // Job-card fields (the 9 the user selected)
  scheduleDate: string | null;
  actualCompletionDate: string | null;
  trafficControlRequired: boolean | null;
  constructionCrewForeman: string | null;
  nscProjectNotes: string | null;
  // Extra fields stored for future phases (not shown on card v1)
  dateReceived: string | null;
  actualStartDate: string | null;
  permitRequired: string | null;
  splicingStatus: string | null;
  // Sync metadata
  smartsheetModified: string | null;
  firstSyncedAt: number;
  lastSyncedAt: number;
  // Geocode result (lat/lng for the map)
  geocode: JobGeocode | null;
}

export interface SyncRun {
  syncId: string;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "success" | "error";
  // Counts
  sheetTotalRows: number;
  filteredRows: number;
  upserted: number;
  flaggedOffTracker: number;
  geocodedFresh: number;
  geocodedCached: number;
  geocodeFailed: number;
  error?: string;
}
