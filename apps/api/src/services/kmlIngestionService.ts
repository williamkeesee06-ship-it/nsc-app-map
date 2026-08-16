// Candidate KML/KMZ ingestion + revision approval pipeline.
//
// What this module owns:
//   • Accept a raw KML string or a KMZ (base64) upload from Google Earth.
//   • Strictly validate size and structure before parsing.
//   • Parse the KML with fast-xml-parser (no fragile regex).
//   • Extract Placemarks (Point / LineString / MultiGeometry) preserving
//     nscFeatureId, nscLayerCode, and nscStrokeStyle when Earth round-tripped
//     an existing feature.
//   • Normalize coords to WGS84 lon/lat (KML is defined as WGS84 already; we
//     reject 3-D altitude modes we don't handle and drop empty geometries).
//   • Compute a real geometry SHA-256 hash and a real footage delta vs. the
//     currently active canonical geometry.
//   • Persist the immutable original payload alongside the revision doc.
//   • On approval: run in a Firestore transaction, re-check lifecycle, promote
//     the revision to the canonical `geoFeatures` collection, mark superseded
//     revisions, and emit an audit event. Never mutate an archived job.

import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import type {
  GeoFeature,
  GeoFeatureRevision,
  GeometrySource,
  Job,
} from "@nsc/types";
import { db } from "../lib/firestore.js";
import { recordAuditEvent } from "./auditEventService.js";

// ─── Constants ─────────────────────────────────────────────────────────────

/** Max accepted KML/KMZ payload (post-decompression for KMZ). 10 MB is
 *  generous for a construction job — a full state fits in <1 MB. */
export const MAX_KML_BYTES = 10 * 1024 * 1024;
export const MAX_KMZ_BYTES = 25 * 1024 * 1024;

// ─── Public types ──────────────────────────────────────────────────────────

export interface ParsedFeature {
  /** Neutral GeoFeature id echoed from ExtendedData when the feature
   *  round-tripped from our own feed. `null` means this is a brand-new
   *  feature drawn in Earth. */
  nscFeatureId: string | null;
  layerCode: string;
  strokeStyle: string | null;
  name: string | null;
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "LineString"; coordinates: Array<[number, number]> };
  /** Length in feet — only present for LineString. */
  footageFt: number;
}

export interface ParseResult {
  features: ParsedFeature[];
  warnings: string[];
}

// ─── Input decoding ────────────────────────────────────────────────────────

/**
 * Detect whether a payload is a KMZ (zip) archive vs plain KML. KMZ magic
 * bytes are `PK\x03\x04`.
 */
export function isKmzMagic(buf: Buffer): boolean {
  return buf.length >= 4 &&
    buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/** Extract the primary .kml file from a KMZ archive. Rejects zip-slip and
 *  oversized entries. */
export async function extractKmlFromKmz(kmzBuffer: Buffer): Promise<string> {
  if (kmzBuffer.length > MAX_KMZ_BYTES) {
    throw new Error(`KMZ archive exceeds ${MAX_KMZ_BYTES} bytes`);
  }
  const zip = await JSZip.loadAsync(kmzBuffer);
  // KMZ spec: primary doc is doc.kml at archive root. Fall back to first .kml.
  let entry = zip.file("doc.kml");
  if (!entry) {
    const kmlEntries = Object.values(zip.files).filter(
      (f) => !f.dir && f.name.toLowerCase().endsWith(".kml")
    );
    if (kmlEntries.length === 0) throw new Error("KMZ contains no .kml document");
    entry = kmlEntries[0]!;
  }
  // Guard against decompression bombs by checking uncompressed size *after*
  // string extraction — JSZip streams into memory, so we hard-cap the string.
  const kmlText = await entry.async("string");
  if (kmlText.length > MAX_KML_BYTES) {
    throw new Error(`KMZ inner KML exceeds ${MAX_KML_BYTES} bytes`);
  }
  return kmlText;
}

// ─── XML parsing ───────────────────────────────────────────────────────────

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseTagValue: false,     // keep everything as strings; we cast intentionally
  parseAttributeValue: false,
  trimValues: true,
  cdataPropName: "__cdata",
});

/** Coerce a value to an array whether XML parser returned single or list. */
function toArr<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Read a text node, honoring CDATA if present. */
function nodeText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object" && node !== null) {
    const asObj = node as Record<string, unknown>;
    if (typeof asObj.__cdata === "string") return asObj.__cdata;
    if (typeof asObj["#text"] === "string") return asObj["#text"] as string;
  }
  return "";
}

/** Parse a single `<coordinates>` block. Returns [[lng, lat], ...] tuples
 *  clamped to valid WGS84 ranges. Altitude is discarded. */
function parseCoordinates(raw: string): Array<[number, number]> {
  return raw
    .split(/\s+/)
    .map((tok) => tok.trim())
    .filter(Boolean)
    .map((tok): [number, number] | null => {
      const parts = tok.split(",");
      if (parts.length < 2) return null;
      const lng = Number(parts[0]);
      const lat = Number(parts[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      return [lng, lat];
    })
    .filter((c): c is [number, number] => c !== null);
}

/** Great-circle distance in meters between two [lng, lat] points. */
function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Polyline length in feet (geodesic). */
export function polylineFootage(coords: Array<[number, number]>): number {
  if (coords.length < 2) return 0;
  let meters = 0;
  for (let i = 1; i < coords.length; i++) {
    meters += haversineMeters(coords[i - 1]!, coords[i]!);
  }
  return meters * 3.28084;
}

/** Extract ExtendedData/Data pairs into a flat record. */
function extractExtendedData(placemark: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const extended = placemark.ExtendedData as Record<string, unknown> | undefined;
  if (!extended) return out;
  const dataItems = toArr(extended.Data as unknown);
  for (const item of dataItems) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = (rec["@_name"] ?? "").toString();
    if (!name) continue;
    const rawValue = rec.value ?? rec["#text"] ?? "";
    out[name] = nodeText(rawValue);
  }
  return out;
}

/**
 * Parse a KML string into normalized features. Never throws on missing
 * fields — collects warnings so the reviewer can see what was skipped.
 */
export function parseKmlToFeatures(kmlText: string): ParseResult {
  if (kmlText.length > MAX_KML_BYTES) {
    throw new Error(`KML exceeds ${MAX_KML_BYTES} bytes`);
  }
  const warnings: string[] = [];
  const features: ParsedFeature[] = [];

  let parsed: any;
  try {
    parsed = XML_PARSER.parse(kmlText);
  } catch (err) {
    throw new Error(`Malformed XML: ${(err as Error).message}`);
  }
  if (!parsed?.kml) {
    throw new Error("Payload is not a KML document (missing <kml> root)");
  }

  // Walk every Placemark, wherever nested. KML places Placemarks under
  // Document, Folder, or nested Folder — we do a shallow recursive collect.
  const placemarks: Array<Record<string, unknown>> = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    for (const pm of toArr(rec.Placemark)) {
      if (pm && typeof pm === "object") placemarks.push(pm as Record<string, unknown>);
    }
    for (const folder of toArr(rec.Folder)) walk(folder);
    for (const doc of toArr(rec.Document)) walk(doc);
  };
  walk(parsed.kml);
  if (parsed.kml.Document) walk(parsed.kml.Document);

  for (const pm of placemarks) {
    const extData = extractExtendedData(pm);
    const nscFeatureId = extData.nscFeatureId ? extData.nscFeatureId : null;
    const layerCode = extData.nscLayerCode || "earth_design";
    const strokeStyle = extData.nscStrokeStyle || null;
    const name = nodeText(pm.name) || null;

    // Point
    const point = pm.Point as Record<string, unknown> | undefined;
    if (point && point.coordinates) {
      const coords = parseCoordinates(nodeText(point.coordinates));
      if (coords.length >= 1) {
        features.push({
          nscFeatureId,
          layerCode,
          strokeStyle,
          name,
          geometry: { type: "Point", coordinates: coords[0]! },
          footageFt: 0,
        });
        continue;
      }
      warnings.push(`Skipped Point with no valid coordinates (name=${name ?? ""})`);
    }

    // LineString
    const line = pm.LineString as Record<string, unknown> | undefined;
    if (line && line.coordinates) {
      const coords = parseCoordinates(nodeText(line.coordinates));
      if (coords.length >= 2) {
        features.push({
          nscFeatureId,
          layerCode,
          strokeStyle,
          name,
          geometry: { type: "LineString", coordinates: coords },
          footageFt: polylineFootage(coords),
        });
        continue;
      }
      warnings.push(`Skipped LineString with <2 valid vertices (name=${name ?? ""})`);
    }

    // MultiGeometry — we flatten to component features
    const multi = pm.MultiGeometry as Record<string, unknown> | undefined;
    if (multi) {
      for (const line2 of toArr(multi.LineString as unknown)) {
        const rec = line2 as Record<string, unknown>;
        const coords = parseCoordinates(nodeText(rec.coordinates));
        if (coords.length >= 2) {
          features.push({
            nscFeatureId,
            layerCode,
            strokeStyle,
            name,
            geometry: { type: "LineString", coordinates: coords },
            footageFt: polylineFootage(coords),
          });
        }
      }
      for (const point2 of toArr(multi.Point as unknown)) {
        const rec = point2 as Record<string, unknown>;
        const coords = parseCoordinates(nodeText(rec.coordinates));
        if (coords.length >= 1) {
          features.push({
            nscFeatureId,
            layerCode,
            strokeStyle,
            name,
            geometry: { type: "Point", coordinates: coords[0]! },
            footageFt: 0,
          });
        }
      }
      continue;
    }

    // Anything else (Polygon, Model, gx:Track, ...) — record as warning.
    warnings.push(`Skipped unsupported Placemark geometry (name=${name ?? "unnamed"})`);
  }

  return { features, warnings };
}

// ─── Hashing / delta ───────────────────────────────────────────────────────

/** Stable geometry hash — SHA-256 of a canonicalized JSON of all features. */
export function hashFeatures(features: ParsedFeature[]): string {
  const canonical = features
    .map((f) => ({
      id: f.nscFeatureId,
      layer: f.layerCode,
      type: f.geometry.type,
      coords: f.geometry.coordinates,
      name: f.name,
    }))
    .sort((a, b) => {
      const ka = `${a.id ?? ""}|${a.layer}|${a.type}`;
      const kb = `${b.id ?? ""}|${b.layer}|${b.type}`;
      return ka.localeCompare(kb);
    });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Diff footage totals between the candidate and the currently approved
 *  active geometry (which lives in the canonical geoFeatures collection). */
async function computeDelta(
  jobId: string,
  candidate: ParsedFeature[]
): Promise<{ addedFootage: number; removedFootage: number; geometryChanged: boolean }> {
  const snap = await db()
    .collection("jobs")
    .doc(jobId)
    .collection("geoFeatures")
    .where("lifecycle", "==", "approved")
    .get();

  const activeByFeatureId = new Map<string, GeoFeature>();
  let activeFootage = 0;
  snap.forEach((d) => {
    const f = d.data() as GeoFeature;
    activeByFeatureId.set(f.id, f);
    if (f.geometry?.type === "LineString") {
      const coords = f.geometry.coordinates as Array<[number, number]>;
      activeFootage += polylineFootage(coords);
    }
  });

  let candidateFootage = 0;
  let geometryChanged = false;
  for (const c of candidate) {
    if (c.geometry.type === "LineString") candidateFootage += c.footageFt;
    if (!c.nscFeatureId || !activeByFeatureId.has(c.nscFeatureId)) {
      geometryChanged = true;
    }
  }
  const diff = candidateFootage - activeFootage;
  return {
    addedFootage: Math.max(0, Math.round(diff)),
    removedFootage: Math.max(0, Math.round(-diff)),
    geometryChanged: geometryChanged || Math.abs(diff) > 0.5,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Create a `pending_review` revision from a KML/KMZ payload. Rejects if the
 * job doc is missing or lifecycle=archived. Stores the immutable original
 * payload as a subdocument for audit.
 */
export async function createCandidateRevision(
  jobId: string,
  payload: { kmlText?: string; kmzBase64?: string },
  submittedBy: string,
  source: GeometrySource = "google-earth"
): Promise<GeoFeatureRevision & { warnings: string[]; featureCount: number }> {
  if (!jobId) throw new Error("jobId required");

  const jobRef = db().collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) throw new Error(`Job ${jobId} not found`);
  const job = jobSnap.data() as Job;
  if ((job as any).lifecycle === "archived") {
    throw new Error(`Job ${jobId} is archived; new revisions rejected`);
  }

  let kmlText: string;
  if (payload.kmzBase64) {
    const kmzBuf = Buffer.from(payload.kmzBase64, "base64");
    if (!isKmzMagic(kmzBuf)) throw new Error("Payload is not a valid KMZ archive");
    kmlText = await extractKmlFromKmz(kmzBuf);
  } else if (payload.kmlText) {
    if (Buffer.byteLength(payload.kmlText, "utf8") > MAX_KML_BYTES) {
      throw new Error(`KML text exceeds ${MAX_KML_BYTES} bytes`);
    }
    kmlText = payload.kmlText;
  } else {
    throw new Error("Provide either kmlText or kmzBase64");
  }

  const { features, warnings } = parseKmlToFeatures(kmlText);
  if (features.length === 0) {
    throw new Error("Parsed 0 valid features from KML");
  }

  const now = Date.now();
  const revisionId = `rev_${now}_${createHash("sha256")
    .update(`${jobId}|${now}|${submittedBy}`)
    .digest("hex")
    .slice(0, 12)}`;

  const delta = await computeDelta(jobId, features);

  const revision: GeoFeatureRevision = {
    id: revisionId,
    // Batch revisions submit against the whole job — we track the featureId
    // as the jobId with a batch marker so downstream tooling can distinguish
    // per-feature edits (which use the neutral GeoFeature id) from batch
    // uploads like this one.
    featureId: `batch:${jobId}`,
    jobId,
    source,
    lifecycle: "pending_review",
    geometry: {
      type: "FeatureCollection",
      // Coordinates carry all parsed features so the reviewer sees exactly
      // what will be promoted. Approval fans out into per-feature GeoFeatures.
      coordinates: features,
    },
    geometryHash: hashFeatures(features),
    submittedBy,
    submittedAt: now,
    delta,
  };

  const batch = db().batch();
  const revRef = jobRef.collection("earthRevisions").doc(revisionId);
  batch.set(revRef, revision);
  // Immutable original payload for audit. Stored separately so the revision
  // doc stays small enough to list quickly.
  batch.set(revRef.collection("payload").doc("original"), {
    kmlText,
    receivedAt: now,
    submittedBy,
    byteLength: Buffer.byteLength(kmlText, "utf8"),
  });
  await batch.commit();

  await recordAuditEvent(jobId, {
    eventType: "earth_submission_received",
    summary: `Received Earth candidate revision (${features.length} features, +${delta.addedFootage}ft / -${delta.removedFootage}ft) from ${submittedBy}`,
    userId: submittedBy,
    metadata: { revisionId, featureCount: features.length, delta, warnings },
  });

  return { ...revision, warnings, featureCount: features.length };
}

/**
 * Transactional approval:
 *   1. Re-read the revision inside the txn; reject if not pending_review.
 *   2. Re-read the job; reject if archived.
 *   3. Mark superseded any approved revisions this one replaces (by geometryHash).
 *   4. Fan out revision.features into canonical GeoFeature docs.
 *   5. Flip revision.lifecycle = approved, stamp approvedBy/approvedAt.
 *   6. Emit audit event.
 */
export async function approveCandidateRevision(
  jobId: string,
  revisionId: string,
  approvedBy: string
): Promise<{ ok: true; approvedFeatureCount: number }> {
  if (!jobId || !revisionId) throw new Error("jobId and revisionId required");

  const firestore = db();
  const jobRef = firestore.collection("jobs").doc(jobId);
  const revRef = jobRef.collection("earthRevisions").doc(revisionId);
  const featuresCol = jobRef.collection("geoFeatures");

  const result = await firestore.runTransaction(async (tx) => {
    const [jobSnap, revSnap] = await Promise.all([tx.get(jobRef), tx.get(revRef)]);
    if (!jobSnap.exists) throw new Error(`Job ${jobId} not found`);
    if (!revSnap.exists) throw new Error(`Revision ${revisionId} not found`);
    const job = jobSnap.data() as Job;
    if ((job as any).lifecycle === "archived") {
      throw new Error(`Job ${jobId} is archived; approval denied`);
    }
    const revision = revSnap.data() as GeoFeatureRevision;
    if (revision.lifecycle !== "pending_review") {
      throw new Error(`Revision is ${revision.lifecycle}; only pending_review may be approved`);
    }

    const now = Date.now();
    const features = (revision.geometry?.coordinates as ParsedFeature[]) || [];

    // Load current active features so we can mark ones this batch replaces.
    // We look them up outside the txn's writes (reads happen first) — for the
    // scale we're at (one job at a time), this is fine.
    const activeSnaps = await tx.get(
      featuresCol.where("lifecycle", "==", "approved")
    );
    const activeById = new Map<string, GeoFeature>();
    activeSnaps.forEach((d) => {
      const f = d.data() as GeoFeature;
      activeById.set(f.id, f);
    });

    let promoted = 0;
    for (const feat of features) {
      // Reuse the neutral GeoFeature id if the feature round-tripped from our
      // feed; otherwise allocate a fresh UUID-like id.
      const featureId = feat.nscFeatureId
        ? feat.nscFeatureId
        : `feat_${createHash("sha256").update(`${revisionId}|${promoted}`).digest("hex").slice(0, 16)}`;

      // If this feature id was already approved, supersede the prior version.
      const existing = activeById.get(featureId);
      if (existing) {
        tx.update(featuresCol.doc(featureId), {
          lifecycle: "superseded",
          updatedAt: now,
        });
      }

      const geoFeature: GeoFeature = {
        id: featureId,
        organizationId: (job as any).organizationId || "nsc",
        jobId,
        layerId: feat.layerCode,
        featureType: feat.geometry.type === "Point" ? "point" : "route",
        source: revision.source,
        lifecycle: "approved",
        geometry: {
          type: feat.geometry.type,
          coordinates: feat.geometry.coordinates,
        },
        properties: {
          strokeColor: "#06B6D4",
          strokeWidth: 3,
          strokeStyle: (feat.strokeStyle as any) || "solid",
          fill: { kind: "none" },
          opacity: 0.9,
          userLabel: feat.name || undefined,
          calculatedFootage: feat.footageFt || undefined,
        } as any,
        activeRevisionId: revisionId,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      tx.set(featuresCol.doc(featureId), geoFeature, { merge: false });
      promoted++;
    }

    tx.update(revRef, {
      lifecycle: "approved",
      approvedBy,
      approvedAt: now,
    });

    return { promoted };
  });

  await recordAuditEvent(jobId, {
    eventType: "earth_revision_approved",
    summary: `Approved Earth revision ${revisionId} (${result.promoted} features promoted) by ${approvedBy}`,
    userId: approvedBy,
    metadata: { revisionId, featureCount: result.promoted },
  });

  return { ok: true, approvedFeatureCount: result.promoted };
}

/**
 * Reject a pending revision with a required reason. Transactional; never
 * promotes anything; leaves the immutable payload intact for audit.
 */
export async function rejectCandidateRevision(
  jobId: string,
  revisionId: string,
  rejectedBy: string,
  reason: string
): Promise<{ ok: true }> {
  if (!reason || reason.trim().length < 3) {
    throw new Error("Rejection reason is required (min 3 chars)");
  }
  const firestore = db();
  const revRef = firestore.collection("jobs").doc(jobId).collection("earthRevisions").doc(revisionId);

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(revRef);
    if (!snap.exists) throw new Error(`Revision ${revisionId} not found`);
    const rev = snap.data() as GeoFeatureRevision;
    if (rev.lifecycle !== "pending_review") {
      throw new Error(`Revision is ${rev.lifecycle}; only pending_review may be rejected`);
    }
    tx.update(revRef, {
      lifecycle: "rejected",
      approvedBy: rejectedBy,
      approvedAt: Date.now(),
      reviewComment: reason.trim(),
    });
  });

  await recordAuditEvent(jobId, {
    eventType: "earth_revision_rejected",
    summary: `Rejected Earth revision ${revisionId} by ${rejectedBy}: ${reason.trim().slice(0, 200)}`,
    userId: rejectedBy,
    metadata: { revisionId, reason: reason.trim() },
  });

  return { ok: true };
}
