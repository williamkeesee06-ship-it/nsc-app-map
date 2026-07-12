// Geometry helpers for high-detail Ziply print CAD on Google Maps.
// Priority: stored georeferenced path → street waypoints → street-like multi-jog path.

export type LatLng = { lat: number; lng: number };

const M_PER_DEG_LAT = 111_320;

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

export function distMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * mPerDegLng((a.lat + b.lat) / 2);
  return Math.hypot(dLat, dLng);
}

export function isValidLatLng(p: LatLng | null | undefined): p is LatLng {
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    !(p.lat === 0 && p.lng === 0) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

/** Densify a polyline with linear steps between vertices. */
export function densifyPath(points: LatLng[], stepsPerSeg = 5): LatLng[] {
  if (points.length < 2) return points.slice();
  const out: LatLng[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (let s = 0; s < stepsPerSeg; s++) {
      const t = s / stepsPerSeg;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/**
 * Place terminals using real coords when present; otherwise fan by footage
 * so plant layout reflects lateral lengths from the print.
 */
export function placeTerminalAroundHub(
  hub: LatLng,
  index: number,
  total: number,
  footageFt: number | null | undefined,
  existing: LatLng | null
): LatLng {
  if (isValidLatLng(existing)) return existing;
  const n = Math.max(total, 1);
  const angle = (index * 2 * Math.PI) / n - Math.PI / 2 + 0.15;
  // 1 ft ≈ 0.3048 m — scale plant so ~500–2500' laterals are readable at z16–18
  const ft = footageFt != null && footageFt > 0 ? footageFt : 500 + (index % 7) * 120;
  const meters = Math.min(380, Math.max(55, ft * 0.085));
  const dLat = (meters * Math.sin(angle)) / M_PER_DEG_LAT;
  const dLng = (meters * Math.cos(angle)) / mPerDegLng(hub.lat);
  return { lat: hub.lat + dLat, lng: hub.lng + dLng };
}

/**
 * Street-grid path: run along E/W then N/S with intermediate jogs so laterals
 * look like ROW/street following, not a single stick or one soft curve.
 */
export function buildStreetGridPath(
  hub: LatLng,
  terminal: LatLng,
  index: number,
  waypoints?: LatLng[] | null
): LatLng[] {
  if (waypoints && waypoints.length > 0) {
    const chain = [hub, ...waypoints.filter(isValidLatLng), terminal];
    return densifyPath(chain, 4);
  }

  const side = index % 2 === 0 ? 1 : -1;
  const dx = terminal.lng - hub.lng;
  const dy = terminal.lat - hub.lat;
  // Prefer longer axis first (more like arterial then local)
  const eastFirst = Math.abs(dx) >= Math.abs(dy);

  const p1: LatLng = eastFirst
    ? { lat: hub.lat, lng: hub.lng + dx * 0.42 }
    : { lat: hub.lat + dy * 0.42, lng: hub.lng };

  // Jog off the axis so parallel cables separate
  const jogM = 18 + (index % 4) * 8;
  const jogLat = (side * jogM) / M_PER_DEG_LAT;
  const jogLng = (side * jogM) / mPerDegLng(hub.lat);

  const p2: LatLng = {
    lat: p1.lat + (eastFirst ? jogLat : 0),
    lng: p1.lng + (eastFirst ? 0 : jogLng),
  };

  const p3: LatLng = eastFirst
    ? { lat: terminal.lat, lng: p2.lng }
    : { lat: p2.lat, lng: terminal.lng };

  // Soft corner fillets via densify
  return densifyPath([hub, p1, p2, p3, terminal], 6);
}

/**
 * Build cable polyline for map.
 * 1) Real stored path  2) waypoints  3) street-grid synthetic
 */
export function buildCablePath(
  hub: LatLng,
  terminal: LatLng,
  index: number,
  realPath?: Array<{ lat: number; lng: number }> | null,
  waypoints?: LatLng[] | null
): LatLng[] {
  if (realPath && realPath.length >= 2) {
    const cleaned = realPath.filter((p) => isValidLatLng(p));
    if (cleaned.length >= 2) return densifyPath(cleaned, 3);
  }
  return buildStreetGridPath(hub, terminal, index, waypoints);
}

export function pathMidpoint(path: LatLng[]): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (path.length === 1) return path[0]!;
  // Distance-weighted mid
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const d = distMeters(path[i]!, path[i + 1]!);
    segs.push(d);
    total += d;
  }
  if (total < 1) return path[Math.floor(path.length / 2)]!;
  let acc = 0;
  const half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i]! >= half) {
      const t = (half - acc) / (segs[i]! || 1);
      const a = path[i]!;
      const b = path[i + 1]!;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      };
    }
    acc += segs[i]!;
  }
  return path[path.length - 1]!;
}

/** Format footage for labels. */
export function formatFt(ft: number | null | undefined): string | null {
  if (ft == null || !Number.isFinite(ft)) return null;
  return `${Math.round(ft)}'`;
}
