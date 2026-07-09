import { useEffect, useMemo, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import {
  radiusCircleVertices,
  routeBufferVertices,
  type LatLngVertex,
  type Job,
} from "@nsc/types";

interface AllDigShapesOverlayProps {
  jobs: Job[];
  activeJobId?: string | null;
}

export default function AllDigShapesOverlay({ jobs, activeJobId }: AllDigShapesOverlayProps) {
  const map = useMap();
  const polygonsRef = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    if (!map) return;

    // Clear existing polygons
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];

    const now = Date.now();
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

    jobs.forEach((job) => {
      // Don't duplicate the selected editing shape if it's active
      if (job.jobId === activeJobId) return;

      const shape = job.digPolygon;
      if (!shape) return;

      // Determine ring geometry
      // shape may be a legacy PolygonData (no `type` field) or a modern DigShape.
      let ring: LatLngVertex[] = [];
      if ("type" in shape && shape.type === "radius") {
        ring = radiusCircleVertices(shape.center, shape.radiusFt).map((v) => ({
          lat: v.lat,
          lng: v.lng,
        }));
      } else if ("type" in shape && shape.type === "route") {
        ring = routeBufferVertices(shape.path, shape.widthFt).map((v) => ({
          lat: v.lat,
          lng: v.lng,
        }));
      } else {
        ring = shape.vertices.map((v) => ({ lat: v.lat, lng: v.lng }));
      }

      if (ring.length < 3) return;

      // Calculate locate ticket status color
      let color = "#8e96a0"; // Gray: Pending/No Ticket
      let fillOpacity = 0.15;

      if (job.locateExpires) {
        const expiresAt = typeof job.locateExpires === "string" ? new Date(job.locateExpires).getTime() : job.locateExpires;
        if (expiresAt > now + fiveDaysMs) {
          color = "#00E676"; // Green: Active & Cleared
          fillOpacity = 0.25;
        } else {
          color = "#ff2d4a"; // Red: Expired or Expiring soon
          fillOpacity = 0.35;
        }
      }

      const poly = new google.maps.Polygon({
        paths: ring.map((v) => ({ lat: v.lat, lng: v.lng })),
        map,
        fillColor: color,
        fillOpacity: fillOpacity,
        strokeColor: color,
        strokeWeight: 2,
        strokeOpacity: 0.8,
        clickable: false,
        zIndex: 10,
      });

      polygonsRef.current.push(poly);
    });

    return () => {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, jobs, activeJobId]);

  return null;
}
