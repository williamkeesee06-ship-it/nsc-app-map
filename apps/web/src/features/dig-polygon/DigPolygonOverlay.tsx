// 811 Phase 1 — dig polygon drawing surface. Lives inside <Map>.
//
// Draw mode is toggled from the Telecom tab. While active:
//   • click the map to drop excavation-boundary vertices
//   • click the first vertex (≥3 points down) to close the ring
//   • drag any chrome-disc handle to fine-tune
//   • live area (shoelace) + perimeter (spherical law of cosines) HUD
// On Save we persist to jobs/{jobId}.digPolygon via the API. A job that
// already has a polygon loads it back for re-editing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import {
  buildPolygonData,
  polygonAreaSqFt,
  polygonPerimeterFt,
  type LatLngVertex,
} from "@nsc/types";
import { useDigPolygon } from "./digPolygonContext.js";
import { useAuth } from "../auth/authContext.js";
import { api } from "../../lib/api.js";
import "./digPolygon.css";

// ── Neon Pulse Light theme ────────────────────────────────────────────────
const CYAN = "#06b6d4";
const FILL = "rgba(6, 182, 212, 0.15)";
const CLOSE_THRESHOLD_PX = 14; // click within this of vertex 0 → close ring

// Chrome-bezel disc used for every draggable vertex handle. Concentric grey
// gradient with a cyan core so handles read as "live" against the fill.
function vertexIcon(): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 6,
    fillColor: "#e8edf2",
    fillOpacity: 1,
    strokeColor: CYAN,
    strokeWeight: 2.5,
  };
}

// The first vertex gets a fatter cyan ring so the user can see the close target.
function firstVertexIcon(): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 7,
    fillColor: CYAN,
    fillOpacity: 0.9,
    strokeColor: "#e8edf2",
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
  const { active, setActive, jobId, existing, onSaved } = useDigPolygon();
  const { username } = useAuth();

  const [verts, setVerts] = useState<LatLngVertex[]>([]);
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a live ref for imperative google.maps listeners (avoid stale closures).
  const vertsRef = useRef<LatLngVertex[]>(verts);
  vertsRef.current = verts;
  const closedRef = useRef(closed);
  closedRef.current = closed;

  const shapeRef = useRef<google.maps.Polygon | google.maps.Polyline | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const mapClickRef = useRef<google.maps.MapsEventListener | null>(null);

  // ── Initialize when draw mode turns on/off ───────────────────────────────
  // Intentionally keyed on `active` only: we don't want an incoming `existing`
  // update (e.g. from our own save) to blow away an in-progress edit.
  useEffect(() => {
    if (active) {
      if (existing && existing.vertices.length >= 3) {
        setVerts(existing.vertices.map((v) => ({ lat: v.lat, lng: v.lng })));
        setClosed(true);
      } else {
        setVerts([]);
        setClosed(false);
      }
      setError(null);
    } else {
      setVerts([]);
      setClosed(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ── Map click → append a vertex (only while drawing an open ring) ─────────
  useEffect(() => {
    if (!map || !active) return;
    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (closedRef.current) return;
      const ll = e.latLng;
      if (!ll) return;
      setVerts((prev) => [...prev, { lat: ll.lat(), lng: ll.lng() }]);
    });
    mapClickRef.current = listener;
    return () => {
      listener.remove();
      mapClickRef.current = null;
    };
  }, [map, active]);

  const closeRing = useCallback(() => {
    if (vertsRef.current.length >= 3) setClosed(true);
  }, []);

  // ── Sync google.maps overlays to [verts, closed, active] ──────────────────
  useEffect(() => {
    if (!map) return;

    // Tear down previous render.
    shapeRef.current?.setMap(null);
    shapeRef.current = null;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (!active || verts.length === 0) return;

    const path = verts.map((v) => ({ lat: v.lat, lng: v.lng }));

    if (closed && verts.length >= 3) {
      shapeRef.current = new google.maps.Polygon({
        paths: path,
        map,
        fillColor: CYAN,
        fillOpacity: 0.15,
        strokeColor: CYAN,
        strokeWeight: 2,
        strokeOpacity: 1,
        clickable: false,
        zIndex: 40,
      });
    } else if (verts.length >= 2) {
      shapeRef.current = new google.maps.Polyline({
        path,
        map,
        strokeColor: CYAN,
        strokeWeight: 2,
        strokeOpacity: 1,
        clickable: false,
        zIndex: 40,
      });
    }

    // Draggable chrome-disc handle per vertex.
    verts.forEach((v, i) => {
      const isFirst = i === 0;
      const marker = new google.maps.Marker({
        position: v,
        map,
        draggable: true,
        icon: isFirst ? firstVertexIcon() : vertexIcon(),
        zIndex: 50 + i,
        cursor: !closed && isFirst && verts.length >= 3 ? "pointer" : "move",
        title: !closed && isFirst && verts.length >= 3 ? "Click to close the ring" : undefined,
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
      if (isFirst) {
        marker.addListener("click", () => {
          if (!closedRef.current) closeRing();
        });
      }
      markersRef.current.push(marker);
    });

    return () => {
      shapeRef.current?.setMap(null);
      shapeRef.current = null;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [map, verts, closed, active, closeRing]);

  // ── Pixel-proximity close: clicking near vertex 0 also closes ─────────────
  // (Belt-and-suspenders alongside the marker click, since a fast click may
  // land on the map just beside the small handle.)
  useEffect(() => {
    if (!map || !active || closed) return;
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
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist <= CLOSE_THRESHOLD_PX) closeRing();
    });
    return () => listener.remove();
  }, [map, active, closed, closeRing]);

  const metrics = useMemo(() => {
    if (verts.length < 3) return { area: 0, perimeter: 0 };
    return {
      area: polygonAreaSqFt(verts),
      perimeter: polygonPerimeterFt(verts),
    };
  }, [verts]);

  const undoVertex = useCallback(() => {
    if (closed) {
      setClosed(false);
      return;
    }
    setVerts((prev) => prev.slice(0, -1));
  }, [closed]);

  const handleSave = useCallback(async () => {
    if (!jobId || verts.length < 3) return;
    setSaving(true);
    setError(null);
    try {
      const data = buildPolygonData(verts, username || "William");
      await api.putDigPolygon(jobId, data);
      onSaved(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save polygon");
    } finally {
      setSaving(false);
    }
  }, [jobId, verts, username, onSaved]);

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
      setError(e instanceof Error ? e.message : "Failed to clear polygon");
    } finally {
      setSaving(false);
    }
  }, [jobId, onSaved]);

  const handleRedraw = useCallback(() => {
    setVerts([]);
    setClosed(false);
    setError(null);
  }, []);

  const handleCancel = useCallback(() => {
    setActive(false);
  }, [setActive]);

  // Escape cancels draw mode.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, handleCancel]);

  if (!active) return null;

  const canSave = verts.length >= 3 && !saving;
  const hint = closed
    ? "Drag the chrome handles to adjust, then Save."
    : verts.length < 3
      ? "Click the map to drop excavation-boundary points."
      : "Click the first point (cyan) to close the ring.";

  return (
    <div className="dig-hud" role="dialog" aria-label="Dig polygon tool">
      <div className="dig-hud__title">
        <span className="dig-hud__dot" /> 811 DIG POLYGON
      </div>
      <div className="dig-hud__hint">{hint}</div>
      <div className="dig-hud__metrics">
        <div className="dig-hud__metric">
          <span className="dig-hud__metric-label">AREA</span>
          <span className="dig-hud__metric-value">
            {verts.length >= 3 ? fmtArea(metrics.area) : "—"}
          </span>
        </div>
        <div className="dig-hud__metric">
          <span className="dig-hud__metric-label">PERIMETER</span>
          <span className="dig-hud__metric-value">
            {verts.length >= 3 ? fmtLen(metrics.perimeter) : "—"}
          </span>
        </div>
        <div className="dig-hud__metric">
          <span className="dig-hud__metric-label">POINTS</span>
          <span className="dig-hud__metric-value">{verts.length}</span>
        </div>
      </div>

      {error && <div className="dig-hud__error">{error}</div>}

      <div className="dig-hud__actions">
        <button
          className="dig-btn"
          onClick={undoVertex}
          disabled={verts.length === 0 || saving}
        >
          {closed ? "Reopen" : "Undo point"}
        </button>
        <button className="dig-btn" onClick={handleRedraw} disabled={verts.length === 0 || saving}>
          Redraw
        </button>
        <button
          className="dig-btn dig-btn--primary"
          onClick={handleSave}
          disabled={!canSave}
        >
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
