// 811 — read-only overlay for the SAVED dig shape.
//
// While the editing tool (DigPolygonOverlay) is inactive we still want the map
// to show the job's saved locate coverage. This renders the persisted shape in
// the same neon-orange theme as the live drawing but with NO control-point
// markers, drag handles, or hit region — pure display. It hides itself the
// moment a tool becomes active so the two overlays never fight.
import { useEffect, useMemo, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import {
  radiusCircleVertices,
  routeBufferVertices,
  type LatLngVertex,
} from "@nsc/types";
import { useDigPolygon } from "./digPolygonContext.js";

const ORANGE = "#ff6a00";
const FILL_OPACITY = 0.2;

export default function SavedDigShapeOverlay() {
  const map = useMap();
  const { tool, existing } = useDigPolygon();

  // The closed ring to render for the saved shape, matching how the live
  // overlay derives geometry from a shape's own parameters.
  const ring = useMemo<LatLngVertex[]>(() => {
    if (!existing) return [];
    if (existing.type === "radius") {
      return radiusCircleVertices(existing.center, existing.radiusFt).map((v) => ({
        lat: v.lat,
        lng: v.lng,
      }));
    }
    if (existing.type === "route") {
      return routeBufferVertices(existing.path, existing.widthFt).map((v) => ({
        lat: v.lat,
        lng: v.lng,
      }));
    }
    return existing.vertices.map((v) => ({ lat: v.lat, lng: v.lng }));
  }, [existing]);

  const shapeRef = useRef<google.maps.Polygon | null>(null);

  useEffect(() => {
    if (!map) return;
    shapeRef.current?.setMap(null);
    shapeRef.current = null;
    // Hide while editing so the live overlay owns the shape.
    if (tool !== null || ring.length < 3) return;

    shapeRef.current = new google.maps.Polygon({
      paths: ring.map((v) => ({ lat: v.lat, lng: v.lng })),
      map,
      fillColor: ORANGE,
      fillOpacity: FILL_OPACITY,
      strokeColor: ORANGE,
      strokeWeight: 3,
      strokeOpacity: 1,
      clickable: false,
      zIndex: 39,
    });

    return () => {
      shapeRef.current?.setMap(null);
      shapeRef.current = null;
    };
  }, [map, tool, ring]);

  return null;
}
