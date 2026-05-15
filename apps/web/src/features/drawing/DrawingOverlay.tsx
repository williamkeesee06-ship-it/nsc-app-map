// DrawingOverlay.tsx — React component that lives inside <Map>.
// Phase 4: cable PLACED = solid neon green, REMOVED = neon red + X marks.
// Phase 5.1: click-through when non-select tool active; details popup for all objects;
//            map-rendered userLabel next to point symbols + line midpoints + shape centers.

import { useEffect, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { DrawingObject } from "@nsc/types";
import { useDrawing } from "./drawingContext.js";
import { DrawingEngine } from "./DrawingEngine.js";
import { iconForTool } from "./icons/telecomIcons.js";
import ObjectDetailsPopup from "./ObjectDetailsPopup.js";

const FEET_PER_METER = 3.28084;

// ── Cable line rendering ──────────────────────────────────────────────────────

const PLACED_COLOR  = "#39ff7a"; // neon green — hardcoded, not user-overridable
const REMOVED_COLOR = "#ff2d4a"; // neon red  — hardcoded, not user-overridable

function styleToPolylineOpts(obj: DrawingObject & { vertices: unknown }): Partial<google.maps.PolylineOptions> {
  const tool = obj.tool as string;
  const style = obj.style;

  // PLACED cable: solid neon green
  if (tool === "placed_cable") {
    return {
      strokeColor: PLACED_COLOR,
      strokeWeight: style.strokeWidth,
      strokeOpacity: style.opacity,
    };
  }

  // REMOVED cable: neon red with repeating X marks
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
      icons: [
        {
          icon: xSymbol,
          offset: "0",
          repeat: "60px",
        },
      ],
    };
  }

  // All other polyline tools (line, arrow, polygon, freehand, measure)
  return {
    strokeColor: style.strokeColor,
    strokeWeight: style.strokeWidth,
    strokeOpacity: style.opacity,
    icons:
      style.strokeStyle === "dashed"
        ? [
            {
              icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: style.strokeWidth },
              offset: "0",
              repeat: "12px",
            },
          ]
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

// ── SVG label helpers ─────────────────────────────────────────────────────────

function escSvg(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeLabelSvg(text: string): string {
  const charW = 7;
  const pad = 10;
  const h = 18;
  const w = Math.max(36, text.length * charW + pad * 2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="4" ry="4" fill="white" stroke="#C8D0DA" stroke-width="1"/>` +
    `<text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" font-family="ui-monospace,Consolas,monospace" font-size="10" font-weight="bold" fill="#1A2332">${escSvg(text)}</text>` +
    `</svg>`
  );
}

function makeLabelMarker(
  position: google.maps.LatLngLiteral,
  text: string,
  map: google.maps.Map,
  zIndex: number
): google.maps.Marker {
  const svg = makeLabelSvg(text);
  const charW = 7;
  const pad = 10;
  const w = Math.max(36, text.length * charW + pad * 2);
  return new google.maps.Marker({
    position,
    map,
    icon: {
      url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
      // Anchor at left-center so label starts 18px to the right of the symbol
      anchor: new google.maps.Point(-18, 9),
      size: new google.maps.Size(w, 18),
    },
    clickable: false,
    zIndex: zIndex + 1,
    optimized: false,
  });
}

// ── Label position helpers ────────────────────────────────────────────────────

function midpointOfVertices(vertices: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const mid = vertices[Math.floor(vertices.length / 2)];
  return mid ?? vertices[0]!;
}

function centerOfBounds(bounds: { n: number; s: number; e: number; w: number }): { lat: number; lng: number } {
  return {
    lat: (bounds.n + bounds.s) / 2,
    lng: (bounds.e + bounds.w) / 2,
  };
}

function labelPositionForObj(obj: DrawingObject): { lat: number; lng: number } | null {
  if ("vertices" in obj) return midpointOfVertices(obj.vertices);
  if ("bounds" in obj) return centerOfBounds(obj.bounds);
  if ("position" in obj) return obj.position;
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DrawingOverlay() {
  const map = useMap();
  const { state, addObject, updateObject, deleteSelected, select, clearSelection, undo, redo } =
    useDrawing();
  const engineRef = useRef<DrawingEngine | null>(null);
  const overlaysRef = useRef<globalThis.Map<string, OverlayRef>>(new globalThis.Map());
  const measureInfoRef = useRef<globalThis.Map<string, google.maps.InfoWindow>>(new globalThis.Map());
  // Track last-rendered userLabel per object for incremental updates
  const labelVersionRef = useRef<globalThis.Map<string, string | undefined>>(new globalThis.Map());

  // Phase 5.1: pending object waiting for the details popup
  const [pendingObject, setPendingObject] = useState<{
    obj: DrawingObject;
    screenPos: { x: number; y: number };
  } | null>(null);

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
        if (pendingObject) return; // let popup handle Esc
        engineRef.current?.cancel();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, undo, redo, pendingObject]);

  // ─── Activate / deactivate drawing engine ────────────────────────────────
  useEffect(() => {
    if (!map) return;
    if (!engineRef.current) {
      engineRef.current = new DrawingEngine(map, addObject);
    }
    const engine = engineRef.current;

    // Phase 5.1: wire the pending object callback
    engine.onPendingObject = (obj, screenPos) => {
      setPendingObject({ obj, screenPos });
    };

    if (state.activeTool && state.activeTool !== "select") {
      engine.activate(state.activeTool, state.style);
    } else {
      engine.deactivate();
    }
  }, [map, state.activeTool, state.style, addObject]);

  // ─── Phase 5.1: clickable state per active tool ───────────────────────────
  useEffect(() => {
    if (!map) return;
    const isClickable = state.activeTool === "select" || state.activeTool === null;
    overlaysRef.current.forEach((overlay, key) => {
      // Don't toggle label markers (they're never clickable)
      if (key.endsWith("_label")) return;
      overlay.setOptions({ clickable: isClickable });
    });
  }, [map, state.activeTool]);

  // ─── Render objects ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;

    const isClickable = state.activeTool === "select" || state.activeTool === null;
    const currentIds = new Set(state.objects.map((o) => o.id));
    const renderedIds = new Set(overlaysRef.current.keys());

    // Remove deleted overlays (including their label counterparts)
    renderedIds.forEach((id) => {
      // Only check base IDs (not _label suffixes)
      if (id.endsWith("_label")) return;
      if (!currentIds.has(id)) {
        overlaysRef.current.get(id)?.setMap(null);
        overlaysRef.current.delete(id);
        // Remove label too
        const lbl = overlaysRef.current.get(id + "_label");
        if (lbl) { lbl.setMap(null); overlaysRef.current.delete(id + "_label"); }
        const iw = measureInfoRef.current.get(id);
        if (iw) { iw.close(); measureInfoRef.current.delete(id); }
        labelVersionRef.current.delete(id);
      }
    });

    // Add/update overlays
    state.objects.forEach((obj) => {
      // Phase 5: skip hidden objects
      if (obj.style.hidden) {
        const prev = overlaysRef.current.get(obj.id);
        if (prev) { prev.setMap(null); overlaysRef.current.delete(obj.id); }
        const prevLbl = overlaysRef.current.get(obj.id + "_label");
        if (prevLbl) { prevLbl.setMap(null); overlaysRef.current.delete(obj.id + "_label"); }
        return;
      }
      const isSelected = state.selectedIds.has(obj.id);
      const existing = overlaysRef.current.get(obj.id);

      if (existing) {
        if ("setOptions" in existing) {
          if (existing instanceof google.maps.Polyline || existing instanceof google.maps.Polygon) {
            existing.setOptions({
              strokeOpacity: isSelected ? 1 : obj.style.opacity,
              zIndex: isSelected ? 20 : 5,
              clickable: isClickable,
            });
          } else if (existing instanceof google.maps.Rectangle || existing instanceof google.maps.Circle) {
            existing.setOptions({
              strokeOpacity: isSelected ? 1 : obj.style.opacity,
              zIndex: isSelected ? 20 : 5,
              clickable: isClickable,
            });
          } else if (existing instanceof google.maps.Marker) {
            existing.setOptions({
              zIndex: isSelected ? 20 : 5,
              clickable: isClickable,
            });
          }
        }

        // Update label marker if userLabel changed
        const lastLabel = labelVersionRef.current.get(obj.id);
        const currentLabel = obj.style.userLabel;
        if (lastLabel !== currentLabel) {
          // Remove old label marker
          const oldLbl = overlaysRef.current.get(obj.id + "_label");
          if (oldLbl) { oldLbl.setMap(null); overlaysRef.current.delete(obj.id + "_label"); }
          // Create new label marker if label exists
          if (currentLabel) {
            const pos = labelPositionForObj(obj);
            if (pos) {
              const lblMarker = makeLabelMarker(pos, currentLabel, map, isSelected ? 20 : 5);
              overlaysRef.current.set(obj.id + "_label", lblMarker);
            }
          }
          labelVersionRef.current.set(obj.id, currentLabel);
        }
        return;
      }

      // Create new overlay
      const overlay = createOverlay(obj, map, isSelected, isClickable, (id, additive) => {
        select([id], additive);
      });
      if (overlay) overlaysRef.current.set(obj.id, overlay);

      // Create label marker if userLabel is set
      if (obj.style.userLabel) {
        const pos = labelPositionForObj(obj);
        if (pos) {
          const lblMarker = makeLabelMarker(pos, obj.style.userLabel, map, isSelected ? 20 : 5);
          overlaysRef.current.set(obj.id + "_label", lblMarker);
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

    return () => {
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current.clear();
      measureInfoRef.current.forEach((iw) => iw.close());
      measureInfoRef.current.clear();
      labelVersionRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, state.objects, state.selectedIds]);

  // Click on map background → clear selection
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", () => {
      if (state.activeTool === "select") {
        clearSelection();
      }
    });
    return () => listener.remove();
  }, [map, state.activeTool, clearSelection]);

  // ─── Details popup save/cancel ────────────────────────────────────────────

  function handlePopupSave(label: string, description: string) {
    if (!pendingObject) return;
    const { obj } = pendingObject;

    // For text objects, label becomes the displayed text content
    let finalObj: DrawingObject;
    if (obj.tool === "text") {
      finalObj = {
        ...obj,
        text: label || "Text",
        style: {
          ...obj.style,
          userLabel: label || undefined,
          description: description || undefined,
        },
      };
    } else {
      finalObj = {
        ...obj,
        style: {
          ...obj.style,
          userLabel: label || undefined,
          description: description || undefined,
        },
      };
    }

    addObject(finalObj);
    setPendingObject(null);
  }

  function handlePopupCancel() {
    setPendingObject(null);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  // Determine if the pending object is from a point tool (→ A-TAG placeholder)
  const pendingIsPoint = pendingObject
    ? isPointTool(pendingObject.obj.tool)
    : false;

  return (
    <>
      {pendingObject && (
        <ObjectDetailsPopup
          screenPos={pendingObject.screenPos}
          isPointTool={pendingIsPoint}
          onSave={handlePopupSave}
          onCancel={handlePopupCancel}
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
  onSelect: (id: string, additive: boolean) => void
): OverlayRef | null {
  const z = isSelected ? 20 : 5;

  const clickHandler = (e: google.maps.MapMouseEvent | google.maps.IconMouseEvent | Event) => {
    // Phase 5: locked objects are not selectable
    if (obj.style.locked) return;
    const native = (e as google.maps.MapMouseEvent).domEvent as MouseEvent | undefined;
    onSelect(obj.id, native?.shiftKey ?? false);
    (e as google.maps.MapMouseEvent).stop?.();
  };

  if ("vertices" in obj) {
    // Use dedicated cable options which hardcode colors
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
        bounds: {
          north: obj.bounds.n,
          south: obj.bounds.s,
          east: obj.bounds.e,
          west: obj.bounds.w,
        },
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
        path: google.maps.SymbolPath.CIRCLE,
        scale: 0,
      },
      draggable: true,
      clickable: isClickable,
      zIndex: z,
    });
    marker.addListener("click", clickHandler);
    return marker;
  }

  if ("position" in obj && !("text" in obj)) {
    // Point (telecom) object — use black icon, override with user color if set
    const pointSize = obj.style.pointSize;
    const icon = iconForTool(obj.tool, obj.style.strokeColor, pointSize ?? 1.0);
    const marker = new google.maps.Marker({
      position: new google.maps.LatLng(obj.position.lat, obj.position.lng),
      map,
      icon,
      title: obj.label ?? obj.tool,
      draggable: true,
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
