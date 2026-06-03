// Personal scratchpad route — per-user free-form markups that aren't tied
// to a specific job. Billy 6/3: "I WANT SHIT I PUT ON MY MAP TO SAVE TO THE
// BACKEND SO IT IS ACCESSIBLE INSTANTLY NO MATTER WHICH DEVICE I CHOOSE TO USE"
//
// Storage shape:  scratchpads/{ownerSlug} → { objects: DrawingObject[], updatedAt, ownerName }
//
// API:
//   GET  /api/scratchpad/:owner   → { objects, updatedAt, ownerName }
//   PUT  /api/scratchpad/:owner   → body { objects } → persists, returns same shape

import { Router } from "express";
import { db } from "../lib/firestore.js";

const router = Router();

function slugifyOwner(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

function docRef(ownerName: string) {
  const slug = slugifyOwner(ownerName);
  return db().collection("scratchpads").doc(slug);
}

router.get("/scratchpad/:owner", async (req, res, next) => {
  try {
    const ownerName = req.params.owner;
    if (!ownerName) {
      res.status(400).json({ error: "owner required" });
      return;
    }
    const snap = await docRef(ownerName).get();
    if (!snap.exists) {
      res.json({ objects: [], updatedAt: 0, ownerName });
      return;
    }
    const data = snap.data() as { objects?: unknown[]; updatedAt?: number; ownerName?: string };
    res.json({
      objects: Array.isArray(data.objects) ? data.objects : [],
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
      ownerName: data.ownerName ?? ownerName,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/scratchpad/:owner", async (req, res, next) => {
  try {
    const ownerName = req.params.owner;
    if (!ownerName) {
      res.status(400).json({ error: "owner required" });
      return;
    }
    const body = req.body as { objects?: unknown };
    const objects = Array.isArray(body.objects) ? body.objects : [];
    const payload = {
      objects,
      updatedAt: Date.now(),
      ownerName,
    };
    await docRef(ownerName).set(payload, { merge: false });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
