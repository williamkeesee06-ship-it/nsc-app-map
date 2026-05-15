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

// ---- Phase 3: Drawing system types ----

export type DrawingTool =
  | "placed_cable"
  | "removed_cable"
  | "mh_new"
  | "mh_removed"
  | "hh_new"
  | "hh_removed"
  | "ped_new"
  | "ped_removed"
  | "pole_new"
  | "pole_removed"
  | "cabinet_new"
  | "cabinet_removed"
  | "anchor_new"
  | "anchor_removed"
  | "text"
  | "line"
  | "arrow"
  | "rectangle"
  | "circle"
  | "polygon"
  | "freehand"
  | "measure"
  | "select";

export interface DrawingStyle {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed";
  fill:
    | { kind: "none" }
    | { kind: "solid"; color: string }
    | { kind: "hash"; pattern: "diagonal" | "cross" | "dots"; color: string; density: number };
  opacity: number; // 0..1
  /** Phase 4: size multiplier for point symbols (0.5–2.0). Default 1.0. */
  pointSize?: number;
  /** Phase 5: hide object from map overlay (still in list). */
  hidden?: boolean;
  /** Phase 5: lock object — prevents selection/editing. */
  locked?: boolean;
  /** Phase 5: user-assigned display label override. */
  userLabel?: string;
}

export type DrawingObject =
  | {
      id: string;
      tool: "placed_cable" | "removed_cable" | "line" | "arrow" | "polygon" | "freehand" | "measure";
      vertices: Array<{ lat: number; lng: number }>;
      style: DrawingStyle;
    }
  | {
      id: string;
      tool: "rectangle" | "circle";
      bounds: { n: number; s: number; e: number; w: number };
      style: DrawingStyle;
    }
  | {
      id: string;
      tool: "text";
      position: { lat: number; lng: number };
      text: string;
      style: DrawingStyle;
    }
  | {
      id: string;
      tool:
        | "mh_new"
        | "mh_removed"
        | "hh_new"
        | "hh_removed"
        | "ped_new"
        | "ped_removed"
        | "pole_new"
        | "pole_removed"
        | "cabinet_new"
        | "cabinet_removed"
        | "anchor_new"
        | "anchor_removed";
      position: { lat: number; lng: number };
      label?: string;
      style: DrawingStyle;
    };

export interface AsBuiltDocument {
  jobId: string;
  objects: DrawingObject[];
  updatedAt: number;
  updatedBy?: string;
}

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
