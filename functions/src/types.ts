// Self-contained mirror of the fields the automation touches from @nsc/types.
// Firebase Functions bundle their own node_modules and deploy separately from
// the npm workspace, so we duplicate the minimal shape here rather than pull in
// the monorepo package. Keep in sync with packages/types/src/index.ts.

export type Timestamp = number; // epoch ms

export type DigTicketStatus =
  | "Drafting"
  | "Filing"
  | "Review"
  | "Filed"
  | "Active"
  | "Expiring"
  | "Expired"
  | "Failed";

export interface UtilityStatus {
  utility: string;
  status: "pending" | "in-progress" | "marked" | "clear" | "conflict";
  respondedAt?: Timestamp;
  lastCheckedAt?: Timestamp;
  notes?: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ShapeBounds {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export interface DigShape {
  type: "radius" | "route" | "polygon";
  vertices: LatLng[];
  bounds: ShapeBounds;
  areaSqFt: number;
  perimeterFt: number;
  center?: LatLng;
  radiusFt?: number;
  path?: LatLng[];
  widthFt?: number;
}

export interface DigTicket {
  id: string;
  ticketNumber: string;
  jobId: string;
  status: DigTicketStatus;
  shape: DigShape;
  specs: {
    handDigOnly: boolean;
    directionalBoring: boolean;
    whiteLined: boolean;
    explosives: boolean;
    workType: string;
    equipment: string[];
    markAround: string;
    startDate: Timestamp;
    duration: 45;
  };
  markingInstructions: string;
  hazardsWarning: string;
  safeGuidelines: string;
  utilityStatuses: UtilityStatus[];
  lastCheckedAt: Timestamp | null;
  readyToDig: boolean;
  automation: {
    reviewScreenshotUrl: string;
    confirmationScreenshotUrl: string | null;
    botRunId: string;
    filedAt: Timestamp | null;
    botErrors: string[];
  };
  iticPdfUrl?: string | null;
  dates: {
    createdAt: Timestamp;
    submittedAt: Timestamp | null;
    startsAt: Timestamp | null;
    expiresAt: Timestamp | null;
  };
  createdBy: string;
}

export interface Job {
  jobId: string;
  workOrder?: string;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  workType?: string | null;
  activeTicketId?: string | null;
  smartsheetRowId?: number | null;
}
