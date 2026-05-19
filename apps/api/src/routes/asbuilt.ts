import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/firestore.js";
import { emptyAsbuilt, type AsbuiltDoc } from "@nsc/types";

const router = Router();

// ---- Legacy schema (Phase 1/2 —  schemaVersion:1) ----
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

const AsbuiltLegacySchema = z.object({
  jobId: z.string().min(1),
  points: z.array(MapPointSchema),
  lines: z.array(MapLineSchema),
  viewport: z.object({ center: LatLngSchema, zoom: z.number() }).optional(),
  updatedAt: z.number(),
  schemaVersion: z.literal(1),
});

// ---- Phase 3 schema (AsBuiltDocument — schemaVersion:2) ----
const DrawingStyleSchema = z.object({
  strokeColor: z.string(),
  strokeWidth: z.number().min(1).max(10),
  strokeStyle: z.enum(["solid", "dashed"]),
  fill: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("solid"), color: z.string() }),
    z.object({
      kind: z.literal("hash"),
      pattern: z.enum(["diagonal", "cross", "dots"]),
      color: z.string(),
      density: z.number(),
    }),
  ]),
  opacity: z.number().min(0).max(1),
  pointSize: z.number().optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  userLabel: z.string().optional(),
  description: z.string().optional(),
  // Phase 7 layer metadata
  layerId: z.string().optional(),
  createdBy: z.string().optional(),
  workDate: z.string().optional(),
}).passthrough();

const AsBuiltLayerSchema = z.object({
  layerId: z.string(),
  createdBy: z.string(),
  workDate: z.string(),
  locked: z.boolean(),
  hidden: z.boolean(),
  createdAt: z.number(),
});

const VertexSchema = z.object({ lat: z.number(), lng: z.number() });
const BoundsSchema = z.object({ n: z.number(), s: z.number(), e: z.number(), w: z.number() });

const DrawingObjectSchema = z.discriminatedUnion("tool", [
  z.object({
    id: z.string(),
    tool: z.enum(["placed_cable", "removed_cable", "line", "arrow", "polygon", "freehand", "measure"]),
    vertices: z.array(VertexSchema),
    style: DrawingStyleSchema,
  }),
  z.object({
    id: z.string(),
    tool: z.enum(["rectangle", "circle"]),
    bounds: BoundsSchema,
    style: DrawingStyleSchema,
  }),
  z.object({
    id: z.string(),
    tool: z.literal("text"),
    position: VertexSchema,
    text: z.string(),
    style: DrawingStyleSchema,
  }),
  z.object({
    id: z.string(),
    tool: z.enum([
      "mh_new", "mh_removed",
      "hh_new", "hh_removed",
      "ped_new", "ped_removed",
      "pole_new", "pole_removed",
      "cabinet_new", "cabinet_removed",
      "anchor_new", "anchor_removed",
    ]),
    position: VertexSchema,
    label: z.string().optional(),
    style: DrawingStyleSchema,
  }),
]);

const AsBuiltDocumentSchema = z.object({
  jobId: z.string().min(1),
  objects: z.array(DrawingObjectSchema),
  updatedAt: z.number(),
  updatedBy: z.string().optional(),
  schemaVersion: z.literal(2),
  layers: z.array(AsBuiltLayerSchema).optional(),
  activeLayerId: z.string().nullable().optional(),
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

    // Verify job exists
    const jobSnap = await db().collection("jobs").doc(jobId).get();
    if (!jobSnap.exists) {
      res.status(404).json({ error: `Job ${jobId} not found` });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const schemaVersion = body.schemaVersion;

    if (schemaVersion === 2) {
      // Phase 3 schema
      const incoming = { ...body, jobId, updatedAt: Date.now(), schemaVersion: 2 };
      const parsed = AsBuiltDocumentSchema.safeParse(incoming);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid asbuilt payload (v2)", issues: parsed.error.issues });
        return;
      }
      // Strip undefined recursively — Firestore rejects undefined values.
      const sanitized = JSON.parse(JSON.stringify(parsed.data));
      await docRef(jobId).set(sanitized, { merge: false });
      res.json(sanitized);
    } else {
      // Phase 1/2 legacy schema — keep backward compat
      const incoming = { ...body, jobId, updatedAt: Date.now(), schemaVersion: 1 };
      const parsed = AsbuiltLegacySchema.safeParse(incoming);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid asbuilt payload (v1)", issues: parsed.error.issues });
        return;
      }
      await docRef(jobId).set(parsed.data, { merge: false });
      res.json(parsed.data);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
