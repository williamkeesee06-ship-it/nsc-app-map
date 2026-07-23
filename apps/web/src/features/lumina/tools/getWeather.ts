/**
 * Tool: getWeather
 *
 * Free 7-day forecast from the NOAA / National Weather Service API. No key
 * required, no rate limits at our volume. US-only (which is what we need).
 *
 * Two-step protocol per NWS docs:
 *   1) GET https://api.weather.gov/points/{lat},{lng}   → forecast URL
 *   2) GET that URL                                     → 7-day periods
 *
 * NOAA requires a User-Agent header. The /api/lumina/weather backend route
 * sets one; we proxy through it instead of calling NOAA from the browser so
 * CORS and UA stay clean.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

import { request } from "../../../lib/api.js";

interface WeatherInput {
  lat: number;
  lng: number;
  /** Optional days cap (each NWS "period" is ~12 hours). Default 14 (=7 days). */
  periods?: number;
}

interface WeatherPeriod {
  name: string; // "Tonight", "Tuesday", "Tuesday Night", ...
  start: string;
  end: string;
  temperatureF: number;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast: string;
  precipitationChancePct: number | null;
}

interface WeatherData {
  lat: number;
  lng: number;
  /** NWS station / area description. */
  area: string | null;
  periods: WeatherPeriod[];
}

async function run(
  input: WeatherInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<WeatherData>> {
  if (typeof input.lat !== "number" || typeof input.lng !== "number") {
    return { ok: false, message: "getWeather requires numeric lat and lng." };
  }
  const periods = Math.min(Math.max(input.periods ?? 14, 1), 14);
  let body: WeatherData;
  try {
    body = await request<WeatherData>(
      `/api/lumina/weather?lat=${input.lat}&lng=${input.lng}&periods=${periods}`
    );
  } catch (err) {
    return { ok: false, message: `Weather lookup failed. ${(err as Error).message}` };
  }
  return {
    ok: true,
    message: `Forecast for ${body.area ?? `${input.lat.toFixed(3)},${input.lng.toFixed(3)}`}: ${body.periods.length} periods.`,
    data: body,
  };
}

export const getWeatherTool: LuminaTool<WeatherInput, WeatherData> = {
  name: "getWeather",
  description:
    "Get a US weather forecast (up to 7 days / 14 half-day periods) from NOAA for a lat/lng. Use for any 'is it raining at job X' / 'should I push this fielding to tomorrow' question.",
  kind: "read",
  run,
};
