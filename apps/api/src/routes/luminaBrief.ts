// Sprint 3.0 — Daily 6:30 AM briefing endpoint.
//
// Vercel's cron service hits this endpoint once a day. It composes a plain-
// English briefing (today's crews + schedule, weather, unread inbox highlights)
// and ships it to Billy's phone via the existing Pushover proxy.
//
// Locked down two ways:
//   1. CRON_SECRET header — Vercel attaches `Authorization: Bearer <CRON_SECRET>`
//      automatically to every cron invocation. We reject anything that doesn't
//      match the value set in Vercel env. Manual hits from `curl` need to pass
//      `?key=<CRON_SECRET>` for QA.
//   2. The endpoint never accepts an arbitrary recipient — it always pushes
//      to Billy via the same Pushover creds the watch-notification tool uses.
//
// Why the route is self-contained: in-process Smartsheet + weather helpers
// keep this fast (one Smartsheet round-trip, one NWS round-trip, one Pushover
// post) instead of doing self-fetches across the Express boundary.

import { Router, type Request, type Response } from "express";
import { getSheet, rowToRecord, buildColumnsById } from "../lib/smartsheet.js";

const router = Router();

// Same scope constant the rest of luminaSmartsheet uses. Keep in sync if Billy
// ever takes on a co-supervisor (this is the single source of truth on what
// "my" jobs means everywhere on the server).
const SUPERVISOR_SCOPE = "Billy Keesee";
const SUPERVISOR_COLUMN = "Construction Supervisor";

// Kent, WA — Billy's home base. Used for the weather call when no override.
const DEFAULT_LAT = 47.3809;
const DEFAULT_LNG = -122.2348;

const PUSHOVER_ENDPOINT = "https://api.pushover.net/1/messages.json";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Pacific-time YYYY-MM-DD for the moment passed in (defaults to now). */
function todayPacificIso(now: Date = new Date()): string {
  // Intl gives us a stable Pacific-time date without dragging in a tz library.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** Friendly Pacific-time weekday + month/day, e.g. "Thu Jun 18". */
function todayPacificLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(now);
}

interface BriefJob {
  workOrder: string;
  address: string;
  city: string;
  crew: string;
  status: string;
}

/**
 * Returns Billy's jobs scheduled for `dateIso` (Pacific YYYY-MM-DD), inclusive
 * of multi-day jobs spanning that date.
 */
async function getJobsForDate(dateIso: string): Promise<BriefJob[]> {
  const sheet = await getSheet();
  const columnsById = buildColumnsById(sheet);
  const out: BriefJob[] = [];

  for (const row of sheet.rows) {
    const rec = rowToRecord(row, columnsById);
    if (String(rec[SUPERVISOR_COLUMN] ?? "").trim() !== SUPERVISOR_SCOPE) continue;

    const sd = String(rec["Schedule Date"] ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sd)) continue;
    const ed = String(rec["End Date"] ?? "").trim().slice(0, 10);
    const endIso = /^\d{4}-\d{2}-\d{2}$/.test(ed) ? ed : sd;

    // Inclusive window test (string compare is safe — all ISO dates same length).
    if (dateIso < sd || dateIso > endIso) continue;

    const crewRaw = String(rec["Construction Crew/Forman"] ?? "").trim();
    const crew = crewRaw.replace(/\s+/g, " ") || "(unassigned)";

    out.push({
      workOrder: String(rec["Work Order"] ?? "").trim(),
      address: String(rec["Address"] ?? "").trim(),
      city: String(rec["City"] ?? "").trim(),
      crew,
      status: rec["Job Status"] != null ? String(rec["Job Status"]) : "",
    });
  }

  // Group by crew so the brief reads naturally ("Crew A on… Crew B on…").
  out.sort((a, b) => (a.crew === b.crew ? a.city.localeCompare(b.city) : a.crew.localeCompare(b.crew)));
  return out;
}

interface BriefWeather {
  area: string | null;
  today: string;        // e.g. "Mostly sunny, high 74°F"
  tonight: string;      // e.g. "Partly cloudy, low 52°F"
  precipPct: number | null;
}

const NWS_UA = "NSCAppMap/1.0 (williamkeesee06@gmail.com)";

/**
 * Pulls a simplified today/tonight forecast straight from NWS — same upstream
 * the /lumina/weather route uses, just summarized for a one-line briefing.
 */
async function getWeather(lat: number, lng: number): Promise<BriefWeather | null> {
  try {
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
      { headers: { "User-Agent": NWS_UA, Accept: "application/geo+json" } }
    );
    if (!pointsRes.ok) return null;
    const pointsJson = (await pointsRes.json()) as {
      properties?: {
        forecast?: string;
        relativeLocation?: { properties?: { city?: string; state?: string } };
      };
    };
    const forecastUrl = pointsJson.properties?.forecast;
    if (!forecastUrl) return null;

    const area = pointsJson.properties?.relativeLocation?.properties
      ? `${pointsJson.properties.relativeLocation.properties.city ?? ""}, ${pointsJson.properties.relativeLocation.properties.state ?? ""}`
      : null;

    const fxRes = await fetch(forecastUrl, {
      headers: { "User-Agent": NWS_UA, Accept: "application/geo+json" },
    });
    if (!fxRes.ok) return null;
    const fxJson = (await fxRes.json()) as {
      properties?: {
        periods?: Array<{
          name?: string;
          temperature?: number;
          temperatureUnit?: string;
          shortForecast?: string;
          isDaytime?: boolean;
          probabilityOfPrecipitation?: { value: number | null };
        }>;
      };
    };
    const periods = fxJson.properties?.periods ?? [];
    // First two periods are always "today" + "tonight" (or "tonight"+"tomorrow"
    // if it's already past 6pm — at 6:30am we're firmly in today/tonight).
    const day = periods.find((p) => p.isDaytime) ?? periods[0];
    const night = periods.find((p) => !p.isDaytime) ?? periods[1];

    const fmt = (p: typeof day): string => {
      if (!p) return "";
      const t = p.temperature != null ? `${p.temperature}°${p.temperatureUnit ?? "F"}` : "";
      const short = p.shortForecast ?? "";
      return [short, t].filter(Boolean).join(", ");
    };

    return {
      area,
      today: fmt(day),
      tonight: fmt(night),
      precipPct: day?.probabilityOfPrecipitation?.value ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Composes the plain-English message. Kept short — Pushover collapses long
 * messages on the lock screen and Billy reads these at 6:30am.
 */
function composeBrief(args: {
  dateLabel: string;
  jobs: BriefJob[];
  weather: BriefWeather | null;
}): string {
  const { dateLabel, jobs, weather } = args;
  const lines: string[] = [];

  lines.push(`Good morning. ${dateLabel}.`);

  if (weather) {
    const wx = weather.today || weather.tonight || "Forecast unavailable";
    const rain = weather.precipPct != null && weather.precipPct >= 30
      ? ` (${weather.precipPct}% rain)`
      : "";
    lines.push(`Weather: ${wx}${rain}.`);
  }

  if (jobs.length === 0) {
    lines.push("No crews on the board today.");
  } else {
    // Group by crew so the brief reads as a clean roll-call.
    const byCrew = new Map<string, BriefJob[]>();
    for (const j of jobs) {
      const arr = byCrew.get(j.crew) ?? [];
      arr.push(j);
      byCrew.set(j.crew, arr);
    }
    lines.push(`${jobs.length} job${jobs.length === 1 ? "" : "s"} on the board, ${byCrew.size} crew${byCrew.size === 1 ? "" : "s"}:`);
    for (const [crew, items] of byCrew) {
      const where = items
        .map((j) => `${j.city || j.address || "?"}${j.workOrder ? ` (${j.workOrder})` : ""}`)
        .join("; ");
      lines.push(`• ${crew}: ${where}`);
    }
  }

  return lines.join("\n");
}

// ------------------------------------------------------------------
// Route
// ------------------------------------------------------------------

router.get("/lumina/brief/daily", async (req: Request, res: Response) => {
  // Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>` automatically
  // when the env var is set. We also accept `?key=` for manual QA.
  const secret = process.env.CRON_SECRET ?? "";
  if (secret) {
    const auth = req.header("authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const key = String(req.query.key ?? "");
    if (bearer !== secret && key !== secret) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const dryRun = String(req.query.dryRun ?? "false") === "true";

  try {
    const todayIso = todayPacificIso();
    const todayLabel = todayPacificLabel();

    const [jobs, weather] = await Promise.all([
      getJobsForDate(todayIso),
      getWeather(DEFAULT_LAT, DEFAULT_LNG),
    ]);

    const message = composeBrief({ dateLabel: todayLabel, jobs, weather });

    // Dry run: return the composed message without pushing. Handy for testing.
    if (dryRun) {
      return res.json({ ok: true, dryRun: true, todayIso, jobCount: jobs.length, message });
    }

    const token = process.env.PUSHOVER_APP_TOKEN;
    const user = process.env.PUSHOVER_USER_KEY;
    if (!token || !user) {
      return res.status(500).json({ error: "Pushover credentials not configured." });
    }

    const body = new URLSearchParams();
    body.set("token", token);
    body.set("user", user);
    body.set("title", `NSC Daily Brief — ${todayLabel}`);
    body.set("message", message);
    body.set("priority", "0");
    body.set("sound", "magic");

    const pushRes = await fetch(PUSHOVER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const pushJson = (await pushRes.json().catch(() => ({}))) as { status?: number; errors?: string[] };

    if (!pushRes.ok || pushJson.status !== 1) {
      return res.status(502).json({
        error: "Pushover rejected the briefing",
        upstream: pushJson,
        message,
      });
    }

    return res.json({
      ok: true,
      todayIso,
      jobCount: jobs.length,
      crewCount: new Set(jobs.map((j) => j.crew)).size,
      messagePreview: message.slice(0, 200),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Failed to build daily brief: ${msg}` });
  }
});

export default router;
