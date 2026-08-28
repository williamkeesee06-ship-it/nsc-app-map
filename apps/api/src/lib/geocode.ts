// Google Geocoding API client.
// Why: convert Smartsheet "Address, City, Zip" strings to lat/lng for map markers.
// Docs: https://developers.google.com/maps/documentation/geocoding/overview

import { getEnv } from "../config/env.js";
import type { JobGeocode } from "@nsc/types";

const GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

interface GoogleGeocodeResult {
  status: string;
  error_message?: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
}

function getApiKey(): string {
  const env = getEnv();
  const key =
    (env.GOOGLE_GEOCODING_API_KEY || "").trim() ||
    (env.VITE_GOOGLE_MAPS_API_KEY || "").trim() ||
    (process.env.GOOGLE_MAPS_API_KEY || "").trim() ||
    (process.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
  if (!key) {
    throw new Error(
      "[geocode] No API key available (set GOOGLE_GEOCODING_API_KEY or VITE_GOOGLE_MAPS_API_KEY)"
    );
  }
  return key;
}

// Build a "Address, City, State Zip" string. We assume Western WA per the user's
// tracker name; this gets the geocoder to the right region even when Zip is missing.
export function buildAddressString(parts: {
  address: string | null;
  city: string | null;
  zipCode: string | null;
}): string | null {
  const street = (parts.address ?? "").trim();
  const city = (parts.city ?? "").trim();
  const zip = (parts.zipCode ?? "").trim();
  if (!street && !city) return null; // can't geocode with nothing

  // If the "street" field already looks like a full address (has city/state/zip
  // or multiple commas), don't re-append city/WA/zip — that confuses Google.
  const looksComplete =
    /,\s*(WA|Washington)\b/i.test(street) ||
    /\b\d{5}(-\d{4})?\b/.test(street) ||
    (street.includes(",") && street.split(",").length >= 2 && /[A-Za-z]{3,}/.test(street));
  if (looksComplete && street.length > 8) {
    return street;
  }

  const tail = [city, "WA", zip].filter(Boolean).join(" ");
  return [street, tail].filter(Boolean).join(", ");
}

/**
 * Known city-center fallbacks for North Metro / common Ziply work areas.
 * Used only when street-level geocode fails so prints still appear on the map.
 */
export const NORTH_METRO_CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  arlington: { lat: 48.1987, lng: -122.1251 },
  "lake stevens": { lat: 48.0151, lng: -122.0637 },
  marysville: { lat: 48.0518, lng: -122.1771 },
  everett: { lat: 47.979, lng: -122.2021 },
  lynnwood: { lat: 47.8209, lng: -122.3151 },
  edmonds: { lat: 47.8107, lng: -122.3774 },
  mukilteo: { lat: 47.9445, lng: -122.3046 },
  "mountlake terrace": { lat: 47.7882, lng: -122.3087 },
  bothell: { lat: 47.7623, lng: -122.2054 },
  millcreek: { lat: 47.8601, lng: -122.2043 },
  "mill creek": { lat: 47.8601, lng: -122.2043 },
  snohomish: { lat: 47.9129, lng: -122.0982 },
  monroe: { lat: 47.8554, lng: -121.9701 },
  stanwood: { lat: 48.2412, lng: -122.3507 },
  "smokey point": { lat: 48.1515, lng: -122.1918 },
  tulalip: { lat: 48.0654, lng: -122.2918 },
};

/** Resolve a hard-coded city center when Google geocode fails. */
export function cityCenterFallback(
  city: string | null | undefined,
  extraHints: Array<string | null | undefined> = []
): { lat: number; lng: number; source: string } | null {
  const blobs = [city, ...extraHints]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.toLowerCase());
  for (const blob of blobs) {
    for (const [name, coords] of Object.entries(NORTH_METRO_CITY_CENTERS)) {
      if (blob.includes(name)) {
        return { lat: coords.lat, lng: coords.lng, source: `city_center:${name}` };
      }
    }
  }
  return null;
}

export async function geocodeAddress(sourceAddress: string): Promise<JobGeocode> {
  const key = getApiKey();
  const url = `${GEOCODE_BASE}?address=${encodeURIComponent(sourceAddress)}&key=${encodeURIComponent(key)}`;
  const now = Date.now();
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return {
        lat: 0,
        lng: 0,
        formattedAddress: "",
        sourceAddress,
        cachedAt: now,
        status: "ERROR",
        errorMessage: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as GoogleGeocodeResult;
    if (data.status === "OK" && data.results[0]) {
      const r = data.results[0];
      return {
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        formattedAddress: r.formatted_address,
        sourceAddress,
        cachedAt: now,
        status: "OK",
      };
    }
    if (data.status === "ZERO_RESULTS") {
      return {
        lat: 0,
        lng: 0,
        formattedAddress: "",
        sourceAddress,
        cachedAt: now,
        status: "ZERO_RESULTS",
      };
    }
    return {
      lat: 0,
      lng: 0,
      formattedAddress: "",
      sourceAddress,
      cachedAt: now,
      status: "ERROR",
      errorMessage: data.error_message ?? `Google status: ${data.status}`,
    };
  } catch (err) {
    return {
      lat: 0,
      lng: 0,
      formattedAddress: "",
      sourceAddress,
      cachedAt: now,
      status: "ERROR",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
