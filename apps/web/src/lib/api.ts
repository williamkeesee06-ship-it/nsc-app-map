// Same-origin API client. In dev, Vite proxies /api to localhost:3001.
// In prod, vercel.json rewrites /api/* to the serverless function.
import type {
  AsbuiltDoc, AsBuiltDocument, EngineeringPrint, Job, JobAttachment,
  LatLng, QuickReferenceGist, SyncRun,
} from "@nsc/types";

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
  putDrawing: (jobId: string, doc: AsBuiltDocument) =>
    request<AsBuiltDocument>(`/api/asbuilt/${encodeURIComponent(jobId)}`, {
      method: "PUT",
      body: JSON.stringify(doc),
    }),

  listJobs: () => request<{ jobs: Job[]; count: number }>("/api/jobs"),
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

  // ── Phase 7: attachments ────────────────────────────────────────────────
  listAttachments: (jobId: string) =>
    request<{ attachments: JobAttachment[]; count: number }>(
      `/api/jobs/${encodeURIComponent(jobId)}/attachments`
    ),
  uploadAttachment: (
    jobId: string,
    body: { filename: string; mimeType: string; size: number; dataUrl: string }
  ) =>
    request<{ attachment: JobAttachment }>(
      `/api/jobs/${encodeURIComponent(jobId)}/attachments`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  deleteAttachment: (jobId: string, attachmentId: string) =>
    request<{ ok: true }>(
      `/api/jobs/${encodeURIComponent(jobId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "DELETE" }
    ),

  // ── Phase 7: engineering prints ─────────────────────────────────────────
  listPrints: (jobId: string) =>
    request<{ prints: EngineeringPrint[]; count: number }>(
      `/api/jobs/${encodeURIComponent(jobId)}/prints`
    ),
  createPrint: (
    jobId: string,
    body: {
      source: EngineeringPrint["source"];
      corners: EngineeringPrint["corners"];
      opacity?: number;
      active?: boolean;
      visible?: boolean;
    }
  ) =>
    request<{ print: EngineeringPrint }>(
      `/api/jobs/${encodeURIComponent(jobId)}/prints`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  patchPrint: (
    jobId: string,
    printId: string,
    body: Partial<Pick<EngineeringPrint, "corners" | "opacity" | "active" | "visible">>
  ) =>
    request<{ print: EngineeringPrint }>(
      `/api/jobs/${encodeURIComponent(jobId)}/prints/${encodeURIComponent(printId)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  deletePrint: (jobId: string, printId: string) =>
    request<{ ok: true }>(
      `/api/jobs/${encodeURIComponent(jobId)}/prints/${encodeURIComponent(printId)}`,
      { method: "DELETE" }
    ),

  // ── Phase 7: quick reference layer ──────────────────────────────────────
  getGist: (jobId: string) =>
    request<{ gist: QuickReferenceGist | null }>(
      `/api/jobs/${encodeURIComponent(jobId)}/quickref`
    ),
  syncGist: (jobId: string) =>
    request<{ gist: QuickReferenceGist }>(
      `/api/jobs/${encodeURIComponent(jobId)}/quickref/sync`,
      { method: "POST", body: "{}" }
    ),
  markGistOutOfDate: (jobId: string) =>
    request<{ ok?: true; gist?: QuickReferenceGist | null; created?: boolean }>(
      `/api/jobs/${encodeURIComponent(jobId)}/quickref/mark-stale`,
      { method: "POST", body: "{}" }
    ),
  appendQuickEntry: (
    jobId: string,
    entry: {
      status: "NEW" | "REMOVED";
      medium: "AERIAL" | "UNDERGROUND";
      family?: "FIBER" | "COPPER" | "ASW" | "BSW";
      label?: string;
      path: LatLng[];
    }
  ) =>
    request<{ gist: QuickReferenceGist }>(
      `/api/jobs/${encodeURIComponent(jobId)}/quickref/quick`,
      { method: "POST", body: JSON.stringify(entry) }
    ),
};
