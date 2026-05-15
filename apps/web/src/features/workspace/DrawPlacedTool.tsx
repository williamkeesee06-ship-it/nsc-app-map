// PLACED cable draw tool. Click on the map to add vertices; finish to commit.
// This implements the Phase 1 end-to-end acceptance criterion.
import { useCallback, useEffect, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { LatLng, MapLine } from "@nsc/types";

interface Props {
  active: boolean;
  onFinish: (line: MapLine) => void;
  onCancel: () => void;
}

const PLACED_COLOR = "#ff7847";

export default function DrawPlacedTool({ active, onFinish, onCancel }: Props) {
  const map = useMap();
  const [vertices, setVertices] = useState<LatLng[]>([]);
  const [polyline, setPolyline] = useState<google.maps.Polyline | null>(null);

  // Manage one live polyline that mirrors the working vertices.
  useEffect(() => {
    if (!map) return;
    if (!active) {
      polyline?.setMap(null);
      setPolyline(null);
      setVertices([]);
      return;
    }
    const pl = new google.maps.Polyline({
      path: [],
      strokeColor: PLACED_COLOR,
      strokeWeight: 4,
      strokeOpacity: 0.95,
      map,
      clickable: false,
    });
    setPolyline(pl);
    return () => { pl.setMap(null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, map]);

  useEffect(() => {
    if (polyline) {
      polyline.setPath(vertices.map((v) => new google.maps.LatLng(v.lat, v.lng)));
    }
  }, [vertices, polyline]);

  // Click listener — add a vertex.
  useEffect(() => {
    if (!map || !active) return;
    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      setVertices((prev) => [...prev, { lat: e.latLng!.lat(), lng: e.latLng!.lng() }]);
    });
    return () => listener.remove();
  }, [map, active]);

  const finish = useCallback(() => {
    if (vertices.length < 2) {
      onCancel();
      return;
    }
    const line: MapLine = {
      id: `ln_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      category: "PLACED",
      path: vertices,
      createdAt: Date.now(),
    };
    onFinish(line);
    setVertices([]);
  }, [vertices, onFinish, onCancel]);

  if (!active) return null;
  return (
    <div style={{
      position: "absolute", top: 14, right: 14, zIndex: 10,
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 8, padding: 10, display: "flex", gap: 8, alignItems: "center",
    }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Drawing PLACED · {vertices.length} pts · click map to add
      </span>
      <button className="primary" onClick={finish} disabled={vertices.length < 2}>Finish</button>
      <button className="danger" onClick={onCancel}>Cancel</button>
    </div>
  );
}
