// AllJobsMarkupsOverlay.tsx — read-only overlay that paints EVERY job's
// markups onto the map at all times. The active job's editable overlay is
// drawn separately by DrawingOverlay, so we skip the active job here to
// avoid duplicate rendering. This is the "markups are always visible no
// matter what" guarantee from Billy 5/21.
//
// Strategy:
//   - On mount + on a timer + whenever the active job's draft is saved,
//     fetch /api/asbuilt → { docs: [{ jobId, objects }] }.
//   - For each (jobId, object), create a google.maps overlay (Polyline /
//     Polygon / Rectangle / Circle / Marker).
//   - Skip the currently-active job's objects (DrawingOverlay handles them).
//   - All overlays are clickable:false, draggable:false, editable:false.
//   - On unmount, clear everything.

import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { DrawingObject } from "@nsc/types";
import { api } from "../../lib/api.js";
import { useDrawing } from "./drawingContext.js";
import { useAuth } from "../auth/authContext.js";
import { setMarkupSearchDocs } from "../search/markupSearchStore.js";
import { iconForTool } from "./icons/telecomIcons.js";

const PLACED_COLOR  = "#39ff7a";
const REMOVED_COLOR = "#ff2d4a";
const ZOOM_REF = 17;
const BASE_SIZE = 24; // matches DrawingOverlay (was ICON_SIZE = 32)
// Phase 9.7: labels visible at zoom ≥16 (lowered from 18) — must match DrawingOverlay
const MIN_LABEL_ZOOM = 16;

type OverlayRef =
  | google.maps.Polyline
  | google.maps.Polygon
  | google.maps.Rectangle
  | google.maps.Circle
  | google.maps.Marker;

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

function computeSymbolPx(zoom: number, pointSize: number): number {
  // Smoother half-octave scaling, capped at 40px (was 96). Keeps poles
  // icon-sized at all zoom levels instead of bloating to fill the screen.
  const raw = BASE_SIZE * Math.pow(1.41, zoom - ZOOM_REF) * pointSize;
  return Math.round(Math.max(8, Math.min(40, raw)));
}

function styleToPolylineOpts(obj: DrawingObject & { vertices: unknown }): Partial<google.maps.PolylineOptions> {
  const tool = obj.tool as string;
  const style = obj.style;
  if (tool === "placed_cable") {
    return { strokeColor: PLACED_COLOR, strokeWeight: style.strokeWidth, strokeOpacity: style.opacity };
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

function createReadOnlyOverlay(
  obj: DrawingObject,
  map: google.maps.Map,
  zoom: number,
  onClick: (() => void) | null
): OverlayRef | null {
  if (obj.style.hidden) return null;
  const clickable = onClick !== null;

  // Helper to attach a click listener if the overlay is clickable.
  function wireClick<T extends { addListener: (e: string, fn: () => void) => unknown }>(
    overlay: T
  ): T {
    if (clickable && onClick) overlay.addListener("click", onClick);
    return overlay;
  }

  if ("vertices" in obj) {
    const opts = styleToPolylineOpts(obj as typeof obj & { vertices: unknown });
    if (obj.tool === "polygon") {
      return wireClick(new google.maps.Polygon({
        paths: obj.vertices.map((v) => new google.maps.LatLng(v.lat, v.lng)),
        ...opts,
        fillColor: fillColor(obj.style),
        fillOpacity: fillOpacity(obj.style),
        zIndex: 4,
        clickable,
        map,
      }));
    }
    return wireClick(new google.maps.Polyline({
      path: obj.vertices.map((v) => new google.maps.LatLng(v.lat, v.lng)),
      ...opts,
      zIndex: 4,
      clickable,
      map,
    }));
  }

  if ("bounds" in obj) {
    if (obj.tool === "rectangle") {
      return wireClick(new google.maps.Rectangle({
        bounds: { north: obj.bounds.n, south: obj.bounds.s, east: obj.bounds.e, west: obj.bounds.w },
        strokeColor: obj.style.strokeColor,
        strokeWeight: obj.style.strokeWidth,
        strokeOpacity: obj.style.opacity,
        fillColor: fillColor(obj.style),
        fillOpacity: fillOpacity(obj.style),
        zIndex: 4,
        clickable,
        map,
      }));
    }
    if (obj.tool === "circle") {
      const centerLat = (obj.bounds.n + obj.bounds.s) / 2;
      const centerLng = (obj.bounds.e + obj.bounds.w) / 2;
      const latR = (obj.bounds.n - obj.bounds.s) / 2;
      const radiusM = latR * 111320;
      return wireClick(new google.maps.Circle({
        center: { lat: centerLat, lng: centerLng },
        radius: radiusM,
        strokeColor: obj.style.strokeColor,
        strokeWeight: obj.style.strokeWidth,
        strokeOpacity: obj.style.opacity,
        fillColor: fillColor(obj.style),
        fillOpacity: fillOpacity(obj.style),
        zIndex: 4,
        clickable,
        map,
      }));
    }
  }

  if ("position" in obj && "text" in obj) {
    return wireClick(new google.maps.Marker({
      position: new google.maps.LatLng(obj.position.lat, obj.position.lng),
      map,
      label: {
        text: obj.text,
        color: obj.style.strokeColor,
        fontSize: "13px",
        fontWeight: "bold",
        fontFamily: "ui-monospace, monospace",
      },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
      clickable,
      draggable: false,
      zIndex: 4,
    }));
  }

  if ("position" in obj && !("text" in obj)) {
    const pointSize = obj.style.pointSize ?? 1.0;
    const px = computeSymbolPx(zoom, pointSize);
    const baseIcon = iconForTool(obj.tool, obj.style.strokeColor, pointSize);
    return wireClick(new google.maps.Marker({
      position: new google.maps.LatLng(obj.position.lat, obj.position.lng),
      map,
      icon: {
        ...baseIcon,
        size: new google.maps.Size(px, px),
        scaledSize: new google.maps.Size(px, px),
        anchor: new google.maps.Point(px / 2, px / 2),
      },
      title: (obj as { label?: string }).label ?? obj.tool,
      clickable,
      draggable: false,
      zIndex: 4,
    }));
  }

  return null;
}

// Get the label anchor lat/lng for an object
function labelPositionForObj(obj: DrawingObject): { lat: number; lng: number } | null {
  if ("position" in obj) return { lat: obj.position.lat, lng: obj.position.lng };
  if ("vertices" in obj && obj.vertices.length > 0) {
    const mid = obj.vertices[Math.floor(obj.vertices.length / 2)];
    return mid ? { lat: mid.lat, lng: mid.lng } : null;
  }
  if ("bounds" in obj) {
    return {
      lat: (obj.bounds.n + obj.bounds.s) / 2,
      lng: (obj.bounds.e + obj.bounds.w) / 2,
    };
  }
  return null;
}

// Pick the best label text for any object:
//   - Points (MH/HH/Pole/Ped/Cab): style.userLabel
//   - Lines/shapes/freehand: style.description
//   - Text tool: its own text
function labelTextForObj(obj: DrawingObject): string | null {
  if (obj.style.hidden) return null;
  if (obj.style.userLabel && obj.style.userLabel.trim()) return obj.style.userLabel.trim();
  if (obj.style.description && obj.style.description.trim()) return obj.style.description.trim();
  if ("text" in obj && obj.text && obj.text.trim()) return obj.text.trim();
  return null;
}

function createLabelMarker(
  obj: DrawingObject,
  map: google.maps.Map
): google.maps.Marker | null {
  const text = labelTextForObj(obj);
  if (!text) return null;
  const pos = labelPositionForObj(obj);
  if (!pos) return null;

  const cleanText = text.trim();
  const width = Math.max(48, Math.ceil(cleanText.length * 7 + 16));
  const height = 20;
  const strokeColor = obj.style.strokeColor || "#39ff7a";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="4"
        fill="rgba(10, 16, 26, 0.9)" stroke="${strokeColor}" stroke-width="1.2"/>
  <text x="${width / 2}" y="${height / 2 + 3.5}" text-anchor="middle"
        fill="#f1f5f9" font-size="10" font-weight="700"
        font-family="JetBrains Mono, monospace" letter-spacing="0.03em">${cleanText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>
</svg>`;

  return new google.maps.Marker({
    position: new google.maps.LatLng(pos.lat, pos.lng),
    map,
    icon: {
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(width, height),
      anchor: new google.maps.Point(width / 2, height / 2),
    },
    clickable: false,
    draggable: false,
    zIndex: 6,
  });
}

const REFRESH_INTERVAL_MS = 15_000; // Solo desktop use: very frequent refresh so markups feel instantly persistent after saving. Network cost is tiny for personal use.

interface AllJobsMarkupsOverlayProps {
  /** Called when a markup is clicked. Receives the jobId it belongs to. */
  onMarkupClick?: (jobId: string) => void;
}

export default function AllJobsMarkupsOverlay({ onMarkupClick }: AllJobsMarkupsOverlayProps = {}) {
  const map = useMap();
  const { state } = useDrawing();
  const overlaysRef = useRef<Map<string, OverlayRef>>(new Map());
  const docsRef = useRef<Array<{ jobId: string; objects: DrawingObject[] }>>([]);

  // (lastSavedTrigger ref kept for potential future use; currently we rely on the
  // "nsc:markups-saved" event + dirty transition + periodic refresh)

  // Per-supervisor markup scoping: EVERYONE sees only their own markups,
  // including managers (Robbie explicitly does not want to see other
  // supervisors' map markups — 9.7).
  const { username } = useAuth();
  const markupOwner = username ?? "";
  async function fetchAll() {
    try {
      if (!markupOwner) {
        // No user signed in — clear and bail.
        docsRef.current = [];
        setMarkupSearchDocs([]);
        renderAll();
        return;
      }
      const res = await api.getAllDrawings(markupOwner);
      docsRef.current = res.docs.map((d) => ({
        jobId: d.jobId,
        objects: (d.objects as DrawingObject[]) ?? [],
      }));
      // Publish to the global markup-search store so SearchBar can query it.
      setMarkupSearchDocs(docsRef.current);
      renderAll();
    } catch {
      // silent — overlay is best-effort
    }
  }

  function clearAll() {
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current.clear();
  }

  function renderAll() {
    if (!map) return;
    clearAll();
    const zoom = map.getZoom() ?? ZOOM_REF;
    const labelsVisible = zoom >= MIN_LABEL_ZOOM;
    const activeJobId = state.targetJobId;
    for (const doc of docsRef.current) {
      if (activeJobId && doc.jobId === activeJobId) continue; // active job is rendered by DrawingOverlay
      // Click on any of this job's markups jumps to its card.
      const handler = onMarkupClick ? () => onMarkupClick(doc.jobId) : null;
      for (const obj of doc.objects) {
        try {
          const overlay = createReadOnlyOverlay(obj, map, zoom, handler);
          if (overlay) overlaysRef.current.set(`${doc.jobId}:${obj.id}`, overlay);
          // Phase 9.5: render labels only when zoomed in close enough
          if (labelsVisible) {
            const lbl = createLabelMarker(obj, map);
            if (lbl) overlaysRef.current.set(`${doc.jobId}:${obj.id}:label`, lbl);
          }
        } catch {
          // skip malformed object
        }
      }
    }
  }

  // Initial fetch + periodic refresh
  useEffect(() => {
    if (!map) return;
    void fetchAll();
    const t = setInterval(() => void fetchAll(), REFRESH_INTERVAL_MS);
    // Re-render on zoom change so labels appear/disappear with zoom
    const zoomListener = map.addListener("zoom_changed", () => renderAll());
    return () => {
      clearInterval(t);
      zoomListener.remove();
      clearAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, markupOwner]);

  // Re-render when active job changes (so the active job's objects get hidden
  // from the global layer; DrawingOverlay paints them as the editable copy)
  useEffect(() => {
    renderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.targetJobId]);

  // After a successful save (dirty→false while we have a target), re-fetch so
  // the global layer reflects the latest persisted state
  const wasDirtyRef = useRef(false);
  useEffect(() => {
    if (wasDirtyRef.current && !state.dirty && !state.saving) {
      void fetchAll();
    }
    wasDirtyRef.current = state.dirty;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.dirty, state.saving]);

  // Robust cross-component notification: when any save (workspace, main map, or field finding)
  // succeeds, immediately refresh the global markups so they appear on the main Jobs Map.
  useEffect(() => {
    const handler = () => {
      void fetchAll();
    };
    window.addEventListener("nsc:markups-saved", handler);
    // Also refresh when jobs are reloaded (login, manual resync) — keeps markups in sync
    window.addEventListener("nsc:jobs-reload", handler);
    return () => {
      window.removeEventListener("nsc:markups-saved", handler);
      window.removeEventListener("nsc:jobs-reload", handler);
    };
  }, []);

  return null;
}
