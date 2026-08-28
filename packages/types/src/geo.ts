// Pure geodesic helpers for the 811 dig polygon tool. No google.maps
// dependency so they run in Node (tests) and future Cloud Functions.

import type {
  PolygonData,
  DigShape,
  RadiusShape,
  RouteShape,
  PolygonShape,
  LatLng,
} from "./index.js";

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

// ── Phase 1.5 — radius + route shapes ──────────────────────────────────────
// The dig tool now offers three shapes matching ITIC's drawing tools:
//   • radius  — a circle (ITIC "Radius excavation")
//   • route   — a buffered polyline (ITIC "Route excavation")
//   • polygon — a freeform ring (ITIC "Other")
// All three carry a rendered `vertices` ring plus their own source parameters
// so we get a lossless roundtrip (radius keeps center+radiusFt, route keeps
// path+widthFt) and the bot can reproduce the exact shape on ITIC's map.

const FEET_PER_DEGREE_LAT = 364567.2; // ≈ EARTH_RADIUS_M * (π/180) in feet

/** Feet per degree of longitude at a given latitude (shrinks toward poles). */
function feetPerDegreeLng(latDeg: number): number {
  return FEET_PER_DEGREE_LAT * Math.cos(toRad(latDeg));
}

/** Offset a point by (east, north) feet, using a local flat-earth approx. */
function offsetFeet(origin: LatLngVertex, eastFt: number, northFt: number): LatLng {
  return {
    lat: origin.lat + northFt / FEET_PER_DEGREE_LAT,
    lng: origin.lng + eastFt / feetPerDegreeLng(origin.lat),
  };
}

/**
 * Approximate a circle of `radiusFt` around `center` with `segments` vertices.
 * 64 segments (the default) keeps the polygon visually smooth at parcel scale.
 */
export function radiusCircleVertices(
  center: LatLngVertex,
  radiusFt: number,
  segments = 64
): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    out.push(offsetFeet(center, Math.cos(theta) * radiusFt, Math.sin(theta) * radiusFt));
  }
  return out;
}

/**
 * Buffer a polyline `path` by `widthFt/2` on each side to build a filled
 * polygon ring. Each vertex is offset along the average of its adjacent
 * segment normals (miter join); endpoints use a square (rectangular) cap.
 * Good enough for rendering + ITIC reproduction; not a survey-grade offset.
 */
export function routeBufferVertices(path: LatLngVertex[], widthFt: number): LatLng[] {
  if (path.length < 2) return path.map((p) => ({ lat: p.lat, lng: p.lng }));
  const half = widthFt / 2;
  // Work in a local feet plane anchored at path[0].
  const origin = path[0]!;
  const toXY = (p: LatLngVertex) => ({
    x: (p.lng - origin.lng) * feetPerDegreeLng(origin.lat),
    y: (p.lat - origin.lat) * FEET_PER_DEGREE_LAT,
  });
  const pts = path.map(toXY);
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i]!;
    const next = pts[i + 1];
    // Perpendicular (normal) of the incoming and outgoing segments.
    const normals: { nx: number; ny: number }[] = [];
    if (prev) normals.push(perp(prev, cur));
    if (next) normals.push(perp(cur, next));
    // Average the normals (miter). Endpoints have a single normal (square cap).
    let nx = normals.reduce((s, n) => s + n.nx, 0) / normals.length;
    let ny = normals.reduce((s, n) => s + n.ny, 0) / normals.length;
    const mag = Math.hypot(nx, ny) || 1;
    nx /= mag;
    ny /= mag;
    left.push({ x: cur.x + nx * half, y: cur.y + ny * half });
    right.push({ x: cur.x - nx * half, y: cur.y - ny * half });
  }
  const ring = [...left, ...right.reverse()];
  return ring.map((p) => offsetFeet(origin, p.x, p.y));
}

function perp(a: { x: number; y: number }, b: { x: number; y: number }): { nx: number; ny: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mag = Math.hypot(dx, dy) || 1;
  return { nx: -dy / mag, ny: dx / mag };
}

/** Total length of a polyline in feet (spherical law of cosines per segment). */
export function pathLengthFt(path: LatLngVertex[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) total += distanceFt(path[i]!, path[i + 1]!);
  return total;
}

/**
 * Build a radius DigShape. Area/perimeter are exact (πr², 2πr); the vertex
 * ring is a 64-point approximation used only for rendering.
 */
export function buildRadiusShape(
  center: LatLngVertex,
  radiusFt: number,
  drawnBy: string,
  drawnAt: number = Date.now()
): RadiusShape {
  const vertices = radiusCircleVertices(center, radiusFt);
  return {
    type: "radius",
    center: { lat: center.lat, lng: center.lng },
    radiusFt,
    vertices,
    bounds: polygonBounds(vertices),
    areaSqFt: Math.PI * radiusFt * radiusFt,
    perimeterFt: 2 * Math.PI * radiusFt,
    drawnAt,
    drawnBy,
  };
}

/**
 * Build a route DigShape. Area = length × width, perimeter = 2·length + 2·width
 * (treating the buffered corridor as a rectangle, per spec).
 */
export function buildRouteShape(
  path: LatLngVertex[],
  widthFt: number,
  drawnBy: string,
  drawnAt: number = Date.now()
): RouteShape {
  const lengthFt = pathLengthFt(path);
  const vertices = routeBufferVertices(path, widthFt);
  return {
    type: "route",
    path: path.map((p) => ({ lat: p.lat, lng: p.lng })),
    widthFt,
    vertices,
    bounds: polygonBounds(vertices),
    areaSqFt: lengthFt * widthFt,
    perimeterFt: 2 * lengthFt + 2 * widthFt,
    drawnAt,
    drawnBy,
  };
}

/** Build a freeform polygon DigShape from traced vertices. */
export function buildPolygonShape(
  vertices: LatLngVertex[],
  drawnBy: string,
  drawnAt: number = Date.now()
): PolygonShape {
  const base = buildPolygonData(vertices, drawnBy, drawnAt);
  return { type: "polygon", ...base };
}

/**
 * Coerce a possibly-legacy stored value into a DigShape. Phase 1 persisted a
 * bare PolygonData (no `type`); treat anything without a recognized type as a
 * freeform polygon so old job docs keep rendering.
 */
export function normalizeDigShape(
  raw: DigShape | PolygonData | null | undefined
): DigShape | null {
  if (!raw) return null;
  const t = (raw as Partial<DigShape>).type;
  if (t === "radius" || t === "route" || t === "polygon") return raw as DigShape;
  return { type: "polygon", ...(raw as PolygonData) };
}
