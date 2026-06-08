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
};
