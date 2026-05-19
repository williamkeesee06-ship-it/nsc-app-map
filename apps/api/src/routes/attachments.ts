// Per-job attachments. Stored at jobs/{jobId}/attachments/{attachmentId}.
// Files are kept as base64 data URLs in Firestore for now — the Smartsheet
// upstream sync is a TODO since multipart upload requires extra plumbing.
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "../lib/firestore.js";
import type { JobAttachment } from "@nsc/types";

const router = Router();

// Express has a default 1mb json limit set in app.ts; bump for attachments only.
import express from "express";
const ATTACHMENT_JSON_LIMIT = "25mb";

const AttachmentBodySchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  dataUrl: z.string().min(8),
});

function classify(mimeType: string, filename: string): JobAttachment["kind"] {
  const lcMime = mimeType.toLowerCase();
  const lcName = filename.toLowerCase();
  if (lcMime === "application/pdf" || lcName.endsWith(".pdf")) return "pdf";
  if (lcMime.startsWith("image/")) return "image";
  return "other";
}

function isRejected(mimeType: string, filename: string): boolean {
  const lcMime = mimeType.toLowerCase();
  const lcName = filename.toLowerCase();
  // Reject KMZ and GeoJSON uploads per Phase 7 contract.
  if (lcName.endsWith(".kmz") || lcMime === "application/vnd.google-earth.kmz") return true;
  if (lcName.endsWith(".kml") || lcMime === "application/vnd.google-earth.kml+xml") return true;
  if (lcName.endsWith(".geojson") || lcMime === "application/geo+json") return true;
  return false;
}

router.get("/jobs/:jobId/attachments", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const snap = await db()
      .collection("jobs").doc(jobId)
      .collection("attachments")
      .orderBy("uploadedAt", "desc")
      .get();
    const attachments = snap.docs.map((d) => d.data() as JobAttachment);
    res.json({ attachments, count: attachments.length });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/jobs/:jobId/attachments",
  express.json({ limit: ATTACHMENT_JSON_LIMIT }),
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const parsed = AttachmentBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid attachment payload", issues: parsed.error.issues });
        return;
      }
      const { filename, mimeType, size, dataUrl } = parsed.data;
      if (isRejected(mimeType, filename)) {
        res.status(415).json({
          error:
            "KMZ, KML, and GeoJSON uploads are not allowed here. Use Quick Mode for backfills or draw directly in the As-Built workspace.",
        });
        return;
      }
      const attachmentId = randomUUID();
      const attachment: JobAttachment = {
        attachmentId,
        jobId,
        filename,
        mimeType,
        size,
        dataUrl,
        kind: classify(mimeType, filename),
        uploadedAt: Date.now(),
      };
      await db()
        .collection("jobs").doc(jobId)
        .collection("attachments").doc(attachmentId)
        .set(attachment);
      // TODO(merge-conflict): sync attachment upload to Smartsheet row via attachments API.
      res.status(201).json({ attachment });
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/jobs/:jobId/attachments/:attachmentId", async (req, res, next) => {
  try {
    const { jobId, attachmentId } = req.params;
    await db()
      .collection("jobs").doc(jobId)
      .collection("attachments").doc(attachmentId)
      .delete();
    // TODO(merge-conflict): delete corresponding Smartsheet attachment.
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
