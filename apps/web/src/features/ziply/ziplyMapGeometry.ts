// Geometry helpers for richer Ziply print CAD on Google Maps.
// When Gemini does not return georeferenced cable polylines, we synthesize
// curved street-like laterals instead of stick-straight hub→terminal lines.

export type LatLng = { lat: number; lng: number };

/** ~meters per degree latitude. */
const M_PER_DEG_LAT = 111_320;

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Distance in meters (rough). */
export function distMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * mPerDegLng((a.lat + b.lat) / 2);
  return Math.hypot(dLat, dLng);
}

/** Place terminals by compass fan + lateral length so the design reads as a plant, not a pin cushion. */
export function placeTerminalAroundHub(
  hub: LatLng,
  index: number,
  total: number,
  footageFt: number | null | undefined,
  existing: LatLng | null
): LatLng {
  if (existing && Number.isFinite(existing.lat) && Number.isFinite(existing.lng) && !(existing.lat === 0 && existing.lng === 0)) {
    return existing;
  }
  const n = Math.max(total, 1);
  // Even fan; slight phase so first isn't due-east only
  const angle = (index * 2 * Math.PI) / n - Math.PI / 2;
  // Map footage to radial distance (clamp 40m–220m for readability at street zoom)
  const ft = footageFt != null && footageFt > 0 ? footageFt : 400 + (index % 5) * 80;
  const meters = Math.min(220, Math.max(45, ft * 0.12));
  const dLat = (meters * Math.sin(angle)) / M_PER_DEG_LAT;
  const dLng = (meters * Math.cos(angle)) / mPerDegLng(hub.lat);
  return { lat: hub.lat + dLat, lng: hub.lng + dLng };
}

/** Sample a quadratic Bezier for a smooth cable run. */
function sampleQuad(a: LatLng, c: LatLng, b: LatLng, steps: number): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      lat: u * u * a.lat + 2 * u * t * c.lat + t * t * b.lat,
      lng: u * u * a.lng + 2 * u * t * c.lng + t * t * b.lng,
    });
  }
  return out;
}

/**
 * Build a cable polyline: prefer real path; else curved hub→terminal with
 * alternating bend so parallel laterals don't stack into one stick.
 */
export function buildCablePath(
  hub: LatLng,
  terminal: LatLng,
  index: number,
  realPath?: Array<{ lat: number; lng: number }> | null
): LatLng[] {
  if (realPath && realPath.length >= 2) {
    return realPath.map((p) => ({ lat: p.lat, lng: p.lng }));
  }
  const dx = terminal.lng - hub.lng;
  const dy = terminal.lat - hub.lat;
  // Perpendicular unit-ish offset (in lat/lng space)
  const len = Math.hypot(dx, dy) || 1e-9;
  const side = index % 2 === 0 ? 1 : -1;
  // Bend amount ~12–22% of span, varies by index
  const bend = (0.12 + (index % 5) * 0.02) * side;
  const ctrl: LatLng = {
    lat: (hub.lat + terminal.lat) / 2 - dx * bend,
    lng: (hub.lng + terminal.lng) / 2 + dy * bend,
  };
  // Extra mid kinks for longer runs so it feels like street following
  const steps = Math.min(24, Math.max(10, Math.round(len * 8000)));
  const base = sampleQuad(hub, ctrl, terminal, steps);
  // Light secondary bow at 1/3 and 2/3 for longer laterals
  if (steps >= 14) {
    return base.map((p, i) => {
      if (i === 0 || i === base.length - 1) return p;
      const t = i / (base.length - 1);
      const wobble = Math.sin(t * Math.PI * 2) * 0.00002 * side * (1 + (index % 3));
      return {
        lat: p.lat + wobble * Math.cos(angleOf(hub, terminal)),
        lng: p.lng + wobble * Math.sin(angleOf(hub, terminal)),
      };
    });
  }
  return base;
}

function angleOf(a: LatLng, b: LatLng): number {
  return Math.atan2(b.lat - a.lat, b.lng - a.lng);
}

/** Midpoint along a path (for cable labels). */
export function pathMidpoint(path: LatLng[]): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (path.length === 1) return path[0]!;
  const mid = Math.floor(path.length / 2);
  return path[mid]!;
}
