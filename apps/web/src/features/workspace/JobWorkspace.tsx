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
import { SapphireGlassCard, TitaniumHexBolt } from "../../components/HorologyMetalBezel.js";
import { Globe2, Wrench, X as XIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

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
            <NsmsDrawer
              title={drawer === "earth" ? "Google Earth Bridge" : "As-Built Studio"}
              accent={drawer}
              onClose={() => setDrawer(null)}
            >
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

// ── NSMS drawer chrome ────────────────────────────────────
// Sapphire-glass chrome to match the rest of the app. The toggle strip is
// framed in a titanium-riveted card and the drawer uses a mirror-bezel edge
// with laser-blue accent when Earth Bridge is open, teal accent for As-Built.

interface DrawerToggleProps {
  active: null | "earth" | "asbuilt";
  onSelect: (next: null | "earth" | "asbuilt") => void;
}

function NsmsDrawerToggles({ active, onSelect }: DrawerToggleProps) {
  return (
    <div
      className="absolute z-20 flex flex-col items-stretch gap-2"
      style={{ top: 96, right: 12, width: 96 } as CSSProperties}
    >
      <SapphireGlassCard glow={active === "earth"} className="!p-2">
        <button
          type="button"
          onClick={() => onSelect(active === "earth" ? null : "earth")}
          title="Google Earth Bridge — Network Link + KML review"
          className={`w-full flex flex-col items-center justify-center gap-1 py-2 rounded-lg font-['Audiowide'] text-[10px] font-black uppercase tracking-widest transition-all duration-200 ${
            active === "earth"
              ? "text-white bg-blue-600/40 shadow-[0_0_14px_rgba(37,99,235,0.6)]"
              : "text-slate-200 hover:text-white hover:bg-blue-500/15"
          }`}
        >
          <Globe2 size={20} className={active === "earth" ? "text-sky-300" : "text-slate-300"} />
          <span>Earth</span>
          <span className="text-[8px] text-slate-400 tracking-normal normal-case font-sans">Bridge</span>
        </button>
      </SapphireGlassCard>

      <SapphireGlassCard glow={active === "asbuilt"} className="!p-2">
        <button
          type="button"
          onClick={() => onSelect(active === "asbuilt" ? null : "asbuilt")}
          title="As-Built Studio"
          className={`w-full flex flex-col items-center justify-center gap-1 py-2 rounded-lg font-['Audiowide'] text-[10px] font-black uppercase tracking-widest transition-all duration-200 ${
            active === "asbuilt"
              ? "text-white bg-teal-600/40 shadow-[0_0_14px_rgba(13,148,136,0.6)]"
              : "text-slate-200 hover:text-white hover:bg-teal-500/15"
          }`}
        >
          <Wrench size={20} className={active === "asbuilt" ? "text-teal-300" : "text-slate-300"} />
          <span>As-Built</span>
          <span className="text-[8px] text-slate-400 tracking-normal normal-case font-sans">Studio</span>
        </button>
      </SapphireGlassCard>
    </div>
  );
}

interface DrawerProps {
  title: string;
  onClose: () => void;
  accent?: "earth" | "asbuilt";
  children: ReactNode;
}

function NsmsDrawer({ title, onClose, accent = "earth", children }: DrawerProps) {
  const accentClass =
    accent === "asbuilt"
      ? "border-teal-500/60 shadow-[-12px_0_32px_rgba(13,148,136,0.35),inset_1px_0_0_rgba(45,212,191,0.35)]"
      : "border-blue-500/60 shadow-[-12px_0_32px_rgba(37,99,235,0.35),inset_1px_0_0_rgba(96,165,250,0.35)]";
  const badgeClass =
    accent === "asbuilt"
      ? "bg-teal-600/30 text-teal-300 border-teal-500/50 shadow-[0_0_8px_rgba(13,148,136,0.5)]"
      : "bg-blue-600/30 text-blue-300 border-blue-500/50 shadow-[0_0_8px_rgba(37,99,235,0.5)]";

  return (
    <div
      className={`absolute top-0 right-0 bottom-0 z-30 flex flex-col backdrop-blur-lg bg-slate-950/95 border-l-2 ${accentClass}`}
      style={{ width: 480, maxWidth: "92vw" } as CSSProperties}
      role="dialog"
      aria-label={title}
    >
      {/* Titanium-riveted header bar */}
      <div className="relative flex items-center justify-between px-5 py-3 border-b border-slate-700/80 bg-gradient-to-b from-slate-900/95 to-slate-950/95">
        <TitaniumHexBolt size={11} className="absolute top-2 left-2 opacity-70" />
        <TitaniumHexBolt size={11} className="absolute top-2 right-2 opacity-70" />
        <div className="flex items-center gap-3 pl-4">
          <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-widest border ${badgeClass}`}>
            NSMS
          </span>
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-100 font-['Audiowide']">
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drawer"
          className="flex items-center justify-center w-7 h-7 rounded-md border border-slate-600/70 bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-700/80 hover:border-slate-400/70 transition-colors"
        >
          <XIcon size={14} />
        </button>
      </div>

      {/* Scroll region */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
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
