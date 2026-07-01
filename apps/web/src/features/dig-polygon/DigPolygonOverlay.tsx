// 811 Phase 1.5 — dig-shape drawing surface. Lives inside <Map>.
//
// Three ITIC-matching tools, chosen from the Telecom tab:
//   • radius  — click a center, set radius (≤100ft) → circle (πr², 2πr)
//   • route   — click path points, set width (≤500ft) → buffered corridor
//   • polygon — click boundary points, click first to close → freeform ring
// Every shape renders NEON ORANGE and persists to jobs/{jobId}.digPolygon as a
// DigShape via the API. A job that already has a shape loads it back for edit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import {
  buildRadiusShape,
  buildRouteShape,
  buildPolygonShape,
  radiusCircleVertices,
  routeBufferVertices,
  polygonAreaSqFt,
  polygonPerimeterFt,
  pathLengthFt,
  type DigShape,
  type LatLngVertex,
} from "@nsc/types";
import { useDigPolygon } from "./digPolygonContext.js";
import { useAuth } from "../auth/authContext.js";
import { api } from "../../lib/api.js";
import "./digPolygon.css";

// ── Neon orange theme (per 811 spec) ──────────────────────────────────────
const ORANGE = "#ff6a00";
const FILL_OPACITY = 0.2;
const CLOSE_THRESHOLD_PX = 14; // click within this of vertex 0 → close ring

const RADIUS_DEFAULT_FT = 25;
const RADIUS_MAX_FT = 100;
const ROUTE_DEFAULT_FT = 5;
const ROUTE_MAX_FT = 500;

function vertexIcon(): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 6,
    fillColor: "#fff2e6",
    fillOpacity: 1,
    strokeColor: ORANGE,
    strokeWeight: 2.5,
  };
}

function firstVertexIcon(): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 7,
    fillColor: ORANGE,
    fillOpacity: 0.9,
    strokeColor: "#fff2e6",
    strokeWeight: 3,
  };
}

const fmtArea = (sqft: number): string =>
  sqft >= 43_560
    ? `${(sqft / 43_560).toFixed(2)} ac (${Math.round(sqft).toLocaleString()} ft²)`
    : `${Math.round(sqft).toLocaleString()} ft²`;

const fmtLen = (ft: number): string => `${Math.round(ft).toLocaleString()} ft`;

export default function DigPolygonOverlay() {
  const map = useMap();
  const { tool, active, setTool, jobId, existing, onSaved } = useDigPolygon();
  const { username } = useAuth();

  // Shared drawing state. `verts` are the user-placed control points:
  //   radius  → [center]
  //   route   → path points
  //   polygon → ring vertices
  const [verts, setVerts] = useState<LatLngVertex[]>([]);
  const [closed, setClosed] = useState(false); // polygon only
  const [widthFt, setWidthFt] = useState(RADIUS_DEFAULT_FT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vertsRef = useRef<LatLngVertex[]>(verts);
  vertsRef.current = verts;
  const closedRef = useRef(closed);
  closedRef.current = closed;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const shapeRef = useRef<google.maps.Polygon | google.maps.Polyline | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);

  // ── (Re)initialize when the tool changes ─────────────────────────────────
  useEffect(() => {
    if (tool) {
      if (existing && existing.type === tool) {
        // Re-edit the saved shape with its own control points.
        if (existing.type === "radius") {
          setVerts([{ lat: existing.center.lat, lng: existing.center.lng }]);
          setWidthFt(existing.radiusFt);
          setClosed(false);
        } else if (existing.type === "route") {
          setVerts(existing.path.map((v) => ({ lat: v.lat, lng: v.lng })));
          setWidthFt(existing.widthFt);
          setClosed(false);
        } else {
          setVerts(existing.vertices.map((v) => ({ lat: v.lat, lng: v.lng })));
          setClosed(true);
        }
      } else {
        setVerts([]);
        setClosed(false);
        setWidthFt(tool === "radius" ? RADIUS_DEFAULT_FT : tool === "route" ? ROUTE_DEFAULT_FT : 0);
      }
      setError(null);
    } else {
      setVerts([]);
      setClosed(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // ── Map click → place a control point ────────────────────────────────────
  useEffect(() => {
    if (!map || !tool) return;
    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      const ll = e.latLng;
      if (!ll) return;
      const t = toolRef.current;
      if (t === "radius") {
        // One control point: the center. Subsequent clicks move it.
        setVerts([{ lat: ll.lat(), lng: ll.lng() }]);
        return;
      }
      if (t === "polygon" && closedRef.current) return;
      setVerts((prev) => [...prev, { lat: ll.lat(), lng: ll.lng() }]);
    });
    return () => listener.remove();
  }, [map, tool]);

  const closeRing = useCallback(() => {
    if (toolRef.current === "polygon" && vertsRef.current.length >= 3) setClosed(true);
  }, []);

  // Compute the rendered ring for the current tool + control points.
  const ring = useMemo<LatLngVertex[]>(() => {
    if (tool === "radius") {
      if (verts.length < 1 || widthFt <= 0) return [];
      return radiusCircleVertices(verts[0]!, widthFt).map((v) => ({ lat: v.lat, lng: v.lng }));
    }
    if (tool === "route") {
      if (verts.length < 2 || widthFt <= 0) return [];
      return routeBufferVertices(verts, widthFt).map((v) => ({ lat: v.lat, lng: v.lng }));
    }
    // polygon
    return verts;
  }, [tool, verts, widthFt]);

  // ── Sync google.maps overlays ────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    shapeRef.current?.setMap(null);
    shapeRef.current = null;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (!tool) return;

    const filled = tool === "radius" || tool === "route" || (tool === "polygon" && closed);
    if (filled && ring.length >= 3) {
      shapeRef.current = new google.maps.Polygon({
        paths: ring.map((v) => ({ lat: v.lat, lng: v.lng })),
        map,
        fillColor: ORANGE,
        fillOpacity: FILL_OPACITY,
        strokeColor: ORANGE,
        strokeWeight: 3,
        strokeOpacity: 1,
        clickable: false,
        zIndex: 40,
      });
    } else if (tool === "polygon" && verts.length >= 2) {
      shapeRef.current = new google.maps.Polyline({
        path: verts.map((v) => ({ lat: v.lat, lng: v.lng })),
        map,
        strokeColor: ORANGE,
        strokeWeight: 3,
        strokeOpacity: 1,
        clickable: false,
        zIndex: 40,
      });
    } else if (tool === "route" && verts.length >= 1) {
      shapeRef.current = new google.maps.Polyline({
        path: verts.map((v) => ({ lat: v.lat, lng: v.lng })),
        map,
        strokeColor: ORANGE,
        strokeWeight: 2,
        strokeOpacity: 0.7,
        clickable: false,
        zIndex: 41,
      });
    }

    // Draggable control-point handles.
    verts.forEach((v, i) => {
      const isFirst = i === 0;
      const canClose = tool === "polygon" && !closed && isFirst && verts.length >= 3;
      const marker = new google.maps.Marker({
        position: v,
        map,
        draggable: true,
        icon: isFirst ? firstVertexIcon() : vertexIcon(),
        zIndex: 50 + i,
        cursor: canClose ? "pointer" : "move",
        title: canClose ? "Click to close the ring" : undefined,
      });
      marker.addListener("dragend", (e: google.maps.MapMouseEvent) => {
        const ll = e.latLng;
        if (!ll) return;
        setVerts((prev) => {
          const next = [...prev];
          next[i] = { lat: ll.lat(), lng: ll.lng() };
          return next;
        });
      });
      if (canClose) marker.addListener("click", () => closeRing());
      markersRef.current.push(marker);
    });

    return () => {
      shapeRef.current?.setMap(null);
      shapeRef.current = null;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [map, tool, verts, ring, closed, closeRing]);

  // Pixel-proximity close for polygon.
  useEffect(() => {
    if (!map || tool !== "polygon" || closed) return;
    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      const cur = vertsRef.current;
      if (cur.length < 3 || !e.latLng) return;
      const proj = map.getProjection();
      const zoom = map.getZoom();
      if (!proj || zoom == null) return;
      const scale = 2 ** zoom;
      const toPx = (ll: google.maps.LatLng | { lat: number; lng: number }) => {
        const point = proj.fromLatLngToPoint(
          ll instanceof google.maps.LatLng ? ll : new google.maps.LatLng(ll.lat, ll.lng)
        );
        return point ? { x: point.x * scale, y: point.y * scale } : null;
      };
      const a = toPx(e.latLng);
      const b = toPx(cur[0]!);
      if (!a || !b) return;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= CLOSE_THRESHOLD_PX) closeRing();
    });
    return () => listener.remove();
  }, [map, tool, closed, closeRing]);

  // Live metrics per tool.
  const metrics = useMemo(() => {
    if (tool === "radius" && verts.length >= 1 && widthFt > 0) {
      return { area: Math.PI * widthFt * widthFt, perimeter: 2 * Math.PI * widthFt };
    }
    if (tool === "route" && verts.length >= 2 && widthFt > 0) {
      const len = pathLengthFt(verts);
      return { area: len * widthFt, perimeter: 2 * len + 2 * widthFt };
    }
    if (tool === "polygon" && verts.length >= 3) {
      return { area: polygonAreaSqFt(verts), perimeter: polygonPerimeterFt(verts) };
    }
    return { area: 0, perimeter: 0 };
  }, [tool, verts, widthFt]);

  const undo = useCallback(() => {
    if (tool === "polygon" && closed) {
      setClosed(false);
      return;
    }
    setVerts((prev) => prev.slice(0, -1));
  }, [tool, closed]);

  const redraw = useCallback(() => {
    setVerts([]);
    setClosed(false);
    setError(null);
  }, []);

  const buildShape = useCallback((): DigShape | null => {
    const by = username || "William";
    if (tool === "radius" && verts.length >= 1 && widthFt > 0) {
      return buildRadiusShape(verts[0]!, widthFt, by);
    }
    if (tool === "route" && verts.length >= 2 && widthFt > 0) {
      return buildRouteShape(verts, widthFt, by);
    }
    if (tool === "polygon" && verts.length >= 3) {
      return buildPolygonShape(verts, by);
    }
    return null;
  }, [tool, verts, widthFt, username]);

  const handleSave = useCallback(async () => {
    if (!jobId) return;
    const shape = buildShape();
    if (!shape) return;
    setSaving(true);
    setError(null);
    try {
      await api.putDigPolygon(jobId, shape);
      onSaved(shape);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save shape");
    } finally {
      setSaving(false);
    }
  }, [jobId, buildShape, onSaved]);

  const handleClear = useCallback(async () => {
    if (!jobId) return;
    setSaving(true);
    setError(null);
    try {
      await api.putDigPolygon(jobId, null);
      onSaved(null);
      setVerts([]);
      setClosed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear shape");
    } finally {
      setSaving(false);
    }
  }, [jobId, onSaved]);

  const handleCancel = useCallback(() => setTool(null), [setTool]);

  useEffect(() => {
    if (!tool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, handleCancel]);

  if (!active || !tool) return null;

  const canSave = !saving && buildShape() !== null;
  const maxWidth = tool === "route" ? ROUTE_MAX_FT : RADIUS_MAX_FT;
  const widthLabel = tool === "route" ? "WIDTH (ft)" : "RADIUS (ft)";

  const hint =
    tool === "radius"
      ? verts.length < 1
        ? "Click the map to drop the excavation center."
        : "Set the radius, then Save. Drag the center to move it."
      : tool === "route"
        ? verts.length < 2
          ? "Click along the excavation route (≥2 points)."
          : "Set the corridor width, then Save."
        : closed
          ? "Drag the handles to adjust, then Save."
          : verts.length < 3
            ? "Click the map to drop boundary points."
            : "Click the first point (orange) to close the ring.";

  const title =
    tool === "radius" ? "811 RADIUS DIG" : tool === "route" ? "811 ROUTE DIG" : "811 POLYGON DIG";

  const showWidth = tool === "radius" || tool === "route";

  return (
    <div className="dig-hud" role="dialog" aria-label="Dig shape tool">
      <div className="dig-hud__title">
        <span className="dig-hud__dot" /> {title}
      </div>
      <div className="dig-hud__hint">{hint}</div>

      {showWidth && (
        <div className="dig-hud__width">
          <label className="dig-hud__metric-label" htmlFor="dig-width">
            {widthLabel}
          </label>
          <input
            id="dig-width"
            className="dig-hud__width-input"
            type="number"
            min={1}
            max={maxWidth}
            step={1}
            value={widthFt}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setWidthFt(Math.max(1, Math.min(maxWidth, n)));
            }}
          />
          <input
            className="dig-hud__width-slider"
            type="range"
            min={1}
            max={maxWidth}
            step={1}
            value={widthFt}
            onChange={(e) => setWidthFt(Number(e.target.value))}
          />
        </div>
      )}

      <div className="dig-hud__metrics">
        <div className="dig-hud__metric">
          <span className="dig-hud__metric-label">AREA</span>
          <span className="dig-hud__metric-value">
            {metrics.area > 0 ? fmtArea(metrics.area) : "—"}
          </span>
        </div>
        <div className="dig-hud__metric">
          <span className="dig-hud__metric-label">PERIMETER</span>
          <span className="dig-hud__metric-value">
            {metrics.perimeter > 0 ? fmtLen(metrics.perimeter) : "—"}
          </span>
        </div>
        <div className="dig-hud__metric">
          <span className="dig-hud__metric-label">POINTS</span>
          <span className="dig-hud__metric-value">{verts.length}</span>
        </div>
      </div>

      {error && <div className="dig-hud__error">{error}</div>}

      <div className="dig-hud__actions">
        <button className="dig-btn" onClick={undo} disabled={verts.length === 0 || saving}>
          {tool === "polygon" && closed ? "Reopen" : "Undo point"}
        </button>
        <button className="dig-btn" onClick={redraw} disabled={verts.length === 0 || saving}>
          Redraw
        </button>
        <button className="dig-btn dig-btn--primary" onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="dig-hud__actions">
        <button className="dig-btn" onClick={handleCancel} disabled={saving}>
          Cancel
        </button>
        {existing && (
          <button className="dig-btn dig-btn--danger" onClick={handleClear} disabled={saving}>
            Clear saved
          </button>
        )}
      </div>
    </div>
  );
}
