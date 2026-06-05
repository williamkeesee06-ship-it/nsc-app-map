// DrawingOverlay.tsx — React component that lives inside <Map>.
// Phase 4: cable PLACED = solid neon green, REMOVED = neon red + X marks.
// Phase 5.1: click-through when non-select tool active; details popup for all objects;
//            map-rendered userLabel next to point symbols + line midpoints + shape centers.
// Phase 5.3: zoom-scaled telecom symbols; label callout lines + anti-collision placement;
//            full re-edit on select click (editable/draggable + geometry sync);
//            ObjectDetailsCard for live editing.

import { useEffect, useRef, useState, useCallback } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { DrawingObject } from "@nsc/types";
import { useDrawing } from "./drawingContext.js";
import { DrawingEngine } from "./DrawingEngine.js";
import { iconForTool } from "./icons/telecomIcons.js";
import ObjectDetailsPopup from "./ObjectDetailsPopup.js";
import ObjectDetailsCard from "./ObjectDetailsCard.js";

const FEET_PER_METER = 3.28084;

// ── Cable line rendering ──────────────────────────────────────────────────────

const PLACED_COLOR  = "#39ff7a";
const REMOVED_COLOR = "#ff2d4a";

function styleToPolylineOpts(obj: DrawingObject & { vertices: unknown }): Partial<google.maps.PolylineOptions> {
  const tool = obj.tool as string;
  const style = obj.style;

  if (tool === "placed_cable") {
    return {
      strokeColor: PLACED_COLOR,
      strokeWeight: style.strokeWidth,
      strokeOpacity: style.opacity,
    };
  }

  if (tool === "removed_cable") {
    const xSymbol: google.maps.Symbol = {
      path: "M -1,-1 1,1 M -1,1 1,-1",
      strokeColor: REMOVED_COLOR,
      strokeWeight: Math.max(2, style.strokeWidth - 1),
      scale: Math.max(3, style.strokeWidth + 1),
    };
    return {
      strokeColor: REMOVED_COLOR,
      strokeWeight: style.strokeWidth,
      strokeOpacity: style.opacity,
      icons: [{ icon: xSymbol, offset: "0", repeat: "60px" }],
    };
  }

  return {
    strokeColor: style.strokeColor,
    strokeWeight: style.strokeWidth,
    strokeOpacity: style.opacity,
    icons:
      style.strokeStyle === "dashed"
        ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: style.strokeWidth }, offset: "0", repeat: "12px" }]
        : style.strokeStyle === "dotted"
        ? [{ icon: { path: "M 0,0 0,0.01", strokeOpacity: 1, scale: style.strokeWidth }, offset: "0", repeat: "6px" }]
        : undefined,
  };
}

function fillOpacity(style: DrawingObject["style"]): number {
  if (style.fill.kind === "none") return 0;
  // Hash uses a canvas overlay for the pattern; the polygon itself stays
  // nearly invisible so the diagonal lines aren’t washed out by a solid tint.
  if (style.fill.kind === "hash") return 0;
  return style.opacity * 0.35;
}

function fillColor(style: DrawingObject["style"]): string {
  if (style.fill.kind === "solid") return style.fill.color;
  if (style.fill.kind === "hash") return style.fill.color;
  return "transparent";
}

// ── Hatch fill overlay ───────────────────────────────────────────────────────
// Google Maps Polygons have no built-in pattern fills, so when the user picks
// “Hash” we paint a canvas overlay sized to the shape and stroke diagonal
// lines clipped to the polygon path. One HatchOverlay lives per hashed object
// and is rebuilt whenever the geometry or style changes.

interface HatchSpec {
  vertices: Array<{ lat: number; lng: number }>; // outline in lat/lng
  color: string;
  opacity: number;
  pattern: "diagonal" | "cross" | "dots";
  density: number; // pixels between stripes (smaller → denser)
  zIndex: number;
}

function createHatchOverlay(map: google.maps.Map, spec: HatchSpec) {
  class HatchView extends google.maps.OverlayView {
    public div: HTMLDivElement | null = null;
    public canvas: HTMLCanvasElement | null = null;
    public spec: HatchSpec = spec;

    onAdd() {
      const div = document.createElement("div");
      div.style.position = "absolute";
      div.style.pointerEvents = "none";
      const canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.left = "0";
      canvas.style.top = "0";
      div.appendChild(canvas);
      this.div = div;
      this.canvas = canvas;
      const panes = this.getPanes();
      panes?.overlayLayer.appendChild(div);
    }

    draw() {
      const proj = this.getProjection();
      if (!proj || !this.div || !this.canvas) return;
      const verts = this.spec.vertices;
      if (verts.length < 3) return;

      // Project all vertices to pixel coords; track bbox.
      const pts: Array<{ x: number; y: number }> = [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const v of verts) {
        const p = proj.fromLatLngToDivPixel(new google.maps.LatLng(v.lat, v.lng));
        if (!p) return;
        pts.push({ x: p.x, y: p.y });
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      // Pad so stroke isn’t clipped at the edge.
      const PAD = 2;
      const w = Math.max(1, Math.ceil(maxX - minX) + PAD * 2);
      const h = Math.max(1, Math.ceil(maxY - minY) + PAD * 2);
      this.div.style.left = `${Math.floor(minX) - PAD}px`;
      this.div.style.top = `${Math.floor(minY) - PAD}px`;
      this.div.style.width = `${w}px`;
      this.div.style.height = `${h}px`;
      this.div.style.zIndex = String(this.spec.zIndex);

      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;

      const ctx = this.canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Build polygon path in canvas-local coords.
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i].x - (Math.floor(minX) - PAD);
        const y = pts[i].y - (Math.floor(minY) - PAD);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.clip();

      // Draw diagonal stripes across a square that covers the whole bbox
      // regardless of orientation (use diagonal length).
      const diag = Math.ceil(Math.sqrt(w * w + h * h));
      const step = Math.max(2, this.spec.density);
      ctx.strokeStyle = this.spec.color;
      ctx.globalAlpha = Math.min(1, Math.max(0.15, this.spec.opacity));
      ctx.lineWidth = 1.25;

      // 45° stripes (top-left → bottom-right).
      ctx.beginPath();
      for (let d = -diag; d < diag * 2; d += step) {
        ctx.moveTo(d, 0);
        ctx.lineTo(d + diag, diag);
      }
      ctx.stroke();

      if (this.spec.pattern === "cross") {
        // 135° stripes for a cross-hatch.
        ctx.beginPath();
        for (let d = -diag; d < diag * 2; d += step) {
          ctx.moveTo(d, diag);
          ctx.lineTo(d + diag, 0);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    onRemove() {
      if (this.div?.parentNode) this.div.parentNode.removeChild(this.div);
      this.div = null;
      this.canvas = null;
    }

    update(next: HatchSpec) {
      this.spec = next;
      this.draw();
    }
  }

  const overlay = new HatchView();
  overlay.setMap(map);
  return overlay;
}

type HatchOverlay = ReturnType<typeof createHatchOverlay>;

function hatchSpecForObj(obj: DrawingObject, isSelected: boolean): HatchSpec | null {
  if (obj.style.hidden) return null;
  if (obj.style.fill.kind !== "hash") return null;
  const fill = obj.style.fill;
  let verts: Array<{ lat: number; lng: number }> | null = null;
  if ("vertices" in obj && obj.tool === "polygon") {
    verts = obj.vertices;
  } else if ("bounds" in obj && obj.tool === "rectangle") {
    const b = obj.bounds;
    verts = [
      { lat: b.n, lng: b.w },
      { lat: b.n, lng: b.e },
      { lat: b.s, lng: b.e },
      { lat: b.s, lng: b.w },
    ];
  } else if ("bounds" in obj && obj.tool === "circle") {
    // Approximate circle with 64 segments.
    const b = obj.bounds;
    const cLat = (b.n + b.s) / 2;
    const cLng = (b.e + b.w) / 2;
    const rLat = (b.n - b.s) / 2;
    const rLng = (b.e - b.w) / 2;
    const segs = 64;
    verts = [];
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      verts.push({ lat: cLat + rLat * Math.cos(t), lng: cLng + rLng * Math.sin(t) });
    }
  }
  if (!verts) return null;
  return {
    vertices: verts,
    color: fill.color,
    opacity: obj.style.opacity,
    pattern: fill.pattern,
    density: fill.density ?? 6,
    zIndex: isSelected ? 19 : 4,
  };
}

type OverlayRef =
  | google.maps.Polyline
  | google.maps.Polygon
  | google.maps.Rectangle
  | google.maps.Circle
  | google.maps.Marker;

function distanceFeet(vertices: Array<{ lat: number; lng: number }>): number {
  if (vertices.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < vertices.length; i++) {
    d += google.maps.geometry.spherical.computeDistanceBetween(
      new google.maps.LatLng(vertices[i - 1]!.lat, vertices[i - 1]!.lng),
      new google.maps.LatLng(vertices[i]!.lat, vertices[i]!.lng)
    );
  }
  return d * FEET_PER_METER;
}

// ── Point tool detection ──────────────────────────────────────────────────────

const POINT_TOOLS = new Set([
  "mh_new", "mh_removed",
  "hh_new", "hh_removed",
  "ped_new", "ped_removed",
  "pole_new", "pole_removed",
  "cabinet_new", "cabinet_removed",
  "anchor_new", "anchor_removed",
]);

function isPointTool(tool: string): boolean {
  return POINT_TOOLS.has(tool);
}

// ── Zoom-scaled symbol size ────────────────────────────────────────────────────

const ZOOM_REF = 17;
// Phase 9.5 -> 9.7: a-tags appear at zoom ≥16 instead of 18 so Billy can
// read pole labels at street level, not just rooftop level.
const MIN_LABEL_ZOOM = 16;
const BASE_SIZE = 24; // 24px at reference zoom 17 (down from 32 — less bloat)

// Smoother scaling with a tight 40px cap so pole icons don't dominate the map
// at high zoom. Min raised to 8px so they're still tappable at low zoom.
function computeSymbolPx(zoom: number, pointSize: number): number {
  // Half-octave scaling (×1.41 per zoom step) instead of doubling, so the
  // jump from zoom 17→18 is +40% rather than +100%. Feels proportional.
  const raw = BASE_SIZE * Math.pow(1.41, zoom - ZOOM_REF) * pointSize;
  return Math.round(Math.max(8, Math.min(40, raw)));
}

// Pick the best label text for any object — used at zoom ≥ MIN_LABEL_ZOOM.
//   - Points (MH/HH/Pole/Ped/Cab): style.userLabel (the tag the user typed)
//   - Lines/shapes/cables/freehand: style.description (the detail-popup field)
//   - Text tool: its own text
function labelTextForObj(obj: DrawingObject): string | null {
  if (obj.style.hidden) return null;
  if (obj.style.userLabel && obj.style.userLabel.trim()) return obj.style.userLabel.trim();
  if (obj.style.description && obj.style.description.trim()) return obj.style.description.trim();
  if ("text" in obj && obj.text && obj.text.trim()) return obj.text.trim();
  return null;
}

// ── SVG label helpers ─────────────────────────────────────────────────────────

function escSvg(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LABEL_CHAR_W = 7;
const LABEL_PAD = 10;
const LABEL_H = 18;

function labelWidth(text: string): number {
  return Math.max(36, text.length * LABEL_CHAR_W + LABEL_PAD * 2);
}

function makeLabelSvg(text: string): string {
  const w = labelWidth(text);
  const h = LABEL_H;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="4" ry="4" fill="white" stroke="#C8D0DA" stroke-width="1"/>` +
    `<text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" font-family="ui-monospace,Consolas,monospace" font-size="10" font-weight="bold" fill="#1A2332">${escSvg(text)}</text>` +
    `</svg>`
  );
}

// ── Anti-collision label placement ────────────────────────────────────────────

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

// ── Projection helpers ────────────────────────────────────────────────────────

function pixelOffsetToLatLng(
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

// ── Callout line ──────────────────────────────────────────────────────────────

const CALLOUT_COLOR = "#9aa3b0";
const CALLOUT_MIN_OFFSET_PX = 20;

function makeCalloutLine(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  map: google.maps.Map,
  zIndex: number
): google.maps.Polyline {
  return new google.maps.Polyline({
    path: [from, to],
    strokeColor: CALLOUT_COLOR,
    strokeWeight: 1,
    strokeOpacity: 0.85,
    clickable: false,
    zIndex,
    map,
  });
}

// ── Label position helpers ────────────────────────────────────────────────────

function midpointOfVertices(vertices: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
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

function labelPositionForObj(obj: DrawingObject): { lat: number; lng: number } | null {
  if ("vertices" in obj) return midpointOfVertices(obj.vertices);
  if ("bounds" in obj) return centerOfBounds(obj.bounds);
  if ("position" in obj) return obj.position;
  return null;
}

// ── Label placement ───────────────────────────────────────────────────────────

interface LabelEntry {
  objId: string;
  symbolLatLng: google.maps.LatLngLiteral;
  text: string;
  zIndex: number;
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

function makeLabelMarkerAt(
  position: google.maps.LatLngLiteral,
  text: string,
  map: google.maps.Map,
  zIndex: number
): google.maps.Marker {
  const svg = makeLabelSvg(text);
  const w = labelWidth(text);
  const h = LABEL_H;
  return new google.maps.Marker({
    position,
    map,
    icon: {
      url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
      anchor: new google.maps.Point(0, h / 2),
      size: new google.maps.Size(w, h),
      scaledSize: new google.maps.Size(w, h),
    },
    clickable: false,
    zIndex: zIndex + 1,
    optimized: false,
  });
}

function clearAllLabels(
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

function rebuildAllLabels(
  map: google.maps.Map,
  objects: DrawingObject[],
  overlaysMap: globalThis.Map<string, OverlayRef>,
  calloutMap: globalThis.Map<string, google.maps.Polyline>
): void {
  // Zoom gate: hide all labels when zoomed out below threshold
  const curZoom = map.getZoom() ?? ZOOM_REF;
  if (curZoom < MIN_LABEL_ZOOM) {
    clearAllLabels(overlaysMap, calloutMap);
    return;
  }

  const entries: LabelEntry[] = [];
  for (const obj of objects) {
    // Text tool already renders its own text as the primary visual — don't
    // double-render it as a separate label marker.
    if (obj.tool === "text" || obj.tool === "callout") continue;
    const text = labelTextForObj(obj);
    if (!text) continue;
    const pos = labelPositionForObj(obj);
    if (!pos) continue;
    entries.push({ objId: obj.id, symbolLatLng: pos, text, zIndex: 6 });
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

    const lbl = makeLabelMarkerAt(labelLatLng, p.text, map, p.zIndex);
    overlaysMap.set(p.objId + "_label", lbl);

    const offsetMag = Math.sqrt(p.offsetDx ** 2 + p.offsetDy ** 2);
    if (offsetMag > CALLOUT_MIN_OFFSET_PX) {
      calloutMap.set(p.objId + "_callout", makeCalloutLine(p.symbolLatLng, labelLatLng, map, p.zIndex - 1));
    }
  }
}

// ── Screen position for card anchor ──────────────────────────────────────────

function latLngToScreenPos(
  latLng: google.maps.LatLngLiteral,
  map: google.maps.Map
): { x: number; y: number } | null {
  const proj = map.getProjection();
  if (!proj) return null;
  const zoom = map.getZoom() ?? ZOOM_REF;
  const scale = Math.pow(2, zoom);
  const pt = proj.fromLatLngToPoint(new google.maps.LatLng(latLng.lat, latLng.lng));
  if (!pt) return null;
  const mapBounds = map.getBounds();
  if (!mapBounds) return null;
  const mapDiv = map.getDiv();
  const rect = mapDiv.getBoundingClientRect();
  const nePt = proj.fromLatLngToPoint(mapBounds.getNorthEast());
  const swPt = proj.fromLatLngToPoint(mapBounds.getSouthWest());
  if (!nePt || !swPt) return null;
  const mapWidthWorld = (nePt.x - swPt.x) * scale;
  const mapHeightWorld = (swPt.y - nePt.y) * scale;
  // Fraction across the map div
  const fracX = ((pt.x - swPt.x) * scale) / mapWidthWorld;
  const fracY = ((pt.y - nePt.y) * scale) / mapHeightWorld;
  return {
    x: rect.left + fracX * rect.width,
    y: rect.top + fracY * rect.height,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DrawingOverlay() {
  const map = useMap();
  const { state, addObject, updateObject, updateObjectGeometry, updateObjectPosition, deleteSelected, deleteObjects, select, clearSelection, undo, redo, patchObjectStyle, setTool } =
    useDrawing();
  const engineRef = useRef<DrawingEngine | null>(null);
  const overlaysRef = useRef<globalThis.Map<string, OverlayRef>>(new globalThis.Map());
  const measureInfoRef = useRef<globalThis.Map<string, google.maps.InfoWindow>>(new globalThis.Map());
  const labelVersionRef = useRef<globalThis.Map<string, string | undefined>>(new globalThis.Map());
  const calloutLinesRef = useRef<globalThis.Map<string, google.maps.Polyline>>(new globalThis.Map());
  // Hatch-fill overlays keyed by object id (one per hashed polygon/rect/circle).
  const hatchRef = useRef<globalThis.Map<string, HatchOverlay>>(new globalThis.Map());

  // Track selection click listeners so we can reliably attach them when entering Select mode
  const selectionListenersRef = useRef<globalThis.Map<string, google.maps.MapsEventListener>>(new globalThis.Map());

  // Phase 5.1: pending object waiting for the placement popup
  const [pendingObject, setPendingObject] = useState<{
    obj: DrawingObject;
    screenPos: { x: number; y: number };
  } | null>(null);

  // Phase 5.3: selected card state (for ObjectDetailsCard)
  const [cardObj, setCardObj] = useState<DrawingObject | null>(null);
  const [cardAnchor, setCardAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Stable ref to cardObj for event listeners
  const cardObjRef = useRef<DrawingObject | null>(null);
  cardObjRef.current = cardObj;

  // Keep card object in sync with state (live style updates flow through)
  useEffect(() => {
    if (!cardObj) return;
    const live = state.objects.find((o) => o.id === cardObj.id);
    if (!live) { setCardObj(null); return; }
    setCardObj(live);
  }, [state.objects, cardObj?.id]);

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === "Escape") {
        if (pendingObject) return;
        if (cardObj) { setCardObj(null); clearSelection(); return; }
        engineRef.current?.cancel();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, undo, redo, pendingObject, cardObj, clearSelection]);

  // Stable ref so engine can call back into live object list for snap
  const objectsForSnapRef = useRef<DrawingObject[]>([]);
  objectsForSnapRef.current = state.objects;

  // ─── Activate / deactivate drawing engine ────────────────────────────────
  useEffect(() => {
    if (!map) return;
    if (!engineRef.current) {
      engineRef.current = new DrawingEngine(map, addObject);
    }
    const engine = engineRef.current;

    // Auto-save rule: every markup commits to state the instant it's placed.
    // The drawing context syncs state to Firestore (asbuilt for a job, scratchpad
    // otherwise) on a 250ms debounce, so nothing is ever stuck in local pending
    // state. Popup is bypassed entirely.
    engine.instantCommit = true;

    engine.onPendingObject = (obj, screenPos) => {
      // Defensive fallback in case instantCommit is ever turned off in the future.
      setPendingObject({ obj, screenPos });
    };

    // Phase 9: provide live snap targets (Pole / MH / HH / PED point objects)
    engine.getSnapTargets = () => {
      const out: Array<{ id: string; lat: number; lng: number }> = [];
      for (const o of objectsForSnapRef.current) {
        if (
          o.tool !== "pole_new" && o.tool !== "pole_removed" &&
          o.tool !== "mh_new" && o.tool !== "mh_removed" &&
          o.tool !== "hh_new" && o.tool !== "hh_removed" &&
          o.tool !== "ped_new" && o.tool !== "ped_removed"
        ) continue;
        if (!("position" in o)) continue;
        out.push({ id: o.id, lat: o.position.lat, lng: o.position.lng });
      }
      return out;
    };

    if (state.activeTool && state.activeTool !== "select") {
      engine.activate(state.activeTool, state.style);
    } else {
      engine.deactivate();
    }
  }, [map, state.activeTool, state.style, addObject]);

  // ─── clickable state per active tool ───────────────────────────────────
  useEffect(() => {
    if (!map) return;
    // Finished overlays stay clickable in every tool so the user can re-select
    // and edit them. The click handler switches back to Select automatically.
    overlaysRef.current.forEach((overlay, key) => {
      if (key.endsWith("_label")) return;
      overlay.setOptions({ clickable: true });
    });
  }, [map, state.activeTool]);



  // ─── Phase 5.3: zoom_changed → rescale symbols + re-place labels ─────────
  useEffect(() => {
    if (!map) return;

    function handleZoomChange() {
      const zoom = map!.getZoom() ?? ZOOM_REF;
      state.objects.forEach((obj) => {
        if (!isPointTool(obj.tool) || obj.style.hidden) return;
        const marker = overlaysRef.current.get(obj.id);
        if (!(marker instanceof google.maps.Marker)) return;
        const pointSize = obj.style.pointSize ?? 1.0;
        const px = computeSymbolPx(zoom, pointSize);
        const icon = iconForTool(obj.tool, obj.style.strokeColor, pointSize);
        marker.setIcon({
          ...icon,
          size: new google.maps.Size(px, px),
          scaledSize: new google.maps.Size(px, px),
          anchor: new google.maps.Point(px / 2, px / 2),
        });
      });
      rebuildAllLabels(map!, state.objects, overlaysRef.current, calloutLinesRef.current);
    }

    const listener = map.addListener("zoom_changed", handleZoomChange);
    return () => listener.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, state.objects]);

  // ─── Phase 5.3: editable/draggable state for selected objects ────────────
  // We attach path mutation listeners here, keyed by objId.
  const geoListenersRef = useRef<globalThis.Map<string, google.maps.MapsEventListener[]>>(new globalThis.Map());

  const attachGeoListeners = useCallback((
    objId: string,
    overlay: OverlayRef,
  ) => {
    // Remove existing listeners first
    const existing = geoListenersRef.current.get(objId);
    if (existing) {
      existing.forEach((l) => l.remove());
    }
    const listeners: google.maps.MapsEventListener[] = [];

    if (overlay instanceof google.maps.Polyline || overlay instanceof google.maps.Polygon) {
      const path = overlay.getPath();
      function syncPath() {
        const verts: Array<{ lat: number; lng: number }> = [];
        path.forEach((latlng) => verts.push({ lat: latlng.lat(), lng: latlng.lng() }));
        updateObjectGeometry(objId, verts);
      }
      listeners.push(
        google.maps.event.addListener(path, "set_at", syncPath),
        google.maps.event.addListener(path, "insert_at", syncPath),
        google.maps.event.addListener(path, "remove_at", syncPath),
        overlay.addListener("dragend", syncPath)
      );
    } else if (overlay instanceof google.maps.Marker) {
      listeners.push(
        overlay.addListener("dragend", () => {
          const pos = overlay.getPosition();
          if (pos) updateObjectPosition(objId, { lat: pos.lat(), lng: pos.lng() });
        })
      );
    } else if (overlay instanceof google.maps.Rectangle) {
      listeners.push(
        overlay.addListener("bounds_changed", () => {
          // Rectangle bounds change handled via drag; we don't need vertex sync
        }),
        overlay.addListener("dragend", () => {
          const b = overlay.getBounds();
          if (!b) return;
          // Dispatch as UPDATE_OBJECT with new bounds
          const obj = state.objects.find((o) => o.id === objId);
          if (!obj || !("bounds" in obj)) return;
          const ne = b.getNorthEast(), sw = b.getSouthWest();
          updateObject({
            ...obj,
            bounds: { n: ne.lat(), s: sw.lat(), e: ne.lng(), w: sw.lng() },
          });
        })
      );
    } else if (overlay instanceof google.maps.Circle) {
      listeners.push(
        overlay.addListener("dragend", () => {
          const c = overlay.getCenter();
          const r = overlay.getRadius();
          if (!c) return;
          const obj = state.objects.find((o) => o.id === objId);
          if (!obj || !("bounds" in obj)) return;
          const latDelta = r / 111320;
          const lngDelta = r / (111320 * Math.cos((c.lat() * Math.PI) / 180));
          updateObject({
            ...obj,
            bounds: {
              n: c.lat() + latDelta,
              s: c.lat() - latDelta,
              e: c.lng() + lngDelta,
              w: c.lng() - lngDelta,
            },
          });
        })
      );
    }

    geoListenersRef.current.set(objId, listeners);
  }, [updateObjectGeometry, updateObjectPosition, updateObject, state.objects]);

  function removeGeoListeners(objId: string) {
    const existing = geoListenersRef.current.get(objId);
    if (existing) {
      existing.forEach((l) => l.remove());
      geoListenersRef.current.delete(objId);
    }
  }

  // ─── Render objects ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;

    const isSelectTool = state.activeTool === "select" || state.activeTool === null;
    // Finished overlays are always clickable so the user can re-select / edit
    // them without first having to switch back to the Select tool. The click
    // handler below will switch tools automatically when needed.
    const isClickable = true;
    const currentIds = new Set(state.objects.map((o) => o.id));
    const renderedIds = new Set(overlaysRef.current.keys());

    // Remove deleted overlays
    renderedIds.forEach((id) => {
      if (id.endsWith("_label")) return;
      if (!currentIds.has(id)) {
        overlaysRef.current.get(id)?.setMap(null);
        overlaysRef.current.delete(id);
        const lbl = overlaysRef.current.get(id + "_label");
        if (lbl) { lbl.setMap(null); overlaysRef.current.delete(id + "_label"); }
        const callout = calloutLinesRef.current.get(id + "_callout");
        if (callout) { callout.setMap(null); calloutLinesRef.current.delete(id + "_callout"); }
        const iw = measureInfoRef.current.get(id);
        if (iw) { iw.close(); measureInfoRef.current.delete(id); }
        labelVersionRef.current.delete(id);
        removeGeoListeners(id);
      }
    });

    const zoom = map.getZoom() ?? ZOOM_REF;

    // Add/update overlays
    state.objects.forEach((obj) => {
      if (obj.style.hidden) {
        const prev = overlaysRef.current.get(obj.id);
        if (prev) { prev.setMap(null); overlaysRef.current.delete(obj.id); }
        const prevLbl = overlaysRef.current.get(obj.id + "_label");
        if (prevLbl) { prevLbl.setMap(null); overlaysRef.current.delete(obj.id + "_label"); }
        const prevCallout = calloutLinesRef.current.get(obj.id + "_callout");
        if (prevCallout) { prevCallout.setMap(null); calloutLinesRef.current.delete(obj.id + "_callout"); }
        removeGeoListeners(obj.id);

        // Remove selection listener if present
        const selListener = selectionListenersRef.current.get(obj.id);
        if (selListener) {
          selListener.remove();
          selectionListenersRef.current.delete(obj.id);
        }
        return;
      }

      const isSelected = state.selectedIds.has(obj.id);
      const isEditable = isSelected && isSelectTool;
      const existing = overlaysRef.current.get(obj.id);

      if (existing) {
        if (existing instanceof google.maps.Polyline || existing instanceof google.maps.Polygon) {
          // Update stroke options
          const opts = "tool" in obj && "vertices" in obj
            ? styleToPolylineOpts(obj as typeof obj & { vertices: unknown })
            : {};
          // Selected lines/polygons are ALWAYS editable + draggable so the user
          // can reshape them right after clicking, regardless of what tool was
          // active before. The geometry listeners below sync changes back.
          const allowEdit = isSelected && !obj.style.locked;
          existing.setOptions({
            ...opts,
            strokeOpacity: isSelected ? 1 : obj.style.opacity,
            strokeWeight: isSelected ? Math.max(obj.style.strokeWidth + 1.5, 3) : obj.style.strokeWidth,
            zIndex: isSelected ? 20 : 5,
            clickable: isClickable,
            editable: allowEdit,
            draggable: allowEdit,
          });
          if (allowEdit) {
            attachGeoListeners(obj.id, existing);
          } else {
            removeGeoListeners(obj.id);
          }
        } else if (existing instanceof google.maps.Rectangle || existing instanceof google.maps.Circle) {
          existing.setOptions({
            strokeColor: isSelected ? "#3aa7ff" : obj.style.strokeColor,
            strokeWeight: isSelected ? Math.max(obj.style.strokeWidth + 2, 4) : obj.style.strokeWidth,
            strokeOpacity: isSelected ? 1 : obj.style.opacity,
            fillColor: fillColor(obj.style),
            fillOpacity: isSelected ? Math.min(fillOpacity(obj.style) + 0.15, 0.6) : fillOpacity(obj.style),
            zIndex: isSelected ? 20 : 5,
            clickable: isClickable,
            editable: isEditable,
            draggable: isEditable,
          });
        } else if (existing instanceof google.maps.Marker) {
          existing.setOptions({
            zIndex: isSelected ? 20 : 5,
            clickable: isClickable,
            draggable: isEditable,
            // Make selected points more prominent (neon ring effect via icon scaling)
            icon: isSelected ? {
              ...iconForTool(obj.tool, "#3aa7ff", (obj.style.pointSize ?? 1) * 1.15),
            } : undefined,
          });
          // Rescale point symbols
          if (isPointTool(obj.tool)) {
            const pointSize = obj.style.pointSize ?? 1.0;
            const px = computeSymbolPx(zoom, pointSize);
            const icon = iconForTool(obj.tool, obj.style.strokeColor, pointSize);
            existing.setIcon({
              ...icon,
              size: new google.maps.Size(px, px),
              scaledSize: new google.maps.Size(px, px),
              anchor: new google.maps.Point(px / 2, px / 2),
            });
          }
        }

        // Attach / detach geometry listeners based on editable state (points/shapes;
        // Polylines/Polygons handled in their own branch above).
        if (!(existing instanceof google.maps.Polyline) && !(existing instanceof google.maps.Polygon)) {
          if (isEditable) {
            attachGeoListeners(obj.id, existing);
          } else {
            removeGeoListeners(obj.id);
          }
        }

        // Make sure selection click listener is present when in Select tool
        if (isSelectTool && !selectionListenersRef.current.has(obj.id)) {
          const selListener = existing.addListener("click", (e: google.maps.MapMouseEvent) => {
            const domEvent = (e as any).domEvent as MouseEvent | undefined;
            const pos = domEvent ? { x: domEvent.clientX, y: domEvent.clientY } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            const additive = domEvent?.shiftKey ?? false;

            select([obj.id], additive);

            const live = state.objects.find((o) => o.id === obj.id);
            if (live) {
              setCardObj(live);
              setCardAnchor(pos);
            }

            if (state.activeTool !== "select") {
              setTool("select");
            }
          });
          selectionListenersRef.current.set(obj.id, selListener);
        }

        // Update label marker if the displayed label changed (any source).
        const lastLabel = labelVersionRef.current.get(obj.id);
        const currentLabel = labelTextForObj(obj) ?? undefined;
        if (lastLabel !== currentLabel) {
          const oldLbl = overlaysRef.current.get(obj.id + "_label");
          if (oldLbl) { oldLbl.setMap(null); overlaysRef.current.delete(obj.id + "_label"); }
          const oldCallout = calloutLinesRef.current.get(obj.id + "_callout");
          if (oldCallout) { oldCallout.setMap(null); calloutLinesRef.current.delete(obj.id + "_callout"); }
          labelVersionRef.current.set(obj.id, currentLabel);
        }
        return;
      }

      // Create new overlay
      const overlay = createOverlay(obj, map, isSelected, isClickable, zoom, (id, additive, clickPos) => {
        // Eraser mode: delete the clicked object
        if (state.activeTool === "eraser") {
          deleteObjects([id]);
          return;
        }

        // If user clicks an object while a drawing tool is active, switch back
        // to Select so they can re-edit the shape (drag vertices, move it, etc).
        if (!isSelectTool) {
          setTool("select");
        }
        select([id], additive);
        const live = state.objects.find((o) => o.id === id);
        if (live) {
          setCardObj(live);
          setCardAnchor(clickPos);
        }
      });
      if (overlay) {
        overlaysRef.current.set(obj.id, overlay);
        if (isEditable) {
          attachGeoListeners(obj.id, overlay);
        }
      }

      // Special Callout rendering: draw leader polyline through optional bend
      // points, with an arrowhead pointing at the anchor (the "tip").
      //   path order on screen:  text-box position → bends (reversed) → anchor (tip)
      // We put the arrow on the LAST vertex of the polyline so the head sits on
      // the anchor (arrow points at the thing you're calling out).
      if (obj.tool === "callout" && "anchor" in obj) {
        const anchor = (obj as any).anchor as { lat: number; lng: number };
        const textPos = "position" in obj ? (obj as any).position : anchor;
        const bends: Array<{ lat: number; lng: number }> =
          ("path" in obj && Array.isArray((obj as any).path)) ? (obj as any).path : [];

        // Draw from text-box → bends (reversed) → anchor so the arrowhead
        // ends up at the anchor.
        const polylinePath = [textPos, ...[...bends].reverse(), anchor];

        const leaderKey = obj.id + "_callout_leader";
        let leader = overlaysRef.current.get(leaderKey) as google.maps.Polyline | undefined;

        const arrowSymbol: google.maps.IconSequence = {
          icon: {
            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 3.5,
            strokeColor: obj.style.strokeColor || "#3aa7ff",
            fillColor: obj.style.strokeColor || "#3aa7ff",
            fillOpacity: 1,
          },
          offset: "100%",
        };

        if (!leader) {
          leader = new google.maps.Polyline({
            path: polylinePath,
            strokeColor: obj.style.strokeColor || "#3aa7ff",
            strokeWeight: (obj.style.strokeWidth || 2) + (isSelected ? 1 : 0),
            strokeOpacity: obj.style.opacity ?? 0.9,
            icons: [arrowSymbol],
            map,
            zIndex: isSelected ? 18 : 4,
          });
          overlaysRef.current.set(leaderKey, leader);
        } else {
          leader.setPath(polylinePath);
          leader.setOptions({
            strokeWeight: (obj.style.strokeWidth || 2) + (isSelected ? 1 : 0),
            icons: [arrowSymbol],
            zIndex: isSelected ? 18 : 4,
          });
        }
      }

      // Create label marker (only when zoomed in close enough). Use whatever
      // label source the object has — userLabel / description / text.
      const labelText = labelTextForObj(obj);
      if (labelText && zoom >= MIN_LABEL_ZOOM) {
        const pos = labelPositionForObj(obj);
        if (pos) {
          // Line-like tools (cables, lines, freehand, measure) want the label
          // sitting ON the midpoint of the line, no pixel offset and no leader.
          const isLineLike =
            obj.tool === "placed_cable" ||
            obj.tool === "removed_cable" ||
            obj.tool === "line" ||
            obj.tool === "freehand" ||
            obj.tool === "measure";
          const labelLatLng = isLineLike ? pos : pixelOffsetToLatLng(pos, 30, 0, map);
          if (labelLatLng) {
            const lbl = makeLabelMarkerAt(labelLatLng, labelText, map, 6);
            overlaysRef.current.set(obj.id + "_label", lbl);
            if (!isLineLike) {
              const offsetMag = Math.sqrt(30 ** 2);
              if (offsetMag > CALLOUT_MIN_OFFSET_PX) {
                calloutLinesRef.current.set(obj.id + "_callout", makeCalloutLine(pos, labelLatLng, map, 5));
              }
            }
          }
        }
      }
      labelVersionRef.current.set(obj.id, labelText ?? undefined);

      // Measure distance label
      if (obj.tool === "measure" && "vertices" in obj) {
        const ft = distanceFeet(obj.vertices);
        const mid = midpointOfVertices(obj.vertices);
        if (mid) {
          const iw = new google.maps.InfoWindow({
            content: `<div style="color:#1A2332;background:#fff;padding:4px 8px;border-radius:4px;font-size:12px;font-family:monospace;border:1px solid #C8D0DA;">${ft.toFixed(0)} ft</div>`,
            position: new google.maps.LatLng(mid.lat, mid.lng),
            disableAutoPan: true,
          });
          iw.open(map);
          measureInfoRef.current.set(obj.id, iw);
        }
      }
    });

    // Full label anti-collision pass
    rebuildAllLabels(map, state.objects, overlaysRef.current, calloutLinesRef.current);

    // ── Hatch fill sync ────────────────────────────────────────────────
    // Add/update hatch overlays for hashed polygons, remove any whose object
    // is gone or whose fill changed back to solid/none.
    const wantHatchIds = new Set<string>();
    state.objects.forEach((obj) => {
      const spec = hatchSpecForObj(obj, state.selectedIds.has(obj.id));
      if (!spec) return;
      wantHatchIds.add(obj.id);
      const existing = hatchRef.current.get(obj.id);
      if (existing) {
        existing.update(spec);
      } else {
        hatchRef.current.set(obj.id, createHatchOverlay(map, spec));
      }
    });
    hatchRef.current.forEach((ov, id) => {
      if (!wantHatchIds.has(id)) {
        ov.setMap(null);
        hatchRef.current.delete(id);
      }
    });

    return () => {
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current.clear();
      calloutLinesRef.current.forEach((l) => l.setMap(null));
      calloutLinesRef.current.clear();
      measureInfoRef.current.forEach((iw) => iw.close());
      measureInfoRef.current.clear();

      // Clean up selection listeners
      selectionListenersRef.current.forEach((l) => l.remove());
      selectionListenersRef.current.clear();
      labelVersionRef.current.clear();
      geoListenersRef.current.forEach((ls) => ls.forEach((l) => l.remove()));
      geoListenersRef.current.clear();
      hatchRef.current.forEach((o) => o.setMap(null));
      hatchRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, state.objects, state.selectedIds, state.activeTool]);

  // Dedicated effect: ensure selection click listeners exist on all overlays when in Select mode.
  // This is the main fix for "clicking existing markups does nothing".
  useEffect(() => {
    const isSelectTool = state.activeTool === "select" || state.activeTool === null;
    if (!isSelectTool || !map) {
      // Clean up if we leave select mode
      selectionListenersRef.current.forEach((l) => l.remove());
      selectionListenersRef.current.clear();
      return;
    }

    overlaysRef.current.forEach((overlay, key) => {
      if (key.endsWith("_label") || key.includes("_leader") || key.includes("_callout")) return;
      if (selectionListenersRef.current.has(key)) return;

      const listener = overlay.addListener("click", (e: google.maps.MapMouseEvent) => {
        const domEvent = (e as any).domEvent as MouseEvent | undefined;
        const pos = domEvent 
          ? { x: domEvent.clientX, y: domEvent.clientY } 
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 };

        const objId = key.split("_")[0];
        const additive = domEvent?.shiftKey ?? false;

        select([objId], additive);

        const live = state.objects.find((o) => o.id === objId);
        if (live) {
          setCardObj(live);
          setCardAnchor(pos);
        }

        if (state.activeTool !== "select") {
          setTool("select");
        }
      });

      selectionListenersRef.current.set(key, listener);
    });
  }, [state.activeTool, state.objects, map, select, setCardObj, setCardAnchor, setTool]);

  // Click on map background → clear selection + close card
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", () => {
      if (state.activeTool === "select" || state.activeTool === null) {
        clearSelection();
        setCardObj(null);
      }
    });
    return () => listener.remove();
  }, [map, state.activeTool, clearSelection]);

  // ─── Details popup save/cancel ────────────────────────────────────────────

  function handlePopupSave(label: string, description: string) {
    if (!pendingObject) return;
    const { obj } = pendingObject;
    let finalObj: DrawingObject;
    if (obj.tool === "text" || obj.tool === "callout") {
      finalObj = {
        ...obj,
        text: label || "",
        style: { ...obj.style, userLabel: label || undefined, description: description || undefined },
      };
    } else {
      finalObj = {
        ...obj,
        style: { ...obj.style, userLabel: label || undefined, description: description || undefined },
      };
    }
    addObject(finalObj);
    setPendingObject(null);
  }

  function handlePopupCancel() {
    setPendingObject(null);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {pendingObject && (
        <ObjectDetailsPopup
          screenPos={pendingObject.screenPos}
          tool={pendingObject.obj.tool}
          onSave={handlePopupSave}
          onCancel={handlePopupCancel}
        />
      )}
      {cardObj && (
        <ObjectDetailsCard
          obj={cardObj}
          anchorPos={cardAnchor}
          onClose={() => { setCardObj(null); clearSelection(); }}
        />
      )}
    </>
  );
}

// ─── Overlay factory ──────────────────────────────────────────────────────────

function createOverlay(
  obj: DrawingObject,
  map: google.maps.Map,
  isSelected: boolean,
  isClickable: boolean,
  zoom: number,
  onSelect: (id: string, additive: boolean, clickPos: { x: number; y: number }) => void
): OverlayRef | null {
  const z = isSelected ? 20 : 5;

  function getClickPos(e: google.maps.MapMouseEvent): { x: number; y: number } {
    const domEvent = (e as google.maps.MapMouseEvent).domEvent as MouseEvent | undefined;
    if (domEvent) return { x: domEvent.clientX, y: domEvent.clientY };
    // Fallback: use latlng projection
    if (e.latLng) {
      const pos = latLngToScreenPos({ lat: e.latLng.lat(), lng: e.latLng.lng() }, map);
      if (pos) return pos;
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  const clickHandler = (e: google.maps.MapMouseEvent | google.maps.IconMouseEvent | Event) => {
    if (obj.style.locked) return;
    const mapEvent = e as google.maps.MapMouseEvent;
    const native = mapEvent.domEvent as MouseEvent | undefined;
    const pos = getClickPos(mapEvent);
    onSelect(obj.id, native?.shiftKey ?? false, pos);
    mapEvent.stop?.();
  };

  if ("vertices" in obj) {
    const opts = styleToPolylineOpts(obj as typeof obj & { vertices: unknown });
    if (obj.tool === "polygon") {
      const poly = new google.maps.Polygon({
        paths: obj.vertices.map((v) => new google.maps.LatLng(v.lat, v.lng)),
        ...opts,
        fillColor: fillColor(obj.style),
        fillOpacity: fillOpacity(obj.style),
        zIndex: z,
        clickable: isClickable,
        map,
      });
      poly.addListener("click", clickHandler);
      return poly;
    }
    const pl = new google.maps.Polyline({
      path: obj.vertices.map((v) => new google.maps.LatLng(v.lat, v.lng)),
      ...opts,
      zIndex: z,
      clickable: isClickable,
      map,
    });
    pl.addListener("click", clickHandler);
    if (obj.tool === "arrow" && obj.vertices.length >= 2) {
      addArrowhead(pl, obj.vertices, obj.style, map);
    }
    return pl;
  }

  if ("bounds" in obj) {
    const fillC = fillColor(obj.style);
    const fillO = fillOpacity(obj.style);
    if (obj.tool === "rectangle") {
      const rect = new google.maps.Rectangle({
        bounds: { north: obj.bounds.n, south: obj.bounds.s, east: obj.bounds.e, west: obj.bounds.w },
        strokeColor: obj.style.strokeColor,
        strokeWeight: obj.style.strokeWidth,
        strokeOpacity: obj.style.opacity,
        fillColor: fillC,
        fillOpacity: fillO,
        zIndex: z,
        clickable: isClickable,
        map,
      });
      rect.addListener("click", clickHandler);
      return rect;
    }
    if (obj.tool === "circle") {
      const centerLat = (obj.bounds.n + obj.bounds.s) / 2;
      const centerLng = (obj.bounds.e + obj.bounds.w) / 2;
      const latR = (obj.bounds.n - obj.bounds.s) / 2;
      const radiusM = latR * 111320;
      const circle = new google.maps.Circle({
        center: { lat: centerLat, lng: centerLng },
        radius: radiusM,
        strokeColor: obj.style.strokeColor,
        strokeWeight: obj.style.strokeWidth,
        strokeOpacity: obj.style.opacity,
        fillColor: fillC,
        fillOpacity: fillO,
        zIndex: z,
        clickable: isClickable,
        map,
      });
      circle.addListener("click", clickHandler);
      return circle;
    }
  }

  if ("position" in obj && "text" in obj) {
    // Phase 9.6 fix: give text markers a real (invisible) hit target so they
    // can be clicked/selected/deleted. The previous scale:0 icon made the
    // marker effectively un-clickable. We use a square SVG sized to roughly
    // match the label, fully transparent.
    const textLen = (obj.text || "").length;
    const hitWidth = Math.max(40, textLen * 9 + 16);
    const hitHeight = 22;
    const hitSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${hitWidth}" height="${hitHeight}">` +
      `<rect width="${hitWidth}" height="${hitHeight}" fill="#000" fill-opacity="0.001"/>` +
      `</svg>`;
    const marker = new google.maps.Marker({
      position: new google.maps.LatLng(obj.position.lat, obj.position.lng),
      map,
      label: {
        text: obj.text,
        color: obj.style.strokeColor,
        fontSize: "13px",
        fontWeight: "bold",
        fontFamily: "ui-monospace, monospace",
      },
      icon: {
        url: "data:image/svg+xml;utf8," + encodeURIComponent(hitSvg),
        size: new google.maps.Size(hitWidth, hitHeight),
        scaledSize: new google.maps.Size(hitWidth, hitHeight),
        anchor: new google.maps.Point(hitWidth / 2, hitHeight / 2),
        labelOrigin: new google.maps.Point(hitWidth / 2, hitHeight / 2),
      },
      draggable: isSelected,
      clickable: isClickable,
      zIndex: z,
    });
    marker.addListener("click", clickHandler);
    return marker;
  }

  if ("position" in obj && !("text" in obj)) {
    const pointSize = obj.style.pointSize ?? 1.0;
    const px = computeSymbolPx(zoom, pointSize);
    const baseIcon = iconForTool(obj.tool, obj.style.strokeColor, pointSize);
    const marker = new google.maps.Marker({
      position: new google.maps.LatLng(obj.position.lat, obj.position.lng),
      map,
      icon: {
        ...baseIcon,
        size: new google.maps.Size(px, px),
        scaledSize: new google.maps.Size(px, px),
        anchor: new google.maps.Point(px / 2, px / 2),
      },
      title: obj.label ?? obj.tool,
      draggable: isSelected,
      clickable: isClickable,
      zIndex: z,
    });
    marker.addListener("click", clickHandler);
    return marker;
  }

  return null;
}

// ─── Arrowhead ────────────────────────────────────────────────────────────────

function addArrowhead(
  _pl: google.maps.Polyline,
  vertices: Array<{ lat: number; lng: number }>,
  style: DrawingObject["style"],
  map: google.maps.Map
): void {
  if (vertices.length < 2) return;
  const last = vertices[vertices.length - 1]!;
  const prev = vertices[vertices.length - 2]!;
  const heading = google.maps.geometry.spherical.computeHeading(
    new google.maps.LatLng(prev.lat, prev.lng),
    new google.maps.LatLng(last.lat, last.lng)
  );
  new google.maps.Marker({
    position: new google.maps.LatLng(last.lat, last.lng),
    map,
    icon: {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: style.strokeWidth + 2,
      strokeColor: style.strokeColor,
      fillColor: style.strokeColor,
      fillOpacity: style.opacity,
      rotation: heading,
      anchor: new google.maps.Point(0, 2.5),
    },
    clickable: false,
    zIndex: 6,
  });
}
