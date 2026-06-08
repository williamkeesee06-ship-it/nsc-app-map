/**
 * Tool: listPhotos — return metadata only (no base64 blobs), optionally
 * scoped to a single markup object id.
 *
 * Photos in Firestore are stored as base64 data URLs which can be hundreds
 * of KB each — never return those to the model. Just count + ids + dates.
 */

import { api } from "../../../lib/api.js";
import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface ListPhotosInput {
  jobId: string;
  objectId?: string;
}

interface PhotoMeta {
  id: string;
  objectId: string;
  takenAt: number;
  takenAtIso: string;
  takenBy: string;
}

interface ListPhotosData {
  jobId: string;
  scopedToObjectId: string | null;
  total: number;
  photos: PhotoMeta[];
}

async function run(
  input: ListPhotosInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<ListPhotosData>> {
  if (!input.jobId) return { ok: false, message: "listPhotos requires jobId." };
  const r = await api.listPhotos(input.jobId);
  const all = r.photos ?? [];
  const filtered = input.objectId ? all.filter((p) => p.objectId === input.objectId) : all;
  const meta: PhotoMeta[] = filtered.map((p) => ({
    id: p.id,
    objectId: p.objectId,
    takenAt: p.takenAt,
    takenAtIso: new Date(p.takenAt).toISOString(),
    takenBy: p.takenBy,
  }));
  return {
    ok: true,
    message: `${filtered.length} photo${filtered.length === 1 ? "" : "s"} on ${input.jobId}${
      input.objectId ? ` for object ${input.objectId}` : ""
    }.`,
    data: {
      jobId: input.jobId,
      scopedToObjectId: input.objectId ?? null,
      total: filtered.length,
      photos: meta,
    },
  };
}

export const listPhotosTool: LuminaTool<ListPhotosInput, ListPhotosData> = {
  name: "listPhotos",
  description: "List photo metadata for a job, optionally scoped to one markup object.",
  kind: "read",
  run,
};
