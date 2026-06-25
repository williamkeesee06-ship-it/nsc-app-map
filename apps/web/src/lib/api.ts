// Same-origin API client. In dev, Vite proxies /api to localhost:3001.
// In prod, vercel.json rewrites /api/* to the serverless function.
import type { AsbuiltDoc, AsBuiltDocument, Job, SyncRun } from "@nsc/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; time: string }>("/api/health"),

  // Legacy Phase 1/2 asbuilt (schemaVersion:1)
  getAsbuilt: (jobId: string) =>
    request<AsbuiltDoc>(`/api/asbuilt/${encodeURIComponent(jobId)}`),
  putAsbuilt: (jobId: string, doc: AsbuiltDoc) =>
    request<AsbuiltDoc>(`/api/asbuilt/${encodeURIComponent(jobId)}`, {
      method: "PUT",
      body: JSON.stringify(doc),
    }),

  // Phase 3 drawing objects (schemaVersion:2)
  // owner: pass the current supervisor's name to scope to their markups;
  // pass "*" to fetch every supervisor's markups (manager mode).
  getDrawing: (jobId: string, owner?: string) => {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
    return request<AsBuiltDocument | AsbuiltDoc>(
      `/api/asbuilt/${encodeURIComponent(jobId)}${q}`
    );
  },
  // All jobs' drawings — used by the always-visible global markups overlay
  getAllDrawings: (owner?: string) => {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
    return request<{ docs: Array<{ jobId: string; objects: unknown[]; updatedAt: number; schemaVersion: number; owner?: string }>; count: number }>(
      `/api/asbuilt${q}`
    );
  },
  putDrawing: (jobId: string, doc: AsBuiltDocument, owner?: string) => {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
    return request<AsBuiltDocument>(
      `/api/asbuilt/${encodeURIComponent(jobId)}${q}`,
      { method: "PUT", body: JSON.stringify(doc) }
    );
  },

  listJobs: () => request<{ jobs: Job[]; count: number }>("/api/jobs"),

  // Dashboard weather strip — reuses the existing NWS-backed weather route.
  getWeather: (lat: number, lng: number) =>
    request<WeatherPayload>(
      `/api/lumina/weather?lat=${lat}&lng=${lng}&periods=2`
    ),

  // Dashboard Lumina briefing — reuses /api/lumina/chat with a dedicated mode.
  getDashboardBriefing: (username: string) =>
    request<DashboardBriefing>("/api/lumina/chat", {
      method: "POST",
      body: JSON.stringify({ mode: "dashboard_briefing", username, history: [] }),
    }),
  // One-shot question from the dashboard briefing card. Returns the model's
  // text reply (tool-calling turns are not expected for these short asks).
  askLumina: (prompt: string, username: string | null) =>
    request<{ text?: string; modelTurnAt: number }>("/api/lumina/chat", {
      method: "POST",
      body: JSON.stringify({
        history: [],
        newUserMessage: prompt,
        username: username ?? undefined,
      }),
    }),
  listSupervisors: () =>
    request<{ supervisors: string[]; managers: string[]; count: number }>(
      "/api/supervisors"
    ),
  syncSupervisor: (supervisor: string) =>
    request<{ status: string; upserted: number; filteredRows: number }>(
      "/api/sync/supervisor",
      { method: "POST", body: JSON.stringify({ supervisor }) }
    ),
  syncAllSupervisors: (manager: string) =>
    request<{ status: string; upserted: number; filteredRows: number }>(
      "/api/sync/all-supervisors",
      { method: "POST", body: JSON.stringify({ manager }) }
    ),
  searchJobs: (q: string) =>
    request<{ jobs: Job[]; count: number }>(
      `/api/jobs/search?q=${encodeURIComponent(q)}`
    ),
  getJob: (jobId: string) =>
    request<{ job: Job }>(`/api/jobs/${encodeURIComponent(jobId)}`),
  createJob: (body: { workOrder: string; jobName: string; address?: string; lat?: number; lng?: number }) =>
    request<{ jobId: string; workOrder: string; jobName: string; lat?: number; lng?: number }>("/api/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  triggerSync: () =>
    request<SyncRun>(`/api/sync/jobs`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  syncStatus: () => request<{ lastRun: SyncRun | null }>(`/api/sync/status`),

  // User preferences (Billy 5/25) — cross-device sync of filters, panel widths, etc.
  getPrefs: (username: string) =>
    request<{ prefs: Record<string, unknown> }>(`/api/prefs/${encodeURIComponent(username)}`),
  putPrefs: (username: string, prefs: Record<string, unknown>) =>
    request<{ ok: boolean; prefs: Record<string, unknown> }>(`/api/prefs/${encodeURIComponent(username)}`, {
      method: "PUT",
      body: JSON.stringify(prefs),
    }),

  // Personal scratchpad (Billy 6/3) — markups drawn on the main map (no job
  // selected) auto-save here so they follow the user across devices.
  getScratchpad: (owner: string) =>
    request<{ objects: unknown[]; updatedAt: number; ownerName: string }>(
      `/api/scratchpad/${encodeURIComponent(owner)}`
    ),
  putScratchpad: (owner: string, objects: unknown[]) =>
    request<{ objects: unknown[]; updatedAt: number; ownerName: string }>(
      `/api/scratchpad/${encodeURIComponent(owner)}`,
      { method: "PUT", body: JSON.stringify({ objects }) }
    ),

  // Per-markup photos (Billy 6/8) — photos attached to specific drawing
  // objects (poles, MHs, splices, etc.). Stored as base64 data URLs in
  // Firestore at jobs/{jobId}/photos/{photoId}.
  listPhotos: (jobId: string) =>
    request<{ photos: Array<{ id: string; objectId: string; dataUrl: string; takenAt: number; takenBy: string }>; count: number }>(
      `/api/photos/${encodeURIComponent(jobId)}`
    ),
  addPhoto: (jobId: string, body: { objectId: string; dataUrl: string; takenBy: string }) =>
    request<{ id: string; objectId: string; dataUrl: string; takenAt: number; takenBy: string }>(
      `/api/photos/${encodeURIComponent(jobId)}`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  deletePhoto: (jobId: string, photoId: string) =>
    request<{ ok: boolean }>(
      `/api/photos/${encodeURIComponent(jobId)}/${encodeURIComponent(photoId)}`,
      { method: "DELETE" }
    ),

  // Lumina memory layer (Phase 5) — per-user durable facts/prefs/shortcuts.
  // Read on every chat turn (server injects into the system prompt); written
  // via the proposeMemorySave → APPLY card flow.
  listMemories: (username: string) =>
    request<{ items: LuminaMemoryItem[] }>(
      `/api/lumina/memories/${encodeURIComponent(username)}`
    ),
  addMemory: (username: string, body: { text: string; kind?: string }) =>
    request<{ ok: true; item: LuminaMemoryItem; items: LuminaMemoryItem[] }>(
      `/api/lumina/memories/${encodeURIComponent(username)}`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  updateMemory: (
    username: string,
    id: string,
    body: { text?: string; pinned?: boolean }
  ) =>
    request<{ ok: true; item: LuminaMemoryItem; items: LuminaMemoryItem[] }>(
      `/api/lumina/memories/${encodeURIComponent(username)}/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  deleteMemory: (username: string, id: string) =>
    request<{ ok: true; items: LuminaMemoryItem[] }>(
      `/api/lumina/memories/${encodeURIComponent(username)}/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    ),

  // Calendar tab: returns scheduled events overlapping the Mon-Fri week
  // starting at weekStart (YYYY-MM-DD). scope='mine' = Billy only,
  // scope='all' = every supervisor in the sheet.
  getCalendar: (weekStart: string, scope: "mine" | "all") =>
    request<CalendarPayload>(
      `/api/lumina/smartsheet/calendar?weekStart=${encodeURIComponent(weekStart)}&scope=${scope}`
    ),

  // Smartsheet write-through (Sprint 1.4 + 2.1) — Billy-scoped only.
  // The server enforces supervisor = "Billy Keesee"; cross-supervisor edits
  // are refused with 403. These are called only by the APPLY card flow after
  // Billy approves a propose-* tool's pending action.
  updateSmartsheetNotes: (body: {
    jobId: string | number;
    notes: string;
    mode?: "replace" | "append";
  }) =>
    request<{
      ok: true;
      rowId: number;
      jobId: string | number;
      mode: "replace" | "append";
      newValue: string;
      modifiedAt?: string;
    }>("/api/lumina/smartsheet/update-notes", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSmartsheetStatus: (body: {
    jobId: string | number;
    status: string;
    kind?: "primary" | "secondary";
  }) =>
    request<{
      ok: true;
      rowId: number;
      jobId: string | number;
      column: string;
      newValue: string;
      modifiedAt?: string;
    }>("/api/lumina/smartsheet/update-status", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Sheet-wide existence check for a Work Order. Unlike getJob/by-job
  // (which are Billy-scoped), locateSmartsheetJob looks at every row in
  // the tracker and reports just enough to answer "is this job somewhere
  // else?": supervisor name, city, and Job Status. Notes and other cells
  // stay opaque for cross-supervisor rows.
  locateSmartsheetJob: (workOrder: string) =>
    request<{
      workOrder: string;
      found: boolean;
      hits: Array<{
        rowId: number;
        workOrder: string;
        supervisor: string | null;
        isMine: boolean;
        city: string | null;
        jobStatus: string | null;
      }>;
      anyMine?: boolean;
      message?: string;
    }>(`/api/lumina/smartsheet/locate/${encodeURIComponent(workOrder)}`),

  rescheduleSmartsheet: (body: {
    jobId: string | number;
    scheduleDate: string; // YYYY-MM-DD
    endDate?: string; // YYYY-MM-DD
  }) =>
    request<{
      ok: true;
      rowId: number;
      jobId: string | number;
      scheduleDate: string;
      endDate: string | null;
      modifiedAt?: string;
    }>("/api/lumina/smartsheet/reschedule", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export interface WeatherPeriod {
  name: string;
  start: string;
  end: string;
  temperatureF: number;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast: string;
  precipitationChancePct: number | null;
  relativeHumidityPct: number | null;
}

export interface WeatherPayload {
  lat: number;
  lng: number;
  area: string | null;
  sunrise: string;
  sunset: string;
  periods: WeatherPeriod[];
}

export interface DashboardBriefing {
  greeting: string;
  bullets: string[];
  modelTurnAt: number;
}

export interface CalendarEvent {
  rowId: number;
  workOrder: string;
  jobStatus: string | null;
  supervisor: string;
  supervisorColor: string;
  crew: string;
  address: string;
  city: string;
  bidMaster: string | null;
  base: string | null;
  scheduleDate: string;
  endDate: string;
  attachmentCount: number;
  modifiedAt?: string;
}

export interface CalendarPayload {
  scope: "mine" | "all";
  supervisor: string | null;
  weekStart: string;
  weekEnd: string;
  totalEvents: number;
  supervisorColors: Record<string, string>;
  cachedSeconds: number;
  events: CalendarEvent[];
}

export interface LuminaMemoryItem {
  id: string;
  text: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}
