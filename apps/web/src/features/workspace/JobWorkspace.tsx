// JobWorkspace — Phase 5: Focused single-job editor.
// Reuses the same drawing engine, left rail, and modifier strip as the Jobs Map,
// but filters to one job, hides non-active markers, and enables auto-save.
// Phase 5.3: auto-center on job geocode at zoom 19 on workspace entry.
import { useCallback, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import { DrawingProvider, useDrawing } from "../drawing/drawingContext.js";
import DrawingOverlay from "../drawing/DrawingOverlay.js";
// MapTypeToggle removed — map type/theme now lives in LeftRail Filters tab (MapTypeFilterSection).
import MapTypeApplier from "../map/MapTypeApplier.js";
import ModifiersPanel from "../drawing/ModifiersPanel.js";
import LeftRail from "../jobs-map/LeftRail.js";
import { defaultFilters } from "../jobs-map/FilterRail.js";
import { api } from "../../lib/api.js";
import LayersPanel from "./LayersPanel.js";
import { useJob } from "./useJob.js";

const WORKSPACE_ZOOM = 19; // street-level, ready for placing physical infrastructure

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
          const layers = "layers" in doc && Array.isArray(doc.layers) ? doc.layers : [];
          loadObjects(doc.objects, layers);
        } else {
          loadObjects([], []);
        }
      })
      .catch(() => {
        loadObjects([], []);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Compute initial center (used as Map defaultCenter before the auto-fit runs)
  const jobCenter =
    jobState.state === "ready" &&
    jobState.job.geocode?.status === "OK" &&
    jobState.job.geocode.lat !== 0
      ? { lat: jobState.job.geocode.lat, lng: jobState.job.geocode.lng }
      : null;
  const initialCenter = jobCenter ?? DEFAULT_CENTER;
  const initialZoom = jobCenter ? WORKSPACE_ZOOM : DEFAULT_ZOOM;

  // Resolved job for the fit component (null while loading)
  const job = jobState.state === "ready" ? jobState.job : null;

  return (
    <div className="workspace-layout">
      {/* Phase 9.6: JobContextStrip is now rendered inline in App.tsx topbar */}

      <div className="workspace-layout__body">
        {/* Left rail (tools only — no filter rail in workspace mode) */}
        <WorkspaceLeftRail />

        {/* Map area */}
        <div className="workspace-layout__map">
          <ModifiersPanel />
          <div className="map-host" style={{ position: "absolute", inset: 0, top: 0 }}>
            <Map
              defaultCenter={initialCenter}
              defaultZoom={initialZoom}
              styles={stylesFor(theme)}
              gestureHandling="greedy"
              disableDefaultUI={false}
              streetViewControl={true}
              mapTypeControl={false}
            >
              <MapHandle mapRef={mapRef} />
              <FitToJobGeometry job={job} jobId={jobId} />
              <DrawingOverlay />
              {/* MapTypeToggle lives in the topbar; this applier wires it to the map. */}
              <MapTypeApplier />
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

// ── Fit map to drawing geometry or job geocode (runs once per workspace entry) ──

interface FitProps {
  job: { geocode?: { lat: number; lng: number; status: string } | null; address?: string | null } | null;
  jobId: string;
}

function FitToJobGeometry({ job, jobId }: FitProps) {
  const map = useMap();
  const { state } = useDrawing();
  // One-shot fit per jobId — reset when jobId changes
  const didFitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!map) return;
    // Already fit for this jobId
    if (didFitRef.current === jobId) return;

    const objects = state.objects;

    // ── Case 1: existing drawings → fit to their bounds ──────────────────
    if (objects.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      let hasPoints = false;
      for (const obj of objects) {
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
      if (hasPoints && !bounds.isEmpty()) {
        map.fitBounds(bounds, 60);
        didFitRef.current = jobId;
        return;
      }
    }

    // ── Case 2: job not loaded yet — wait ────────────────────────────────
    if (!job) return;

    // ── Case 3: job has geocode → center + zoom 19 ───────────────────────
    if (job.geocode?.status === "OK" && job.geocode.lat !== 0) {
      const { lat, lng } = job.geocode;
      map.setCenter({ lat, lng });
      map.setZoom(WORKSPACE_ZOOM);
      didFitRef.current = jobId;
      return;
    }

    // ── Case 4: job has address but no geocode → client-side geocode ─────
    if (job.address) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: job.address }, (results, status) => {
        if (status === "OK" && results?.[0]) {
          const loc = results[0].geometry.location;
          map.setCenter(loc);
          map.setZoom(WORKSPACE_ZOOM);
        }
      });
      didFitRef.current = jobId;
      return;
    }

    // ── Case 5: no location data — mark done to stop retrying ────────────
    if (import.meta.env.DEV) {
      console.warn("[workspace] job has no geocode and no address — cannot auto-center");
    }
    didFitRef.current = jobId;

  // Re-run when map, job, or jobId changes — but the didFitRef guard prevents
  // re-fitting after the initial fit, even as drawing objects accumulate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, job, jobId, state.objects.length > 0]);

  return null;
}
