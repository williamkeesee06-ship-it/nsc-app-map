// Pure geodesic helpers for the 811 dig polygon tool. No google.maps
// dependency so they run in Node (tests) and future Cloud Functions.

import type { PolygonData } from "./index.js";

export type LatLngVertex = { lat: number; lng: number };

export const FEET_PER_METER = 3.28084;
const EARTH_RADIUS_M = 6371008.8; // IUGG mean earth radius

// Washington reference latitude (~47.4°N) used as the constant for the
// longitude-scaling factor per the spec. Excavation polygons are small
// (tens–hundreds of feet), so treating cos(lat) as constant over the
// polygon introduces negligible error while keeping the math simple.
export const WA_REFERENCE_LAT_DEG = 47.4;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

// Local planar projection of a lat/lng onto a metric x/y plane using the
// reference latitude for the longitude scale. Good enough for parcel-sized
// areas; used only for the shoelace area computation.
function toLocalMeters(
  v: LatLngVertex,
  originLat: number,
  originLng: number,
  refLatDeg: number
): { x: number; y: number } {
  const latRad = toRad(refLatDeg);
  const x = toRad(v.lng - originLng) * Math.cos(latRad) * EARTH_RADIUS_M;
  const y = toRad(v.lat - originLat) * EARTH_RADIUS_M;
  return { x, y };
}

/**
 * Polygon area via the shoelace formula, returned in square feet.
 * Vertices are projected to a local metric plane first. Order-independent
 * (absolute value) and ignores an explicitly repeated closing vertex.
 */
export function polygonAreaSqFt(
  vertices: LatLngVertex[],
  refLatDeg: number = WA_REFERENCE_LAT_DEG
): number {
  const pts = stripClosingVertex(vertices);
  if (pts.length < 3) return 0;
  const originLat = pts[0]!.lat;
  const originLng = pts[0]!.lng;
  const xy = pts.map((v) => toLocalMeters(v, originLat, originLng, refLatDeg));
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i]!;
    const b = xy[(i + 1) % xy.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  const areaM2 = Math.abs(sum) / 2;
  return areaM2 * FEET_PER_METER * FEET_PER_METER;
}

/**
 * Great-circle distance between two points via the spherical law of cosines,
 * returned in feet.
 */
export function distanceFt(a: LatLngVertex, b: LatLngVertex): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  // Clamp to [-1, 1] to guard against floating-point drift for near-identical
  // points, which would otherwise make Math.acos return NaN.
  const cosVal = Math.min(
    1,
    Math.max(-1, Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng))
  );
  const meters = Math.acos(cosVal) * EARTH_RADIUS_M;
  return meters * FEET_PER_METER;
}

/**
 * Closed-loop perimeter (last vertex connects back to the first) in feet,
 * summing spherical-law-of-cosines segment distances.
 */
export function polygonPerimeterFt(vertices: LatLngVertex[]): number {
  const pts = stripClosingVertex(vertices);
  if (pts.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    total += distanceFt(pts[i]!, pts[(i + 1) % pts.length]!);
  }
  return total;
}

/** Axis-aligned bounds of the vertex set. */
export function polygonBounds(
  vertices: LatLngVertex[]
): { swLat: number; swLng: number; neLat: number; neLng: number } {
  const pts = stripClosingVertex(vertices);
  let swLat = Infinity;
  let swLng = Infinity;
  let neLat = -Infinity;
  let neLng = -Infinity;
  for (const v of pts) {
    if (v.lat < swLat) swLat = v.lat;
    if (v.lng < swLng) swLng = v.lng;
    if (v.lat > neLat) neLat = v.lat;
    if (v.lng > neLng) neLng = v.lng;
  }
  return { swLat, swLng, neLat, neLng };
}

// If the caller passed a closed ring (first vertex repeated as last), drop the
// duplicate so it isn't counted twice in perimeter/area math.
function stripClosingVertex(vertices: LatLngVertex[]): LatLngVertex[] {
  if (vertices.length >= 2) {
    const first = vertices[0]!;
    const last = vertices[vertices.length - 1]!;
    if (first.lat === last.lat && first.lng === last.lng) {
      return vertices.slice(0, -1);
    }
  }
  return vertices;
}

/**
 * Build a complete PolygonData record from raw vertices. Centralizes the
 * area/perimeter/bounds computation so the UI HUD and the persisted document
 * always agree.
 */
export function buildPolygonData(
  vertices: LatLngVertex[],
  drawnBy: string,
  drawnAt: number = Date.now()
): PolygonData {
  return {
    vertices: vertices.map((v) => ({ lat: v.lat, lng: v.lng })),
    bounds: polygonBounds(vertices),
    areaSqFt: polygonAreaSqFt(vertices),
    perimeterFt: polygonPerimeterFt(vertices),
    drawnAt,
    drawnBy,
  };
}
