/**
 * Tool: searchAddress — geocode a free-form address string to lat/lng.
 *
 * Hits the server-side /api/lumina/geocode proxy so the Google geocoding
 * key never reaches the browser. Does NOT move the map (that's flyToAddress).
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";
import { request } from "../../../lib/api.js";

interface SearchAddressInput {
  query: string;
}

interface SearchAddressData {
  query: string;
  lat: number;
  lng: number;
  formattedAddress: string;
}

async function run(
  input: SearchAddressInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<SearchAddressData>> {
  if (!input.query) return { ok: false, message: "searchAddress requires query." };
  let j: any;
  try {
    j = await request(`/api/lumina/geocode?q=${encodeURIComponent(input.query)}`);
  } catch (err) {
    return { ok: false, message: `Geocode failed: ${(err as Error).message}` };
  }
  if (j.status !== "OK") {
    return { ok: false, message: `Geocode returned ${j.status} for "${input.query}".` };
  }
  return {
    ok: true,
    message: `Found ${j.formattedAddress} at ${j.lat.toFixed(5)}, ${j.lng.toFixed(5)}.`,
    data: {
      query: input.query,
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
