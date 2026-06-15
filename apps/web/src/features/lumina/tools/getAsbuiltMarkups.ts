/**
 * Tool: getAsbuiltMarkups
 *
 * Cross-app awareness — pulls the asbuilt document (the SEPARATE asbuilt app's
 * drawings stored at /api/asbuilt/:jobId) so Lumina can answer questions like
 * "how many poles and MHs are on job X" without Billy having to switch apps.
 *
 * Returns a LEAN counts-and-labels summary, not the raw geometry. Lumina can
 * always follow up with listMarkups(jobId) for the map-app side or with
 * specific objectId requests if she needs more detail.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface GetAsbuiltMarkupsInput {
  jobId: string;
}

interface AsbuiltSummary {
  jobId: string;
  schemaVersion: number | null;
  /** Legacy v1 fields. */
  pointCount: number;
  lineCount: number;
  /** Tallies by point type so Lumina can quote real counts. */
  pointsByType: Record<string, number>;
  /** Tallies by line category (PLACED / REMOVED). */
  linesByCategory: Record<string, number>;
  /** Any labels found on points/lines, for quick reference. */
  sampleLabels: string[];
  updatedAt: number | null;
}

async function run(
  input: GetAsbuiltMarkupsInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<AsbuiltSummary>> {
  if (!input.jobId) {
    return { ok: false, message: "getAsbuiltMarkups requires jobId." };
  }
  const res = await fetch(`/api/asbuilt/${encodeURIComponent(input.jobId)}`);
  if (res.status === 404) {
    return {
      ok: true,
      message: `No asbuilt document for ${input.jobId} yet.`,
      data: {
        jobId: input.jobId,
        schemaVersion: null,
        pointCount: 0,
        lineCount: 0,
        pointsByType: {},
        linesByCategory: {},
        sampleLabels: [],
        updatedAt: null,
      },
    };
  }
  if (!res.ok) {
    return { ok: false, message: `Asbuilt fetch failed (${res.status}).` };
  }
  const doc = (await res.json()) as {
    jobId: string;
    schemaVersion?: number;
    points?: Array<{ type: string; label?: string }>;
    lines?: Array<{ category: string; label?: string }>;
    updatedAt?: number;
  };
  const points = doc.points ?? [];
  const lines = doc.lines ?? [];
  const pointsByType: Record<string, number> = {};
  for (const p of points) pointsByType[p.type] = (pointsByType[p.type] ?? 0) + 1;
  const linesByCategory: Record<string, number> = {};
  for (const l of lines) linesByCategory[l.category] = (linesByCategory[l.category] ?? 0) + 1;
  const labels: string[] = [];
  for (const p of points) if (p.label) labels.push(p.label);
  for (const l of lines) if (l.label) labels.push(l.label);
  const sampleLabels = labels.slice(0, 12);

  return {
    ok: true,
    message: `Asbuilt for ${doc.jobId}: ${points.length} point${points.length === 1 ? "" : "s"}, ${lines.length} line${lines.length === 1 ? "" : "s"}.`,
    data: {
      jobId: doc.jobId,
      schemaVersion: doc.schemaVersion ?? null,
      pointCount: points.length,
      lineCount: lines.length,
      pointsByType,
      linesByCategory,
      sampleLabels,
      updatedAt: doc.updatedAt ?? null,
    },
  };
}

export const getAsbuiltMarkupsTool: LuminaTool<GetAsbuiltMarkupsInput, AsbuiltSummary> = {
  name: "getAsbuiltMarkups",
  description:
    "Summarize the asbuilt-app drawings (points + lines) for a job. Returns counts by type and sample labels — useful for 'how many poles on job X' / 'is the asbuilt done' style questions.",
  kind: "read",
  run,
};
