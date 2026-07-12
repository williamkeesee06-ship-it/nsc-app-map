// Geometry helpers for high-detail Ziply print CAD on Google Maps.
// Priority: stored multi-point road path → street waypoints → multi-jog ROW path.
// NEVER draw a single straight hub→terminal stick.

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
  const ft = footageFt != null && footageFt > 0 ? footageFt : 500 + (index % 7) * 120;
  // ~0.25 m per ft visual scale, capped so plant stays readable
  const meters = Math.min(520, Math.max(70, ft * 0.22));
  const dLat = (meters * Math.sin(angle)) / M_PER_DEG_LAT;
  const dLng = (meters * Math.cos(angle)) / mPerDegLng(hub.lat);
  return { lat: hub.lat + dLat, lng: hub.lng + dLng };
}

/**
 * Multi-jog ROW path: several E/W and N/S segments so laterals read as
 * street-following plant, never a single stick.
 */
export function buildStreetGridPath(
  hub: LatLng,
  terminal: LatLng,
  index: number,
  waypoints?: LatLng[] | null,
  footageFt?: number | null
): LatLng[] {
  if (waypoints && waypoints.length > 0) {
    const chain = [hub, ...waypoints.filter(isValidLatLng), terminal];
    return densifyPath(chain, 5);
  }

  const side = index % 2 === 0 ? 1 : -1;
  const dx = terminal.lng - hub.lng;
  const dy = terminal.lat - hub.lat;
  const eastFirst = Math.abs(dx) >= Math.abs(dy);
  const ft = footageFt != null && footageFt > 0 ? footageFt : 900;
  const jogs = Math.min(7, Math.max(3, Math.round(ft / 320)));

  const pts: LatLng[] = [hub];
  let cur: LatLng = { ...hub };

  for (let j = 1; j <= jogs; j++) {
    const t = j / (jogs + 1);
    const alongLat = hub.lat + dy * t;
    const alongLng = hub.lng + dx * t;
    const jogM = (14 + (index % 5) * 7) * side * (j % 2 === 0 ? 1 : -0.55);
    const jogLat = jogM / M_PER_DEG_LAT;
    const jogLng = jogM / mPerDegLng(hub.lat);

    if (eastFirst) {
      const mid: LatLng = {
        lat: cur.lat,
        lng: alongLng + (j % 2 === 0 ? 0 : jogLng * 0.4),
      };
      pts.push(mid);
      cur = {
        lat: alongLat + (j % 2 === 1 ? jogLat : 0),
        lng: mid.lng,
      };
      pts.push(cur);
    } else {
      const mid: LatLng = {
        lat: alongLat + (j % 2 === 0 ? 0 : jogLat * 0.4),
        lng: cur.lng,
      };
      pts.push(mid);
      cur = {
        lat: mid.lat,
        lng: alongLng + (j % 2 === 1 ? jogLng : 0),
      };
      pts.push(cur);
    }
  }

  // Final corner into terminal
  if (eastFirst) {
    pts.push({ lat: cur.lat, lng: terminal.lng });
  } else {
    pts.push({ lat: terminal.lat, lng: cur.lng });
  }
  pts.push(terminal);

  // Deduplicate
  const clean: LatLng[] = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (
      !last ||
      Math.abs(last.lat - p.lat) > 1e-8 ||
      Math.abs(last.lng - p.lng) > 1e-8
    ) {
      clean.push(p);
    }
  }
  return densifyPath(clean, 4);
}

/**
 * Build cable polyline for map.
 * 1) Stored multi-point path (roads / enhance) — needs ≥3 vertices
 * 2) Street-grid multi-jog synthetic (never 2-point stick)
 */
export function buildCablePath(
  hub: LatLng,
  terminal: LatLng,
  index: number,
  realPath?: Array<{ lat: number; lng: number }> | null,
  waypoints?: LatLng[] | null,
  footageFt?: number | null
): LatLng[] {
  if (realPath && realPath.length >= 3) {
    const cleaned = realPath.filter((p) => isValidLatLng(p));
    // 2-point "paths" are still sticks — rebuild. 3+ verts = real detail.
    if (cleaned.length >= 3) {
      // If path is almost collinear (old stick densified), rebuild
      if (cleaned.length >= 4 || pathHasTurns(cleaned)) {
        return densifyPath(cleaned, cleaned.length >= 8 ? 2 : 4);
      }
    }
  }
  return buildStreetGridPath(hub, terminal, index, waypoints, footageFt);
}

/** True if path has at least one meaningful corner (not a straight stick). */
function pathHasTurns(path: LatLng[]): boolean {
  if (path.length < 3) return false;
  let turnCount = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const c = path[i + 1]!;
    const abx = b.lng - a.lng;
    const aby = b.lat - a.lat;
    const bcx = c.lng - b.lng;
    const bcy = c.lat - b.lat;
    const cross = Math.abs(abx * bcy - aby * bcx);
    if (cross > 1e-12) turnCount++;
  }
  return turnCount >= 1;
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

/** Format footage for labels. */
export function formatFt(ft: number | null | undefined): string | null {
  if (ft == null || !Number.isFinite(ft)) return null;
  return `${Math.round(ft)}'`;
}
