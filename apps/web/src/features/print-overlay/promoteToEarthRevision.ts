// promoteToEarthRevision — Phase 3 (NSMS) bridge helper.
//
// Serializes a set of WGS84-projected drawings (already projected via an
// active SheetRegistration by the caller) into a KML document that the
// server's kmlIngestionService can parse. The resulting revision is tagged
// source="pdf-markup" so it flows through the same RevisionReviewConsole
// approval path as Google Earth submissions but stays clearly attributable
// to a print sheet.
//
// This module has NO knowledge of the print-overlay data model — it takes
// generic geometry inputs. The caller (PrintOverlayStudio or any future
// consumer) is responsible for reading its own markup objects and projecting
// them to WGS84 using the existing `printGeoreference` transform.

import { api } from "../../lib/api.js";

export type PromotableGeometry =
  | {
      kind: "linestring";
      name: string;
      strokeStyle?: string;
      coordinates: Array<{ lat: number; lng: number }>;
      description?: string;
    }
  | {
      kind: "point";
      name: string;
      strokeStyle?: string;
      coordinates: { lat: number; lng: number };
      description?: string;
    };

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build a KML document from a batch of promotable geometries. Coordinates
 * are emitted as `lng,lat,0` per KML spec. Stroke style metadata is embedded
 * as ExtendedData so the server can round-trip it back to canonical
 * GeoFeatures. Descriptions are wrapped in CDATA for safety.
 */
export function buildKmlFromGeometries(
  jobId: string,
  documentId: string | undefined,
  sheetRegistrationId: string | undefined,
  geometries: PromotableGeometry[]
): string {
  if (geometries.length === 0) {
    throw new Error("buildKmlFromGeometries: at least one geometry required");
  }

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  parts.push("<Document>");
  parts.push(`<name>PDF Markup Promotion \u2014 ${xmlEscape(jobId)}</name>`);
  parts.push("<ExtendedData>");
  parts.push(`<Data name="nscSource"><value>pdf-markup</value></Data>`);
  if (documentId) parts.push(`<Data name="nscDocumentId"><value>${xmlEscape(documentId)}</value></Data>`);
  if (sheetRegistrationId) parts.push(`<Data name="nscSheetRegistrationId"><value>${xmlEscape(sheetRegistrationId)}</value></Data>`);
  parts.push("</ExtendedData>");

  for (let i = 0; i < geometries.length; i++) {
    const g = geometries[i]!;
    parts.push("<Placemark>");
    parts.push(`<name>${xmlEscape(g.name || `Feature ${i + 1}`)}</name>`);
    if (g.description) {
      parts.push(`<description><![CDATA[${g.description}]]></description>`);
    }
    parts.push("<ExtendedData>");
    if (g.strokeStyle) parts.push(`<Data name="nscStrokeStyle"><value>${xmlEscape(g.strokeStyle)}</value></Data>`);
    parts.push(`<Data name="nscLayerCode"><value>pdf_markup</value></Data>`);
    parts.push("</ExtendedData>");

    if (g.kind === "point") {
      const { lat, lng } = g.coordinates;
      parts.push("<Point>");
      parts.push(`<coordinates>${lng},${lat},0</coordinates>`);
      parts.push("</Point>");
    } else {
      parts.push("<LineString>");
      parts.push("<tessellate>1</tessellate>");
      const coords = g.coordinates.map((c) => `${c.lng},${c.lat},0`).join(" ");
      parts.push(`<coordinates>${coords}</coordinates>`);
      parts.push("</LineString>");
    }
    parts.push("</Placemark>");
  }

  parts.push("</Document>");
  parts.push("</kml>");
  return parts.join("\n");
}

/**
 * End-to-end helper: build KML from promotable geometries and POST it to the
 * print-overlay → Earth revision bridge. Returns the created revision doc
 * (lifecycle=pending_review, source="pdf-markup").
 */
export async function promoteMarkupToEarthRevision(
  jobId: string,
  args: {
    geometries: PromotableGeometry[];
    documentId?: string;
    sheetRegistrationId?: string;
  }
): Promise<{ revision: any }> {
  const kmlText = buildKmlFromGeometries(
    jobId,
    args.documentId,
    args.sheetRegistrationId,
    args.geometries
  );
  const result = await api.promotePrintOverlayToEarthRevision(jobId, {
    kmlText,
    documentId: args.documentId,
    sheetRegistrationId: args.sheetRegistrationId,
  });
  return { revision: result.revision };
}
