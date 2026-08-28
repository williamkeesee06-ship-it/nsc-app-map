// Per-markup photo storage. Photos live in
//   jobs/{jobId}/photos/{photoId}
// as base64 data URLs (capped at ~150KB each so a job's photo collection
// stays well under Firestore limits). Each photo references the markup
// object id it belongs to so the client can look up which photos belong
// to which pole/splice/etc.
//
// Routes:
//   GET    /api/photos/:jobId                → list all photos for a job
//   POST   /api/photos/:jobId                → upload one photo (body: {objectId, dataUrl, takenBy})
//   DELETE /api/photos/:jobId/:photoId       → delete a photo
//
// Billy 6/8.

import { Router } from "express";
import { db } from "../lib/firestore.js";

const router = Router();

const MAX_DATA_URL_BYTES = 200_000; // ~200KB per photo

interface PhotoDoc {
  objectId: string;
  dataUrl: string; // "data:image/jpeg;base64,..."
  takenAt: number;
  takenBy: string;
}

router.get("/photos/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const snap = await db().collection("jobs").doc(jobId).collection("photos").get();
    const photos: Array<PhotoDoc & { id: string }> = [];
    snap.forEach((d) => {
      const data = d.data() as PhotoDoc;
      if (!data || !data.dataUrl) return;
      photos.push({ id: d.id, ...data });
    });
    res.json({ photos, count: photos.length });
  } catch (err) {
    next(err);
  }
});

router.post("/photos/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { objectId, dataUrl, takenBy } = req.body as Partial<PhotoDoc>;
    if (!objectId || typeof objectId !== "string") {
      res.status(400).json({ error: "objectId required" });
      return;
    }
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      res.status(400).json({ error: "dataUrl must be a data:image/... URL" });
      return;
    }
    if (dataUrl.length > MAX_DATA_URL_BYTES) {
      res.status(413).json({ error: `Photo too large (${dataUrl.length} bytes, max ${MAX_DATA_URL_BYTES})` });
      return;
    }
    const photo: PhotoDoc = {
      objectId,
      dataUrl,
      takenAt: Date.now(),
      takenBy: typeof takenBy === "string" ? takenBy : "",
    };
    const ref = await db().collection("jobs").doc(jobId).collection("photos").add(photo);
    res.json({ id: ref.id, ...photo });
  } catch (err) {
    next(err);
  }
});

router.delete("/photos/:jobId/:photoId", async (req, res, next) => {
  try {
    const { jobId, photoId } = req.params;
    await db().collection("jobs").doc(jobId).collection("photos").doc(photoId).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
