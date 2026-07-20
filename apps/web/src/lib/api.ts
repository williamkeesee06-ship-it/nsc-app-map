// Same-origin API client. In dev, Vite proxies /api to localhost:3001.
// In prod, vercel.json rewrites /api/* to the serverless function.
// All non-health routes require a Firebase ID token (solo lock).
import { getFunctions, httpsCallable } from "firebase/functions";
import type {
  AsbuiltDoc,
  AsBuiltDocument,
  DigShape,
  DigTicket,
  Job,
  PolygonData,
  SyncRun,
  ZiplySectionScope,
} from "@nsc/types";
import { app, waitForIdToken, getIdToken } from "./firebase.js";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // NEVER call protected /api without a Bearer token (solo lock).
  // Wait for Firebase session restore / post-login user before fetching.
  let token = await waitForIdToken(8000);
  if (!token) {
    token = await getIdToken(true);
  }
  if (!token) {
    throw new Error(
      `API blocked (not signed in) ${path}: no Firebase ID token yet. Sign in again.`
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  // Merge extra headers without wiping Authorization
  if (init?.headers) {
    const extra =
      init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : Array.isArray(init.headers)
          ? Object.fromEntries(init.headers)
          : (init.headers as Record<string, string>);
    Object.assign(headers, extra);
    // Re-assert after merge
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    // Token was present but server rejected it (expired / wrong Firebase project)
    if (res.status === 401) {
      window.dispatchEvent(
        new CustomEvent("nsc:auth-required", { detail: { path, status: 401, body } })
      );
    }
    throw new Error(`API ${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// The ITIC bot / response-poller run as Firebase Callable Functions (Playwright
// is too heavy for Vercel). They are declared onCall, so we invoke them with the
// Firebase Functions SDK, which injects the auth token, wraps the body in
// { data }, routes to the correct region, and unwraps the { result } envelope.
// The functions are deployed in us-west1, so the SDK must target that region.
const functions = getFunctions(app, "us-west1");

// The ITIC callables drive Playwright through many steps and legitimately run for
// several minutes. The client SDK's default callable timeout is 70s, which would
// abort with deadline-exceeded long before the function (540s) finishes, so match
// the client timeout to the server ceiling.
async function callFunction<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const callable = httpsCallable<Record<string, unknown>, T>(functions, name, {
    timeout: 540_000,
  });
  const res = await callable(data);
  return res.data;
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
  saveGeoJson: (projectId: string, geojson: unknown) =>
    request<{ ok: boolean; path: string }>("/api/asbuilt/save-geojson", {
      method: "POST",
      body: JSON.stringify({ projectId, geojson }),
    }),

  listJobs: () => request<{ jobs: Job[]; count: number }>("/api/jobs"),

  // Dashboard weather strip — reuses the existing NWS-backed weather route.
  getWeather: (lat: number, lng: number) =>
    request<WeatherPayload>(
      `/api/lumina/weather?lat=${lat}&lng=${lng}&periods=2`
    ),

  // Dashboard Lumina briefing — reuses /api/lumina/chat with a dedicated mode.
  getDashboardBriefing: (username: string, contract?: string) =>
    request<DashboardBriefing>("/api/lumina/chat", {
      method: "POST",
      body: JSON.stringify({ mode: "dashboard_briefing", username, contract, history: [] }),
    }),
  // One-shot question from the dashboard briefing card. Returns the model's
  // text reply (tool-calling turns are not expected for these short asks).
  askLumina: (prompt: string, username: string | null, contract?: string) =>
    request<{ text?: string; modelTurnAt: number }>("/api/lumina/chat", {
      method: "POST",
      body: JSON.stringify({
        history: [],
        newUserMessage: prompt,
        username,
        contract,
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
  // 811 — save (or clear, with null) the excavation dig shape for a job.
  putDigPolygon: (jobId: string, polygon: DigShape | PolygonData | null) =>
    request<{ jobId: string; digPolygon: DigShape | null }>(
      `/api/jobs/${encodeURIComponent(jobId)}/dig-polygon`,
      { method: "PUT", body: JSON.stringify({ polygon }) }
    ),
  // Ziply — AI print ingestion. Client uploads print files directly to
  // Firebase Storage first, then sends only small Storage references here.
  ziplyIngest: (
    jobId: string,
    storageFiles: Array<{
      storagePath: string;
      downloadUrl?: string;
      contentType?: string;
      name?: string;
      size?: number;
      storageBucket?: string;
    }>
  ) =>
    request<{ ok: boolean; jobId: string; status: "processing" }>(
      `/api/jobs/${encodeURIComponent(jobId)}/ziply-ingest`,
      { method: "POST", body: JSON.stringify({ storageFiles }) }
    ),
  saveZiplyPrintMarkups: (jobId: string, markups: any[]) =>
    request<{ ok: boolean }>(
      `/api/jobs/${encodeURIComponent(jobId)}/ziply-print-markups`,
      { method: "POST", body: JSON.stringify({ markups }) }
    ),
  /**
   * Upload metadata for a permit already in Storage; kicks off AI parse
   * (permit #, dates, conditions) onto ziplyPrintLayer.permitFiles.
   */
  ziplyPermitIngest: (
    jobId: string,
    body: {
      permitType: string;
      storageFiles: Array<{
        storagePath?: string;
        downloadUrl?: string;
        contentType?: string;
        name?: string;
        size?: number;
        storageBucket?: string;
      }>;
    }
  ) =>
    request<{
      ok: boolean;
      jobId: string;
      permitFileId: string;
      status: "processing";
      permitType: string;
    }>(`/api/jobs/${encodeURIComponent(jobId)}/ziply-permit-ingest`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Re-geocode hub/terminals + run CAD geometry enhance (no AI re-parse). */
  repairZiplyPrint: (jobId: string, address?: string) =>
    request<{
      ok: boolean;
      jobId: string;
      workOrder?: string | null;
      repaired?: boolean;
      enhanced?: boolean;
      reason: string;
      lat?: number;
      lng?: number;
      terminalsFixed?: number;
      terminalsGeocoded?: number;
      cablesPathed?: number;
      waypointsGeocoded?: number;
      dropsPlaced?: number;
    }>(`/api/jobs/${encodeURIComponent(jobId)}/ziply-repair-print`, {
      method: "POST",
      body: JSON.stringify({ address }),
    }),
  /**
   * 2-Point Web Mercator Affine Georeferencing alignment.
   */
  affineAlignZiplyPrint: (
    jobId: string,
    cp1: { pdf: { x: number; y: number }; map: { lat: number; lng: number } },
    cp2: { pdf: { x: number; y: number }; map: { lat: number; lng: number } }
  ) =>
    request<{
      ok: boolean;
      jobId: string;
      matrix: { scale: number; rotationRad: number; tx: number; ty: number };
      transformedTerminals: number;
    }>(`/api/jobs/${encodeURIComponent(jobId)}/ziply-print/affine-align`, {
      method: "POST",
      body: JSON.stringify({ cp1, cp2 }),
    }),
  /** Fleet CAD fidelity QA report. */
  ziplyFidelityReport: () =>
    request<{
      ok: boolean;
      totalPrintJobs: number;
      mapReady: number;
      enhanced: number;
      byGrade: Record<string, number>;
      bySource: Record<string, number>;
      avgResidualM: number | null;
      jobs: Array<{
        jobId: string;
        workOrder?: string | null;
        grade: string;
        geometrySource: string | null;
        residualM: number | null;
        controlCount: number;
        notes: string[];
      }>;
    }>("/api/jobs/ziply-fidelity"),
  /** Field control pin for sheet registration. */
  pinZiplyControl: (
    jobId: string,
    body: {
      kind: "hub" | "terminal" | "cable";
      ref: string;
      lat: number;
      lng: number;
      sheetX?: number | null;
      sheetY?: number | null;
      reenhance?: boolean;
    }
  ) =>
    request<{ ok: boolean; jobId: string; pin: unknown; enhance: unknown }>(
      `/api/jobs/${encodeURIComponent(jobId)}/ziply-control-pin`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  /** Field-correct a cable polyline so the map twin matches the print. */
  updateZiplyCablePath: (
    jobId: string,
    body: {
      label: string;
      path: Array<{ lat: number; lng: number }>;
      role?: "mainline" | "lateral" | "feeder" | null;
    }
  ) =>
    request<{ ok: boolean; jobId: string; label: string; points: number }>(
      `/api/jobs/${encodeURIComponent(jobId)}/ziply-cable-path`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  /** Batch-repair Ziply prints missing map coordinates. */
  repairAllZiplyPrints: () =>
    request<{
      ok: boolean;
      repaired: number;
      skipped: number;
      failed: number;
      results: Array<{
        jobId: string;
        workOrder?: string | null;
        repaired: boolean;
        reason: string;
        lat?: number;
        lng?: number;
      }>;
    }>("/api/jobs/ziply-repair-prints", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  // Ziply — persist a single map object's build status (spec §4 click-to-drawer).
  // kind identifies the object family; ref is the hub/terminal/cable label.
	  updateZiplyObjectStatus: (
	    jobId: string,
	    body: { kind: "hub" | "terminal" | "cable"; ref: string; status: import("@nsc/types").ZiplyObjectStatus }
	  ) =>
	    request<{ ok: boolean; jobId: string; ziplyPrintLayer: unknown }>(
	      `/api/jobs/${encodeURIComponent(jobId)}/ziply-object-status`,
	      { method: "POST", body: JSON.stringify(body) }
	    ),
	  // Ziply — assign a crew to a hub/terminal/cable section (hub + ref keyed).
	  updateZiplySectionCrew: (
	    jobId: string,
	    body: { kind: "hub" | "terminal" | "cable"; ref: string; crewName: string | null }
	  ) =>
	    request<{ ok: boolean; jobId: string; kind: string; ref: string; crewName: string | null; assignedAt: number }>(
	      `/api/jobs/${encodeURIComponent(jobId)}/ziply-section-crew`,
	      { method: "POST", body: JSON.stringify(body) }
	    ),
	  createJob: (body: { workOrder: string; jobName: string; address?: string; lat?: number; lng?: number }) =>
    request<{ jobId: string; workOrder: string; jobName: string; lat?: number; lng?: number }>("/api/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateJobSchedule: (jobId: string | number, body: { scheduleDate?: string | null; endDate?: string | null; constructionCrewForeman?: string | null }) =>
    request<{ ok: boolean; jobId: string | number; scheduleDate?: string | null; endDate?: string | null; constructionCrewForeman?: string | null }>(
      `/api/jobs/${encodeURIComponent(jobId)}/schedule`,
      { method: "POST", body: JSON.stringify(body) }
    ),
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

  // ── 811 Dig Ticket Manager ─────────────────────────────────────────────
  listDigTickets: (owner?: string) => {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
    return request<{ tickets: DigTicket[]; count: number }>(`/api/dig-tickets${q}`);
  },
  getDigTicket: (ticketId: string) =>
    request<{ ticket: DigTicket }>(
      `/api/dig-tickets/${encodeURIComponent(ticketId)}`
    ),
  // Create a ticket from a job's saved dig shape. Server snapshots the shape,
  // generates marking instructions via Gemini, and returns the draft ticket.
	  createDigTicket: (body: {
	    jobId: string;
	    scope?: ZiplySectionScope | null;
	    specs: {
      handDigOnly: boolean;
      directionalBoring: boolean;
      whiteLined: boolean;
      explosives: boolean;
      workType: string;
      equipment: string[];
      markAround: string;
      duration: 45;
    };
  }) =>
    request<{ ticket: DigTicket }>("/api/dig-tickets", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateDigTicket: (ticketId: string, patch: Partial<DigTicket>) =>
    request<{ ticket: DigTicket }>(
      `/api/dig-tickets/${encodeURIComponent(ticketId)}`,
      { method: "PATCH", body: JSON.stringify(patch) }
    ),
  // Delete a draft/failed/orphaned ticket. Server returns 403 for filed tickets.
  deleteDigTicket: (ticketId: string) =>
    request<{ ok: boolean; id: string }>(
      `/api/dig-tickets/${encodeURIComponent(ticketId)}`,
      { method: "DELETE" }
    ),
  // Regenerate marking instructions / hazards / safe guidelines via Gemini.
  regenerateMarkingInstructions: (ticketId: string) =>
    request<{ ticket: DigTicket }>(
      `/api/dig-tickets/${encodeURIComponent(ticketId)}/marking-instructions`,
      { method: "POST", body: JSON.stringify({}) }
    ),
  // Update one utility's locate status (manual entry in v1).
  updateUtilityStatus: (
    ticketId: string,
    body: { utility: string; status: string; notes?: string }
  ) =>
    request<{ ticket: DigTicket }>(
      `/api/dig-tickets/${encodeURIComponent(ticketId)}/utility-status`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // LUMINA GOD MODE (CODE & DATA)
  // ─────────────────────────────────────────────────────────────────────────
  searchCodebase: (args: { query: string; isRegex?: boolean }) =>
    request<any>("/api/lumina/code/search", { method: "POST", body: JSON.stringify(args) }),
  readSourceFile: (args: { filePath: string }) =>
    request<any>("/api/lumina/code/read", { method: "POST", body: JSON.stringify(args) }),
  queryFirestore: (args: { collection: string; limit?: number; filters?: any[] }) =>
    request<any>("/api/lumina/data/query", { method: "POST", body: JSON.stringify(args) }),

  // Ziply Gigs / Go-backs
  listGigs: (jobId?: string) => {
    const q = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
    return request<{ gigs: import("@nsc/types").Gig[] }>(`/api/gigs${q}`);
  },
  addGig: (jobId: string, task: string) =>
    request<{ gig: import("@nsc/types").Gig }>("/api/gigs", {
      method: "POST",
      body: JSON.stringify({ jobId, task }),
    }),
  completeGig: (gigId: string) =>
    request<{ gig: import("@nsc/types").Gig }>(`/api/gigs/${encodeURIComponent(gigId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    }),
  deleteGig: (gigId: string) =>
    request<void>(`/api/gigs/${encodeURIComponent(gigId)}`, {
      method: "DELETE",
    }),

  // ── ITIC automation (Firebase Callable Functions) ──────────────────────
  // Trigger background automated filing bot on ITIC
  fileTicketBot: (ticketId: string) =>
    callFunction<{ ok: boolean; status: string; ticketNumber: string; expiresAt: number; iticPdfUrl: string }>(
      "fileTicketBot",
      { ticketId }
    ),
  // Scrape live utility responses for a filed ticket.
  checkTicketResponses: (ticketId: string) =>
    callFunction<{ ok: boolean; utilityStatuses: DigTicket["utilityStatuses"]; readyToDig: boolean }>(
      "checkUtilityResponses",
      { ticketId }
    ),
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
