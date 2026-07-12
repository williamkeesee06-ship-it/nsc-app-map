// Client geometry for Ziply print CAD. Prefer server-stored multi-point paths.
// NEVER draw a single straight hub→terminal stick as the sole geometry.

export type LatLng = { lat: number; lng: number };

const M_PER_DEG_LAT = 111_320;

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

function distMeters(a: LatLng, b: LatLng): number {
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

/** Densify polyline. Caps output for long server paths (scalability). */
function densifyPath(points: LatLng[], stepsPerSeg = 5): LatLng[] {
  if (points.length < 2) return points.slice();
  // Already dense enough — avoid O(n * steps) explosion on long Directions paths
  if (points.length >= 24) return points.slice();
  const steps = points.length >= 12 ? Math.min(stepsPerSeg, 2) : stepsPerSeg;
  const out: LatLng[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
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
 * Place terminals using real coords when present; otherwise fan by footage.
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
  const ft = footageFt != null && footageFt > 0 ? footageFt : 500 + (index % 7) * 120;
  const meters = Math.min(520, Math.max(70, ft * 0.22));
  const dLat = (meters * Math.sin(angle)) / M_PER_DEG_LAT;
  const dLng = (meters * Math.cos(angle)) / mPerDegLng(hub.lat);
  return { lat: hub.lat + dLat, lng: hub.lng + dLng };
}

/**
 * Build cable polyline for map.
 * 1) Stored multi-point path from master plant engine (preferred)
 * 2) Compact L-path fallback — never a 2-point stick alone
 */
export function buildCablePath(
  hub: LatLng,
  terminal: LatLng,
  index: number,
  realPath?: Array<{ lat: number; lng: number }> | null
): LatLng[] {
  if (realPath && realPath.length >= 2) {
    const cleaned = realPath.filter((p) => isValidLatLng(p));
    if (cleaned.length >= 3) {
      // Server paths are already densified / road-followed — use as-is
      return cleaned;
    }
    if (cleaned.length === 2) {
      return densifyPath(cleaned, 4);
    }
  }
  const dx = terminal.lng - hub.lng;
  const dy = terminal.lat - hub.lat;
  const eastFirst = Math.abs(dx) >= Math.abs(dy);
  const join: LatLng = eastFirst
    ? { lat: hub.lat, lng: terminal.lng }
    : { lat: terminal.lat, lng: hub.lng };
  const shoulder: LatLng = {
    lat: join.lat + (index % 2 === 0 ? 1 : -1) * 0.00004,
    lng: join.lng + (index % 2 === 0 ? 1 : -1) * 0.00004,
  };
  return densifyPath([hub, join, shoulder, terminal], 4);
}

export function pathMidpoint(path: LatLng[]): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (path.length === 1) return path[0]!;
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
