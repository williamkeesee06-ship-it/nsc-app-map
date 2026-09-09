/**
 * Digital Field Operations Platform — H3024 Firestore schema
 *
 * One document per feature (never whole FeatureCollection — avoids 1MB limit).
 * Path: /projects/H3024/features/{featureId}
 *       /projects/H3024/permits/{permitId}
 *       /projects/H3024/locateTickets/{ticketId}
 *       /projects/H3024/progress/{featureId}
 *
 * WA 811: Utility Notification Center (UNC) — utn.com — not 811Assist.
 */

export const H3024_PROJECT_ID = "H3024";

export const H3024_HUB_ANCHOR = {
  lat: 47.939488,
  lng: -122.157410,
  address: "6105 Foster Slough Rd, Lake Stevens, WA 98290",
  hubId: "H3024",
  hubType: "Vault Mount 432-port FDH",
} as const;

export type FeatureLayer =
  | "hub"
  | "feeder"
  | "distribution"
  | "drop"
  | "terminal"
  | "service_point"
  | "pole"
  | "handhole"
  | "bore";

export type FeatureStatus =
  | "designed"
  | "permitted"
  | "ticket_active"
  | "in_progress"
  | "placed"
  | "spliced"
  | "tested"
  | "complete"
  | "on_hold";

export interface ProjectMetadata {
  projectId: typeof H3024_PROJECT_ID;
  workOrder: string;
  name: string;
  region: string;
  hub: typeof H3024_HUB_ANCHOR;
  engineer?: string;
  planner?: string;
  sourcePdf: string;
  pages: number;
}

/** One feature = one Firestore document */
export interface FeatureDoc {
  featureId: string;
  projectId: typeof H3024_PROJECT_ID;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown> & {
    type: string;
    layer: FeatureLayer;
    status: FeatureStatus;
    printRef?: string | null;
    progressPct?: number;
  };
  /** geohash for spatial queries (optional seed) */
  geoHash?: string | null;
  updatedAt: number;
  updatedBy?: string | null;
}

export interface PermitDoc {
  id: string;
  projectId: typeof H3024_PROJECT_ID;
  authority:
    | "CITY_LAKE_STEVENS"
    | "WSDOT"
    | "PACIFIC_POWER_JPN"
    | "SNOHOMISH_PUD"
    | "SNOHOMISH_COUNTY"
    | "RAILROAD"
    | "TCP";
  required: boolean;
  permitNumber?: string | null;
  status: "applied" | "pending_review" | "approved" | "active" | "expired" | "revoked" | "not_required";
  expiryDate?: number | null;
  conditions?: string[];
  affectedFeatureIds?: string[];
}

/** Cover sheet permit matrix for H3024 */
export const H3024_PERMIT_SEED: Omit<PermitDoc, "id" | "projectId">[] = [
  { authority: "CITY_LAKE_STEVENS", required: true, status: "approved" },
  { authority: "WSDOT", required: true, status: "approved" },
  { authority: "SNOHOMISH_COUNTY", required: false, status: "not_required" },
  { authority: "RAILROAD", required: false, status: "not_required" },
  { authority: "PACIFIC_POWER_JPN", required: true, status: "approved" },
  { authority: "TCP", required: false, status: "not_required" },
  { authority: "SNOHOMISH_PUD", required: true, status: "approved" },
];

/**
 * Convert platform FeatureCollection → per-feature docs for Firestore seed.
 * Does not write — pure transform for seed scripts / API.
 * One document per feature (never store whole collection in one doc).
 */
export function featureCollectionToDocs(
  fc: {
    features?: Array<{
      id?: string | number;
      geometry?: { type: string; coordinates: unknown } | null;
      properties?: Record<string, unknown> | null;
    }>;
  },
  updatedBy?: string | null
): FeatureDoc[] {
  const now = Date.now();
  return (fc.features ?? []).map((f, i) => {
    const props = (f.properties ?? {}) as FeatureDoc["properties"];
    const id =
      (typeof f.id === "string" && f.id) ||
      String(props.terminalId || props.cableId || props.address || `f-${i}`);
    return {
      featureId: id.replace(/[/\s]/g, "_").slice(0, 120),
      projectId: H3024_PROJECT_ID,
      geometry: f.geometry ?? { type: "Point", coordinates: [0, 0] },
      properties: {
        ...props,
        type: String(props.type || props.layer || "asset"),
        layer: (props.layer || props.type || "distribution") as FeatureLayer,
        status: (props.status as FeatureStatus) || "designed",
        progressPct: typeof props.progressPct === "number" ? props.progressPct : 0,
      },
      geoHash: null,
      updatedAt: now,
      updatedBy: updatedBy ?? null,
    };
  });
}
