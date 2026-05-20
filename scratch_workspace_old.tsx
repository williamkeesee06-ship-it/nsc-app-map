// JobWorkspace ΓÇö Phase 5: Focused single-job editor.
// Reuses the same drawing engine, left rail, and modifier strip as the Jobs Map,
// but filters to one job, hides non-active markers, and enables auto-save.
// Phase 5.3: auto-center on job geocode at zoom 19 on workspace entry.
// Phase 7: AttachmentsPanel + EngineeringPrintOverlay surfaced in workspace.
import { useCallback, useEffect, useRef, useState } from "react";
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
import AttachmentsPanel from "./AttachmentsPanel.js";
import EngineeringPrintOverlay from "../asbuilt/EngineeringPrintOverlay.js";
import type { EngineeringPrint } from "@nsc/types";
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

// ΓöÇΓöÇ Inner component (has access to DrawingContext) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

interface InnerProps {
  jobId: string;
  theme: ReturnType<typeof useMapTheme>["theme"];
  mapRef: React.MutableRefObject<google.maps.Map | null>;
}

function WorkspaceInner({ jobId, theme, mapRef }: InnerProps) {
  const { setTarget, loadObjects, setWorkspaceJobId, activateLayerForToday } = useDrawing();
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
          const d = doc as unknown as { layers?: import("@nsc/types").AsBuiltLayer[]; activeLayerId?: string | null };
          loadObjects(doc.objects, d.layers, d.activeLayerId ?? undefined);
        } else {
          loadObjects([]);
        }
      })
      .catch(() => {
        loadObjects([]);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Phase 7: bootstrap active foreman+layer from the job's crew foreman
  useEffect(() => {
    if (jobState.state !== "ready") return;
    const foreman = jobState.job.constructionCrewForeman?.trim();
    if (!foreman) return;
    activateLayerForToday(foreman);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobState.state]);

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

  // Phase 7: Active engineering print (mirror of AttachmentsPanel state)
  const [activePrint, setActivePrint] = useState<EngineeringPrint | null>(null);
  const [alignmentEditing, setAlignmentEditing] = useState(false);

  const handleCornersChange = useCallback((corners: EngineeringPrint["corners"]) => {
    if (!activePrint) return;
    setActivePrint({ ...activePrint, corners });
    void api.patchPrint(jobId, activePrint.printId, { corners }).catch(() => {});
  }, [activePrint, jobId]);

  return (
    <div className="workspace-layout">
      {/* Job context strip below topbar */}
      {jobId && <JobContextStrip jobId={jobId} />}

      <div className="workspace-layout__body">
        {/* Left rail (tools only ΓÇö no filter rail in workspace mode) */}
        <WorkspaceLeftRail />

        {/* Map area */}
        <div className="workspace-layout__map">
          <ModifiersPanel />
          {jobId && (
            <AttachmentsPanel
              jobId={jobId}
              onActivePrintChange={setActivePrint}
              alignmentEditing={alignmentEditing}
              onSetAlignmentEditing={setAlignmentEditing}
            />
          )}
          <div className="map-host" style={{ position: "absolute", inset: 0, top: 0 }}>
            <Map
              defaultCenter={initialCenter}
              defaultZoom={initialZoom}
              styles={stylesFor(theme)}
              gestureHandling="greedy"
              disableDefaultUI={false}
            >
              <MapHandle mapRef={mapRef} />
              <FitToJobGeometry job={job} jobId={jobId} />
              <DrawingOverlay />
              {activePrint && (
                <EngineeringPrintOverlay
                  print={activePrint}
                  editing={alignmentEditing}
                  onCornersChange={handleCornersChange}
                />
              )}
            </Map>
          </div>
        </div>

        {/* Layers panel (right side) */}
        <LayersPanel />
      </div>
    </div>
  );
}

// ΓöÇΓöÇ Left rail without filter section ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

// ΓöÇΓöÇ Map handle ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

// ΓöÇΓöÇ Fit map to drawing geometry or job geocode (runs once per workspace entry) ΓöÇΓöÇ

interface FitProps {
  job: { geocode?: { lat: number; lng: number; status: string } | null; address?: string | null } | null;
  jobId: string;
}

function FitToJobGeometry({ job, jobId }: FitProps) {
  const map = useMap();
  const { state } = useDrawing();
  // One-shot fit per jobId ΓÇö reset when jobId changes
  const didFitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!map) return;
    // Already fit for this jobId
    if (didFitRef.current === jobId) return;

    const objects = state.objects;

    // ΓöÇΓöÇ Case 1: existing drawings ΓåÆ fit to their bounds ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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
        if (import.meta.env.DEV) {
          const c = bounds.getCenter();
          console.log("[workspace] fit to drawing bounds, center", c.lat(), c.lng());
        }
        didFitRef.current = jobId;
        return;
      }
    }

    // ΓöÇΓöÇ Case 2: job not loaded yet ΓÇö wait ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    if (!job) return;

    // ΓöÇΓöÇ Case 3: job has geocode ΓåÆ center + zoom 19 ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    if (job.geocode?.status === "OK" && job.geocode.lat !== 0) {
      const { lat, lng } = job.geocode;
      map.setCenter({ lat, lng });
      map.setZoom(WORKSPACE_ZOOM);
      if (import.meta.env.DEV) {
        console.log("[workspace] centering on", lat, lng, "zoom", WORKSPACE_ZOOM);
      }
      didFitRef.current = jobId;
      return;
    }

    // ΓöÇΓöÇ Case 4: job has address but no geocode ΓåÆ client-side geocode ΓöÇΓöÇΓöÇΓöÇΓöÇ
    if (job.address) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: job.address }, (results, status) => {
        if (status === "OK" && results?.[0]) {
          const loc = results[0].geometry.location;
          map.setCenter(loc);
          map.setZoom(WORKSPACE_ZOOM);
          if (import.meta.env.DEV) {
            console.log("[workspace] geocoded address, centering on", loc.lat(), loc.lng(), "zoom", WORKSPACE_ZOOM);
          }
        } else {
          if (import.meta.env.DEV) {
            console.warn("[workspace] geocode failed for address:", job.address, status);
          }
        }
      });
      didFitRef.current = jobId;
      return;
    }

    // ΓöÇΓöÇ Case 5: no location data ΓÇö mark done to stop retrying ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    if (import.meta.env.DEV) {
      console.warn("[workspace] job has no geocode and no address ΓÇö cannot auto-center");
    }
    didFitRef.current = jobId;

  // Re-run when map, job, or jobId changes ΓÇö but the didFitRef guard prevents
  // re-fitting after the initial fit, even as drawing objects accumulate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, job, jobId, state.objects.length > 0]);

  return null;
}
