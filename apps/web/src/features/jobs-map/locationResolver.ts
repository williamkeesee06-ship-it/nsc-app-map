// Location resolution engine for map pins.
// Determines the accurate lat/lng for a job based on priority:
// 1. Manual user coordinate override (saved in Firestore `customCoordinates`)
// 2. Center/midpoint of drawn route/geometry from as-built markups
// 3. Geocoded address from Smartsheet (fallback)

import type { Job, DrawingObject } from "@nsc/types";

export interface ResolvedLocation {
  lat: number;
  lng: number;
  source: "custom" | "geometry" | "geocode";
}

/**
 * Calculates the bounding centroid from a list of drawing objects.
 */
export function computeCentroidFromObjects(objects: DrawingObject[]): { lat: number; lng: number } | null {
  if (!objects || objects.length === 0) return null;
  let totalLat = 0;
  let totalLng = 0;
  let count = 0;

  for (const obj of objects) {
    if ("vertices" in obj && Array.isArray(obj.vertices) && obj.vertices.length > 0) {
      for (const v of obj.vertices) {
        if (typeof v.lat === "number" && typeof v.lng === "number") {
          totalLat += v.lat;
          totalLng += v.lng;
          count++;
        }
      }
    } else if ("bounds" in obj && obj.bounds) {
      totalLat += (obj.bounds.n + obj.bounds.s) / 2;
      totalLng += (obj.bounds.e + obj.bounds.w) / 2;
      count++;
    } else if ("position" in obj && obj.position) {
      if (typeof obj.position.lat === "number" && typeof obj.position.lng === "number") {
        totalLat += obj.position.lat;
        totalLng += obj.position.lng;
        count++;
      }
    }
  }

  if (count === 0) return null;
  return { lat: totalLat / count, lng: totalLng / count };
}

/**
 * Resolves the display location for a job.
 */
export function resolveJobLocation(
  job: Job,
  geometryCentroid?: { lat: number; lng: number } | null
): ResolvedLocation | null {
  // 1. Highest priority: User manual pin drag override
  if (job.customCoordinates && typeof job.customCoordinates.lat === "number" && job.customCoordinates.lat !== 0) {
    return {
      lat: job.customCoordinates.lat,
      lng: job.customCoordinates.lng,
      source: "custom",
    };
  }

  // 2. Second priority: Auto-snap to center of drawn cable routes / as-built objects
  if (geometryCentroid && typeof geometryCentroid.lat === "number" && geometryCentroid.lat !== 0) {
    return {
      lat: geometryCentroid.lat,
      lng: geometryCentroid.lng,
      source: "geometry",
    };
  }

  // 3. Third priority: Smartsheet address geocode
  if (job.geocode && job.geocode.status === "OK" && typeof job.geocode.lat === "number" && job.geocode.lat !== 0) {
    return {
      lat: job.geocode.lat,
      lng: job.geocode.lng,
      source: "geocode",
    };
  }

  return null;
}
