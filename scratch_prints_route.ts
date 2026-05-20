// Engineering print overlays. One or more per job; at most one marked active.
// Stored at jobs/{jobId}/prints/{printId}.
import { Router } from "express";
import express from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "../lib/firestore.js";
import type { EngineeringPrint } from "@nsc/types";

const router = Router();

const LatLngSchema = z.object({ lat: z.number(), lng: z.number() });
const CornersSchema = z.object({
  nw: LatLngSchema, ne: LatLngSchema, se: LatLngSchema, sw: LatLngSchema,
});

const SourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), dataUrl: z.string() }),
  z.object({ kind: z.literal("pdf"), dataUrl: z.string(), page: z.number().int().min(1) }),
]);

const PrintBodySchema = z.object({
  source: SourceSchema,
  corners: CornersSchema,
  opacity: z.number().min(0).max(1).default(0.6),
  active: z.boolean().optional(),
  visible: z.boolean().optional(),
});

const PrintPatchSchema = z.object({
  corners: CornersSchema.optional(),
  opacity: z.number().min(0).max(1).optional(),
  active: z.boolean().optional(),
  visible: z.boolean().optional(),
});

router.get("/jobs/:jobId/prints", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const snap = await db()
      .collection("jobs").doc(jobId)
      .collection("prints")
      .orderBy("createdAt", "desc")
      .get();
    const prints = snap.docs.map((d) => d.data() as EngineeringPrint);
    res.json({ prints, count: prints.length });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/jobs/:jobId/prints",
  express.json({ limit: "25mb" }),
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const parsed = PrintBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid print payload", issues: parsed.error.issues });
        return;
      }
      const printId = randomUUID();
      const print: EngineeringPrint = {
        printId,
        jobId,
        source: parsed.data.source,
        corners: parsed.data.corners,
        opacity: parsed.data.opacity,
        active: parsed.data.active ?? false,
        visible: parsed.data.visible ?? true,
        createdAt: Date.now(),
      };
      // If marking active, demote any existing active print for this job
      if (print.active) {
        await demoteOthers(jobId, printId);
      }
      await db()
        .collection("jobs").doc(jobId)
        .collection("prints").doc(printId)
        .set(print);
      res.status(201).json({ print });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/jobs/:jobId/prints/:printId",
  express.json({ limit: "25mb" }),
  async (req, res, next) => {
    try {
      const { jobId, printId } = req.params;
      const parsed = PrintPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid print patch", issues: parsed.error.issues });
        return;
      }
      const ref = db().collection("jobs").doc(jobId).collection("prints").doc(printId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Print not found" });
        return;
      }
      const next = { ...(snap.data() as EngineeringPrint), ...parsed.data };
      if (parsed.data.active === true) {
        await demoteOthers(jobId, printId);
      }
      await ref.set(next, { merge: false });
      res.json({ print: next });
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/jobs/:jobId/prints/:printId", async (req, res, next) => {
  try {
    const { jobId, printId } = req.params;
    await db()
      .collection("jobs").doc(jobId)
      .collection("prints").doc(printId)
      .delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function demoteOthers(jobId: string, keepPrintId: string): Promise<void> {
  const snap = await db()
    .collection("jobs").doc(jobId)
    .collection("prints")
    .where("active", "==", true)
    .get();
  const batch = db().batch();
  for (const doc of snap.docs) {
    if (doc.id === keepPrintId) continue;
    batch.update(doc.ref, { active: false });
  }
  await batch.commit();
}

export default router;
