// Job Workspace — Phase 1 sample shell. Map + toolbar + draw PLACED + save/load.
// Acceptance: draw a polyline, click Save, refresh, polyline reloads from Firestore.
import { useCallback, useEffect, useState } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { useParams } from "react-router-dom";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import DrawPlacedTool from "./DrawPlacedTool.js";
import { useAsbuilt } from "./useAsbuilt.js";
import type { MapLine } from "@nsc/types";

const PLACED_COLOR = "#ff7847";
const REMOVED_COLOR = "#d163a7";

export default function JobWorkspace() {
  const { jobId = "sample" } = useParams();
  const { doc, save, state, error, saving } = useAsbuilt(jobId);
  const { theme } = useMapTheme();
  const [drawing, setDrawing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [localLines, setLocalLines] = useState<MapLine[]>([]);

  // When the server doc loads, hydrate local working copy.
  useEffect(() => {
    if (state === "ready") setLocalLines(doc.lines);
  }, [state, doc]);

  const onFinishLine = useCallback((line: MapLine) => {
    setLocalLines((prev) => [...prev, line]);
    setDrawing(false);
    setDirty(true);
  }, []);

  const onSave = useCallback(async () => {
    await save({ ...doc, lines: localLines, points: doc.points });
    setDirty(false);
  }, [save, doc, localLines]);

  return (
    <div className="workspace">
      <div className="map-host">
        <Map
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          styles={stylesFor(theme)}
          gestureHandling="greedy"
        >
          <SavedLines lines={localLines} />
        </Map>
        <DrawPlacedTool
          active={drawing}
          onFinish={onFinishLine}
          onCancel={() => setDrawing(false)}
        />
      </div>

      <div className="toolbar">
        <span className="label">Job · {jobId}</span>
        <button onClick={() => setDrawing(true)} disabled={drawing}>
          Draw PLACED cable
        </button>
        <button className="primary" onClick={onSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : dirty ? "Save as-built" : "Saved"}
        </button>
        <span className="label" style={{ marginTop: 6 }}>
          {state === "loading" ? "Loading…" :
           state === "error" ? "Load error" :
           `${localLines.length} line(s)`}
        </span>
        {error && <span style={{ color: "var(--danger)", fontSize: 11 }}>{error}</span>}
      </div>
    </div>
  );
}

// Renders persisted lines on the map.
function SavedLines({ lines }: { lines: MapLine[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const polylines = lines.map((ln) => new google.maps.Polyline({
      path: ln.path.map((p) => new google.maps.LatLng(p.lat, p.lng)),
      strokeColor: ln.category === "PLACED" ? PLACED_COLOR : REMOVED_COLOR,
      strokeWeight: 4,
      strokeOpacity: 0.9,
      map,
    }));
    return () => polylines.forEach((p) => p.setMap(null));
  }, [map, lines]);
  return null;
}
