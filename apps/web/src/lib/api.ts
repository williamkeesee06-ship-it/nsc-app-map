// Same-origin API client. In dev, Vite proxies /api to localhost:3001.
// In prod, vercel.json rewrites /api/* to the serverless function.
import type { AsbuiltDoc } from "@nsc/types";

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
  getAsbuilt: (jobId: string) => request<AsbuiltDoc>(`/api/asbuilt/${encodeURIComponent(jobId)}`),
  putAsbuilt: (jobId: string, doc: AsbuiltDoc) =>
    request<AsbuiltDoc>(`/api/asbuilt/${encodeURIComponent(jobId)}`, {
      method: "PUT",
      body: JSON.stringify(doc),
    }),
};
