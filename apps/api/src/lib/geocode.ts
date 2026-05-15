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
  const key = env.GOOGLE_GEOCODING_API_KEY ?? env.VITE_GOOGLE_MAPS_API_KEY;
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
  const tail = [city, "WA", zip].filter(Boolean).join(" ");
  return [street, tail].filter(Boolean).join(", ");
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
