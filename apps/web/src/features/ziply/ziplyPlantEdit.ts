// Map-side path editing helpers for Ziply print CAD.

import type { LatLng } from "./ziplyMapGeometry.js";

/** Simplify path by min spacing (meters) for editable control points. */
export function pathControlPoints(path: LatLng[], maxPts = 24): LatLng[] {
  if (path.length <= maxPts) return path.map((p) => ({ ...p }));
  const step = Math.ceil(path.length / maxPts);
  const out: LatLng[] = [];
  for (let i = 0; i < path.length; i += step) {
    out.push({ ...path[i]! });
  }
  const last = path[path.length - 1]!;
  const prev = out[out.length - 1]!;
  if (prev.lat !== last.lat || prev.lng !== last.lng) out.push({ ...last });
  return out;
}

export function insertVertex(
  path: LatLng[],
  afterIndex: number,
  point: LatLng
): LatLng[] {
  const next = path.slice();
  const i = Math.max(0, Math.min(afterIndex + 1, next.length));
  next.splice(i, 0, { ...point });
  return next;
}

export function moveVertex(path: LatLng[], index: number, point: LatLng): LatLng[] {
  if (index < 0 || index >= path.length) return path;
  const next = path.slice();
  next[index] = { ...point };
  return next;
}

export function removeVertex(path: LatLng[], index: number): LatLng[] {
  if (path.length <= 2) return path;
  if (index < 0 || index >= path.length) return path;
  return path.filter((_, i) => i !== index);
}

/** Find nearest segment index for inserting a click point. */
export function nearestSegmentIndex(path: LatLng[], click: LatLng): number {
  if (path.length < 2) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const mid = {
      lat: (a.lat + b.lat) / 2,
      lng: (a.lng + b.lng) / 2,
    };
    const d = Math.hypot(click.lat - mid.lat, click.lng - mid.lng);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
