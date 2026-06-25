/**
 * GET /api/lumina/weather?lat=...&lng=...&periods=14
 *
 * NOAA / National Weather Service two-step forecast lookup. Free, key-less.
 * Required User-Agent per NWS docs.
 *
 *   1. points/{lat},{lng}      → returns properties.forecast URL
 *   2. that URL                → returns properties.periods[] (~14 half-days)
 */

import { Router, type Request, type Response } from "express";

const router = Router();

const NWS_UA = "NSC-Map-App/1.0 (williamkeesee06@gmail.com)";

interface NwsPeriod {
  name?: string;
  startTime?: string;
  endTime?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
  detailedForecast?: string;
  probabilityOfPrecipitation?: { value: number | null };
  relativeHumidity?: { value: number | null };
}

// Sunrise/sunset (NOAA solar equations) — keyless, no upstream call. Returns
// local-time HH:MM AM/PM strings for the given day at lat/lng. The dashboard
// weather strip needs these and NWS does not provide them.
function solarTimes(lat: number, lng: number, when: Date = new Date()): {
  sunrise: string;
  sunset: string;
} {
  const rad = Math.PI / 180;
  const dayMs = 86400000;
  const start = Date.UTC(when.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()) - start) / dayMs);

  // Fractional year (radians) → equation of time + solar declination.
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + 0.5);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma)); // minutes
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma); // radians

  // Hour angle at sunrise/sunset (90.833° accounts for refraction + solar disc).
  const cosH =
    Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) -
    Math.tan(lat * rad) * Math.tan(decl);
  // Polar day/night guard.
  if (cosH > 1) return { sunrise: "—", sunset: "—" };
  if (cosH < -1) return { sunrise: "—", sunset: "—" };
  const ha = Math.acos(cosH) / rad; // degrees

  // UTC minutes from local solar noon math.
  const sunriseUtcMin = 720 - 4 * (lng + ha) - eqTime;
  const sunsetUtcMin = 720 - 4 * (lng - ha) - eqTime;

  const fmt = (utcMinutes: number): string => {
    const base = Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
    const d = new Date(base + Math.round(utcMinutes) * 60000);
    // Render in the timezone implied by the longitude is unreliable; use the
    // server's Pacific scope (the app is Kent, WA based) for the label.
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  };

  return { sunrise: fmt(sunriseUtcMin), sunset: fmt(sunsetUtcMin) };
}

router.get("/lumina/weather", async (req: Request, res: Response) => {
  const lat = parseFloat(String(req.query.lat ?? ""));
  const lng = parseFloat(String(req.query.lng ?? ""));
  const periodsCap = Math.min(
    Math.max(parseInt(String(req.query.periods ?? "14"), 10) || 14, 1),
    14
  );
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: "lat and lng required (numbers)" });
  }
  try {
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
      { headers: { "User-Agent": NWS_UA, Accept: "application/geo+json" } }
    );
    if (!pointsRes.ok) {
      return res
        .status(502)
        .json({ error: `NWS points endpoint returned ${pointsRes.status}` });
    }
    const pointsJson = (await pointsRes.json()) as {
      properties?: {
        forecast?: string;
        relativeLocation?: {
          properties?: { city?: string; state?: string };
        };
      };
    };
    const forecastUrl = pointsJson.properties?.forecast;
    if (!forecastUrl) {
      return res.status(502).json({ error: "NWS did not return a forecast URL." });
    }
    const area =
      pointsJson.properties?.relativeLocation?.properties
        ? `${pointsJson.properties.relativeLocation.properties.city ?? ""}, ${pointsJson.properties.relativeLocation.properties.state ?? ""}`
        : null;

    const fxRes = await fetch(forecastUrl, {
      headers: { "User-Agent": NWS_UA, Accept: "application/geo+json" },
    });
    if (!fxRes.ok) {
      return res.status(502).json({ error: `NWS forecast endpoint returned ${fxRes.status}` });
    }
    const fxJson = (await fxRes.json()) as { properties?: { periods?: NwsPeriod[] } };
    const periods = (fxJson.properties?.periods ?? []).slice(0, periodsCap).map((p) => ({
      name: p.name ?? "",
      start: p.startTime ?? "",
      end: p.endTime ?? "",
      temperatureF:
        p.temperatureUnit === "F" ? (p.temperature ?? 0) : Math.round((p.temperature ?? 0) * 9 / 5 + 32),
      windSpeed: p.windSpeed ?? "",
      windDirection: p.windDirection ?? "",
      shortForecast: p.shortForecast ?? "",
      detailedForecast: p.detailedForecast ?? "",
      precipitationChancePct: p.probabilityOfPrecipitation?.value ?? null,
      relativeHumidityPct: p.relativeHumidity?.value ?? null,
    }));
    const { sunrise, sunset } = solarTimes(lat, lng);
    res.json({ lat, lng, area, sunrise, sunset, periods });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/weather] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
