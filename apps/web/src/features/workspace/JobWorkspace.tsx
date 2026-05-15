// JobWorkspace — Phase 5: Focused single-job editor.
// Reuses the same drawing engine, left rail, and modifier strip as the Jobs Map,
// but filters to one job, hides non-active markers, and enables auto-save.
import { useCallback, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import { DrawingProvider, useDrawing } from "../drawing/drawingContext.js";
import DrawingOverlay from "../drawing/DrawingOverlay.js";
import ModifiersPanel from "../drawing/ModifiersPanel.js";
import LeftRail from "../jobs-map/LeftRail.js";
import { defaultFilters } from "../jobs-map/FilterRail.js";
import { api } from "../../lib/api.js";
import JobContextStrip from "./JobContextStrip.js";
import LayersPanel from "./LayersPanel.js";
import { useJob } from "./useJob.js";

export default function JobWorkspace() {
  const { jobId = "" } = useParams<{ jobId: string }>();
  const { theme } = useMapTheme();
  const mapRef = useRef<google.maps.Map | null>(null);

  return (
    <DrawingProvider mapRef={mapRef}>
      <WorkspaceInner jobId={jobId} theme={theme} mapRef={mapRef} />
    </DrawingProvider>
  );
}

// ── Inner component (has access to DrawingContext) ────────────────────────────

interface InnerProps {
  jobId: string;
  theme: ReturnType<typeof useMapTheme>["theme"];
  mapRef: React.MutableRefObject<google.maps.Map | null>;
}

function WorkspaceInner({ jobId, theme, mapRef }: InnerProps) {
  const { setTarget, loadObjects, setWorkspaceJobId } = useDrawing();
  const jobState = useJob(jobId);

  // Set drawing target + workspace mode on mount
  useEffect(() => {
    if (jobId) {
      setWorkspaceJobId(jobId);
    }
    return () => {
      setWorkspaceJobId(null);
    };
  }, [jobId, setWorkspaceJobId]);

  // Load job drawings when job is ready
  useEffect(() => {
    if (!jobId) return;
    const wo = jobState.state === "ready" ? jobState.job.workOrder : null;
    setTarget(jobId, wo);

    api.getDrawing(jobId)
      .then((doc) => {
        if (doc && "objects" in doc && Array.isArray(doc.objects)) {
          loadObjects(doc.objects);
        } else {
          loadObjects([]);
        }
      })
      .catch(() => {
        loadObjects([]);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Compute fallback center from job geocode
  const jobCenter =
    jobState.state === "ready" &&
    jobState.job.geocode?.status === "OK" &&
    jobState.job.geocode.lat !== 0
      ? { lat: jobState.job.geocode.lat, lng: jobState.job.geocode.lng }
      : null;
  const center = jobCenter ?? DEFAULT_CENTER;
  const fallbackZoom = jobCenter ? 17 : DEFAULT_ZOOM;

  return (
    <div className="workspace-layout">
      {/* Job context strip below topbar */}
      {jobId && <JobContextStrip jobId={jobId} />}

      <div className="workspace-layout__body">
        {/* Left rail (tools only — no filter rail in workspace mode) */}
        <WorkspaceLeftRail />

        {/* Map area */}
        <div className="workspace-layout__map">
          <ModifiersPanel />
          <div className="map-host" style={{ position: "absolute", inset: 0, top: 0 }}>
            <Map
              defaultCenter={center}
              defaultZoom={fallbackZoom}
              styles={stylesFor(theme)}
              gestureHandling="greedy"
              disableDefaultUI={false}
            >
              <MapHandle mapRef={mapRef} />
              <FitToJobGeometry jobId={jobId} fallback={center} fallbackZoom={fallbackZoom} />
              <DrawingOverlay />
            </Map>
          </div>
        </div>

        {/* Layers panel (right side) */}
        <LayersPanel />
      </div>
    </div>
  );
}

// ── Left rail without filter section ────────────────────────────────────────

function WorkspaceLeftRail() {
  const mapRef = useRef<google.maps.Map | null>(null);
  // LeftRail needs a mapRef but we don't use filter callbacks in workspace mode.
  // We pass stub filter props so TypeScript is happy.
  const noopFilters = defaultFilters();
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noop = useCallback(() => {}, []);

  return (
    <LeftRail
      jobs={[]}
      filters={noopFilters}
      setFilters={noop}
      onResync={noop}
      mapRef={mapRef}
      hideFilters
    />
  );
}

// ── Map handle ───────────────────────────────────────────────────────────────

function MapHandle({ mapRef }: { mapRef: React.MutableRefObject<google.maps.Map | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map ?? null;
    return () => {
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [map, mapRef]);
  return null;
}

// ── Fit map to drawing geometry ───────────────────────────────────────────────

function FitToJobGeometry({
  jobId,
  fallback,
  fallbackZoom,
}: {
  jobId: string;
  fallback: { lat: number; lng: number };
  fallbackZoom: number;
}) {
  const map = useMap();
  const { state } = useDrawing();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!map || fittedRef.current) return;
    // Wait until objects are loaded (if drawings exist, length > 0)
    if (state.objects.length === 0) {
      // No drawings: fit to geocode
      map.setCenter(fallback);
      map.setZoom(fallbackZoom);
      fittedRef.current = true;
      return;
    }

    // Fit to drawing geometry bounds
    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;
    for (const obj of state.objects) {
      if ("vertices" in obj) {
        obj.vertices.forEach((v) => { bounds.extend(v); hasPoints = true; });
      } else if ("bounds" in obj) {
        const b = obj.bounds;
        bounds.extend({ lat: b.n, lng: b.e });
        bounds.extend({ lat: b.s, lng: b.w });
        hasPoints = true;
      } else if ("position" in obj) {
        bounds.extend(obj.position);
        hasPoints = true;
      }
    }
    if (hasPoints) {
      map.fitBounds(bounds, 80);
    } else {
      map.setCenter(fallback);
      map.setZoom(fallbackZoom);
    }
    fittedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, jobId, state.objects.length > 0]);

  return null;
}
