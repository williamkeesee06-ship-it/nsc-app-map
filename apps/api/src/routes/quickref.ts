// Quick Reference Layer gist. Auto-generated from as-built data; cached at
// jobs/{jobId}/quickref/current. Map view renders the cached gist, not live
// as-built data — that's the whole point of the layer.
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "../lib/firestore.js";
import type { AsBuiltDocument, DrawingObject, QuickReferenceGist } from "@nsc/types";

const router = Router();

const QuickEntrySchema = z.object({
  status: z.enum(["NEW", "REMOVED"]),
  medium: z.enum(["AERIAL", "UNDERGROUND"]),
  family: z.enum(["FIBER", "COPPER", "ASW", "BSW"]).optional(),
  label: z.string().optional(),
  path: z.array(z.object({ lat: z.number(), lng: z.number() })).min(2),
});

function ref(jobId: string) {
  return db().collection("jobs").doc(jobId).collection("quickref").doc("current");
}

function asbuiltRef(jobId: string) {
  return db().collection("jobs").doc(jobId).collection("asbuilt").doc("current");
}

function buildGistFromAsbuilt(jobId: string, doc: AsBuiltDocument): QuickReferenceGist {
  const lines: QuickReferenceGist["lines"] = [];
  const points: QuickReferenceGist["points"] = [];
  const objects: DrawingObject[] = doc.objects ?? [];
  for (const o of objects) {
    if (o.style.hidden) continue;
    if (o.tool === "placed_cable" && "vertices" in o) {
      lines.push({
        id: o.id,
        path: o.vertices,
        status: "NEW",
        // Default to underground when unknown — explicit medium pickers come with Quick Mode
        medium: o.style.strokeStyle === "dashed" ? "UNDERGROUND" : "AERIAL",
        label: o.style.userLabel,
      });
    } else if (o.tool === "removed_cable" && "vertices" in o) {
      lines.push({
        id: o.id,
        path: o.vertices,
        status: "REMOVED",
        medium: o.style.strokeStyle === "dashed" ? "UNDERGROUND" : "AERIAL",
        label: o.style.userLabel,
      });
    } else if ("position" in o && o.tool !== "text") {
      const map: Record<string, QuickReferenceGist["points"][number]["pointType"]> = {
        mh_new: "MH", mh_removed: "MH",
        hh_new: "HH", hh_removed: "HH",
        ped_new: "PED", ped_removed: "PED",
        pole_new: "POLE", pole_removed: "POLE",
        cabinet_new: "CABINET", cabinet_removed: "CABINET",
        anchor_new: "ANCHOR", anchor_removed: "ANCHOR",
      };
      const t = map[o.tool];
      if (!t) continue;
      points.push({
        id: o.id,
        position: o.position,
        pointType: t,
        status: o.tool.endsWith("_removed") ? "REMOVED" : "NEW",
        label: o.style.userLabel ?? o.label,
      });
    }
  }
  return {
    jobId,
    lines,
    points,
    generatedAt: Date.now(),
    outOfDate: false,
    source: "asbuilt",
  };
}

router.get("/jobs/:jobId/quickref", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const snap = await ref(jobId).get();
    if (!snap.exists) {
      res.json({ gist: null });
      return;
    }
    res.json({ gist: snap.data() as QuickReferenceGist });
  } catch (err) {
    next(err);
  }
});

// Rebuild gist from current as-built data.
router.post("/jobs/:jobId/quickref/sync", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const asbuiltSnap = await asbuiltRef(jobId).get();
    if (!asbuiltSnap.exists) {
      res.status(404).json({ error: "No as-built data to sync from" });
      return;
    }
    const doc = asbuiltSnap.data() as AsBuiltDocument;
    const gist = buildGistFromAsbuilt(jobId, doc);
    await ref(jobId).set(gist, { merge: false });
    res.json({ gist });
  } catch (err) {
    next(err);
  }
});

// Mark gist as out-of-date (called by drawing context after a save).
router.post("/jobs/:jobId/quickref/mark-stale", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const r = ref(jobId);
    const snap = await r.get();
    if (!snap.exists) {
      // First as-built save → auto-create gist from current asbuilt doc
      const asbuiltSnap = await asbuiltRef(jobId).get();
      if (asbuiltSnap.exists) {
        const doc = asbuiltSnap.data() as AsBuiltDocument;
        const gist = buildGistFromAsbuilt(jobId, doc);
        await r.set(gist, { merge: false });
        res.json({ gist, created: true });
        return;
      }
      res.json({ gist: null });
      return;
    }
    await r.update({ outOfDate: true });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Append a Quick Mode entry (lightweight backfill). Builds/extends the gist
// without touching as-built data.
router.post("/jobs/:jobId/quickref/quick", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const parsed = QuickEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid quick entry", issues: parsed.error.issues });
      return;
    }
    const r = ref(jobId);
    const snap = await r.get();
    const now = Date.now();
    let gist: QuickReferenceGist;
    if (snap.exists) {
      gist = snap.data() as QuickReferenceGist;
    } else {
      gist = {
        jobId,
        lines: [],
        points: [],
        generatedAt: now,
        outOfDate: false,
        source: "quick",
      };
    }
    gist.lines = [
      ...gist.lines,
      {
        id: randomUUID(),
        path: parsed.data.path,
        status: parsed.data.status,
        medium: parsed.data.medium,
        family: parsed.data.family,
        label: parsed.data.label,
      },
    ];
    gist.generatedAt = now;
    gist.source = snap.exists ? gist.source : "quick";
    gist.outOfDate = false;
    await r.set(gist, { merge: false });
    res.status(201).json({ gist });
  } catch (err) {
    next(err);
  }
});

export default router;
