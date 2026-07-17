// Shared types for NSC APP MAP — used by both web and api workspaces.

// Geodesic helpers for the 811 dig polygon tool (area/perimeter/bounds).
export * from "./geo.js";

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
  | "splice"
  | "text"
  | "line"
  | "arrow"
  | "rectangle"
  | "circle"
  | "polygon"
  | "freehand"
  | "measure"
  | "select"
  | "eraser"
  | "highlighter"
  | "callout"
  | "lasso"
  | "rotate"
  | "stamp"
  | "ziply_hub"
  | "ziply_terminal"
  | "ziply_feeder"
  | "ziply_distribution"
  | "ziply_drop"
  | "ziply_bore"
  | "ziply_address"
  | "ziply_pole"
  | "ziply_handhole";

export interface DrawingStyle {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  fill:
    | { kind: "none" }
    | { kind: "solid"; color: string }
    | { kind: "hash"; pattern: "diagonal" | "cross" | "dots"; color: string; density: number };
  opacity: number; // 0..1

  /** Size multiplier for point symbols (0.5–2.0). */
  pointSize?: number;

  /** Per-object icon override (takes precedence over layer icon). */
  icon?: string;

  hidden?: boolean;
  locked?: boolean;
  userLabel?: string;
  description?: string;
  photos?: Array<{ id: string; dataUrl: string; name?: string }>;
  layerId?: string;
  

  /** PDF editor style grouping */
  groupId?: string;

  // ── Text formatting (text + callout tools) ───────────────────────────
  /** Font family for text/callout tools. */
  fontFamily?: string;
  /** Font size in px for text/callout tools. */
  fontSize?: number;
  /** Bold weight for text/callout tools. */
  bold?: boolean;
  /** Italic for text/callout tools. */
  italic?: boolean;
  /** Underline for text/callout tools. */
  underline?: boolean;
  /** Text alignment for text/callout tools. */
  textAlign?: "left" | "center" | "right";
  /** Text color (separate from strokeColor) for text/callout tools. */
  textColor?: string;

  // ── Label offset (Edit 1) ────────────────────────────────────────────
  /** Pixel offset of the user-typed callout label from its anchor point.
   *  Used so the supervisor can drag the label around without moving the
   *  actual marker. Default = { dx: 30, dy: 0 } for point tools, { dx: 0, dy: 0 }
   *  for shapes/text. Stored in screen-px at the current zoom; converted to
   *  lat/lng on render via pixelOffsetToLatLng(). */
  labelOffsetPx?: { dx: number; dy: number };
  /** Per-label font-size override (px). Defaults to 12. */
  labelFontSize?: number;
  /** Per-label background color override (CSS color). Default transparent. */
  labelBg?: string;
  /** Per-label border color override (CSS color). Default none. */
  labelBorder?: string;
  /** Per-label border thickness override (px). Default 0. */
  labelBorderWidth?: number;
  /** Cable Flow Animation flag (#3) */
  animateFlow?: boolean;

  // Ziply specific tracking fields
  ziplyStatus?: "planned" | "placed" | "completed" | "Complete" | "Pending" | string;
  ziplyCrewId?: string;
  ziplyTimestamp?: number;
}

// Phase 9+: per-job MyMaps-style layers (elevated for personal desktop use).
// Inspired by Google My Maps layers: users can organize, style, and toggle groups of markups.
export interface JobLayer {
  id: string;
  label: string;

  // Visibility
  hidden?: boolean;

  // Layer-level styling (like My Maps)
  color?: string;           // Default stroke/fill color for objects in this layer
  icon?: string;            // Icon key for point objects (e.g. "mh", "custom-pin", "warning", etc.)

  // Future-friendly
  opacity?: number;         // 0-1, default 1
  description?: string;     // Optional notes about what this layer represents
}

export type DrawingObject =
  | {
      id: string;
      tool:
        | "placed_cable"
        | "removed_cable"
        | "line"
        | "arrow"
        | "polygon"
        | "freehand"
        | "measure"
        | "ziply_feeder"
        | "ziply_distribution"
        | "ziply_drop"
        | "ziply_bore";
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
      tool: "callout";
      /** First click — arrow tip (this is where the arrowhead points). */
      anchor: { lat: number; lng: number };
      /** Final point — where the editable text box sits (end of line). */
      position: { lat: number; lng: number };
      /** Optional intermediate bend points between anchor and position. */
      path?: Array<{ lat: number; lng: number }>;
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
        | "anchor_removed"
        | "splice"
        | "ziply_hub"
        | "ziply_terminal"
        | "ziply_address"
        | "ziply_pole"
        | "ziply_handhole";
      position: { lat: number; lng: number };
      label?: string;
      style: DrawingStyle;
    };

export interface AsBuiltDocument {
  jobId: string;
  objects: DrawingObject[];
  /** Phase 9: per-job MyMaps layers. Optional for back-compat. */
  layers?: JobLayer[];
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

// Build status for an individual Ziply map object (hub, terminal, cable).
// Drives the CAD-blueprint color/symbol system (spec §3) and persists per-object
// so the supervisor's progress survives reloads (spec §4).
export type ZiplyObjectStatus = "planned" | "in_progress" | "complete";

export type ZiplySectionKind = "hub" | "terminal" | "cable";

export interface ZiplySectionScope {
  /** Object family inside ziplyPrintLayer.mapObjects. */
  kind: ZiplySectionKind;
  /** Object label/ref ("hub" for the FDH, terminal label, or cable label). */
  ref: string;
  /** Stable hub id used by future schedule/calendar boards. */
  hubId?: string | null;
  /** Human-readable section or terminal-range label, e.g. "T12 · H2051, 205-216". */
  label?: string | null;
  /** Terminal/DVFTP range when present on the print. */
  terminalRange?: string | null;
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

  // ── Ziply FTTH specific fields ───────────────────────────────────────
  sapSalesOrder?: string | null;
  sapContractId?: string | null;
  hubNumber?: string | null;
  ziplyInspector?: string | null;
  homesPassed?: number | null;
  softscapeBuriedHomes?: number | null;
  softscapeAerialHomes?: number | null;
  crewName?: string | null;
  approvedToBuild?: boolean | null;
  assignedInSiteTracker?: boolean | null;
  locatesCalled?: string | null;
  estBoreFt?: number | null;
  completedBoreFt?: number | null;
  estPlacingFt?: number | null;
  completedPlacingFt?: number | null;
  estAerialFt?: number | null;
  completedAerialFt?: number | null;

  /** Async status for Ziply visual print ingestion. */
  ziplyIngest?: {
    status: "processing" | "complete" | "failed";
    startedAt?: number | null;
    updatedAt?: number | null;
    completedAt?: number | null;
    failedAt?: number | null;
    storageFiles?: Array<{
      storagePath?: string;
      downloadUrl?: string;
      contentType?: string;
      name?: string;
      size?: number;
      storageBucket?: string;
    }> | null;
    legacyDataUrlCount?: number | null;
    errorMessage?: string | null;
    errorCode?: string | null;
    statusCode?: number | null;
    parsed?: unknown;
  } | null;

  /** Structured engineering metrics and map components extracted from visual print ingestion. */
  ziplyPrintLayer?: {
    hubId: string | null;
    hubTypeSize: string | null;
    terminalCount: number | null;
    fiberCountsPerCable?: string[] | null;
    drops?: {
      lu?: number | null;
      mdu?: number | null;
      bu?: number | null;
      total?: number | null;
    } | null;
    permittedExcavationMethods?: string[] | null;
    strandType?: string | null;
    conduitSize?: string | null;
    specialNotes?: string | null;
    permits?: {
      cityRow?: "Pending" | "Approved" | "Active" | "Closed" | null;
      wsdot?: "Pending" | "Approved" | "Active" | "Closed" | null;
      county?: "Pending" | "Approved" | "Active" | "Closed" | null;
      railroad?: "Pending" | "Approved" | "Active" | "Closed" | null;
      pa?: "Pending" | "Approved" | "Active" | "Closed" | null;
      tcp?: "Pending" | "Approved" | "Active" | "Closed" | null;
    } | null;
    /**
     * Legacy: base64 data URLs or download URLs keyed by permit type.
     * Prefer `permitFiles` (Storage + AI parse) for new uploads.
     */
    uploadedPermitDocs?: Record<string, string>;
    /**
     * Uploaded permit PDFs/images with AI extraction (numbers, dates, conditions).
     * One job can hold multiple permits (City ROW, WSDOT, County, etc.).
     */
    permitFiles?: Array<{
      id: string;
      /** cityRow | wsdot | county | railroad | pa | tcp | other */
      permitType: string;
      name: string;
      downloadUrl: string;
      storagePath?: string | null;
      contentType?: string | null;
      size?: number | null;
      uploadedAt: number;
      ingestStatus: "processing" | "complete" | "failed";
      errorMessage?: string | null;
      parsed?: {
        permitNumber?: string | null;
        permitTypeKey?: string | null;
        issuingAgency?: string | null;
        status?: "Pending" | "Approved" | "Active" | "Closed" | null;
        issueDate?: string | null;
        expirationDate?: string | null;
        workStartDate?: string | null;
        workEndDate?: string | null;
        workHours?: string | null;
        workLocation?: string | null;
        streets?: string[] | null;
        excavationMethods?: string[] | null;
        trafficControlRequired?: boolean | null;
        conditions?: string[] | null;
        restrictions?: string[] | null;
        contacts?: string[] | null;
        summary?: string | null;
      } | null;
    }>; 
    mapObjects?: {
      /** Georeferenced hub/FDH cabinet position + build status. */
      hub?: {
        lat?: number | null;
        lng?: number | null;
        status?: ZiplyObjectStatus;
      } | null;
      /**
       * Primary ROW / arterial from the plan (e.g. "Metron Rd") — plant backbone.
       * Written by print parse + enhance for arterial+lateral CAD.
       */
      mainlineStreet?: string | null;
      /**
       * Multi-point path along the mainline / feeder spine (not a spoke).
       * Rendered thicker than laterals on the map.
       */
      backbonePath?: Array<{ lat: number; lng: number }> | null;
      /**
       * How plant geometry was produced:
       * - control_registered: geocoded parcels + true backbone joins (plan fidelity)
       * - road_snapped: control plant with Directions backbone
       * - synthetic: axis/fan fallback
       */
      geometrySource?: "control_registered" | "road_snapped" | "synthetic" | null;
      /** Mean residual meters of control points to backbone (lower = better fit). */
      geometryResidualM?: number | null;
      cables: Array<{
        label: string;
        fiberCount: string;
        lengthFt: number | null;
        /** Georeferenced polyline path when known (else curved synthetic lateral). */
        path?: Array<{ lat: number; lng: number }> | null;
        /** Placement method drives the CAD dash pattern/color. */
        buildType?: "bore" | "trench" | "aerial" | null;
        /** mainline = along arterial; lateral = to MST/parcel; feeder = existing. */
        role?: "mainline" | "lateral" | "feeder" | null;
        /** Terminal label this cable feeds (from print). */
        toTerminal?: string | null;
        /** Street names along the route (layout hints). */
        routeStreets?: string[] | null;
        /** Plan sheet page index (1-based) when known — Studio dual-pane jump. */
        sheetPage?: number | null;
        /** Build sequence (1 = first after feeder). */
        sequenceOrder?: number | null;
        /** left/right of mainline looking up-station. */
        side?: "left" | "right" | "both" | null;
        /** Station feet along mainline from plan (e.g. 12+50 → 1250). */
        stationFt?: number | null;
        status?: ZiplyObjectStatus;
        /** Section-scoped 811 + crew metadata keyed by hubId + label/range. */
        locateTicketId?: string | null;
        locateExpires?: Timestamp | null;
        crewName?: string | null;
        crewAssignedAt?: Timestamp | null;
      }>;
      terminals: Array<{
        label: string;
        type: string;
        /** Drawer detail fields (spec §4). */
        portCount?: number | null;
        footageFt?: number | null;
        /** Raw footage label incl. overlash, e.g. "1000' (593' OL)". */
        footageLabel?: string | null;
        /** e.g. "H2051, 205-216". */
        dvftpRange?: string | null;
        code?: string | null;
        fiberSpec?: string | null;
        addressesServed?: string[] | null;
        /** House numbers from plan (e.g. "18052") when full street not labeled. */
        houseNumbers?: string[] | null;
        /** Plan sheet page (1-based). */
        sheetPage?: number | null;
        /** Station order along mainline (south→north or plan up-station). */
        sequenceOrder?: number | null;
        /** Side of mainline ROW. */
        side?: "left" | "right" | null;
        /** Station feet along mainline from plan callout. */
        stationFt?: number | null;
        /** Perpendicular offset feet from mainline on plan. */
        offsetFt?: number | null;
        /** Normalized plan-page coords 0–1 for affine sheet registration. */
        sheetX?: number | null;
        sheetY?: number | null;
        /** Cross street when lateral leaves mainline (e.g. "64th St SE"). */
        crossStreet?: string | null;
        /** Georeferenced terminal position (geocoded address / GPS anchor). */
        lat?: number | null;
        lng?: number | null;
        /** True when crew pinned this terminal on the map. */
        manualPin?: boolean | null;
        status?: ZiplyObjectStatus;
        /** Section-scoped 811 + crew metadata keyed by hubId + label/range. */
        locateTicketId?: string | null;
        locateExpires?: Timestamp | null;
        crewName?: string | null;
        crewAssignedAt?: Timestamp | null;
      }>;
      /**
       * Geocoded drop / home-pass sites (from terminal addressesServed).
       * Written by ziply-enhance-print so the map can show lot-level detail.
       */
      dropSites?: Array<{
        address: string;
        lat: number;
        lng: number;
        terminalLabel?: string | null;
        kind?: "lu" | "mdu" | "bu" | "unknown" | null;
      }> | null;
      /**
       * Field control pins (Phase C) — highest-priority registration anchors.
       * kind+ref match terminals/cables/hub.
       */
      manualPins?: Array<{
        kind: "hub" | "terminal" | "cable";
        ref: string;
        lat: number;
        lng: number;
        sheetX?: number | null;
        sheetY?: number | null;
        pinnedAt?: number | null;
        pinnedBy?: string | null;
      }> | null;
      notes: string | null;
    } | null;
    /** Epoch ms when multi-point paths + drop geocodes last ran. */
    printGeometryEnhancedAt?: number | null;
    /** User-drawn markups (canvas drawings) on the uploaded print PDF/image. */
    printMarkups?: any[] | null;
  } | null;

  // ── 811 Dig Ticket fields (Phase 1) ──────────────────────────────────
  // All optional so existing job docs (and Smartsheet-normalized rows that
  // never touched 811) stay valid without a migration.
  /** The dig shape William drew for this job's excavation area. Phase 1
   *  persisted a bare PolygonData (no `type`); readers should run it through
   *  normalizeDigShape() to coerce legacy values into a DigShape. */
  digPolygon?: DigShape | PolygonData | null;
  /** Reference to the active dig ticket in digTickets/{ticketId}. */
  activeTicketId?: string | null;
  /** Mirrored from the active ticket (also written to Smartsheet). */
  locateNumber?: string | null;
  /** Mirrored from the active ticket. */
  locateExpires?: Timestamp | null;
}

// ---- 811 Locate & Dig Ticket Manager (Phase 1) ----

// This codebase stores Firestore timestamps as epoch-millisecond numbers
// (see Job.firstSyncedAt / AsBuiltDocument.updatedAt), so the spec's
// Firestore `Timestamp` maps to `number` here for consistency.
export type Timestamp = number;

// The polygon William traces around an excavation area. Saved to
// jobs/{jobId}.digPolygon and snapshotted onto a dig ticket at filing time.
export interface PolygonData {
  vertices: Array<{ lat: number; lng: number }>;
  bounds: { swLat: number; swLng: number; neLat: number; neLng: number };
  areaSqFt: number;
  perimeterFt: number;
  drawnAt: Timestamp;
  drawnBy: string;
}

// ── Phase 1.5 — dig shape discriminated union ────────────────────────────
// Fields shared by every dig shape. `vertices` is the rendered ring used for
// drawing + ITIC reproduction; area/perimeter/bounds are precomputed so the
// UI HUD and persisted document always agree.
export interface ShapeCommon {
  vertices: Array<{ lat: number; lng: number }>;
  bounds: { swLat: number; swLng: number; neLat: number; neLng: number };
  areaSqFt: number;
  perimeterFt: number;
  drawnAt: Timestamp;
  drawnBy: string;
}

/** ITIC "Radius excavation" — a circle. area=πr², perimeter=2πr. */
export interface RadiusShape extends ShapeCommon {
  type: "radius";
  center: { lat: number; lng: number };
  radiusFt: number;
}

/** ITIC "Route excavation" — a buffered polyline corridor. */
export interface RouteShape extends ShapeCommon {
  type: "route";
  path: Array<{ lat: number; lng: number }>;
  widthFt: number;
}

/** ITIC "Other" — a freeform traced ring. */
export interface PolygonShape extends ShapeCommon {
  type: "polygon";
}

export type DigShape = RadiusShape | RouteShape | PolygonShape;

// Locator response per utility, populated after marks come in (manual in v1).
export interface UtilityStatus {
  utility: string;
  status: "pending" | "in-progress" | "marked" | "clear" | "conflict";
  respondedAt?: Timestamp;
  lastCheckedAt?: Timestamp;
  notes?: string;
}

export type DigTicketStatus =
  | "Drafting"
  | "Filing"
  | "Review"
  | "Filed"
  | "Active"
  | "Expiring"
  | "Expired"
  | "Failed";

// One document per ticket at digTickets/{ticketId}.
export interface DigTicket {
  id: string; // Firestore doc ID
  ticketNumber: string; // Assigned by ITIC (e.g., "WA-2026-1234567")
  jobId: string; // Reference to jobs/{jobId}
  status: DigTicketStatus;
  shape: DigShape; // Snapshot from the job's dig shape at time of filing
  /** Optional Ziply section/terminal-range scope. Absent means legacy whole-job ticket. */
  scope?: ZiplySectionScope | null;
  specs: {
    handDigOnly: boolean;
    directionalBoring: boolean;
    whiteLined: boolean;
    explosives: boolean;
    /** Free-text type of work the user typed (e.g. "POLE TRANSFER"). */
    workType: string;
    /** Equipment in use (backhoe, trencher, boring rig, etc.). */
    equipment: string[];
    /** Free-text description of what to mark around (e.g. "the pole line"). */
    markAround: string;
    startDate: Timestamp; // 48hr from filing
    /** WA state dig tickets are valid for 45 days — always 45. */
    duration: 45;
  };
  markingInstructions: string; // Gemini-generated, human-edited
  hazardsWarning: string;
  /** Gemini-generated safe-digging guidelines shown on the ticket detail. */
  safeGuidelines: string;
  utilityStatuses: UtilityStatus[]; // Populated after locators respond
  /** Last time the bot/poller checked ITIC for utility responses. */
  lastCheckedAt: Timestamp | null;
  /** True once every utility is marked/clear and the start date has passed. */
  readyToDig: boolean;
  automation: {
    reviewScreenshotUrl: string; // Firebase Storage URL, captured before submit
    confirmationScreenshotUrl: string | null; // Captured after submit
    botRunId: string;
    filedAt: Timestamp | null;
    botErrors: string[];
  };
  /** Signed URL of the ITIC confirmation PDF captured after auto-submit. */
  iticPdfUrl?: string | null;
  dates: {
    createdAt: Timestamp;
    submittedAt: Timestamp | null;
    startsAt: Timestamp | null; // 48hr from ITIC submit
    expiresAt: Timestamp | null; // 45d from ITIC submit
  };
  createdBy: string; // Firebase auth uid
}

// A ticket may only be deleted while it has not been successfully filed with
// ITIC: drafts, failed attempts, or anything without a real ITIC ticket number.
// Filed/Active tickets (or any ticket that carries an ITIC number) are locked.
// Enforced server-side (403) and mirrored client-side to hide the delete UI.
export function canDeleteDigTicket(
  ticket: Pick<DigTicket, "status" | "ticketNumber">
): boolean {
  if (ticket.ticketNumber && ticket.ticketNumber.trim() !== "") return false;
  return ticket.status !== "Filed" && ticket.status !== "Active";
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

export interface Gig {
  id: string;
  jobId: string;
  workOrder: string;
  task: string;
  status: "open" | "completed";
  createdAt: number;
  completedAt: number | null;
}

