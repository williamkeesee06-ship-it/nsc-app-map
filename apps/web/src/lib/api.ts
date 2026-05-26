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
  getDrawing: (jobId: string) =>
    request<AsBuiltDocument | AsbuiltDoc>(`/api/asbuilt/${encodeURIComponent(jobId)}`),
  // All jobs' drawings — used by the always-visible global markups overlay
  getAllDrawings: () =>
    request<{ docs: Array<{ jobId: string; objects: unknown[]; updatedAt: number; schemaVersion: number }>; count: number }>(
      `/api/asbuilt`
    ),
  putDrawing: (jobId: string, doc: AsBuiltDocument) =>
    request<AsBuiltDocument>(`/api/asbuilt/${encodeURIComponent(jobId)}`, {
      method: "PUT",
      body: JSON.stringify(doc),
    }),

  listJobs: () => request<{ jobs: Job[]; count: number }>("/api/jobs"),
  listSupervisors: () =>
    request<{ supervisors: string[]; count: number }>("/api/supervisors"),
  syncSupervisor: (supervisor: string) =>
    request<{ status: string; upserted: number; filteredRows: number }>(
      "/api/sync/supervisor",
      { method: "POST", body: JSON.stringify({ supervisor }) }
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
};
