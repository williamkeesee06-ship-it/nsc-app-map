// Job Workspace — Phase 2. Map + toolbar + draw PLACED + save/load,
// now with a populated Job Card panel on the right.
//
// Centering rule:
//   1) If as-built has geometry, fit to that.
//   2) Else if the job has a geocode, center there.
//   3) Else fall back to Snoqualmie default.
import { useCallback, useEffect, useState } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { useParams } from "react-router-dom";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import DrawPlacedTool from "./DrawPlacedTool.js";
import { useAsbuilt } from "./useAsbuilt.js";
import { useJob } from "./useJob.js";
import JobCard from "../jobs-map/JobCard.js";
import type { MapLine } from "@nsc/types";

const PLACED_COLOR = "#ff7847";
const REMOVED_COLOR = "#d163a7";

export default function JobWorkspace() {
  const { jobId = "sample" } = useParams();
  const { doc, save, state, error, saving } = useAsbuilt(jobId);
  const jobState = useJob(jobId);
  const { theme } = useMapTheme();
  const [drawing, setDrawing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [localLines, setLocalLines] = useState<MapLine[]>([]);

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

  // Compute initial map center: as-built geometry > job geocode > default.
  const jobCenter =
    jobState.state === "ready" &&
    jobState.job.geocode &&
    jobState.job.geocode.status === "OK"
      ? { lat: jobState.job.geocode.lat, lng: jobState.job.geocode.lng }
      : null;
  const center = jobCenter ?? DEFAULT_CENTER;
  const zoom = jobCenter ? 16 : DEFAULT_ZOOM;

  return (
    <div className="job-workspace">
      <div className="job-workspace__main">
        <div className="map-host">
          <Map
            // Keying on center forces re-init when job loads.
            key={`${center.lat},${center.lng}`}
            defaultCenter={center}
            defaultZoom={zoom}
            styles={stylesFor(theme)}
            gestureHandling="greedy"
          >
            <SavedLines lines={localLines} />
            <FitToGeometry lines={localLines} fallback={center} fallbackZoom={zoom} />
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
            {state === "loading"
              ? "Loading…"
              : state === "error"
                ? "Load error"
                : `${localLines.length} line(s)`}
          </span>
          {error && (
            <span style={{ color: "var(--danger)", fontSize: 11 }}>{error}</span>
          )}
        </div>
      </div>

      <aside className="job-workspace__card">
        {jobState.state === "loading" && <div className="muted">Loading job…</div>}
        {jobState.state === "missing" && (
          <div className="muted">
            No job record for <code>{jobId}</code>. This is fine for the sample
            workspace, but normally you'd open a job from the Jobs Map.
          </div>
        )}
        {jobState.state === "error" && (
          <div style={{ color: "var(--danger)" }}>
            {jobState.message}
          </div>
        )}
        {jobState.state === "ready" && (
          <JobCard job={jobState.job} variant="panel" />
        )}
      </aside>
    </div>
  );
}

function SavedLines({ lines }: { lines: MapLine[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const polylines = lines.map(
      (ln) =>
        new google.maps.Polyline({
          path: ln.path.map((p) => new google.maps.LatLng(p.lat, p.lng)),
          strokeColor: ln.category === "PLACED" ? PLACED_COLOR : REMOVED_COLOR,
          strokeWeight: 4,
          strokeOpacity: 0.9,
          map,
        })
    );
    return () => polylines.forEach((p) => p.setMap(null));
  }, [map, lines]);
  return null;
}

// Fits map bounds to existing geometry on load (per spec: "click a Smartsheet
// job should automatically zoom to job extents when geometry exists").
function FitToGeometry({
  lines,
  fallback,
  fallbackZoom,
}: {
  lines: MapLine[];
  fallback: { lat: number; lng: number };
  fallbackZoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (lines.length === 0) {
      map.setCenter(fallback);
      map.setZoom(fallbackZoom);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    lines.forEach((ln) =>
      ln.path.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }))
    );
    map.fitBounds(bounds, 80);
    // Only run on first geometry load, not every map prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, lines.length]);
  return null;
}
