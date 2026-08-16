// JobWorkspace — Phase 5: Focused single-job editor.
// Reuses the same drawing engine, left rail, and modifier strip as the Jobs Map,
// but filters to one job, hides non-active markers, and enables auto-save.
// Phase 5.3: auto-center on job geocode at zoom 19 on workspace entry.
// NSMS: Adds slide-in drawers for Earth Bridge design/review + As-Built studio.
import { useCallback, useEffect, useRef, useState } from "react";
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
import JobPrintOverlays from "../print-overlay/JobPrintOverlays.js";
import EarthDesignPanel from "../earth/EarthDesignPanel.js";
import AsBuiltStudio from "../as-built/AsBuiltStudio.js";

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

  // NSMS drawers — mutually exclusive (only one open at a time)
  const [drawer, setDrawer] = useState<null | "earth" | "asbuilt">(null);

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
              {job && <JobPrintOverlays job={job} visible={true} />}
              {/* MapTypeToggle lives in the topbar; this applier wires it to the map. */}
              <MapTypeApplier />
            </Map>
          </div>

          {/* NSMS drawer toggles — floating on the right edge of the map */}
          <NsmsDrawerToggles active={drawer} onSelect={setDrawer} />

          {/* NSMS drawer overlay */}
          {drawer && job && (
            <NsmsDrawer title={drawer === "earth" ? "Google Earth Bridge" : "As-Built Studio"} onClose={() => setDrawer(null)}>
              {drawer === "earth" ? (
                <EarthDesignPanel job={job} />
              ) : (
                <AsBuiltStudio job={job} />
              )}
            </NsmsDrawer>
          )}
        </div>

        {/* Layers panel (right side) */}
        <LayersPanel />
      </div>
    </div>
  );
}

// ── NSMS drawer chrome ──────────────────────────────────────────────────

interface DrawerToggleProps {
  active: null | "earth" | "asbuilt";
  onSelect: (next: null | "earth" | "asbuilt") => void;
}

function NsmsDrawerToggles({ active, onSelect }: DrawerToggleProps) {
  const btn = (key: "earth" | "asbuilt", label: string, bg: string): React.CSSProperties => ({
    background: active === key ? bg : "rgba(15, 23, 42, 0.85)",
    border: `1px solid ${active === key ? bg : "rgba(148, 163, 184, 0.35)"}`,
    color: "#f8fafc",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.04em",
    padding: "8px 12px",
    borderRadius: 6,
    cursor: "pointer",
    textTransform: "uppercase",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
  });
  return (
    <div
      style={{
        position: "absolute",
        top: 96,
        right: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 20,
      }}
    >
      <button
        type="button"
        onClick={() => onSelect(active === "earth" ? null : "earth")}
        style={btn("earth", "Earth", "#0284c7")}
        title="Google Earth Bridge — Network Link + KML review"
      >
        Earth
      </button>
      <button
        type="button"
        onClick={() => onSelect(active === "asbuilt" ? null : "asbuilt")}
        style={btn("asbuilt", "As-Built", "#0d9488")}
        title="As-Built Studio"
      >
        As-Built
      </button>
    </div>
  );
}

interface DrawerProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function NsmsDrawer({ title, onClose, children }: DrawerProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 460,
        maxWidth: "90vw",
        background: "rgba(3, 7, 18, 0.96)",
        borderLeft: "1px solid rgba(148, 163, 184, 0.25)",
        boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.45)",
        display: "flex",
        flexDirection: "column",
        zIndex: 30,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.06em", color: "#f8fafc", textTransform: "uppercase" }}>
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "1px solid rgba(148, 163, 184, 0.35)",
            color: "#e2e8f0",
            fontSize: 11,
            fontWeight: 800,
            padding: "4px 10px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>{children}</div>
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
