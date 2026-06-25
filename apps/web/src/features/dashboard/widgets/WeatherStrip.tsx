// Weather + daylight strip. Reuses the NWS-backed /api/lumina/weather route
// (extended to return sunrise/sunset + humidity). Centered on the app's
// default map area. 15-minute in-memory cache, refetch on window focus.
// Per spec correction: NO "Good Day to Bore" chip.

import { useEffect, useState } from "react";
import { api, type WeatherPayload } from "../../../lib/api.js";
import { DEFAULT_CENTER } from "../../map/mapStyles.js";

const CACHE_MS = 15 * 60 * 1000;

let cache: { at: number; data: WeatherPayload } | null = null;

async function loadWeather(): Promise<WeatherPayload> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const data = await api.getWeather(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
  cache = { at: Date.now(), data };
  return data;
}

interface Metric {
  label: string;
  value: string;
}

function buildMetrics(w: WeatherPayload): Metric[] {
  const now = w.periods[0];
  const humidity =
    now?.relativeHumidityPct != null ? `${now.relativeHumidityPct}%` : "—";
  const wind = now ? `${now.windSpeed} ${now.windDirection}`.trim() : "—";
  const precip =
    now?.precipitationChancePct != null ? `${now.precipitationChancePct}%` : "—";
  return [
    { label: "Humidity", value: humidity },
    { label: "Wind", value: wind },
    { label: "Precip", value: precip },
    { label: "Sunrise", value: w.sunrise || "—" },
    { label: "Sunset", value: w.sunset || "—" },
  ];
}

export default function WeatherStrip() {
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadWeather()
      .then((w) => {
        if (!cancelled) {
          setWeather(w);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    function onFocus() {
      setNonce((n) => n + 1);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  if (error && !weather) {
    return (
      <div className="weather-strip weather-strip--error" role="status">
        Weather unavailable
      </div>
    );
  }

  if (!weather) {
    return <div className="weather-strip dash-skel dash-skel--strip" aria-hidden />;
  }

  const now = weather.periods[0];
  const temp = now ? `${Math.round(now.temperatureF)}°F` : "—";
  const condition = now?.shortForecast ?? "";
  const metrics = buildMetrics(weather);

  return (
    <div className="weather-strip" role="region" aria-label="Weather and daylight">
      <div className="weather-strip__lead">
        <span className="weather-strip__temp">{temp}</span>
        <span className="weather-strip__condition">{condition}</span>
        {weather.area && (
          <span className="weather-strip__area">{weather.area}</span>
        )}
      </div>
      <div className="weather-strip__metrics">
        {metrics.map((m) => (
          <div className="weather-strip__metric" key={m.label}>
            <span className="weather-strip__metric-label">{m.label}</span>
            <span className="weather-strip__metric-value">{m.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
