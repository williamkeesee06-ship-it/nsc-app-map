/**
 * 2-Point Affine Georeferencing Engine — EPSG:3857 Rigid Transformation Matrix
 * Converts PDF user-space coordinates (px, py) to Web Mercator meters and Lat/Lng.
 */

export interface ControlPoint {
  /** PDF point in pixels or normalized 0-1 bounds */
  pdf: { x: number; y: number };
  /** Matching Map point in Lat/Lng */
  map: { lat: number; lng: number };
}

export interface AffineMatrix {
  scale: number;
  rotationRad: number;
  tx: number;
  ty: number;
}

/** Convert Lat/Lng (WGS84 EPSG:4326) to Web Mercator meters (EPSG:3857) */
export function latLngToMercator(lat: number, lng: number): { x: number; y: number } {
  const x = lng * 111319.49079327357;
  const rad = (lat * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + rad / 2)) * 6378137.0;
  return { x, y };
}

/** Convert Web Mercator meters (EPSG:3857) to Lat/Lng (WGS84 EPSG:4326) */
export function mercatorToLatLng(x: number, y: number): { lat: number; lng: number } {
  const lng = x / 111319.49079327357;
  const lat = (Math.atan(Math.exp(y / 6378137.0)) * 360) / Math.PI - 90;
  return { lat, lng };
}

/**
 * Calculate rigid S-Theta-T Affine Matrix from 2 control points (P1, P2 -> M1, M2).
 */
export function compute2PointAffineMatrix(
  cp1: ControlPoint,
  cp2: ControlPoint
): AffineMatrix {
  const m1 = latLngToMercator(cp1.map.lat, cp1.map.lng);
  const m2 = latLngToMercator(cp2.map.lat, cp2.map.lng);

  const dPdf = Math.hypot(cp2.pdf.x - cp1.pdf.x, cp2.pdf.y - cp1.pdf.y);
  const dMerc = Math.hypot(m2.x - m1.x, m2.y - m1.y);

  if (dPdf === 0) {
    throw new Error("Control points P1 and P2 in PDF cannot be identical.");
  }

  const scale = dMerc / dPdf;
  const anglePdf = Math.atan2(cp2.pdf.y - cp1.pdf.y, cp2.pdf.x - cp1.pdf.x);
  const angleMerc = Math.atan2(m2.y - m1.y, m2.x - m1.x);
  const rotationRad = angleMerc - anglePdf;

  const cosR = Math.cos(rotationRad);
  const sinR = Math.sin(rotationRad);

  const tx = m1.x - scale * (cp1.pdf.x * cosR - cp1.pdf.y * sinR);
  const ty = m1.y - scale * (cp1.pdf.x * sinR + cp1.pdf.y * cosR);

  return { scale, rotationRad, tx, ty };
}

/**
 * Transform a PDF coordinate (pdfX, pdfY) using the computed Affine Matrix to Lat/Lng.
 */
export function transformPdfToLatLng(
  pdfX: number,
  pdfY: number,
  matrix: AffineMatrix
): { lat: number; lng: number } {
  const cosR = Math.cos(matrix.rotationRad);
  const sinR = Math.sin(matrix.rotationRad);

  const mx = matrix.scale * (pdfX * cosR - pdfY * sinR) + matrix.tx;
  const my = matrix.scale * (pdfX * sinR + pdfY * cosR) + matrix.ty;

  return mercatorToLatLng(mx, my);
}
