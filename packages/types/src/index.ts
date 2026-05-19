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
  /** Phase 5.1: user-assigned description/notes. */
  description?: string;
  /** Phase 7: stable layer id (one per jobId+createdBy+workDate). */
  layerId?: string;
  /** Phase 7: foreman who owns the layer this object belongs to. */
  createdBy?: string;
  /** Phase 7: ISO date (YYYY-MM-DD) of the layer this object belongs to. */
  workDate?: string;
}

// ---- Phase 7: Layer + attachment + engineering print types ----

/**
 * Layer metadata. One layer per (jobId, createdBy, workDate) tuple.
 * Objects carry the layerId via their style; layers themselves persist
 * inside the AsBuiltDocument so we can record locked / hidden state.
 */
export interface AsBuiltLayer {
  layerId: string;
  createdBy: string;
  workDate: string; // ISO YYYY-MM-DD
  /** When true, layer is read-only and cannot accept new objects. */
  locked: boolean;
  /** When true, layer is hidden on the map. */
  hidden: boolean;
  createdAt: number;
}

/** Engineering print overlay (one or more per job; at most one "active"). */
export interface EngineeringPrint {
  printId: string;
  jobId: string;
  /** Source kind: an uploaded image (data URL) or PDF rendered page. */
  source: { kind: "image"; dataUrl: string } | { kind: "pdf"; dataUrl: string; page: number };
  /** Four-corner geographic anchors (NW, NE, SE, SW) for the rendered overlay. */
  corners: { nw: LatLng; ne: LatLng; se: LatLng; sw: LatLng };
  /** 0..1 — overlay opacity on the map. */
  opacity: number;
  /** When true, this is the active "Engineering Print" badge for the job. */
  active: boolean;
  /** When true, overlay is rendered on the map. */
  visible: boolean;
  createdAt: number;
}

/** Per-job attachment list entry. Body is stored as a base64 data URL. */
export interface JobAttachment {
  attachmentId: string;
  jobId: string;
  filename: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  /** Kind classification — PDFs can be promoted to engineering prints. */
  kind: "pdf" | "image" | "other";
  /** Optional Smartsheet attachment id if synced upstream. */
  smartsheetAttachmentId?: number;
  uploadedAt: number;
}

/** Quick Reference Layer gist — simplified rendering used on the JobsMap. */
export interface QuickReferenceGist {
  jobId: string;
  /** Simplified cable polylines — NEW / REMOVED, aerial / underground. */
  lines: Array<{
    id: string;
    path: LatLng[];
    status: "NEW" | "REMOVED";
    medium: "AERIAL" | "UNDERGROUND";
    family?: "FIBER" | "COPPER" | "ASW" | "BSW";
    label?: string;
  }>;
  /** Key point landmarks (poles, MH, HH, PED, cabinet, anchor). */
  points: Array<{
    id: string;
    position: LatLng;
    pointType: "MH" | "HH" | "PED" | "POLE" | "CABINET" | "ANCHOR";
    status: "NEW" | "REMOVED";
    label?: string;
  }>;
  generatedAt: number;
  /** When true, the gist is older than the latest as-built save. */
  outOfDate: boolean;
  /** Source of the gist: full as-built vs. lightweight Quick Mode entries. */
  source: "asbuilt" | "quick";
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
  /** Phase 7: layer metadata (one per foreman+date). */
  layers?: AsBuiltLayer[];
  /** Phase 7: id of the currently active layer (where new objects land). */
  activeLayerId?: string | null;
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
