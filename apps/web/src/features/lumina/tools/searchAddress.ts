/**
 * Tool: searchAddress — geocode a free-form address string to lat/lng.
 *
 * Hits the server-side /api/lumina/geocode proxy so the Google geocoding
 * key never reaches the browser. Does NOT move the map (that's flyToAddress).
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface SearchAddressInput {
  query: string;
}

interface SearchAddressData {
  query: string;
  status: string;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
}

interface GeocodeResponse {
  status: string;
  lat: number;
  lng: number;
  formattedAddress: string;
  errorMessage?: string;
}

async function run(
  input: SearchAddressInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<SearchAddressData>> {
  if (!input.query) return { ok: false, message: "searchAddress requires query." };
  const res = await fetch(`/api/lumina/geocode?q=${encodeURIComponent(input.query)}`);
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, message: `Geocode failed: ${text.slice(0, 200)}` };
  }
  const j = (await res.json()) as GeocodeResponse;
  if (j.status !== "OK") {
    return {
      ok: true,
      message: `No result for "${input.query}" (${j.status}).`,
      data: { query: input.query, status: j.status, formattedAddress: null, lat: null, lng: null },
    };
  }
  return {
    ok: true,
    message: `Found: ${j.formattedAddress}`,
    data: {
      query: input.query,
      status: j.status,
      formattedAddress: j.formattedAddress,
      lat: j.lat,
      lng: j.lng,
    },
  };
}

export const searchAddressTool: LuminaTool<SearchAddressInput, SearchAddressData> = {
  name: "searchAddress",
  description: "Geocode an address and return lat/lng + formatted address. Does not move the map.",
  kind: "read",
  run,
};
