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

import { useEffect, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { DrawingObject } from "@nsc/types";
import { api } from "../../lib/api.js";
import { useDrawing } from "./drawingContext.js";
import { useAuth } from "../auth/authContext.js";
import { setMarkupSearchDocs } from "../search/markupSearchStore.js";
import { iconForTool } from "./icons/telecomIcons.js";
import LabelEditPopup, { type LabelEditValues } from "./LabelEditPopup.js";
import MarkupPhotosPopup from "./MarkupPhotosPopup.js";
// Billy 6/8: share the SAME label renderer used by the active-job overlay so
// every label on the map (open job, closed job, callout, ATAG, MH#) has the
// same white text-box look, the same MIN_LABEL_ZOOM gate, and the same anti-
// collision placement. The search index also reads off labelTextForObj() so
// what's searchable is exactly what's visible.
import {
  rebuildAllLabels as sharedRebuildAllLabels,
  clearAllLabels as sharedClearAllLabels,
} from "./DrawingOverlayLabels.js";

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
  "splice",
  "ziply_hub",
  "ziply_terminal",
  "ziply_address",
  "ziply_pole",
  "ziply_handhole",
]);

function isPointTool(tool: string): boolean {
  if (!tool) return false;
  const t = tool.toLowerCase();
  return (
    t.includes("pole") ||
    t.includes("mh") ||
    t.includes("hh") ||
    t.includes("ped") ||
    t.includes("cabinet") ||
    t.includes("anchor") ||
    t.includes("splice") ||
    t.includes("flower") ||
    t.startsWith("ziply_") ||
    POINT_TOOLS.has(tool)
  );
}

function computeSymbolPx(zoom: number, pointSize: number): number {
  const raw = BASE_SIZE * Math.pow(1.41, zoom - ZOOM_REF) * pointSize;
  return Math.round(Math.max(22, Math.min(48, raw)));
}

function styleToPolylineOpts(obj: DrawingObject & { vertices: unknown }): Partial<google.maps.PolylineOptions> {
  const tool = obj.tool as string;
  const style = obj.style;
  if (style.animateFlow && (tool === "placed_cable" || tool === "line" || tool === "arrow")) {
    const color = tool === "placed_cable" ? PLACED_COLOR : (style.strokeColor || "#1ea7ff");
    return {
      strokeColor: color,
      strokeWeight: style.strokeWidth,
      strokeOpacity: 0.35,
      icons: [{
        icon: {
          path: "M 0,-1.5 0,1.5",
          strokeOpacity: 1,
          scale: style.strokeWidth * 1.2,
          strokeColor: color,
        },
        offset: "0px",
        repeat: "30px"
      }]
    };
  }

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
        : style.strokeStyle === "dotted"
        ? [{ icon: { path: "M 0,0 0,0.01", strokeOpacity: 1, scale: style.strokeWidth }, offset: "0", repeat: "6px" }]
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

// Billy 6/8: right-click on a markup opens the photos popup.
type RightClickHandler = (obj: DrawingObject, screen: { x: number; y: number }) => void;

function createReadOnlyOverlay(
  obj: DrawingObject,
  map: google.maps.Map,
  zoom: number,
  onClick: (() => void) | null,
  /** Callback to register auxiliary overlays (e.g. callout leader polyline)
   *  so the parent can dispose them on clear/unmount. */
  registerAux?: (overlay: OverlayRef) => void,
  onRightClick?: RightClickHandler,
  onHover?: (info: { x: number; y: number; crew: string; time: string } | null) => void
): OverlayRef | null {
  if (obj.style.hidden) return null;
  const clickable = onClick !== null;

  // Helper to attach a click listener if the overlay is clickable.
  function wireClick<T extends { addListener: (e: string, fn: ((e?: google.maps.MapMouseEvent) => void)) => unknown }>(
    overlay: T
  ): T {
    if (clickable && onClick) overlay.addListener("click", () => onClick());
    if (onRightClick) {
      overlay.addListener("rightclick", (e?: google.maps.MapMouseEvent) => {
        // Google Maps types declare domEvent as a wide union; cast on read.
        const dom = (e as (google.maps.MapMouseEvent & { domEvent?: MouseEvent }) | undefined)?.domEvent;
        const x = dom?.clientX ?? window.innerWidth / 2;
        const y = dom?.clientY ?? window.innerHeight / 2;
        onRightClick(obj, { x, y });
      });
    }
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
    const polyline = new google.maps.Polyline({
      path: obj.vertices.map((v) => new google.maps.LatLng(v.lat, v.lng)),
      ...opts,
      zIndex: 4,
      clickable,
      map,
    });

    if (
      (obj.tool === "placed_cable" ||
        obj.tool === "ziply_feeder" ||
        obj.tool === "ziply_distribution" ||
        obj.tool === "ziply_drop" ||
        obj.tool === "ziply_bore") &&
      obj.style.ziplyStatus === "Complete"
    ) {
      // Glow polyline
      polyline.setOptions({ strokeColor: "#00ffff" }); // cyan core
      const glow = new google.maps.Polyline({
        path: obj.vertices.map((v) => new google.maps.LatLng(v.lat, v.lng)),
        strokeColor: "#00ffff",
        strokeWeight: obj.style.strokeWidth * 3.5,
        strokeOpacity: 0.3,
        zIndex: 3,
        clickable: false,
        map,
      });
      registerAux?.(glow);
      // mark it so the animation loop can find it
      glow.set("isZiplyPulse", true);

      // Tooltip handling
      if (onHover && obj.style.ziplyCrewId && obj.style.ziplyTimestamp) {
        polyline.addListener("mouseover", (e: any) => {
          const dom = e.domEvent as MouseEvent | undefined;
          if (dom) {
            onHover({
              x: dom.clientX,
              y: dom.clientY,
              crew: obj.style.ziplyCrewId!,
              time: new Date(obj.style.ziplyTimestamp!).toLocaleString(),
            });
          }
        });
        polyline.addListener("mouseout", () => {
          onHover(null);
        });
      }
    }

    return wireClick(polyline);
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

  // Callout: text + arrow-headed leader polyline through optional bend points.
  // The leader's last vertex is the anchor (arrow tip), so the arrowhead
  // points AT the thing being called out.
  if (obj.tool === "callout" && "position" in obj && "anchor" in obj && "text" in obj) {
    const anchor = (obj as any).anchor as { lat: number; lng: number };
    const textPos = obj.position;
    const bends: Array<{ lat: number; lng: number }> =
      Array.isArray((obj as any).path) ? (obj as any).path : [];
    const color = obj.style.strokeColor || "#3aa7ff";

    // text-box -> bends (reversed) -> anchor, arrow on last vertex
    const path = [textPos, ...[...bends].reverse(), anchor];
    const leader = new google.maps.Polyline({
      path,
      strokeColor: color,
      strokeWeight: obj.style.strokeWidth || 2,
      strokeOpacity: obj.style.opacity ?? 0.9,
      icons: [{
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 3.5,
          strokeColor: color,
          fillColor: color,
          fillOpacity: 1,
        },
        offset: "100%",
      }],
      clickable: false,
      zIndex: 3,
      map,
    });
    registerAux?.(leader);

    return wireClick(new google.maps.Marker({
      position: new google.maps.LatLng(textPos.lat, textPos.lng),
      map,
      label: {
        text: obj.text || " ",
        color,
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

// Convert a lat/lng position back to a pixel offset from `origin`. Used when
// the user drag-drops a label to a new spot — we store the offset in screen
// pixels at the current zoom so the label sits at a consistent visual distance
// from its anchor regardless of zoom (Edit 1).
function latLngOffsetToPixels(
  origin: { lat: number; lng: number },
  target: { lat: number; lng: number },
  map: google.maps.Map
): { dx: number; dy: number } | null {
  const proj = map.getProjection();
  if (!proj) return null;
  const zoom = map.getZoom() ?? 18;
  const scale = Math.pow(2, zoom);
  const originPt = proj.fromLatLngToPoint(new google.maps.LatLng(origin.lat, origin.lng));
  const targetPt = proj.fromLatLngToPoint(new google.maps.LatLng(target.lat, target.lng));
  if (!originPt || !targetPt) return null;
  return {
    dx: Math.round((targetPt.x - originPt.x) * scale),
    dy: Math.round((targetPt.y - originPt.y) * scale),
  };
}

// Convert a pixel offset (dx,dy) into a lat/lng offset from `origin`. Used to
// push the label callout off to the side of the point symbol so the label is
// not rendered on top of the icon (Billy 6/5 — fixes pole atag duplicate).
function pixelOffsetToLatLng(
  origin: { lat: number; lng: number },
  dx: number,
  dy: number,
  map: google.maps.Map
): { lat: number; lng: number } | null {
  const proj = map.getProjection();
  if (!proj) return null;
  const zoom = map.getZoom() ?? 18;
  const scale = Math.pow(2, zoom);
  const originPt = proj.fromLatLngToPoint(new google.maps.LatLng(origin.lat, origin.lng));
  if (!originPt) return null;
  const targetPt = new google.maps.Point(originPt.x + dx / scale, originPt.y + dy / scale);
  const targetLatLng = proj.fromPointToLatLng(targetPt);
  if (!targetLatLng) return null;
  return { lat: targetLatLng.lat(), lng: targetLatLng.lng() };
}

// Edit 1: callback fired when the user drags a label to a new position.
// The overlay supplies a function that persists labelOffsetPx on the object
// (computed from the new lat/lng minus the original anchor) and re-saves
// the parent doc to Firestore.
type LabelDragHandler = (
  obj: DrawingObject,
  newPos: { lat: number; lng: number }
) => void;

// Edit 1 finish: callback when the user clicks the label — opens the edit popup.
type LabelClickHandler = (
  obj: DrawingObject,
  screenPos: { x: number; y: number }
) => void;

function createLabelMarker(
  obj: DrawingObject,
  map: google.maps.Map,
  onLabelDrag?: LabelDragHandler,
  onLabelClick?: LabelClickHandler,
  // Billy 6/8: single-click on a label should open the job card (like the
  // markup itself). Double-click opens the label edit popup.
  onLabelOpenJob?: () => void
): google.maps.Marker | null {
  const text = labelTextForObj(obj);
  if (!text) return null;
  const pos = labelPositionForObj(obj);
  if (!pos) return null;
  // Point markups: offset label 30px to the right by default so it sits next
  // to the symbol (callout style), not on top of it. Lines/shapes/text/callout
  // already render their labels in the right spot — leave those alone unless
  // the user has manually dragged the label (labelOffsetPx is set).
  const isPoint = "position" in obj && !("text" in obj);
  const off = obj.style.labelOffsetPx;
  let labelPos = pos;
  if (off) {
    labelPos = pixelOffsetToLatLng(pos, off.dx, off.dy, map) ?? pos;
  } else if (isPoint) {
    labelPos = pixelOffsetToLatLng(pos, 30, 0, map) ?? pos;
  }
  const fontSize = obj.style.labelFontSize ? `${obj.style.labelFontSize}px` : "12px";
  const marker = new google.maps.Marker({
    position: new google.maps.LatLng(labelPos.lat, labelPos.lng),
    map,
    label: {
      text,
      color: obj.style.textColor ?? "#1A2332",
      fontSize,
      fontWeight: "700",
      fontFamily: "ui-monospace, monospace",
    },
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
    clickable: !!(onLabelDrag || onLabelClick || onLabelOpenJob),
    draggable: !!onLabelDrag,
    zIndex: 6,
  });
  if (onLabelDrag) {
    marker.addListener("dragend", () => {
      const p = marker.getPosition();
      if (!p) return;
      onLabelDrag(obj, { lat: p.lat(), lng: p.lng() });
    });
  }
  // Single click opens the job card; double click opens the label edit popup.
  if (onLabelOpenJob || onLabelClick) {
    marker.addListener("click", () => {
      if (onLabelOpenJob) onLabelOpenJob();
    });
    if (onLabelClick) {
      marker.addListener("dblclick", (e: google.maps.MapMouseEvent & { domEvent?: MouseEvent }) => {
        const dom = e.domEvent as MouseEvent | undefined;
        const x = dom?.clientX ?? window.innerWidth / 2;
        const y = dom?.clientY ?? window.innerHeight / 2;
        onLabelClick(obj, { x, y });
      });
    }
  }
  return marker;
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

  // ── Cable Flow Animation Loop (#3) ───────────────────────────────────────
  useEffect(() => {
    let offset = 0;
    const interval = setInterval(() => {
      offset = (offset + 1.2) % 30;
      overlaysRef.current.forEach((val) => {
        if (val instanceof google.maps.Polyline) {
          const icons = val.get("icons");
          if (icons && icons.length > 0 && icons[0].icon && icons[0].repeat === "30px") {
            icons[0].offset = `${offset}px`;
            val.set("icons", icons);
          }
          if (val.get("isZiplyPulse")) {
            const t = Date.now() / 500;
            const op = 0.15 + 0.3 * (Math.sin(t) * 0.5 + 0.5);
            val.setOptions({ strokeOpacity: op });
          }
        }
      });
    }, 40);
    return () => clearInterval(interval);
  }, []);
  const docsRef = useRef<Array<{ jobId: string; objects: DrawingObject[] }>>([]);
  // Billy 6/8: per-job label / callout-line containers so sharedRebuildAllLabels
  // can use its plain (non-prefixed) `${objId}_label` keys without collisions
  // across jobs. One bag of label markers per jobId, plus one bag of leader
  // lines per jobId.
  const labelsByJobRef = useRef<globalThis.Map<string, globalThis.Map<string, OverlayRef>>>(new globalThis.Map());
  const calloutLinesByJobRef = useRef<globalThis.Map<string, globalThis.Map<string, google.maps.Polyline>>>(new globalThis.Map());

  // (lastSavedTrigger ref kept for potential future use; currently we rely on the
  // "nsc:markups-saved" event + dirty transition + periodic refresh)

  // Per-supervisor markup scoping: EVERYONE sees only their own markups,
  // including managers (Robbie explicitly does not want to see other
  // supervisors' map markups — 9.7).
  const { username } = useAuth();
  const markupOwner = username ?? "";

  // Edit 1 finish: label-edit popup state. When the user clicks a label, we
  // open this popup near the click position to edit text/color/font/bg/border.
  const [editing, setEditing] = useState<
    | {
        obj: DrawingObject;
        jobId: string;
        screen: { x: number; y: number };
      }
    | null
  >(null);

  // Billy 6/8: photos popup state. Right-click a markup → opens this.
  const [photos, setPhotos] = useState<
    | {
        obj: DrawingObject;
        jobId: string;
        screen: { x: number; y: number };
      }
    | null
  >(null);

  // Hover tooltip for completed paths
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; crew: string; time: string } | null>(null);

  async function fetchAll() {
    try {
      if (!markupOwner) {
        // No user signed in — clear and bail.
        docsRef.current = [];
        setMarkupSearchDocs([]);
        renderAll();
        return;
      }
      // Fetch job markups AND personal scratchpad in parallel so SearchBar
      // can find markups dropped on the main map (no job selected) too.
      const [res, scratch] = await Promise.all([
        api.getAllDrawings(markupOwner),
        api.getScratchpad(markupOwner).catch(() => ({ objects: [] as unknown[] })),
      ]);
      docsRef.current = res.docs.map((d) => ({
        jobId: d.jobId,
        objects: (d.objects as DrawingObject[]) ?? [],
      }));
      const scratchObjs = (scratch?.objects as DrawingObject[] | undefined) ?? [];
      if (scratchObjs.length > 0) {
        docsRef.current.push({ jobId: "scratchpad", objects: scratchObjs });
      }
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
    // Also drop label markers + leader lines for every job.
    labelsByJobRef.current.forEach((bag) => {
      bag.forEach((m) => m.setMap(null));
      bag.clear();
    });
    labelsByJobRef.current.clear();
    calloutLinesByJobRef.current.forEach((bag) => {
      bag.forEach((l) => l.setMap(null));
      bag.clear();
    });
    calloutLinesByJobRef.current.clear();
  }

  function renderAll() {
    if (!map) return;
    clearAll();
    const zoom = map.getZoom() ?? ZOOM_REF;
    const activeJobId = state.targetJobId;
    for (const doc of docsRef.current) {
      if (activeJobId && doc.jobId === activeJobId) continue; // active job is rendered by DrawingOverlay
      // Click on any of this job's markups jumps to its card.
      const handler = onMarkupClick ? () => onMarkupClick(doc.jobId) : null;
      for (const obj of doc.objects) {
        try {
          let auxIdx = 0;
          const registerAux = (extra: OverlayRef) => {
            overlaysRef.current.set(`${doc.jobId}:${obj.id}:aux${auxIdx++}`, extra);
          };
          const rightClickHandler: RightClickHandler = (target, screen) => {
            // Only allow photos on objects that have a meaningful identity
            // (skip text-tool labels for now — photos belong on assets).
            setPhotos({ obj: target, jobId: doc.jobId, screen });
          };
          const overlay = createReadOnlyOverlay(obj, map, zoom, handler, registerAux, rightClickHandler, setHoverInfo);
          if (overlay) overlaysRef.current.set(`${doc.jobId}:${obj.id}`, overlay);
        } catch {
          // skip malformed object
        }
      }
      // Billy 6/8: hand label rendering to the shared helper so closed-job
      // labels look identical to the open job's labels (white text-box, anti-
      // collision, zoom gated). Use a per-job container so its plain `_label`
      // keys don't collide with other jobs' objects.
      let labelBag = labelsByJobRef.current.get(doc.jobId);
      if (!labelBag) {
        labelBag = new globalThis.Map();
        labelsByJobRef.current.set(doc.jobId, labelBag);
      }
      let calloutBag = calloutLinesByJobRef.current.get(doc.jobId);
      if (!calloutBag) {
        calloutBag = new globalThis.Map();
        calloutLinesByJobRef.current.set(doc.jobId, calloutBag);
      }
      // Pass the same job-card-opening handler that the markup itself uses,
      // so clicking a label opens that job exactly like clicking the markup.
      sharedRebuildAllLabels(
        map,
        doc.objects,
        labelBag,
        calloutBag,
        handler ? () => handler() : undefined
      );
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
      google.maps.event.removeListener(zoomListener);
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

  // Edit 1 finish: persist label edits (text/colors/font/bg/border) back to
  // Firestore and re-render. Mirrors the dragHandler logic above.
  function persistLabelEdit(jobId: string, target: DrawingObject, values: LabelEditValues) {
    const doc = docsRef.current.find((d) => d.jobId === jobId);
    if (!doc) return;
    const updatedObjects = doc.objects.map((o) => {
      if (o.id !== target.id) return o;
      const next = { ...o, style: { ...o.style } } as DrawingObject;
      next.style.textColor = values.textColor;
      next.style.labelFontSize = values.fontSize;
      next.style.labelBg = values.bg;
      next.style.labelBorder = values.border;
      next.style.labelBorderWidth = values.borderWidth;
      if ("text" in next) {
        (next as { text: string }).text = values.text;
      } else if (next.style.userLabel !== undefined && next.style.userLabel !== "") {
        next.style.userLabel = values.text;
      } else {
        next.style.description = values.text;
      }
      return next;
    });
    doc.objects = updatedObjects;
    if (jobId === "scratchpad") {
      void api.putScratchpad(markupOwner, updatedObjects as unknown as unknown[]).catch(() => {});
    } else {
      void api
        .putDrawing(
          jobId,
          { jobId, objects: updatedObjects, updatedAt: Date.now(), updatedBy: markupOwner },
          markupOwner
        )
        .catch(() => {});
    }
    renderAll();
  }

  // Render whichever popup is open. Photos popup takes precedence if both
  // would somehow be set at once.
  if (photos) {
    return (
      <MarkupPhotosPopup
        jobId={photos.jobId}
        objectId={photos.obj.id}
        markupLabel={labelTextForObj(photos.obj) ?? photos.obj.tool}
        takenBy={markupOwner}
        x={photos.screen.x}
        y={photos.screen.y}
        onClose={() => setPhotos(null)}
      />
    );
  }

  if (!editing && !hoverInfo) return null;

  return (
    <>
      {editing && (
        <LabelEditPopup
          x={editing.screen.x}
          y={editing.screen.y}
          initial={{
            text: labelTextForObj(editing.obj) ?? "",
            textColor: editing.obj.style.textColor ?? "#1A2332",
            fontSize: editing.obj.style.labelFontSize ?? 12,
            bg: editing.obj.style.labelBg ?? "",
            border: editing.obj.style.labelBorder ?? "",
            borderWidth: editing.obj.style.labelBorderWidth ?? 0,
          }}
          onSave={(values) => {
            persistLabelEdit(editing.jobId, editing.obj, values);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {hoverInfo && (
        <div style={{
          position: "fixed",
          top: hoverInfo.y - 45,
          left: hoverInfo.x + 15,
          background: "rgba(0, 15, 25, 0.9)",
          border: "1px solid #00ffff",
          borderRadius: 4,
          padding: "6px 10px",
          color: "#00ffff",
          fontSize: 11,
          fontFamily: "monospace",
          zIndex: 10000,
          boxShadow: "0 0 10px rgba(0, 255, 255, 0.3)",
          pointerEvents: "none"
        }}>
          <div><strong>COMPLETED</strong></div>
          <div>Crew: {hoverInfo.crew}</div>
          <div>{hoverInfo.time}</div>
        </div>
      )}
    </>
  );
}
