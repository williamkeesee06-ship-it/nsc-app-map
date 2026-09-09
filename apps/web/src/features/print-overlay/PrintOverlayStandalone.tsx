import { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { useJob } from "../workspace/useJob.js";
import { DrawingProvider, useDrawing } from "../drawing/drawingContext.js";
import { api } from "../../lib/api.js";
import { stylesFor } from "../map/mapStyles.js";
import DrawingOverlay from "../drawing/DrawingOverlay.js";
import PrintOverlayStudio from "./PrintOverlayStudio.js";
import MapTypeToggle from "../map/MapTypeToggle.js";
import MapTypeApplier from "../map/MapTypeApplier.js";
import type { Job } from "@nsc/types";

const DEFAULT_CENTER = { lat: 47.6062, lng: -122.3321 };
const DEFAULT_ZOOM = 10;
const WORKSPACE_ZOOM = 18;

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

export default function PrintOverlayStandalone() {
  const { jobId } = useParams<{ jobId: string }>();
  const mapRef = useRef<google.maps.Map | null>(null);

  if (!jobId) {
    return (
      <div style={{ padding: 20, color: "#ef4444", background: "#050505", height: "100vh", fontFamily: "monospace" }}>
        Error: No jobId provided in URL
      </div>
    );
  }

  const jobState = useJob(jobId);

  if (jobState.state === "loading") {
    return (
      <div style={{
        display: "grid",
        placeItems: "center",
        height: "100vh",
        background: "#050505",
        color: "#06b6d4",
        fontFamily: "monospace",
        fontSize: 14,
        letterSpacing: "0.1em"
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 32,
            height: 32,
            border: "2px solid rgba(6, 182, 212, 0.2)",
            borderTopColor: "#06b6d4",
            borderRadius: "50%",
            margin: "0 auto 16px auto",
            animation: "spin 0.8s linear infinite"
          }} />
          LOADING OVERLAY WORKSPACE...
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (jobState.state === "missing") {
    return (
      <div style={{ padding: 20, color: "#ef4444", background: "#050505", height: "100vh", fontFamily: "monospace" }}>
        Error: Job not found
      </div>
    );
  }

  if (jobState.state === "error") {
    return (
      <div style={{ padding: 20, color: "#ef4444", background: "#050505", height: "100vh", fontFamily: "monospace" }}>
        Error loading job: {jobState.message}
      </div>
    );
  }

  return (
    <DrawingProvider mapRef={mapRef}>
      <StandaloneInner jobId={jobId} job={jobState.job} mapRef={mapRef} />
    </DrawingProvider>
  );
}

function StandaloneInner({
  jobId,
  job,
  mapRef,
}: {
  jobId: string;
  job: Job;
  mapRef: React.MutableRefObject<google.maps.Map | null>;
}) {
  const navigate = useNavigate();
  const { setTarget, loadObjects, setWorkspaceJobId } = useDrawing();

  // Set drawing target + workspace mode on mount
  useEffect(() => {
    setWorkspaceJobId(jobId);
    return () => {
      setWorkspaceJobId(null);
    };
  }, [jobId, setWorkspaceJobId]);

  // Load job drawings
  useEffect(() => {
    setTarget(jobId, job.workOrder);

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
  }, [jobId, job.workOrder, setTarget, loadObjects]);

  const jobCenter =
    job.geocode?.status === "OK" &&
    typeof job.geocode.lat === "number" &&
    typeof job.geocode.lng === "number" &&
    !isNaN(job.geocode.lat) &&
    !isNaN(job.geocode.lng) &&
    job.geocode.lat !== 0
      ? { lat: job.geocode.lat, lng: job.geocode.lng }
      : null;
  const initialCenter = jobCenter ?? DEFAULT_CENTER;
  const initialZoom = jobCenter ? WORKSPACE_ZOOM : DEFAULT_ZOOM;

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden", background: "#050505" }}>
      {/* Standalone Map Container */}
      <div style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}>
        <Map
          defaultCenter={initialCenter}
          defaultZoom={initialZoom}
          gestureHandling="greedy"
          disableDefaultUI={false}
          zoomControl={false}
          fullscreenControl={false}
          rotateControl={true}
          scaleControl={false}
        >
          <MapHandle mapRef={mapRef} />
          <DrawingOverlay />
          <MapTypeApplier forceLight={true} />
          <PrintOverlayStudio
            job={job}
            onClose={() => {
              if (window.opener) {
                window.close();
              } else {
                navigate(`/jobs/${jobId}`);
              }
            }}
          />
        </Map>
      </div>

      {/* Floating map controls */}
      <div style={{ position: "absolute", top: 16, right: 16, zIndex: 1000 }}>
        <MapTypeToggle />
      </div>
    </div>
  );
}
