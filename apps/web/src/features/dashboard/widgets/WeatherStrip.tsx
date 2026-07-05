// Weather + daylight strip. Reuses the NWS-backed /api/lumina/weather route
// (extended to return sunrise/sunset + humidity). Centered on the app's
// default map area. 15-minute in-memory cache, refetch on window focus.
// Per spec correction: NO "Good Day to Bore" chip.

import { useEffect, useState, type ReactNode } from "react";
import { api, type WeatherPayload } from "../../../lib/api.js";
import { DEFAULT_CENTER } from "../../map/mapStyles.js";
import Bezel from "../components/Bezel.js";
import RadialGauge from "../components/RadialGauge.js";

const CACHE_MS = 15 * 60 * 1000;

let cache: { at: number; data: WeatherPayload } | null = null;

async function loadWeather(): Promise<WeatherPayload> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const data = await api.getWeather(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
  cache = { at: Date.now(), data };
  return data;
}

interface Dial {
  label: string;
  display: string;
  value: number;
  max?: number;
  color: string;
  icon: ReactNode;
}

const dropletIcon = (
  <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
    <path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" fill="currentColor" />
  </svg>
);
const windIcon = (
  <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
    <path
      d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
const cloudIcon = (
  <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
    <path
      d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.3A3.5 3.5 0 0 1 17 18z"
      fill="currentColor"
    />
  </svg>
);
const sunIcon = (
  <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
    <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    <path
      d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

function firstNumber(s: string): number {
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function buildDials(w: WeatherPayload): Dial[] {
  const now = w.periods[0];
  const humidity = now?.relativeHumidityPct ?? null;
  const precip = now?.precipitationChancePct ?? null;
  
  let windText = "—";
  let windNum = 0;
  if (now) {
    const cleanSpeed = now.windSpeed
      .toLowerCase()
      .replace(/\s*to\s*/g, "-")
      .replace(/\s*mph\s*/g, " mph");
    windText = `${cleanSpeed} ${now.windDirection}`.trim();
    windNum = firstNumber(now.windSpeed);
  }

  return [
    {
      label: "Humidity",
      display: humidity != null ? `${humidity}%` : "—",
      value: humidity ?? 0,
      max: 100,
      color: "#3da9ff",
      icon: dropletIcon,
    },
    {
      label: "Wind",
      display: windText || "—",
      value: windNum,
      max: 40,
      color: "#6be7c4",
      icon: windIcon,
    },
    {
      label: "Precip",
      display: precip != null ? `${precip}%` : "—",
      value: precip ?? 0,
      max: 100,
      color: "#b48cff",
      icon: cloudIcon,
    },
    {
      label: "Sunrise",
      display: w.sunrise || "—",
      value: 1,
      color: "#ffb547",
      icon: sunIcon,
    },
    {
      label: "Sunset",
      display: w.sunset || "—",
      value: 1,
      color: "#7bc4ff",
      icon: sunIcon,
    },
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
      <Bezel className="weather-strip weather-strip--error">
        <span role="status">Weather unavailable</span>
      </Bezel>
    );
  }

  if (!weather) {
    return (
      <Bezel className="weather-strip">
        <div className="dash-skel dash-skel--strip" aria-hidden />
      </Bezel>
    );
  }

  const now = weather.periods[0];
  const temp = now ? `${Math.round(now.temperatureF)}°` : "—";
  const condition = now?.shortForecast ?? "";
  const dials = buildDials(weather);

  return (
    <Bezel className="weather-strip">
      <div className="weather-strip__body" role="region" aria-label="Weather and daylight">
        <div className="weather-strip__lead">
          <span className="weather-strip__temp">
            {temp}
            <span className="weather-strip__unit">F</span>
          </span>
          <span className="weather-strip__condition">{condition}</span>
          {weather.area && (
            <span className="weather-strip__area">{weather.area}</span>
          )}
        </div>
        <div className="weather-strip__dials">
          {dials.map((d) => (
            <RadialGauge
              key={d.label}
              value={d.value}
              max={d.max}
              display={d.display}
              label={d.label}
              color={d.color}
              icon={d.icon}
              size={104}
            />
          ))}
        </div>
      </div>
    </Bezel>
  );
}
