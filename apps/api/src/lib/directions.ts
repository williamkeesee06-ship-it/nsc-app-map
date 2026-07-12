// Google Directions helpers — turn hub→terminal into road-following polylines
// so Ziply print CAD is not straight sticks.

import { getEnv } from "../config/env.js";

export type LatLng = { lat: number; lng: number };

function getApiKey(): string | null {
  const env = getEnv();
  return env.GOOGLE_GEOCODING_API_KEY ?? env.VITE_GOOGLE_MAPS_API_KEY ?? null;
}

/** Decode Google encoded polyline into lat/lng points. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/**
 * Route along public roads (walking mode prefers neighborhood paths/sidewalks
 * that often better match fiber ROW than highway driving).
 */
export async function routeAlongRoads(
  origin: LatLng,
  destination: LatLng,
  opts?: { mode?: "walking" | "driving" }
): Promise<LatLng[] | null> {
  const key = getApiKey();
  if (!key) return null;

  const mode = opts?.mode ?? "walking";
  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${origin.lat},${origin.lng}` +
    `&destination=${destination.lat},${destination.lng}` +
    `&mode=${mode}` +
    `&units=imperial` +
    `&key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      routes?: Array<{
        overview_polyline?: { points?: string };
        legs?: Array<{
          steps?: Array<{ polyline?: { points?: string } }>;
        }>;
      }>;
    };

    if (data.status !== "OK" || !data.routes?.[0]) {
      // Walking can fail in rural ROW — try driving once
      if (mode === "walking") {
        return routeAlongRoads(origin, destination, { mode: "driving" });
      }
      return null;
    }

    const route = data.routes[0]!;
    // Prefer step-level polyline (more detail) over overview
    const stepPts: LatLng[] = [];
    for (const leg of route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        const enc = step.polyline?.points;
        if (enc) stepPts.push(...decodePolyline(enc));
      }
    }
    if (stepPts.length >= 2) {
      return simplifyPath(stepPts, 4);
    }

    const overview = route.overview_polyline?.points;
    if (overview) {
      return simplifyPath(decodePolyline(overview), 4);
    }
    return null;
  } catch {
    return null;
  }
}

/** Drop near-duplicate points (min ~meters between kept vertices). */
function simplifyPath(points: LatLng[], minMeters: number): LatLng[] {
  if (points.length < 3) return points;
  const out: LatLng[] = [points[0]!];
  const mPerLat = 111_320;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const p = points[i]!;
    const mPerLng = mPerLat * Math.cos((p.lat * Math.PI) / 180);
    const d = Math.hypot(
      (p.lat - prev.lat) * mPerLat,
      (p.lng - prev.lng) * mPerLng
    );
    if (d >= minMeters) out.push(p);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/**
 * High-detail synthetic ROW path when Directions is unavailable.
 * Multi-jog manhattan with intermediate vertices (not a 2-point stick).
 */
export function buildSyntheticRowPath(
  hub: LatLng,
  terminal: LatLng,
  index: number,
  footageFt?: number | null
): LatLng[] {
  const mPerLat = 111_320;
  const mPerLng = mPerLat * Math.cos((hub.lat * Math.PI) / 180);
  const side = index % 2 === 0 ? 1 : -1;
  const dx = terminal.lng - hub.lng;
  const dy = terminal.lat - hub.lat;
  const eastFirst = Math.abs(dx) >= Math.abs(dy);

  // Number of jogs scales with footage so long laterals look like real plant
  const ft = footageFt != null && footageFt > 0 ? footageFt : 800;
  const jogs = Math.min(6, Math.max(3, Math.round(ft / 350)));

  const pts: LatLng[] = [hub];
  let cur = { ...hub };

  for (let j = 1; j <= jogs; j++) {
    const t = j / (jogs + 1);
    const alongLat = hub.lat + dy * t;
    const alongLng = hub.lng + dx * t;
    // Alternate axis steps with small ROW offset so parallel laterals separate
    const jogM = (12 + (index % 5) * 6) * side * (j % 2 === 0 ? 1 : -0.6);
    if (eastFirst) {
      // E/W then N/S step
      const mid = {
        lat: cur.lat,
        lng: alongLng + (j % 2 === 0 ? 0 : jogM / mPerLng),
      };
      pts.push(mid);
      cur = { lat: alongLat + (j % 2 === 1 ? jogM / mPerLat : 0), lng: mid.lng };
      pts.push(cur);
    } else {
      const mid = {
        lat: alongLat + (j % 2 === 0 ? 0 : jogM / mPerLat),
        lng: cur.lng,
      };
      pts.push(mid);
      cur = { lat: mid.lat, lng: alongLng + (j % 2 === 1 ? jogM / mPerLng : 0) };
      pts.push(cur);
    }
  }

  // Final approach corner into terminal
  if (eastFirst) {
    pts.push({ lat: cur.lat, lng: terminal.lng });
  } else {
    pts.push({ lat: terminal.lat, lng: cur.lng });
  }
  pts.push(terminal);

  // Deduplicate consecutive identical points
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
  return clean;
}
