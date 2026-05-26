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
import { iconForTool, ICON_SIZE } from "./icons/telecomIcons.js";
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
        : undefined,
  };
}

function fillOpacity(style: DrawingObject["style"]): number {
  if (style.fill.kind === "none") return 0;
  return style.opacity * 0.35;
}

function fillColor(style: DrawingObject["style"]): string {
  if (style.fill.kind === "solid") return style.fill.color;
  if (style.fill.kind === "hash") return style.fill.color;
  return "transparent";
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
// Phase 9.5: Labels only render at this zoom level or closer.
// Zoomed out, only the structures show.
const MIN_LABEL_ZOOM = 18;
const BASE_SIZE = ICON_SIZE; // 32px

function computeSymbolPx(zoom: number, pointSize: number): number {
  const raw = BASE_SIZE * Math.pow(2, zoom - ZOOM_REF) * pointSize;
  return Math.round(Math.max(4, Math.min(96, raw)));
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
  const mid = vertices[Math.floor(vertices.length / 2)];
  return mid ?? vertices[0]!;
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
    if (!obj.style.userLabel || obj.style.hidden) continue;
    const pos = labelPositionForObj(obj);
    if (!pos) continue;
    entries.push({ objId: obj.id, symbolLatLng: pos, text: obj.style.userLabel, zIndex: 6 });
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
  const { state, addObject, updateObject, updateObjectGeometry, updateObjectPosition, deleteSelected, select, clearSelection, undo, redo, patchObjectStyle } =
    useDrawing();
  const engineRef = useRef<DrawingEngine | null>(null);
  const overlaysRef = useRef<globalThis.Map<string, OverlayRef>>(new globalThis.Map());
  const measureInfoRef = useRef<globalThis.Map<string, google.maps.InfoWindow>>(new globalThis.Map());
  const labelVersionRef = useRef<globalThis.Map<string, string | undefined>>(new globalThis.Map());
  const calloutLinesRef = useRef<globalThis.Map<string, google.maps.Polyline>>(new globalThis.Map());

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

    engine.onPendingObject = (obj, screenPos) => {
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
    const isClickable = state.activeTool === "select" || state.activeTool === null;
    overlaysRef.current.forEach((overlay, key) => {
      if (key.endsWith("_label")) return;
      overlay.setOptions({ clickable: isClickable });
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
    const isClickable = isSelectTool;
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
          existing.setOptions({
            ...opts,
            strokeOpacity: isSelected ? 1 : obj.style.opacity,
            zIndex: isSelected ? 20 : 5,
            clickable: isClickable,
            editable: isEditable,
            draggable: isEditable,
          });
        } else if (existing instanceof google.maps.Rectangle || existing instanceof google.maps.Circle) {
          existing.setOptions({
            strokeColor: obj.style.strokeColor,
            strokeWeight: obj.style.strokeWidth,
            strokeOpacity: isSelected ? 1 : obj.style.opacity,
            fillColor: fillColor(obj.style),
            fillOpacity: fillOpacity(obj.style),
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

        // Attach / detach geometry listeners based on editable state
        if (isEditable) {
          attachGeoListeners(obj.id, existing);
        } else {
          removeGeoListeners(obj.id);
        }

        // Update label marker if userLabel changed
        const lastLabel = labelVersionRef.current.get(obj.id);
        const currentLabel = obj.style.userLabel;
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
        select([id], additive);
        // Open details card if SELECT tool
        if (isSelectTool) {
          const live = state.objects.find((o) => o.id === id);
          if (live) {
            setCardObj(live);
            setCardAnchor(clickPos);
          }
        }
      });
      if (overlay) {
        overlaysRef.current.set(obj.id, overlay);
        if (isEditable) {
          attachGeoListeners(obj.id, overlay);
        }
      }

      // Create label marker (only when zoomed in close enough)
      if (obj.style.userLabel && zoom >= MIN_LABEL_ZOOM) {
        const pos = labelPositionForObj(obj);
        if (pos) {
          const labelLatLng = pixelOffsetToLatLng(pos, 30, 0, map);
          if (labelLatLng) {
            const lbl = makeLabelMarkerAt(labelLatLng, obj.style.userLabel, map, 6);
            overlaysRef.current.set(obj.id + "_label", lbl);
            const offsetMag = Math.sqrt(30 ** 2);
            if (offsetMag > CALLOUT_MIN_OFFSET_PX) {
              calloutLinesRef.current.set(obj.id + "_callout", makeCalloutLine(pos, labelLatLng, map, 5));
            }
          }
        }
      }
      labelVersionRef.current.set(obj.id, obj.style.userLabel);

      // Measure distance label
      if (obj.tool === "measure" && "vertices" in obj) {
        const ft = distanceFeet(obj.vertices);
        const mid = obj.vertices[Math.floor(obj.vertices.length / 2)];
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

    return () => {
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current.clear();
      calloutLinesRef.current.forEach((l) => l.setMap(null));
      calloutLinesRef.current.clear();
      measureInfoRef.current.forEach((iw) => iw.close());
      measureInfoRef.current.clear();
      labelVersionRef.current.clear();
      geoListenersRef.current.forEach((ls) => ls.forEach((l) => l.remove()));
      geoListenersRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, state.objects, state.selectedIds, state.activeTool]);

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
    if (obj.tool === "text") {
      finalObj = {
        ...obj,
        text: label || "Text",
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
