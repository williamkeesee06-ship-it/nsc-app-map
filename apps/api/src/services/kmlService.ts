// KML feed for Google Earth companion bridge.
//
// This module is deliberately narrow and honest:
//   • generateJobNetworkLinkKml — root manifest Earth loads once.
//   • generateJobLayersKml       — dynamic layer feed Earth polls.
//   • signFeedToken / verifyFeedToken — HMAC-SHA256 signed feed URLs.
//   • xmlEscape / cssColorToKml   — small pure helpers.
//
// It never fabricates data. It preserves saved geometry, stroke color, stroke
// width, dash/dot style, opacity, and the neutral GeoFeature id (nscFeatureId)
// so the ingest side can round-trip a candidate revision back to the exact
// active feature. Google Earth cannot send Authorization headers on Network
// Link fetches, so we accept a signed HMAC token in the query string — the
// caller (route) verifies it before we ever generate a payload.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Job, DrawingObject } from "@nsc/types";
import { getEnv } from "../config/env.js";

// ─── XML safety ─────────────────────────────────────────────────────────────

const XML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escape XML text content. Never interpolate raw user data into the feed. */
export function xmlEscape(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input).replace(/[&<>"']/g, (c) => XML_ESCAPE_MAP[c] ?? c);
}

// ─── Color conversion ──────────────────────────────────────────────────────

/**
 * Convert CSS hex (#RRGGBB or #RGB) + opacity (0–1) to KML aabbggrr. Falls back
 * to a visible fiber cyan when input is malformed so a broken color can never
 * silently produce an invisible line.
 */
export function cssColorToKml(hex: string, opacity = 1.0): string {
  let clean = (hex || "#1ea7ff").replace("#", "").trim().toLowerCase();
  if (clean.length === 3) clean = clean.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/.test(clean)) clean = "1ea7ff";
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${a}${b}${g}${r}`;
}

// ─── Feed token (HMAC-SHA256) ──────────────────────────────────────────────

/**
 * Token payload: `${jobId}.${expiresAtMs}.${hmacHex}`. HMAC covers the first
 * two fields with EARTH_FEED_TOKEN_SECRET. Verification is constant-time.
 * Google Earth passes this in `?token=...`; no cookies, no bearer.
 */
export interface FeedTokenClaims {
  jobId: string;
  expiresAt: number;
}

function loadSecret(): string {
  const secret = getEnv().EARTH_FEED_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "[kmlService] EARTH_FEED_TOKEN_SECRET is missing or shorter than 32 chars. Refusing to sign or verify."
    );
  }
  return secret;
}

/** Sign a feed token good for `ttlMs` (default 30 days). */
export function signFeedToken(jobId: string, ttlMs = 30 * 24 * 60 * 60 * 1000): string {
  const expiresAt = Date.now() + ttlMs;
  const body = `${jobId}.${expiresAt}`;
  const mac = createHmac("sha256", loadSecret()).update(body).digest("hex");
  return `${body}.${mac}`;
}

/**
 * Verify a feed token. Returns claims on success, null on any failure
 * (malformed, expired, wrong job, bad signature). Never throws.
 */
export function verifyFeedToken(token: string, expectedJobId: string): FeedTokenClaims | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [jobId, expStr, macHex] = parts;
  if (!jobId || !expStr || !macHex) return null;
  if (jobId !== expectedJobId) return null;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  let expectedMac: Buffer;
  try {
    expectedMac = createHmac("sha256", loadSecret())
      .update(`${jobId}.${expiresAt}`)
      .digest();
  } catch {
    return null;
  }
  let providedMac: Buffer;
  try {
    providedMac = Buffer.from(macHex, "hex");
  } catch {
    return null;
  }
  if (providedMac.length !== expectedMac.length) return null;
  if (!timingSafeEqual(providedMac, expectedMac)) return null;

  return { jobId, expiresAt };
}

// ─── Network Link manifest ─────────────────────────────────────────────────

/**
 * Root Network Link manifest that Earth loads once. Points at the dynamic
 * layer feed with a pre-signed token embedded in the URL, so Earth's
 * refreshInterval fetches keep working without the user re-authenticating.
 */
export function generateJobNetworkLinkKml(job: Job, host: string, signedToken: string): string {
  const feedUrl =
    `https://${host}/api/earth/layers/${encodeURIComponent(job.jobId)}/all.kml` +
    `?token=${encodeURIComponent(signedToken)}`;

  const name = xmlEscape(job.displayName || `${job.workOrder} — Live`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>NSMS Live · ${name}</name>
    <open>1</open>
    <NetworkLink>
      <name>${name}</name>
      <open>1</open>
      <flyToView>1</flyToView>
      <Link>
        <href>${xmlEscape(feedUrl)}</href>
        <refreshMode>onInterval</refreshMode>
        <refreshInterval>60</refreshInterval>
        <viewRefreshMode>onStop</viewRefreshMode>
        <viewRefreshTime>2</viewRefreshTime>
      </Link>
    </NetworkLink>
  </Document>
</kml>`;
}

// ─── Layer feed ────────────────────────────────────────────────────────────

/** KML LineStyle <gx:outerColor>/<gx:physicalWidth> can't express dashes on
 *  their own — Earth honors the standard "-" segment in <coordinates> via
 *  <LineStyle><gx:labelVisibility>0</gx:labelVisibility>. But actual dash
 *  rendering in Earth Web is limited: we emit a hint in ExtendedData so any
 *  downstream renderer preserves the intent, and pick a reasonable width. */
function lineStyleXml(id: string, style: DrawingObject["style"]): string {
  const kmlColor = cssColorToKml(style?.strokeColor || "#06B6D4", style?.opacity ?? 0.9);
  const width = Math.max(1, Math.min(50, style?.strokeWidth ?? 3));
  return `
    <Style id="${xmlEscape(id)}">
      <LineStyle>
        <color>${kmlColor}</color>
        <width>${width}</width>
      </LineStyle>
      <PolyStyle>
        <color>${kmlColor}</color>
        <fill>0</fill>
        <outline>1</outline>
      </PolyStyle>
    </Style>`;
}

interface LayerBucket {
  code: "earth_design" | "asbuilt" | "pdf_markup" | "other";
  name: string;
  objects: DrawingObject[];
}

function classify(o: DrawingObject): LayerBucket["code"] {
  const source = (o.style as any)?.source as string | undefined;
  if (source === "pdf-markup") return "pdf_markup";
  if (source === "asbuilt") return "asbuilt";
  if (source === "google-earth" || source === "manual-map") return "earth_design";
  return "earth_design";
}

/**
 * Emit KML for one job. `layerCode` filters to a single bucket, "all" emits
 * every non-deleted bucket. Preserves saved geometry and style. Every
 * Placemark carries ExtendedData with nscJobId / nscJobNumber /
 * nscBuildReference / nscFeatureId / nscLayerCode / nscStrokeStyle so the
 * ingest side can match features by neutral id.
 */
export function generateJobLayersKml(
  job: Job,
  objects: DrawingObject[],
  layerCode: LayerBucket["code"] | "all" = "all"
): string {
  const active = objects.filter((o) => !o.style?.isDeleted);

  const buckets: Record<LayerBucket["code"], LayerBucket> = {
    earth_design: { code: "earth_design", name: "02 Earth Design", objects: [] },
    asbuilt:      { code: "asbuilt",      name: "05 As-Built",     objects: [] },
    pdf_markup:   { code: "pdf_markup",   name: "04 PDF Markup",   objects: [] },
    other:        { code: "other",        name: "99 Other",        objects: [] },
  };
  for (const o of active) buckets[classify(o)].objects.push(o);

  const wanted = layerCode === "all"
    ? (["earth_design", "asbuilt", "pdf_markup", "other"] as const)
    : ([layerCode] as const);

  const foldersXml: string[] = [];
  for (const code of wanted) {
    const bucket = buckets[code];
    if (bucket.objects.length === 0) continue;
    foldersXml.push(renderFolder(job, bucket));
  }

  const docName = xmlEscape(job.displayName || job.workOrder);
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${docName}</name>
    <open>1</open>
${foldersXml.join("\n")}
  </Document>
</kml>`;
}

function renderFolder(job: Job, bucket: LayerBucket): string {
  const placemarks: string[] = [];
  for (const obj of bucket.objects) {
    const anyObj = obj as any;
    if (Array.isArray(anyObj.vertices) && anyObj.vertices.length >= 2) {
      placemarks.push(renderLine(job, obj, bucket.code));
    } else if (anyObj.position && typeof anyObj.position.lat === "number") {
      placemarks.push(renderPoint(job, obj, bucket.code));
    }
  }
  return `    <Folder>
      <name>${xmlEscape(bucket.name)}</name>
      <open>1</open>
${placemarks.join("\n")}
    </Folder>`;
}

function extendedDataXml(job: Job, obj: DrawingObject, layerCode: string): string {
  const style = obj.style || ({} as any);
  const strokeStyle = style.strokeStyle || "solid";
  const footage = typeof style.footageOverride === "number"
    ? style.footageOverride
    : typeof style.calculatedFootage === "number"
    ? style.calculatedFootage
    : null;
  return `        <ExtendedData>
          <Data name="nscJobId"><value>${xmlEscape(job.jobId)}</value></Data>
          <Data name="nscJobNumber"><value>${xmlEscape(job.workOrder)}</value></Data>
          <Data name="nscBuildReference"><value>${xmlEscape(job.buildReference || "")}</value></Data>
          <Data name="nscFeatureId"><value>${xmlEscape(obj.id)}</value></Data>
          <Data name="nscLayerCode"><value>${xmlEscape(layerCode)}</value></Data>
          <Data name="nscStrokeStyle"><value>${xmlEscape(strokeStyle)}</value></Data>
          ${footage != null ? `<Data name="nscFootageFt"><value>${xmlEscape(String(footage))}</value></Data>` : ""}
        </ExtendedData>`;
}

function renderLine(job: Job, obj: DrawingObject, layerCode: string): string {
  const anyObj = obj as any;
  const style = obj.style || {};
  const name = xmlEscape(style.userLabel || anyObj.tool || "Cable Span");
  const coords = (anyObj.vertices as Array<{ lat: number; lng: number }>)
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng))
    .map((v) => `${v.lng},${v.lat},0`)
    .join(" ");
  if (!coords) return "";
  const styleId = `s_${obj.id}`;
  return `      <Placemark id="${xmlEscape(obj.id)}">
        <name>${name}</name>${lineStyleXml(styleId, style)}
        <styleUrl>#${xmlEscape(styleId)}</styleUrl>
${extendedDataXml(job, obj, layerCode)}
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coords}</coordinates>
        </LineString>
      </Placemark>`;
}

function renderPoint(job: Job, obj: DrawingObject, layerCode: string): string {
  const anyObj = obj as any;
  const style = obj.style || {};
  const name = xmlEscape(style.userLabel || anyObj.tool || "Point");
  const pos = anyObj.position as { lat: number; lng: number };
  if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return "";
  return `      <Placemark id="${xmlEscape(obj.id)}">
        <name>${name}</name>
${extendedDataXml(job, obj, layerCode)}
        <Point>
          <coordinates>${pos.lng},${pos.lat},0</coordinates>
        </Point>
      </Placemark>`;
}
