// QuickRefLayer — Phase 7: renders the saved Quick Reference Gist on the
// JobsMap. Visual rendering rules MUST match As-Built mode:
//   - Aerial cable → solid line
//   - Underground cable → dashed line
//   - NEW → red #FF0000
//   - REMOVED → green #00AA00
// (Per spec — note this is the Quick-Mode/QuickRef palette, NOT the as-built
// PLACED-green/REMOVED-red palette used inside the workspace.)
import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { QuickReferenceGist } from "@nsc/types";

const NEW_COLOR = "#FF0000";
const REMOVED_COLOR = "#00AA00";

interface Props {
  gist: QuickReferenceGist | null;
}

export default function QuickRefLayer({ gist }: Props) {
  const map = useMap();
  const overlaysRef = useRef<google.maps.MVCObject[]>([]);

  useEffect(() => {
    if (!map) return;
    // Clear previous
    overlaysRef.current.forEach((o) => {
      if ("setMap" in o) (o as unknown as { setMap: (m: google.maps.Map | null) => void }).setMap(null);
    });
    overlaysRef.current = [];
    if (!gist) return;

    for (const line of gist.lines) {
      const color = line.status === "NEW" ? NEW_COLOR : REMOVED_COLOR;
      const aerial = line.medium === "AERIAL";
      const opts: google.maps.PolylineOptions = {
        path: line.path,
        strokeColor: color,
        strokeOpacity: aerial ? 1 : 0,
        strokeWeight: 3,
        map,
        clickable: false,
        zIndex: 5,
      };
      if (!aerial) {
        // Dashed line via icon repeat
        opts.icons = [
          {
            icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 2.5 },
            offset: "0",
            repeat: "10px",
          },
        ];
      }
      const pl = new google.maps.Polyline(opts);
      overlaysRef.current.push(pl);
    }

    for (const pt of gist.points) {
      const color = pt.status === "NEW" ? NEW_COLOR : REMOVED_COLOR;
      const m = new google.maps.Marker({
        map,
        position: pt.position,
        clickable: false,
        title: `${pt.pointType}${pt.label ? " · " + pt.label : ""}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: "#fff",
          strokeWeight: 1.5,
        },
      });
      overlaysRef.current.push(m);
    }

    return () => {
      overlaysRef.current.forEach((o) => {
        if ("setMap" in o) (o as unknown as { setMap: (m: google.maps.Map | null) => void }).setMap(null);
      });
      overlaysRef.current = [];
    };
  }, [map, gist]);

  return null;
}
