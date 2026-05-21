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
import { iconForTool, ICON_SIZE } from "./icons/telecomIcons.js";

const PLACED_COLOR  = "#39ff7a";
const REMOVED_COLOR = "#ff2d4a";
const ZOOM_REF = 17;
const BASE_SIZE = ICON_SIZE;

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
  const raw = BASE_SIZE * Math.pow(2, zoom - ZOOM_REF) * pointSize;
  return Math.round(Math.max(4, Math.min(96, raw)));
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
  zoom: number
): OverlayRef | null {
  if (obj.style.hidden) return null;

  if ("vertices" in obj) {
    const opts = styleToPolylineOpts(obj as typeof obj & { vertices: unknown });
    if (obj.tool === "polygon") {
      return new google.maps.Polygon({
        paths: obj.vertices.map((v) => new google.maps.LatLng(v.lat, v.lng)),
        ...opts,
        fillColor: fillColor(obj.style),
        fillOpacity: fillOpacity(obj.style),
        zIndex: 4,
        clickable: false,
        map,
      });
    }
    return new google.maps.Polyline({
      path: obj.vertices.map((v) => new google.maps.LatLng(v.lat, v.lng)),
      ...opts,
      zIndex: 4,
      clickable: false,
      map,
    });
  }

  if ("bounds" in obj) {
    if (obj.tool === "rectangle") {
      return new google.maps.Rectangle({
        bounds: { north: obj.bounds.n, south: obj.bounds.s, east: obj.bounds.e, west: obj.bounds.w },
        strokeColor: obj.style.strokeColor,
        strokeWeight: obj.style.strokeWidth,
        strokeOpacity: obj.style.opacity,
        fillColor: fillColor(obj.style),
        fillOpacity: fillOpacity(obj.style),
        zIndex: 4,
        clickable: false,
        map,
      });
    }
    if (obj.tool === "circle") {
      const centerLat = (obj.bounds.n + obj.bounds.s) / 2;
      const centerLng = (obj.bounds.e + obj.bounds.w) / 2;
      const latR = (obj.bounds.n - obj.bounds.s) / 2;
      const radiusM = latR * 111320;
      return new google.maps.Circle({
        center: { lat: centerLat, lng: centerLng },
        radius: radiusM,
        strokeColor: obj.style.strokeColor,
        strokeWeight: obj.style.strokeWidth,
        strokeOpacity: obj.style.opacity,
        fillColor: fillColor(obj.style),
        fillOpacity: fillOpacity(obj.style),
        zIndex: 4,
        clickable: false,
        map,
      });
    }
  }

  if ("position" in obj && "text" in obj) {
    return new google.maps.Marker({
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
      clickable: false,
      draggable: false,
      zIndex: 4,
    });
  }

  if ("position" in obj && !("text" in obj)) {
    const pointSize = obj.style.pointSize ?? 1.0;
    const px = computeSymbolPx(zoom, pointSize);
    const baseIcon = iconForTool(obj.tool, obj.style.strokeColor, pointSize);
    return new google.maps.Marker({
      position: new google.maps.LatLng(obj.position.lat, obj.position.lng),
      map,
      icon: {
        ...baseIcon,
        size: new google.maps.Size(px, px),
        scaledSize: new google.maps.Size(px, px),
        anchor: new google.maps.Point(px / 2, px / 2),
      },
      title: (obj as { label?: string }).label ?? obj.tool,
      clickable: false,
      draggable: false,
      zIndex: 4,
    });
  }

  return null;
}

const REFRESH_INTERVAL_MS = 60_000;

export default function AllJobsMarkupsOverlay() {
  const map = useMap();
  const { state } = useDrawing();
  const overlaysRef = useRef<Map<string, OverlayRef>>(new Map());
  const docsRef = useRef<Array<{ jobId: string; objects: DrawingObject[] }>>([]);

  // Track when the active job was last saved so we re-fetch fresh data
  const lastSavedTrigger = useRef(0);
  if (!state.dirty && !state.saving && state.targetJobId) {
    // bump on transitions to clean state — best-effort
    lastSavedTrigger.current = state.dirty ? lastSavedTrigger.current : lastSavedTrigger.current;
  }

  async function fetchAll() {
    try {
      const res = await api.getAllDrawings();
      docsRef.current = res.docs.map((d) => ({
        jobId: d.jobId,
        objects: (d.objects as DrawingObject[]) ?? [],
      }));
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
    const activeJobId = state.targetJobId;
    for (const doc of docsRef.current) {
      if (activeJobId && doc.jobId === activeJobId) continue; // active job is rendered by DrawingOverlay
      for (const obj of doc.objects) {
        try {
          const overlay = createReadOnlyOverlay(obj, map, zoom);
          if (overlay) overlaysRef.current.set(`${doc.jobId}:${obj.id}`, overlay);
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
    return () => {
      clearInterval(t);
      clearAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

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

  return null;
}
