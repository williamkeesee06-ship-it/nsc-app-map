// WeatherStrip — Hero top card combining:
//   • Weather condition + NWS dials (left zone)
//   • Job status radial gauges (center zone)
//   • Quick links tiles (right zone)
// All three live in a single Bezel with a rich dark navy/electric-blue gradient bg.

import { useEffect, useState, type ReactNode } from "react";
import { api, type WeatherPayload } from "../../../lib/api.js";
import { DEFAULT_CENTER } from "../../map/mapStyles.js";
import { STATUS_BUCKETS, type StatusBucket } from "../../jobs-map/markerStyle.js";
import { bucketCoreColor, type BucketCounts } from "../dashboardStatus.js";
import Bezel from "../components/Bezel.js";
import RadialGauge from "../components/RadialGauge.js";

const CACHE_MS = 15 * 60 * 1000;

let cache: { at: number; data: WeatherPayload; lat: number; lng: number } | null = null;

async function loadWeather(lat: number, lng: number): Promise<WeatherPayload> {
  const cacheLat = Number(lat.toFixed(2));
  const cacheLng = Number(lng.toFixed(2));
  if (
    cache &&
    Date.now() - cache.at < CACHE_MS &&
    cache.lat === cacheLat &&
    cache.lng === cacheLng
  ) {
    return cache.data;
  }
  const data = await api.getWeather(lat, lng);
  cache = { at: Date.now(), data, lat: cacheLat, lng: cacheLng };
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

// Quick links data — Gmail, Drive, Smartsheet
const QUICK_LINKS = [
  {
    key: "gmail",
    label: "Gmail",
    href: "https://mail.google.com",
    glyph: (
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        <rect x="2.5" y="5" width="19" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M3 6l9 7 9-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: "drive",
    label: "Drive",
    href: "https://drive.google.com",
    glyph: (
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        <path d="M8 3h8l5 9-4 7H7l-4-7zM8 3l-4 9M16 3l4 9M4 12h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: "smartsheet",
    label: "Smartsheet",
    href: "https://app.smartsheet.com",
    glyph: (
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M3 9h18M9 9v11" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
];

const BUCKET_ICONS: Record<StatusBucket, ReactNode> = {
  needs_fielding: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v4l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  rts: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <path d="M5 12l5 5 9-11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  on_hold: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  ),
  pending: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l4 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  in_progress: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <path d="M4 12a8 8 0 1 1 8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 12l-2-2M4 12l2-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  completed: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8.5 12l2.5 2.5L16 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

function firstNumber(s: string): number {
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function buildDials(w: WeatherPayload): Dial[] {
  const now = w.periods[0];
  const precip = now?.precipitationChancePct ?? null;

  return [
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

const supervisorIcon = (
  <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
    <path
      d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
      fill="currentColor"
    />
  </svg>
);

const SUPERVISOR_COLORS = [
  "#3b82f6", // Royal Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#8b5cf6", // Violet
  "#06b6d4", // Cyan
];

export interface WeatherStripProps {
  /** Job counts from useDashboardData — passed through from DashboardPage. */
  jobCounts: BucketCounts;
  onSelectBucket: (bucket: StatusBucket) => void;
  isManager?: boolean;
  supervisorCounts?: Record<string, number>;
}

export default function WeatherStrip({
  jobCounts,
  onSelectBucket,
  isManager = false,
  supervisorCounts = {},
}: WeatherStripProps) {
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchLocalWeather = async (lat: number, lng: number) => {
      try {
        const w = await loadWeather(lat, lng);
        if (!cancelled) { setWeather(w); setError(false); }
      } catch {
        if (!cancelled) setError(true);
      }
    };

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (p) => fetchLocalWeather(p.coords.latitude, p.coords.longitude),
        () => fetchLocalWeather(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
        { timeout: 10000, maximumAge: 60000 }
      );
    } else {
      fetchLocalWeather(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
    }
    return () => { cancelled = true; };
  }, [nonce]);

  useEffect(() => {
    function onFocus() { setNonce((n) => n + 1); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const total = STATUS_BUCKETS.reduce((sum, seg) => sum + jobCounts[seg.key], 0);

  // Group and sort supervisors descending by count, take top 6
  const sortedSupervisors = isManager && supervisorCounts
    ? Object.entries(supervisorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : [];

  const totalActiveJobs = isManager && supervisorCounts
    ? Object.values(supervisorCounts).reduce((sum, c) => sum + c, 0)
    : 0;

  const weatherContent = (() => {
    if (error && !weather) return null;
    if (!weather) return null;
    const now = weather.periods[0];
    const temp = now ? `${Math.round(now.temperatureF)}°` : "—";
    const condition = now?.shortForecast ?? "";
    const dials = buildDials(weather);
    return { temp, condition, area: weather.area, dials };
  })();

  return (
    <Bezel className="weather-strip hero-card">
      <div className="hero-card__body" role="region" aria-label="Dashboard overview" style={{ display: "flex", width: "100%", height: "100%" }}>

        {/* ── LEFT ZONE: Weather + Quick Links (underneath) ───────── */}
        <div className="hero-card__weather" style={{ display: "flex", flexDirection: "column", gap: "12px", flex: "0 0 370px", padding: "0 16px 0 8px" }}>
          {/* Top: Weather details + compact dials */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px", width: "100%" }}>
            {weatherContent ? (
              <>
                <div className="weather-strip__lead" style={{ flexShrink: 0 }}>
                  <span className="weather-strip__temp">
                    {weatherContent.temp}
                    <span className="weather-strip__unit">F</span>
                  </span>
                  <span className="weather-strip__condition" style={{ maxWidth: "110px", wordBreak: "break-word" }}>{weatherContent.condition}</span>
                  {weatherContent.area && (
                    <span className="weather-strip__area">{weatherContent.area}</span>
                  )}
                </div>
                <div className="weather-strip__dials" style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-start" }}>
                  {weatherContent.dials.map((d) => (
                    <RadialGauge
                      key={d.label}
                      value={d.value}
                      max={d.max}
                      display={d.display}
                      label={d.label}
                      color={d.color}
                      icon={d.icon}
                      size={64}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="hero-card__weather-skeleton" style={{ width: "100%" }}>
                <div className="dash-skel dash-skel--strip" aria-hidden />
              </div>
            )}
          </div>

          {/* Bottom: Quick Links (side-by-side) */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%", borderTop: "1px solid rgba(255, 255, 255, 0.12)", paddingTop: "10px" }}>
            <span style={{ fontSize: "10px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(61, 169, 255, 0.6)" }}>Quick Links</span>
            <div style={{ display: "flex", gap: "8px", width: "100%" }}>
              {QUICK_LINKS.map((l) => (
                <a
                  key={l.key}
                  className="hero-card__ql-tile"
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${l.label}`}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "6px 8px", flex: "1 1 0px", minWidth: 0, textDecoration: "none" }}
                >
                  <span className="hero-card__ql-glyph" style={{ display: "flex", alignItems: "center", width: "18px", height: "18px", transform: "scale(0.8)", transformOrigin: "center" }}>{l.glyph}</span>
                  <span className="hero-card__ql-label" style={{ fontSize: "11px", fontWeight: 700 }}>{l.label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* ── Vertical Divider ── */}
        <div className="hero-card__divider" aria-hidden />

        {/* ── RIGHT ZONE: Job Status or Supervisor Gauges ───────── */}
        {isManager && supervisorCounts ? (
          <div className="hero-card__gauges" role="region" aria-label="Supervisor job counts" style={{ flex: "1 1 auto" }}>
            {sortedSupervisors.length === 0 ? (
              <div style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: "13px" }}>No active jobs assigned to supervisors.</div>
            ) : (
              sortedSupervisors.map(([name, count], index) => {
                const color = SUPERVISOR_COLORS[index % SUPERVISOR_COLORS.length] || "#3b82f6";
                return (
                  <div
                    key={name}
                    className="status-bar__seg status-bar__seg--static"
                    style={{ ["--seg-color" as string]: color }}
                    aria-label={`${name}: ${count} active jobs`}
                  >
                    <RadialGauge
                      value={count}
                      max={totalActiveJobs || undefined}
                      display={String(count)}
                      label={name}
                      color={color}
                      icon={supervisorIcon}
                      size={104}
                    />
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="hero-card__gauges" role="region" aria-label="Job status overview" style={{ flex: "1 1 auto" }}>
            {STATUS_BUCKETS.map((seg) => {
              const color = bucketCoreColor(seg.key);
              return (
                <button
                  key={seg.key}
                  type="button"
                  className="status-bar__seg"
                  style={{ ["--seg-color" as string]: color }}
                  aria-label={`${seg.label}: ${jobCounts[seg.key]} jobs`}
                  onClick={() => onSelectBucket(seg.key)}
                >
                  <RadialGauge
                    key={seg.key}
                    value={jobCounts[seg.key]}
                    max={total || undefined}
                    display={String(jobCounts[seg.key])}
                    label={seg.label}
                    color={color}
                    icon={BUCKET_ICONS[seg.key]}
                    size={104}
                  />
                </button>
              );
            })}
          </div>
        )}

      </div>
    </Bezel>
  );
}
