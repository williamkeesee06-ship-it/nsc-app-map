// DrawingOverlayLabels.ts
// ─────────────────────────────────────────────────────────────────────────────
// Billy 6/8: extracted from DrawingOverlay.tsx (#5 light split).
// Pure helpers for rendering the small black-on-white "atag" labels next to
// every active-job markup, the dashed callout leader lines, and the anti-
// collision placement logic. Behavior is identical to the previous in-file
// version — these are just lifted out so DrawingOverlay.tsx is easier to read.
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingObject } from "@nsc/types";

// ── Public types & constants ─────────────────────────────────────────────────

/** Every Google Maps overlay we render. */
export type OverlayRef =
  | google.maps.Polyline
  | google.maps.Polygon
  | google.maps.Rectangle
  | google.maps.Circle
  | google.maps.Marker;

/** Reference zoom for symbol scaling. */
export const ZOOM_REF = 17;

/** Hide all atag labels when zoomed out below this level. */
export const MIN_LABEL_ZOOM = 16;

import { getActiveContract } from "../workspace/contractStore.js";

// ── Label text resolution ────────────────────────────────────────────────────

/** Pick the best label text for any object — used at zoom ≥ MIN_LABEL_ZOOM.
 *  Single source of truth: ATAG/MH/callout/text — every label type funnels
 *  through here so the search index and the visible white-box label agree. */
export function labelTextForObj(obj: DrawingObject): string | null {
  if (obj.style.hidden) return null;
  // Text/callout tools store the user-typed string in `obj.text` — prefer that
  // so the label shown matches what the user typed when placing the callout.
  let text = "";
  if ("text" in obj && obj.text && obj.text.trim()) text = obj.text.trim();
  else if (obj.style.userLabel && obj.style.userLabel.trim()) text = obj.style.userLabel.trim();
  else if (obj.style.description && obj.style.description.trim()) text = obj.style.description.trim();
  
  if (text) {
    const contract = getActiveContract();
    const isPoleOrEquipment = obj.tool.includes("pole") || obj.tool.includes("hub") || obj.tool.includes("terminal");
    if (contract === "Ziply" && isPoleOrEquipment && /^a-/i.test(text)) {
      text = text.slice(2);
    }
  }
  return text || null;
}

// ── SVG label helpers ────────────────────────────────────────────────────────

function escSvg(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LABEL_CHAR_W = 8.5;
const LABEL_PAD = 14;
const LABEL_H = 26;

export function labelWidth(text: string): number {
  return Math.max(48, text.length * LABEL_CHAR_W + LABEL_PAD * 2);
}

/** Default metallic slate border used for ATAG/MH/text labels. Callout labels override
 *  this with the leader-line color so changing the callout color also recolors
 *  the text-box border. */
export const DEFAULT_LABEL_BORDER = "#94a3b8"; // sleek metallic slate

export function makeLabelSvg(text: string, borderColor: string = DEFAULT_LABEL_BORDER): string {
  const w = labelWidth(text);
  const h = LABEL_H;
  
  // Luxurious Light Mode & High-Tech Map Engineer Aesthetic
  // Deep cyan/neon accents on white pill, soft glowing shadow.
  // We use SVG filters to give it a polished, premium UI feel.
  const isCustom = borderColor !== DEFAULT_LABEL_BORDER;
  const strokeW = isCustom ? 2 : 1.5;
  const activeBorderColor = isCustom ? borderColor : "#cbd5e1";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 16}" height="${h + 16}">` +
    `<defs>` +
    `  <filter id="glow-${w}" x="-20%" y="-20%" width="140%" height="140%">` +
    `    <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.12"/>` +
    `  </filter>` +
    `</defs>` +
    // We shift X and Y by 8 to make room for the drop shadow blur
    `<rect x="8" y="8" width="${w}" height="${h}" rx="13" ry="13" fill="rgba(255, 255, 255, 0.96)" stroke="${escSvg(activeBorderColor)}" stroke-width="${strokeW}" filter="url(#glow-${w})"/>` +
    `<text x="${w / 2 + 8}" y="${h / 2 + 12}" text-anchor="middle" font-family="Inter, Roboto, system-ui, sans-serif" font-size="11.5" font-weight="700" letter-spacing="0.4" fill="#0f172a">${escSvg(text)}</text>` +
    `</svg>`
  );
}

// ── Anti-collision label placement ───────────────────────────────────────────

const OFFSET_DISTANCES = [30, 50, 70, 100];
const OFFSET_ANGLES_DEG = [0, -45, 45, 180, -135, 135, 270, 90];

function buildCandidateOffsets(): Array<{ dx: number; dy: number }> {
  const offsets: Array<{ dx: number; dy: number }> = [];
  for (const dist of OFFSET_DISTANCES) {
    for (const angleDeg of OFFSET_ANGLES_DEG) {
      const rad = (angleDeg * Math.PI) / 180;
      offsets.push({ dx: Math.round(dist * Math.cos(rad)), dy: Math.round(dist * Math.sin(rad)) });
    }
  }
  return offsets;
}

const CANDIDATE_OFFSETS = buildCandidateOffsets();

// ── Projection helpers ───────────────────────────────────────────────────────

export function pixelOffsetToLatLng(
  origin: google.maps.LatLngLiteral,
  dx: number,
  dy: number,
  map: google.maps.Map
): google.maps.LatLngLiteral | null {
  const proj = map.getProjection();
  if (!proj) return null;
  const zoom = map.getZoom() ?? ZOOM_REF;
  const scale = Math.pow(2, zoom);
  const originPt = proj.fromLatLngToPoint(new google.maps.LatLng(origin.lat, origin.lng));
  if (!originPt) return null;
  const targetPt = new google.maps.Point(originPt.x + dx / scale, originPt.y + dy / scale);
  const targetLatLng = proj.fromPointToLatLng(targetPt);
  if (!targetLatLng) return null;
  return { lat: targetLatLng.lat(), lng: targetLatLng.lng() };
}

function rectsOverlap(
  a: { dx: number; dy: number; w: number; h: number },
  b: { dx: number; dy: number; w: number; h: number },
  aOrigin: google.maps.LatLngLiteral,
  bOrigin: google.maps.LatLngLiteral,
  map: google.maps.Map
): boolean {
  const proj = map.getProjection();
  if (!proj) return false;
  const zoom = map.getZoom() ?? ZOOM_REF;
  const scale = Math.pow(2, zoom);
  const aPtWorld = proj.fromLatLngToPoint(new google.maps.LatLng(aOrigin.lat, aOrigin.lng));
  const bPtWorld = proj.fromLatLngToPoint(new google.maps.LatLng(bOrigin.lat, bOrigin.lng));
  if (!aPtWorld || !bPtWorld) return false;
  const aOriginPx = { x: aPtWorld.x * scale, y: aPtWorld.y * scale };
  const bOriginPx = { x: bPtWorld.x * scale, y: bPtWorld.y * scale };
  const aCx = aOriginPx.x + a.dx;
  const aCy = aOriginPx.y + a.dy;
  const bCx = bOriginPx.x + b.dx;
  const bCy = bOriginPx.y + b.dy;
  const aL = aCx - a.w / 2 - 2, aR = aCx + a.w / 2 + 2;
  const aT = aCy - a.h / 2 - 2, aB = aCy + a.h / 2 + 2;
  const bL = bCx - b.w / 2 - 2, bR = bCx + b.w / 2 + 2;
  const bT = bCy - b.h / 2 - 2, bB = bCy + b.h / 2 + 2;
  return !(aR < bL || bR < aL || aB < bT || bB < aT);
}

// ── Callout line ─────────────────────────────────────────────────────────────

const CALLOUT_COLOR = "#9aa3b0";
export const CALLOUT_MIN_OFFSET_PX = 20;

export function makeCalloutLine(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  map: google.maps.Map,
  zIndex: number,
  color?: string
): google.maps.Polyline {
  return new google.maps.Polyline({
    path: [from, to],
    strokeColor: color || CALLOUT_COLOR,
    strokeWeight: 1,
    strokeOpacity: 0.85,
    clickable: false,
    zIndex,
    map,
  });
}

// ── Label position helpers ───────────────────────────────────────────────────

export function midpointOfVertices(vertices: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  // Compute the true geometric midpoint along the polyline path (half total length).
  // For a 2-point line this is the exact midpoint between the two endpoints.
  // For multi-segment lines this is the point at 50% of cumulative arc length.
  if (vertices.length === 0) return { lat: 0, lng: 0 };
  if (vertices.length === 1) return vertices[0]!;
  if (vertices.length === 2) {
    return {
      lat: (vertices[0]!.lat + vertices[1]!.lat) / 2,
      lng: (vertices[0]!.lng + vertices[1]!.lng) / 2,
    };
  }
  // Multi-segment: find point at half total cumulative length.
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    const dLat = vertices[i + 1]!.lat - vertices[i]!.lat;
    const dLng = vertices[i + 1]!.lng - vertices[i]!.lng;
    const len = Math.sqrt(dLat * dLat + dLng * dLng);
    segLens.push(len);
    total += len;
  }
  if (total === 0) return vertices[0]!;
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    const next = acc + segLens[i]!;
    if (next >= half) {
      const t = (half - acc) / (segLens[i]! || 1);
      return {
        lat: vertices[i]!.lat + (vertices[i + 1]!.lat - vertices[i]!.lat) * t,
        lng: vertices[i]!.lng + (vertices[i + 1]!.lng - vertices[i]!.lng) * t,
      };
    }
    acc = next;
  }
  return vertices[vertices.length - 1]!;
}

function centerOfBounds(bounds: { n: number; s: number; e: number; w: number }): { lat: number; lng: number } {
  return { lat: (bounds.n + bounds.s) / 2, lng: (bounds.e + bounds.w) / 2 };
}

export function labelPositionForObj(obj: DrawingObject): { lat: number; lng: number } | null {
  if ("vertices" in obj) return midpointOfVertices(obj.vertices);
  if ("bounds" in obj) return centerOfBounds(obj.bounds);
  if ("position" in obj) return obj.position;
  return null;
}

// ── Label placement & rendering ──────────────────────────────────────────────

interface LabelEntry {
  objId: string;
  symbolLatLng: google.maps.LatLngLiteral;
  text: string;
  zIndex: number;
  /** Optional override for the label's box border + leader line color.
   *  Only callout objects set this — every other tool uses the neutral default. */
  borderColor?: string;
}

function computeLabelPlacements(
  entries: LabelEntry[],
  map: google.maps.Map
): Array<LabelEntry & { offsetDx: number; offsetDy: number }> {
  const placements: Array<LabelEntry & { offsetDx: number; offsetDy: number }> = [];
  const placed: Array<{ dx: number; dy: number; w: number; h: number; originLatLng: google.maps.LatLngLiteral }> = [];

  for (const entry of entries) {
    const w = labelWidth(entry.text);
    const h = LABEL_H;
    let chosenDx = CANDIDATE_OFFSETS[0]!.dx;
    let chosenDy = CANDIDATE_OFFSETS[0]!.dy;

    for (const cand of CANDIDATE_OFFSETS) {
      const candidate = { dx: cand.dx, dy: cand.dy, w, h };
      let collides = false;
      for (const p of placed) {
        if (rectsOverlap(candidate, p, entry.symbolLatLng, p.originLatLng, map)) {
          collides = true;
          break;
        }
      }
      if (!collides) {
        chosenDx = cand.dx;
        chosenDy = cand.dy;
        break;
      }
    }

    placed.push({ dx: chosenDx, dy: chosenDy, w, h, originLatLng: entry.symbolLatLng });
    placements.push({ ...entry, offsetDx: chosenDx, offsetDy: chosenDy });
  }

  return placements;
}

export function makeLabelMarkerAt(
  position: google.maps.LatLngLiteral,
  text: string,
  map: google.maps.Map,
  zIndex: number,
  onClick?: (screen: { x: number; y: number }) => void,
  borderColor?: string
): google.maps.Marker {
  const svg = makeLabelSvg(text, borderColor);
  const w = labelWidth(text);
  const h = LABEL_H;
  const marker = new google.maps.Marker({
    position,
    map,
    icon: {
      url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
      // We added 16px of padding to the SVG for the glow effect.
      // So the anchor X (left edge) shifts from 0 to 8, and Y shifts from h/2 to h/2 + 8.
      anchor: new google.maps.Point(8, h / 2 + 8),
      size: new google.maps.Size(w + 16, h + 16),
      scaledSize: new google.maps.Size(w + 16, h + 16),
    },
    // Labels are clickable when a handler is supplied so single-click on a
    // label opens the same editor as clicking the markup itself.
    clickable: !!onClick,
    zIndex: zIndex + 1,
    optimized: false,
  });
  if (onClick) {
    marker.addListener("click", (e: google.maps.MapMouseEvent) => {
      const dom = (e as unknown as { domEvent?: MouseEvent }).domEvent;
      const screen = dom
        ? { x: dom.clientX, y: dom.clientY }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      onClick(screen);
    });
  }
  return marker;
}

export function clearAllLabels(
  overlaysMap: globalThis.Map<string, OverlayRef>,
  calloutMap: globalThis.Map<string, google.maps.Polyline>
): void {
  const labelKeys: string[] = [];
  overlaysMap.forEach((_, key) => {
    if (key.endsWith("_label")) labelKeys.push(key);
  });
  for (const k of labelKeys) {
    const lbl = overlaysMap.get(k);
    if (lbl) lbl.setMap(null);
    overlaysMap.delete(k);
  }
  const calloutKeys: string[] = [];
  calloutMap.forEach((_, key) => calloutKeys.push(key));
  for (const k of calloutKeys) {
    const c = calloutMap.get(k);
    if (c) c.setMap(null);
    calloutMap.delete(k);
  }
}

export function rebuildAllLabels(
  map: google.maps.Map,
  objects: DrawingObject[],
  overlaysMap: globalThis.Map<string, OverlayRef>,
  calloutMap: globalThis.Map<string, google.maps.Polyline>,
  // Billy 6/8: per-object click handler so the label opens the same editor as
  // the markup itself. Passed as a resolver from the caller (active-job
  // overlay uses it to open the inline editor; AllJobsMarkupsOverlay uses it
  // to open the job card). The screen position lets the caller anchor a popup.
  onLabelClick?: (obj: DrawingObject, screen: { x: number; y: number }) => void
): void {
  // Zoom gate: hide all labels when zoomed out below threshold
  const curZoom = map.getZoom() ?? ZOOM_REF;
  if (curZoom < MIN_LABEL_ZOOM) {
    clearAllLabels(overlaysMap, calloutMap);
    return;
  }

  const entries: LabelEntry[] = [];
  for (const obj of objects) {
    // Every object type — ATAG, MH#, text, callout — funnels through the same
    // labelTextForObj() resolver so every label looks/behaves identically.
    // For text/callout the primary visual is JUST the leader line / hit-target;
    // the visible label text comes from this pass (anti-collision + white box).
    const text = labelTextForObj(obj);
    if (!text) continue;
    const pos = labelPositionForObj(obj);
    if (!pos) continue;
    // Callout text boxes mirror the leader line color so changing the stroke
    // in the markup panel updates the box outline AND the leader line.
    const borderColor = obj.tool === "callout" ? obj.style.strokeColor : undefined;
    entries.push({ objId: obj.id, symbolLatLng: pos, text, zIndex: 6, borderColor });
  }
  if (entries.length === 0) {
    clearAllLabels(overlaysMap, calloutMap);
    return;
  }

  const placements = computeLabelPlacements(entries, map);

  for (const p of placements) {
    const oldLbl = overlaysMap.get(p.objId + "_label");
    if (oldLbl) { oldLbl.setMap(null); overlaysMap.delete(p.objId + "_label"); }
    const oldCallout = calloutMap.get(p.objId + "_callout");
    if (oldCallout) { oldCallout.setMap(null); calloutMap.delete(p.objId + "_callout"); }

    const labelLatLng = pixelOffsetToLatLng(p.symbolLatLng, p.offsetDx, p.offsetDy, map);
    if (!labelLatLng) continue;

    const obj = objects.find((o) => o.id === p.objId);
    const handler =
      onLabelClick && obj ? (screen: { x: number; y: number }) => onLabelClick(obj, screen) : undefined;
    const lbl = makeLabelMarkerAt(labelLatLng, p.text, map, p.zIndex, handler, p.borderColor);
    overlaysMap.set(p.objId + "_label", lbl);

    const offsetMag = Math.sqrt(p.offsetDx ** 2 + p.offsetDy ** 2);
    if (offsetMag > CALLOUT_MIN_OFFSET_PX) {
      // Anti-collision leader (separate from the user-drawn callout leader):
      // also color it to match the box border so the visual is unified.
      calloutMap.set(
        p.objId + "_callout",
        makeCalloutLine(p.symbolLatLng, labelLatLng, map, p.zIndex - 1, p.borderColor)
      );
    }
  }
}
