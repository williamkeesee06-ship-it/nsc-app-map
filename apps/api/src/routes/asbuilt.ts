import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/firestore.js";
import { emptyAsbuilt, type AsbuiltDoc } from "@nsc/types";

const router = Router();

const LatLngSchema = z.object({ lat: z.number(), lng: z.number() });

const MapPointSchema = z.object({
  id: z.string(),
  type: z.enum(["MH", "HH", "POLE", "VAULT", "CLOSURE", "A_TAG", "PHOTO_PIN", "OTHER"]),
  position: LatLngSchema,
  label: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.number(),
});

const MapLineSchema = z.object({
  id: z.string(),
  category: z.enum(["PLACED", "REMOVED"]),
  path: z.array(LatLngSchema).min(2),
  label: z.string().optional(),
  createdAt: z.number(),
});

const AsbuiltSchema = z.object({
  jobId: z.string().min(1),
  points: z.array(MapPointSchema),
  lines: z.array(MapLineSchema),
  viewport: z.object({ center: LatLngSchema, zoom: z.number() }).optional(),
  updatedAt: z.number(),
  schemaVersion: z.literal(1),
});

function docRef(jobId: string) {
  return db().collection("jobs").doc(jobId).collection("asbuilt").doc("current");
}

router.get("/asbuilt/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const snap = await docRef(jobId).get();
    if (!snap.exists) {
      res.json(emptyAsbuilt(jobId));
      return;
    }
    res.json(snap.data() as AsbuiltDoc);
  } catch (err) {
    next(err);
  }
});

router.put("/asbuilt/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const incoming = { ...req.body, jobId, updatedAt: Date.now(), schemaVersion: 1 };
    const parsed = AsbuiltSchema.safeParse(incoming);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid asbuilt payload", issues: parsed.error.issues });
      return;
    }
    await docRef(jobId).set(parsed.data, { merge: false });
    res.json(parsed.data);
  } catch (err) {
    next(err);
  }
});

export default router;
