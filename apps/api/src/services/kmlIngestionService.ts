import { db } from "../lib/firestore.js";
import { recordAuditEvent } from "./auditEventService.js";
import type { GeoFeatureRevision } from "@nsc/types";

export interface ParseResult {
  features: Array<{
    id: string;
    name?: string;
    geometry: { type: string; coordinates: unknown };
    style?: { strokeColor?: string; strokeWidth?: number };
    extendedData?: Record<string, string>;
  }>;
}

/**
 * Parses basic KML XML coordinates and placemarks.
 */
export function parseKmlStringToFeatures(kmlText: string): ParseResult {
  const features: ParseResult["features"] = [];

  // Match Placemark blocks
  const placemarkRegex = /<Placemark[\s\S]*?<\/Placemark>/gi;
  const matches = kmlText.match(placemarkRegex) || [];

  for (const pm of matches) {
    const idMatch = pm.match(/id="([^"]+)"/i);
    const nameMatch = pm.match(/<name>([\s\S]*?)<\/name>/i);
    const id = idMatch ? idMatch[1]! : `feat_${Math.random().toString(36).slice(2, 10)}`;
    const name = nameMatch ? nameMatch[1]!.trim() : undefined;

    // Check for LineString
    const lineCoordMatch = pm.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/i);
    if (lineCoordMatch && lineCoordMatch[1]) {
      const rawPairs = lineCoordMatch[1].trim().split(/\s+/);
      const coords = rawPairs
        .map((p) => {
          const parts = p.split(",").map(Number);
          if (parts.length >= 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
            return [parts[0]!, parts[1]!]; // [lng, lat]
          }
          return null;
        })
        .filter(Boolean);

      if (coords.length > 0) {
        features.push({
          id,
          name,
          geometry: { type: "LineString", coordinates: coords },
        });
        continue;
      }
    }

    // Check for Point
    const pointCoordMatch = pm.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/i);
    if (pointCoordMatch && pointCoordMatch[1]) {
      const parts = pointCoordMatch[1].trim().split(",").map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
        features.push({
          id,
          name,
          geometry: { type: "Point", coordinates: [parts[0]!, parts[1]!] },
        });
      }
    }
  }

  return { features };
}

/**
 * Creates a pending_review revision from uploaded KML data.
 */
export async function createCandidateRevision(
  jobId: string,
  kmlText: string,
  submittedBy: string
): Promise<GeoFeatureRevision> {
  const { features } = parseKmlStringToFeatures(kmlText);
  const now = Date.now();
  const revisionId = `rev_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const revision: GeoFeatureRevision = {
    id: revisionId,
    featureId: `batch_${jobId}_${features.length}`,
    jobId,
    source: "google-earth",
    lifecycle: "pending_review",
    geometry: {
      type: "FeatureCollection",
      coordinates: features,
    },
    geometryHash: `hash_${features.length}_${now}`,
    submittedBy,
    submittedAt: now,
    delta: {
      addedFootage: 0,
      removedFootage: 0,
      geometryChanged: true,
    },
  };

  const firestore = db();
  await firestore
    .collection("jobs")
    .doc(jobId)
    .collection("earthRevisions")
    .doc(revisionId)
    .set(revision);

  await recordAuditEvent(jobId, {
    eventType: "earth_submission_received",
    summary: `Received Earth candidate revision (${features.length} features) from ${submittedBy}`,
    userId: submittedBy,
    metadata: { revisionId, featureCount: features.length },
  });

  return revision;
}

/**
 * Promotes a pending_review revision to approved canonical geometry.
 */
export async function approveCandidateRevision(
  jobId: string,
  revisionId: string,
  approvedBy: string
): Promise<boolean> {
  const firestore = db();
  const revRef = firestore.collection("jobs").doc(jobId).collection("earthRevisions").doc(revisionId);
  const snap = await revRef.get();

  if (!snap.exists) {
    throw new Error("Revision not found");
  }

  const now = Date.now();
  await revRef.update({
    lifecycle: "approved",
    approvedBy,
    approvedAt: now,
  });

  await recordAuditEvent(jobId, {
    eventType: "earth_revision_approved",
    summary: `Approved Earth candidate revision ${revisionId} by ${approvedBy}`,
    userId: approvedBy,
    metadata: { revisionId },
  });

  return true;
}
