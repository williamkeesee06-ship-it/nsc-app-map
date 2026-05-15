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
