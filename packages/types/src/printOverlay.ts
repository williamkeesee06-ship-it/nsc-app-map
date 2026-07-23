// Print Overlay (Stages 1–5) — shared types + pure math.
//
// This module has NO google.maps or DOM dependency so the crop-suggestion and
// georeferencing math run in Node (unit tests) and can be reused server-side.
// The georeferencing math deliberately works in a local metric (ENU) plane so
// the computed placement is stable across map pan/zoom (it is expressed in
// geographic space, never in screen pixels).

import type { LatLng } from "./index.js";
import { FEET_PER_METER, WA_REFERENCE_LAT_DEG, distanceFt } from "./geo.js";

// ── Core geometry primitives ────────────────────────────────────────────────

/** A point in a page's own pixel space (origin top-left, y increases downward). */
export interface PagePoint {
  x: number;
  y: number;
}

/**
 * A crop rectangle stored in NORMALIZED page coordinates (0..1 of page width /
 * height). Normalized so the crop survives re-rendering the PDF at any DPI and
 * never depends on the preview raster size. Non-destructive: it only ever
 * describes a sub-rectangle of the original page.
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixel bounds of detected drawing content within a rendered page raster. */
export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ── Page record (Stage 2 persistence) ────────────────────────────────────────

export type PrintOverlayPageStatus =
  | "pending"
  | "rendering"
  | "ready"
  | "error";

/**
 * One typed page record produced by splitting a source PDF. IDs are stable
 * (`${documentId}:p${pageNumber}`) so re-opening the studio reconciles cleanly
 * with persisted crop/transform/alignment metadata. Binaries (the page preview
 * PNG) live in object storage — only the reference is persisted here, never a
 * giant base64 blob.
 */
export interface PrintOverlayPage {
  /** `${documentId}:p${pageNumber}` — stable across renders. */
  id: string;
  jobId: string;
  documentId: string;
  /** 1-based page index within the source PDF. */
  pageNumber: number;
  label: string;
  status: PrintOverlayPageStatus;
  /** Intrinsic PDF page size in CSS points (viewport at scale 1). */
  pageWidth: number;
  pageHeight: number;
  /** Object-storage reference to the rendered preview PNG (not a data URL). */
  previewStoragePath: string | null;
  /** Download URL for the preview when resolved (transient/cacheable). */
  previewUrl: string | null;
  /** Reversible crop; null means "no crop / full page". */
  crop: CropRect | null;
  cropSource: "auto" | "manual" | "skipped" | null;
  /**
   * Reversible exclusion from the overlay project. Excluded pages are hidden
   * from active editing but remain in the carousel (restorable). This NEVER
   * touches the original PDF or the job document — it is overlay-only state.
   */
  excluded?: boolean;
  errorMessage?: string | null;
}

// ── Transform (Stage 4) ───────────────────────────────────────────────────────

/**
 * Free transform of the translucent page copy while the user positions it over
 * the map, BEFORE georeferencing locks it to ground coordinates. `center` is a
 * geographic anchor so the overlay tracks the map across pan/zoom; scale is a
 * unitless multiplier on the page's natural ground size and rotation is
 * clockwise degrees.
 */
export interface PrintOverlayTransform {
  center: LatLng;
  scale: number;
  rotationDeg: number;
  opacity: number;
}

// ── Georeferencing (Stage 5) ──────────────────────────────────────────────────

/** One anchor pairing a point on the page with a point on the map. */
export interface GeoAnchor {
  page: PagePoint;
  map: LatLng;
}

/**
 * Draft alignment metadata. Two anchors are required for the base similarity
 * transform (translation + uniform scale + rotation). A third optional control
 * point is used only to measure/validate residual error — it never changes the
 * base transform. NOTE: this is Stage 5 *draft* alignment; the Stage 6 final
 * lock state is intentionally NOT modeled here.
 */
export interface GeoAlignment {
  anchorA: GeoAnchor;
  anchorB: GeoAnchor;
  control?: GeoAnchor | null;
}

/**
 * Solved similarity transform mapping page pixel space → geographic space.
 * Serializable (plain numbers) so it can persist and be re-applied. `origin`
 * is the geographic image of `pageOrigin`; the transform is:
 *   local_meters = R(rotationRad) · (metersPerPixel · (page - pageOrigin)*)
 * where * flips the y axis (page y is down, north is up), then local meters are
 * offset from `origin` on a flat-earth plane using `refLatDeg` for lng scaling.
 */
export interface GeoSolution {
  pageOrigin: PagePoint;
  origin: LatLng;
  metersPerPixel: number;
  rotationRad: number;
  refLatDeg: number;
}

// ── Persisted document (Stage 1–5 aggregate) ─────────────────────────────────

/** A source PDF the studio can split — either an existing job doc or an upload. */
export interface PrintOverlaySource {
  documentId: string;
  name: string;
  /** "attachment" = already on the job; "upload" = user-provided this session. */
  origin: "attachment" | "upload";
  storagePath: string | null;
  downloadUrl: string | null;
  contentType: string | null;
  size: number | null;
  pageCount: number | null;
}

/** One document per job at jobs/{jobId} under the `printOverlay` field. */
export interface PrintOverlayDoc {
  schemaVersion: 1;
  jobId: string;
  updatedAt: number;
  updatedBy: string | null;
  sources: PrintOverlaySource[];
  pages: PrintOverlayPage[];
  /** Draft transform keyed by page id (Stage 4). */
  transforms: Record<string, PrintOverlayTransform>;
  /** Draft alignment keyed by page id (Stage 5). */
  alignments: Record<string, GeoAlignment>;
}

// =============================================================================
// Pure math — crop suggestion (Stage 3)
// =============================================================================

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Conservative automatic crop suggestion. Given the pixel bounding box of
 * detected drawing content and the raster size, propose a normalized crop that
 * trims plain outer margins while never cutting into detected content. A small
 * safety pad (default 1.5% of the page) is added around the content box so
 * engineering annotations near the edge are protected. This is deliberately a
 * *suggestion* — it never silently removes content; the caller labels it as
 * such and the user can Reset/Accept/Skip.
 *
 * Returns null when the content box is degenerate (blank page) so the caller
 * keeps the full page rather than cropping to nothing.
 */
export function suggestCropRect(
  content: ContentBounds,
  rasterWidth: number,
  rasterHeight: number,
  padFraction = 0.015
): CropRect | null {
  if (rasterWidth <= 0 || rasterHeight <= 0) return null;
  const w = content.maxX - content.minX;
  const h = content.maxY - content.minY;
  // Degenerate / blank page — no meaningful content detected.
  if (w <= 1 || h <= 1) return null;
  const padX = padFraction * rasterWidth;
  const padY = padFraction * rasterHeight;

  const x0 = clamp01((content.minX - padX) / rasterWidth);
  const y0 = clamp01((content.minY - padY) / rasterHeight);
  const x1 = clamp01((content.maxX + padX) / rasterWidth);
  const y1 = clamp01((content.maxY + padY) / rasterHeight);

  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;

  let rect: CropRect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  rect = clampCropRect(rect);
  // If the suggestion covers essentially the whole page, there is nothing to
  // trim - return null so we don't present a no-op crop.
  if (rect.width >= 0.995 && rect.height >= 0.995) return null;
  return rect;
}

/** Clamp a (possibly user-dragged) crop rect into the unit square with a min size. */
export function clampCropRect(rect: CropRect, minSize = 0.02): CropRect {
  let x = clamp01(rect.x);
  let y = clamp01(rect.y);
  // Push the anchor back if the minimum size would breach the right/bottom boundary
  if (x + minSize > 1) x = Math.max(0, 1 - minSize);
  if (y + minSize > 1) y = Math.max(0, 1 - minSize);
  
  const maxW = 1 - x;
  const maxH = 1 - y;
  const width = Math.min(maxW, Math.max(minSize, rect.width));
  const height = Math.min(maxH, Math.max(minSize, rect.height));
  return { x, y, width, height };
}

/** True when a crop rect is inside the unit square and has positive area. */
export function isValidCropRect(rect: CropRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1 + 1e-9 &&
    rect.y + rect.height <= 1 + 1e-9
  );
}

// =============================================================================
// Pure math — georeferencing similarity transform (Stage 5)
// =============================================================================

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const FEET_PER_DEGREE_LAT = 364567.2; // ≈ EARTH_RADIUS_M * (π/180) in feet

function feetPerDegreeLng(latDeg: number): number {
  return FEET_PER_DEGREE_LAT * Math.cos(toRad(latDeg));
}

/** Offset a geographic origin by (east, north) meters on a local flat plane. */
function offsetMeters(origin: LatLng, eastM: number, northM: number, refLatDeg: number): LatLng {
  const eastFt = eastM * FEET_PER_METER;
  const northFt = northM * FEET_PER_METER;
  return {
    lat: origin.lat + northFt / FEET_PER_DEGREE_LAT,
    lng: origin.lng + eastFt / feetPerDegreeLng(refLatDeg),
  };
}

/** Convert a geographic point to local (east, north) meters from an origin. */
function toLocalMeters(p: LatLng, origin: LatLng, refLatDeg: number): { e: number; n: number } {
  const eastFt = (p.lng - origin.lng) * feetPerDegreeLng(refLatDeg);
  const northFt = (p.lat - origin.lat) * FEET_PER_DEGREE_LAT;
  return { e: eastFt / FEET_PER_METER, n: northFt / FEET_PER_METER };
}

/**
 * Solve the similarity transform (translation + uniform scale + rotation) that
 * maps page pixel coordinates onto the map, from two anchor pairs. Uses a local
 * ENU metric plane anchored at anchorA.map so the result is expressed in true
 * ground units and is invariant to the map's current pan/zoom.
 *
 * Returns null if the two page anchors coincide (degenerate — no scale/rotation
 * can be derived).
 */
export function solveGeoSolution(
  alignment: Pick<GeoAlignment, "anchorA" | "anchorB">,
  refLatDeg: number = WA_REFERENCE_LAT_DEG
): GeoSolution | null {
  const { anchorA, anchorB } = alignment;
  // Reference latitude: use the anchors' own latitude for accurate lng scaling.
  const lat = (anchorA.map.lat + anchorB.map.lat) / 2 || refLatDeg;

  // Page vector (flip y: page y is down, math north is up).
  const dpx = anchorB.page.x - anchorA.page.x;
  const dpy = -(anchorB.page.y - anchorA.page.y);
  const pageDist = Math.hypot(dpx, dpy);
  if (pageDist < 1e-9) return null;

  // Map vector in local meters from anchorA.
  const mB = toLocalMeters(anchorB.map, anchorA.map, lat);
  const mapDist = Math.hypot(mB.e, mB.n);

  const metersPerPixel = mapDist / pageDist;
  const rotationRad = Math.atan2(mB.n, mB.e) - Math.atan2(dpy, dpx);

  return {
    pageOrigin: { x: anchorA.page.x, y: anchorA.page.y },
    origin: { lat: anchorA.map.lat, lng: anchorA.map.lng },
    metersPerPixel,
    rotationRad,
    refLatDeg: lat,
  };
}

/** Map a page pixel point to a geographic coordinate using a solved transform. */
export function pageToLatLng(sol: GeoSolution, p: PagePoint): LatLng {
  const dx = p.x - sol.pageOrigin.x;
  const dy = -(p.y - sol.pageOrigin.y); // flip y to north-up
  const cos = Math.cos(sol.rotationRad);
  const sin = Math.sin(sol.rotationRad);
  // Rotate then scale into local meters (east, north).
  const east = (dx * cos - dy * sin) * sol.metersPerPixel;
  const north = (dx * sin + dy * cos) * sol.metersPerPixel;
  return offsetMeters(sol.origin, east, north, sol.refLatDeg);
}

/**
 * Residual error, in feet, between where the transform predicts a control
 * point lands and where the user actually placed it on the map. Lower is a
 * tighter fit. Returns null when no control point is present.
 */
export function alignmentResidualFt(
  alignment: GeoAlignment,
  refLatDeg: number = WA_REFERENCE_LAT_DEG
): number | null {
  if (!alignment.control) return null;
  const sol = solveGeoSolution(alignment, refLatDeg);
  if (!sol) return null;
  const predicted = pageToLatLng(sol, alignment.control.page);
  return distanceFt(predicted, alignment.control.map);
}

/** Human-readable alignment quality bucket from a residual measurement (feet). */
export function alignmentQualityLabel(residualFt: number | null): string {
  if (residualFt == null) return "Add a 3rd point to measure accuracy";
  if (residualFt < 3) return `Excellent alignment (±${residualFt.toFixed(1)} ft)`;
  if (residualFt < 10) return `Good alignment (±${residualFt.toFixed(1)} ft)`;
  if (residualFt < 30) return `Fair alignment (±${residualFt.toFixed(1)} ft)`;
  return `Loose alignment (±${residualFt.toFixed(0)} ft) — re-check anchors`;
}
