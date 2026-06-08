/**
 * Tool: listMarkups — drawing objects (poles, MHs, splices, lines, shapes)
 * attached to a job's asbuilt document.
 *
 * Returns a LEAN summary — kind, label, position (if any), id — never the
 * full DrawingObject payload, which can be heavy (freehand paths, hash
 * fills, etc.). The model only needs enough to answer "what's on this job"
 * and to call flyToMarkup / proposeMarkupLabel.
 */

import type { AsBuiltDocument, AsbuiltDoc, DrawingObject } from "@nsc/types";
import { api } from "../../../lib/api.js";
import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface ListMarkupsInput {
  jobId: string;
}

interface MarkupSummary {
  id: string;
  tool: string;
  label: string | null;
  lat: number | null;
  lng: number | null;
}

interface ListMarkupsData {
  jobId: string;
  totalObjects: number;
  shown: number;
  markups: MarkupSummary[];
  truncatedTo?: number;
}

const HARD_CAP = 100;

function isV2(doc: AsBuiltDocument | AsbuiltDoc): doc is AsBuiltDocument {
  return Array.isArray((doc as AsBuiltDocument).objects);
}

function objectCenter(o: DrawingObject): { lat: number | null; lng: number | null } {
  // Each variant in DrawingObject has its own position shape — pick a
  // representative point per tool so flyToMarkup has a target.
  if ("position" in o) return { lat: o.position.lat, lng: o.position.lng };
  if ("vertices" in o && o.vertices.length > 0) {
    const v = o.vertices[0];
    return { lat: v.lat, lng: v.lng };
  }
  if ("bounds" in o) {
    return { lat: (o.bounds.n + o.bounds.s) / 2, lng: (o.bounds.e + o.bounds.w) / 2 };
  }
  return { lat: null, lng: null };
}

function objectLabel(o: DrawingObject): string | null {
  if ("text" in o && o.text) return o.text;
  if ("label" in o && o.label) return o.label ?? null;
  if (o.style?.userLabel) return o.style.userLabel;
  return null;
}

async function run(
  input: ListMarkupsInput,
  ctx: LuminaToolContext
): Promise<LuminaToolResult<ListMarkupsData>> {
  if (!input.jobId) return { ok: false, message: "listMarkups requires jobId." };

  // Owner-scoped — pass username so Billy sees his own markups (and only
  // managers see "*"). For now we mirror what the Markups overlay does.
  const doc = await api.getDrawing(input.jobId, ctx.username || undefined);
  if (!isV2(doc)) {
    return {
      ok: true,
      message: `No drawing objects on job ${input.jobId} (legacy v1 doc).`,
      data: { jobId: input.jobId, totalObjects: 0, shown: 0, markups: [] },
    };
  }
  const objects = doc.objects ?? [];
  const truncated = objects.length > HARD_CAP;
  const trimmed = truncated ? objects.slice(0, HARD_CAP) : objects;
  const markups: MarkupSummary[] = trimmed.map((o) => {
    const { lat, lng } = objectCenter(o);
    return { id: o.id, tool: o.tool, label: objectLabel(o), lat, lng };
  });
  return {
    ok: true,
    message: `${objects.length} markup${objects.length === 1 ? "" : "s"} on ${input.jobId}${
      truncated ? ` (showing first ${HARD_CAP})` : ""
    }.`,
    data: {
      jobId: input.jobId,
      totalObjects: objects.length,
      shown: markups.length,
      markups,
      ...(truncated ? { truncatedTo: HARD_CAP } : {}),
    },
  };
}

export const listMarkupsTool: LuminaTool<ListMarkupsInput, ListMarkupsData> = {
  name: "listMarkups",
  description: "List drawing objects (poles, MHs, splices, lines, shapes) for a job.",
  kind: "read",
  run,
};
