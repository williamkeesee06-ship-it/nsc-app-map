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
    }));
    res.json({ lat, lng, area, periods });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/weather] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
