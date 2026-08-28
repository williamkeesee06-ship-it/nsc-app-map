/**
 * Tool: getMyLocation
 *
 * Returns the device's current GPS via the browser geolocation API. Used by
 * Lumina when Billy says "nearest first" / "around me" / "where I'm standing".
 * The result feeds straight into listJobs(sortBy:"distance", originLat, originLng).
 *
 * Permission: first call triggers the browser's location prompt. Once granted,
 * subsequent calls are silent. We use { enableHighAccuracy: true } because a
 * supervisor on a job site needs better than cell-tower accuracy.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface MyLocationData {
  lat: number;
  lng: number;
  accuracyMeters: number;
  /** ISO timestamp of when the fix was taken. */
  takenAt: string;
}

const TIMEOUT_MS = 8000;

async function run(
  _input: unknown,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<MyLocationData>> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return {
      ok: false,
      message: "Device geolocation is not available in this environment.",
    };
  }
  return await new Promise<LuminaToolResult<MyLocationData>>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          ok: true,
          message: `Got your location: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (±${Math.round(pos.coords.accuracy)}m).`,
          data: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
            takenAt: new Date(pos.timestamp).toISOString(),
          },
        });
      },
      (err) => {
        // PERMISSION_DENIED=1, POSITION_UNAVAILABLE=2, TIMEOUT=3
        const reason =
          err.code === 1
            ? "Permission denied — Billy must allow location in browser settings."
            : err.code === 2
            ? "Position unavailable (no GPS signal)."
            : err.code === 3
            ? "Location request timed out."
            : err.message || "Unknown geolocation error.";
        resolve({ ok: false, message: reason });
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 30_000 }
    );
  });
}

export const getMyLocationTool: LuminaTool<unknown, MyLocationData> = {
  name: "getMyLocation",
  description:
    "Get the device's current GPS coordinates. Call this before listJobs(sortBy:'distance') so the sort has a real origin. First call prompts Billy for browser location permission.",
  kind: "read",
  run,
};
