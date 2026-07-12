// Google Directions — road-following polylines for Ziply plant CAD.
// Plant layout lives in ziplyPlantEngine.ts (single source of truth).

import { getEnv } from "../config/env.js";

export type LatLng = { lat: number; lng: number };

function getApiKey(): string | null {
  const env = getEnv();
  return env.GOOGLE_GEOCODING_API_KEY ?? env.VITE_GOOGLE_MAPS_API_KEY ?? null;
}

/** Decode Google encoded polyline into lat/lng points. */
function decodePolyline(encoded: string): LatLng[] {
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

/** Drop near-duplicate points (min meters between kept vertices). */
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
 * Route along public roads. Walking first (neighborhood ROW); driving fallback.
 * Returns null if no API key or zero results.
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
      if (mode === "walking") {
        return routeAlongRoads(origin, destination, { mode: "driving" });
      }
      return null;
    }

    const route = data.routes[0]!;
    const stepPts: LatLng[] = [];
    for (const leg of route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        const enc = step.polyline?.points;
        if (enc) stepPts.push(...decodePolyline(enc));
      }
    }
    if (stepPts.length >= 2) return simplifyPath(stepPts, 4);

    const overview = route.overview_polyline?.points;
    if (overview) return simplifyPath(decodePolyline(overview), 4);
    return null;
  } catch {
    return null;
  }
}
