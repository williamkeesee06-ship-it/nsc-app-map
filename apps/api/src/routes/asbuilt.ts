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

// Layer schema (elevated My Maps style for personal desktop use)
const JobLayerSchema = z.object({
  id: z.string(),
  label: z.string(),
  hidden: z.boolean().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  description: z.string().optional(),
});

// ---- Phase 3 schema (AsBuiltDocument — schemaVersion:2) ----
const DrawingStyleSchema = z.object({
  strokeColor: z.string(),
  strokeWidth: z.number().min(1).max(10),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]),
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
  pointSize: z.number().min(0.5).max(2).optional(),
  icon: z.string().optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  userLabel: z.string().optional(),
  description: z.string().optional(),
  layerId: z.string().optional(),
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
    tool: z.literal("callout"),
    anchor: VertexSchema,
    position: VertexSchema,
    path: z.array(VertexSchema).optional(),
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
  layers: z.array(JobLayerSchema).optional(),
  updatedAt: z.number(),
  updatedBy: z.string().optional(),
  schemaVersion: z.literal(2),
});

// Per-supervisor scoping (Billy 5/26): each supervisor's markups live at
// jobs/{jobId}/asbuilt/{ownerSlug}. Legacy global doc lives at .../current
// and is treated as belonging to Billy Keesee on read.
function slugifyOwner(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}
const LEGACY_OWNER = "billy-keesee";
const LEGACY_OWNER_NAME = "Billy Keesee";

function docRef(jobId: string, owner: string) {
  const slug = slugifyOwner(owner) || LEGACY_OWNER;
  return db().collection("jobs").doc(jobId).collection("asbuilt").doc(slug);
}
function legacyDocRef(jobId: string) {
  return db().collection("jobs").doc(jobId).collection("asbuilt").doc("current");
}

// Return every job's asbuilt doc so the map can render ALL markups
// simultaneously regardless of which job is selected. Used by the
// always-visible global markups overlay.
//
// ?owner=<name>  → only that supervisor's markups (legacy `current` docs
//                  are treated as Billy Keesee's).
// ?owner=*       → manager mode: union of every supervisor's markups.
// (no owner)     → defaults to legacy behaviour: legacy `current` docs only.
router.get("/asbuilt", async (req, res, next) => {
  try {
    const owner = typeof req.query.owner === "string" ? req.query.owner : "";
    const wantAll = owner === "*";
    const ownerSlug = owner && !wantAll ? slugifyOwner(owner) : "";
    const snap = await db().collectionGroup("asbuilt").get();
    const docs: Array<{ jobId: string; objects: unknown[]; updatedAt: number; schemaVersion: number; owner?: string }> = [];
    snap.forEach((d) => {
      const id = d.id;
      const data = d.data() as { jobId?: string; objects?: unknown[]; updatedAt?: number; schemaVersion?: number; ownerName?: string };
      if (!data) return;
      if (!Array.isArray(data.objects) || data.objects.length === 0) return;

      // Decide whether this sub-doc matches the requested owner.
      let include = false;
      let ownerName = data.ownerName;
      if (id === "current") {
        // Legacy global doc — counts as Billy Keesee.
        ownerName = ownerName ?? LEGACY_OWNER_NAME;
        if (wantAll) include = true;
        else if (!ownerSlug) include = true; // back-compat: no owner filter
        else if (ownerSlug === LEGACY_OWNER) include = true;
      } else {
        if (wantAll) include = true;
        else if (ownerSlug && id === ownerSlug) include = true;
      }
      if (!include) return;

      docs.push({
        jobId: data.jobId ?? d.ref.parent.parent?.id ?? "",
        objects: data.objects,
        updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
        schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 2,
        owner: ownerName,
      });
    });
    res.json({ docs, count: docs.length });
  } catch (err) {
    next(err);
  }
});

router.get("/asbuilt/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const owner = typeof req.query.owner === "string" ? req.query.owner : "";
    // If no owner specified, fall back to legacy `current` (pre-scoping behaviour).
    if (!owner) {
      const snap = await legacyDocRef(jobId).get();
      if (!snap.exists) {
        res.json(emptyAsbuilt(jobId));
        return;
      }
      res.json(snap.data() as AsbuiltDoc);
      return;
    }
    // Per-owner read.
    const snap = await docRef(jobId, owner).get();
    if (snap.exists) {
      res.json(snap.data() as AsbuiltDoc);
      return;
    }
    // Billy fallback: if Billy has no per-owner doc yet but the legacy doc
    // exists, return that — it predates per-supervisor scoping and belongs to him.
    if (slugifyOwner(owner) === LEGACY_OWNER) {
      const legacy = await legacyDocRef(jobId).get();
      if (legacy.exists) {
        res.json(legacy.data() as AsbuiltDoc);
        return;
      }
    }
    res.json(emptyAsbuilt(jobId));
  } catch (err) {
    next(err);
  }
});

router.put("/asbuilt/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;

    // Field-finding sentinel ids (no associated job) bypass the job-exists check.
    // These are per-supervisor labeled markups not attached to any work order.
    const isFieldFinding = jobId.startsWith("__ff__");

    // Verify job exists (unless this is a field finding)
    if (!isFieldFinding) {
      const jobSnap = await db().collection("jobs").doc(jobId).get();
      if (!jobSnap.exists) {
        res.status(404).json({ error: `Job ${jobId} not found` });
        return;
      }
    }

    const body = req.body as Record<string, unknown>;
    const schemaVersion = body.schemaVersion;
    const ownerRaw = typeof req.query.owner === "string" && req.query.owner
      ? req.query.owner
      : (typeof body.owner === "string" ? body.owner : LEGACY_OWNER_NAME);
    const ownerName = ownerRaw.trim() || LEGACY_OWNER_NAME;
    const target = docRef(jobId, ownerName);

    if (schemaVersion === 2) {
      // Phase 3 schema
      const incoming = { ...body, jobId, updatedAt: Date.now(), schemaVersion: 2, ownerName };
      // Strip top-level `owner` (query-only) so it doesn't break schema.
      delete (incoming as Record<string, unknown>).owner;
      const parsed = AsBuiltDocumentSchema.safeParse(incoming);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid asbuilt payload (v2)", issues: parsed.error.issues });
        return;
      }

      // ── Empty-overwrite guard (Billy 6/18) ───────────────────────────────
      // Refuse to overwrite a non-empty doc with an empty objects array unless
      // the client opts in with ?allowEmpty=true. This prevents the silent
      // data-loss path where a race during job-switch PUTs an empty payload
      // and Firestore replaces real markups with nothing.
      const allowEmpty = String(req.query.allowEmpty ?? "false") === "true";
      if (parsed.data.objects.length === 0 && !allowEmpty) {
        const existing = await target.get();
        if (existing.exists) {
          const existingObjs = (existing.data() as { objects?: unknown[] })?.objects;
          if (Array.isArray(existingObjs) && existingObjs.length > 0) {
            // Hard refuse + log enough context to find offenders in Vercel logs.
            // We do NOT touch Firestore.
            console.warn(`[asbuilt-guard] BLOCKED empty overwrite jobId=${jobId} owner="${ownerName}" existingObjs=${existingObjs.length} userAgent=${req.header("user-agent") ?? "?"} referer=${req.header("referer") ?? "?"}`);
            res.status(409).json({
              error: "refused-empty-overwrite",
              detail: `Existing doc has ${existingObjs.length} markup(s). Pass ?allowEmpty=true to intentionally clear.`,
              jobId,
              owner: ownerName,
              existingCount: existingObjs.length,
            });
            return;
          }
        }
      }

      // Persist ownerName alongside the validated doc (not part of zod schema
      // but Firestore is permissive — we add it as an extra field).
      await target.set({ ...parsed.data, ownerName }, { merge: false });
      res.json(parsed.data);
    } else {
      // Phase 1/2 legacy schema — keep backward compat
      const incoming = { ...body, jobId, updatedAt: Date.now(), schemaVersion: 1 };
      delete (incoming as Record<string, unknown>).owner;
      const parsed = AsbuiltLegacySchema.safeParse(incoming);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid asbuilt payload (v1)", issues: parsed.error.issues });
        return;
      }
      await target.set({ ...parsed.data, ownerName }, { merge: false });
      res.json(parsed.data);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
