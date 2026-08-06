// Jobs Map — Phase 3: full drawing toolbar + Firestore persistence
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { stylesFor, ZIPLY_MUTED_STYLE, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import { useJobs } from "./useJobs.js";
import { applyFilters } from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import { useFiltersContext } from "./filtersContext.js";
import FilterRail from "./FilterRail.js";
import MapThemeToggleSwitch from "./MapThemeToggleSwitch.js";
import MeasuringOverlay from "./MeasuringOverlay.js";
import LeftRail from "./LeftRail.js";
import CalendarTab from "./CalendarTab.js";
import DashboardPage from "../dashboard/DashboardPage.js";
import type { StatusBucket } from "./markerStyle.js";
import JobCard from "./JobCard.js";
import Eight11Section from "./Eight11Section.js";
import LayersPanel from "../workspace/LayersPanel.js";
import type { Job } from "@nsc/types";
import { normalizeDigShape } from "@nsc/types";
import type { PlatformFeature } from "../ziply/FeatureDetailSheet.js";
import DigTicketsTab from "../dig-tickets/DigTicketsTab.js";
import { useSearchFocus } from "../search/searchContext.js";
import { useActiveContract } from "../workspace/contractStore.js";
import { MARKER_COLORS, colorKeyForJob, isJobCompleted, neonPinDataUrl } from "./markerStyle.js";
import { api } from "../../lib/api.js";
import { DrawingProvider, useDrawing } from "../drawing/drawingContext.js";
import DrawingOverlay from "../drawing/DrawingOverlay.js";
import { DigPolygonProvider, useDigPolygon } from "../dig-polygon/digPolygonContext.js";
import JobPrintOverlays from "../print-overlay/JobPrintOverlays.js";
import DigPolygonOverlay from "../dig-polygon/DigPolygonOverlay.js";
import SavedDigShapeOverlay from "../dig-polygon/SavedDigShapeOverlay.js";
import AllDigShapesOverlay from "../dig-polygon/AllDigShapesOverlay.js";
import AllJobsMarkupsOverlay from "../drawing/AllJobsMarkupsOverlay.js";
import CentralOfficesOverlay from "./CentralOfficesOverlay.js";
import { setShowCOs, useShowCOs } from "./centralOfficesStore.js";
import ModifiersPanel from "../drawing/ModifiersPanel.js";
import JobsShownPill from "./JobsShownPill.js";

// MapTypeToggle moved to LeftRail Filters tab (MapTypeFilterSection). MapTypeApplier still listens to the same broadcast.
import MapTypeApplier from "../map/MapTypeApplier.js";
import type { MapTheme } from "../map/themeContext.js";
import { JobsProvider } from "./jobsContext.js";
import { useAuth } from "../auth/authContext.js";
import LuminaOrb from "../lumina/Orb.js";
const LuminaChatPanel = lazy(() => import("../lumina/ChatPanel.js"));
import LuminaMapBridge from "../lumina/MapBridge.js";
import ZiplyJobsTab from "../ziply/ZiplyJobsTab.js";
import {
  isNorthMetroJob,
  isZiplyJob,
  ziplyStatusGroupForJob,
  pickZiplyFocusJob,
  isLakeStevensJob,
} from "../ziply/ziplyUtils.js";

const FOCUS_ZOOM = 17;

export default function JobsMap() {
  const jobsState = useJobs();
  const reload = jobsState.reload;
  const { theme } = useMapTheme();
  const { contract } = useActiveContract();
  const { username, isManager } = useAuth();
  // Per-supervisor markup scoping (Billy 5/26): each supervisor only sees
  // their own drawings. Managers ALSO see only their own (Robbie explicitly
  // does not want to see other supervisors' markups — 9.7).
  const drawingOwner = username ?? "";
  const rawJobs = jobsState.state === "ready" ? jobsState.jobs : [];
  // Phase 9.7 manager mode: load the supervisor allowlist once so the
  // FilterRail can render a checkbox per name.
  const [allSupervisors, setAllSupervisors] = useState<string[]>([]);
  useEffect(() => {
    if (!isManager) return;
    api
      .listSupervisors()
      .then(({ supervisors }) => setAllSupervisors(supervisors))
      .catch(() => { /* swallow */ });
  }, [isManager]);
  // Phase 9.7: strict Lumen filter by supervisor (case-insensitive) and contract.
  // Ziply intentionally uses broad contract visibility: every logged-in Ziply
  // viewer sees every customerProject="Ziply" job, regardless of supervisor,
  // crew, foreman, or inspector names.
  const allJobs = useMemo(() => {
    if (contract === "Ziply") {
      return rawJobs.filter((j) => isZiplyJob(j));
    }

    let filtered = rawJobs;
    if (!isManager) {
      const u = (username ?? "").trim().toLowerCase();
      if (!u) return [];
      // Lumen assignment-based visibility: a supervisor sees a job when they
      // are named on any of its assignment fields.
      filtered = rawJobs.filter((j) => {
        const assignees = [
          j.constructionSupervisor,
          j.constructionCrewForeman,
          j.crewName,
          j.ziplyInspector,
        ];
        return assignees.some((a) => (a ?? "").trim().toLowerCase() === u);
      });
    }
    return filtered.filter((j) => !isZiplyJob(j));
  }, [rawJobs, username, isManager, contract]);
  const { filters, setFilters, setJobs: setFiltersJobs } = useFiltersContext();
  // Keep the FiltersContext jobs list in sync with the supervisor-scoped
  // allJobs so the topbar StatusFilterPills show accurate per-bucket counts.
  useEffect(() => {
    setFiltersJobs(allJobs);
  }, [allJobs, setFiltersJobs]);
  const [selected, setSelected] = useState<Job | null>(null);
  // Ziply focus: North Metro default + clear selection when leaving Ziply
  useEffect(() => {
    setSelected(null);
    if (contract === "Ziply") {
      setFilters({
        ...filters,
        ziplyNorthMetroOnly: true,
        buckets: new Set(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);
  const mapRef = useRef<google.maps.Map | null>(null);
  const ziplyFocusDoneRef = useRef(false);

  // Mirror the locally-tracked `selected` job into the global search context
  // so the topbar job-info boxes (rendered outside this component) can read it.
  // Cleared when the JobCard closes.
  const { setSelectedJobId } = useSearchFocus();
  useEffect(() => {
    setSelectedJobId(selected?.jobId ?? null);
    // Broadcast for SLD tab and other consumers
    try {
      window.dispatchEvent(new CustomEvent("nsc:job-selected", { detail: { jobId: selected?.jobId ?? null } }));
      if (selected?.jobId) sessionStorage.setItem("nsc.selectedJobId", selected.jobId);
      else sessionStorage.removeItem("nsc.selectedJobId");
    } catch { /* ignore */ }
  }, [selected, setSelectedJobId]);
  // Ziply: do NOT apply Lumen status buckets (they default-hide Completed and
  // zero out the map). Use Ziply-only filters: North Metro, print docs, and
  // optional ziplyStatusGroups. Lumen path is unchanged.
  /** Lake Stevens experiment focus WOs (SHARED design packages). */
  const LS_EXPERIMENT_WOS = useMemo(
    () => new Set(["6007959", "6007556", "6007956", "H3024", "H2043"]),
    []
  );
  const isLakeStevensExperimentJob = useCallback(
    (j: Job) => {
      const wo = (j.workOrder || "").replace(/\D/g, "");
      const hub = (j.hubNumber || j.ziplyPrintLayer?.hubId || "").toUpperCase();
      if (LS_EXPERIMENT_WOS.has(wo) || LS_EXPERIMENT_WOS.has(hub)) return true;
      return isLakeStevensJob(j);
    },
    [LS_EXPERIMENT_WOS]
  );

  const filtered = useMemo(() => {
    if (contract !== "Ziply") {
      return applyFilters(allJobs, filters);
    }
    // Shared hide-unmapped / tracker flags only (empty buckets = no Lumen bucket filter)
    let list = applyFilters(allJobs, { ...filters, buckets: new Set() });
    if (filters.ziplyNorthMetroOnly) {
      list = list.filter((j) => isNorthMetroJob(j));
    }
    const groups = filters.ziplyStatusGroups;
    if (groups && groups.size > 0) {
      list = list.filter((j) => groups.has(ziplyStatusGroupForJob(j)));
    }
    return list;
  }, [allJobs, filters, contract, isLakeStevensExperimentJob]);
  const mapped = useMemo(() => filtered.filter(
    (j) => j.geocode?.status === "OK" && j.geocode.lat !== 0
  ), [filtered]);
  const unmapped = filtered.length - mapped.length;



  const onResync = useCallback(async () => {
    try {
      await api.triggerSync();
    } catch (e) {
      console.error("Resync failed", e);
    }
    reload();
  }, [reload]);

  return (
    <JobsProvider jobs={allJobs} refreshJobs={reload}>
      <DrawingProvider mapRef={mapRef}>
        <DigPolygonProvider>
        <JobsMapInner
          allJobs={allJobs}
          mapped={mapped}
          filtered={filtered}
          unmapped={unmapped}
          jobsState={jobsState}
          filters={filters}
          setFilters={setFilters}
          selected={selected}
          setSelected={setSelected}
          onResync={onResync}
          onJobsRefresh={reload}
          mapRef={mapRef}
          theme={theme}
          isManager={isManager}
          allSupervisors={allSupervisors}
          drawingOwner={drawingOwner}
          isLakeStevensExperimentJob={isLakeStevensExperimentJob}
        />
        </DigPolygonProvider>
      </DrawingProvider>
    </JobsProvider>
  );
}

// Inner component can now access DrawingContext
function JobsMapInner({
  allJobs,
  mapped,
  filtered,
  unmapped,
  jobsState,
  filters,
  setFilters,
  selected,
  setSelected,
  onResync,
  onJobsRefresh,
  mapRef,
  theme,
  isManager,
  allSupervisors,
  drawingOwner,
  isLakeStevensExperimentJob,
}: {
  allJobs: Job[];
  mapped: Job[];
  filtered: Job[];
  unmapped: number;
  jobsState: ReturnType<typeof useJobs>;
  filters: Filters;
  setFilters: (f: Filters) => void;
  selected: Job | null;
  setSelected: (j: Job | null) => void;
  onResync: () => Promise<void>;
  onJobsRefresh: () => void;
  mapRef: React.MutableRefObject<google.maps.Map | null>;
  theme: MapTheme;
  isManager: boolean;
  allSupervisors: string[];
  drawingOwner: string;
  isLakeStevensExperimentJob: (j: Job) => boolean;
}) {
  const { contract } = useActiveContract();
  const { state: drawState, setTarget, loadObjects, save: saveDrawing } = useDrawing();
  const { setTarget: setDigTarget } = useDigPolygon();
  const [selectedFeature, setSelectedFeature] = useState<PlatformFeature | null>(null);
  const [ziplyPrintLayerVisible, setZiplyPrintLayerVisible] = useState(true);
  const [ziply811OverlayVisible, setZiply811OverlayVisible] = useState(false);
  const ziplyJobs = useMemo(
    () => allJobs.filter((j) => j.customerProject === "Ziply"),
    [allJobs]
  );

  // ── Dual-Pane Street View (#5) ──────────────────────────
  const panoRef = useRef<HTMLDivElement>(null);
  const [streetViewActive, setStreetViewActive] = useState(false);

  // When selected job changes, update the drawing target
  useEffect(() => {
    if (selected) {
      setTarget(selected.jobId, selected.workOrder);
    } else {
      setTarget(null, null);
    }
  }, [selected, setTarget]);

  // Listener for custom pan events
  useEffect(() => {
    const handlePan = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || !mapRef.current) return;
      if (detail.bounds) {
        const bounds = new google.maps.LatLngBounds();
        detail.bounds.forEach((pt: { lat: number; lng: number }) => {
          bounds.extend(pt);
        });
        mapRef.current.fitBounds(bounds);
        return;
      }
      const center = detail.center ?? (detail.lat != null && detail.lng != null
        ? { lat: detail.lat, lng: detail.lng }
        : null);
      if (center && typeof center.lat === "number" && typeof center.lng === "number") {
        focusMapOnLatLng(mapRef.current, center.lat, center.lng, detail.zoom ?? 17);
      }
    };
    window.addEventListener("nsc:pan-to", handlePan);
    return () => window.removeEventListener("nsc:pan-to", handlePan);
  }, [mapRef]);

  // Mirror the selected job's 811 dig polygon into the DigPolygon context so
  // the Telecom-tab toggle and the on-map drawing surface both know the target
  // and can render/re-edit an existing polygon.
  useEffect(() => {
    setDigTarget(
      selected?.jobId ?? null,
      normalizeDigShape(selected?.digPolygon ?? null)
    );
  }, [selected, setDigTarget]);

  const handleSelect = useCallback(
    async (job: Job) => {
      const prevJobId = drawState.targetJobId;
      const switchingJob = prevJobId && prevJobId !== job.jobId;

      if (drawState.dirty && drawState.objects.length > 0 && switchingJob) {
        // Phase 5.2: auto-save silently before switching (best-effort).
        // Pass `prevJobId` so save() aborts if anything else has already moved
        // the target underneath us — prevents A's markups from landing in B's doc.
        if (prevJobId) {
          try {
            await saveDrawing(prevJobId);
          } catch {
            // Save failed — dirty stays true and the next autosave tick retries.
          }
        }
        // Either way, proceed with the switch — no window.confirm.
      }

      // Billy 6/18 — mid-flight wipe protection.
      // Clear local objects BEFORE setSelected (which triggers setTarget(B))
      // so we never have { targetJobId: B, objects: A's markups } visible to
      // the autosave debounce. loadObjects([]) also clears the dirty flag.
      loadObjects([], []);
      setSelected(job);
      // Ziply: fly to job geocode so the CAD layer is in view.
      if (contract === "Ziply") {
        const g = job.geocode;
        if (g?.status === "OK" && g.lat && g.lng) {
          window.dispatchEvent(
            new CustomEvent("nsc:pan-to", {
              detail: { lat: g.lat, lng: g.lng, zoom: 15 },
            })
          );
        }
      }
      // Now fetch the newly-selected job's markups and load them in (Lumen).
      if (contract !== "Ziply") {
        try {
          const doc = await api.getDrawing(job.jobId, drawingOwner);
          if (doc && "objects" in doc && Array.isArray(doc.objects)) {
            const layers = "layers" in doc && Array.isArray(doc.layers) ? doc.layers : [];
            loadObjects(doc.objects, layers);
          } else {
            loadObjects([], []);
          }
        } catch {
          loadObjects([], []);
        }
      }
    },
    [
      setSelected,
      loadObjects,
      saveDrawing,
      drawState.dirty,
      drawState.objects,
      drawState.targetJobId,
      contract,
      drawingOwner,
    ]
  );

  // Lumen Central Offices overlay — toggled from the topbar pill.
  const showCOs = useShowCOs();

  // ── Full-screen Calendar overlay ─────────────────────────────────────────
  // LeftRail broadcasts its active tab via the "nsc:active-tab" CustomEvent.
  // When the user picks CALENDAR, we mount <CalendarTab /> absolutely-
  // positioned over the map canvas so it claims the full main area.
  // The rail collapses to a thin tab strip so the user can click another
  // tab to dismiss — collapse state does NOT hide the overlay.
  const [calendarFullscreen, setCalendarFullscreen] = useState(false);
  // Dashboard is the default landing tab — it mounts full-screen on first
  // paint (LeftRail starts on 'dashboard' and broadcasts it on mount).
  const [dashboardFullscreen, setDashboardFullscreen] = useState(true);
  const [ticketsFullscreen, setTicketsFullscreen] = useState(false);
  const [ziplyJobsFullscreen, setZiplyJobsFullscreen] = useState(false);


  useEffect(() => {
    function onActiveTab(e: Event) {
      const detail = (e as CustomEvent<{ tab: string; collapsed: boolean }>).detail;
      if (!detail) return;
      setCalendarFullscreen(detail.tab === "calendar");
      setDashboardFullscreen(detail.tab === "dashboard");
      setTicketsFullscreen(detail.tab === "811-tickets");
      setZiplyJobsFullscreen(detail.tab === "jobs" && contract === "Ziply");
    }
    window.addEventListener("nsc:active-tab", onActiveTab);
    return () => window.removeEventListener("nsc:active-tab", onActiveTab);
  }, [contract]);

  // Dashboard → app navigation. Tapping a status segment pre-filters the map;
  // tapping the map/calendar cards switches to that tab. We drive LeftRail via
  // the nsc:request-tab event bus (LeftRail owns the active-tab state).
  const requestTab = useCallback((tab: string) => {
    window.dispatchEvent(new CustomEvent("nsc:request-tab", { detail: { tab } }));
  }, []);
  const onDashboardFilterStatus = useCallback(
    (bucket: StatusBucket) => {
      setFilters({ ...filters, buckets: new Set([bucket]), hideCompleted: bucket !== "completed" });
      requestTab("filters");
    },
    [filters, setFilters, requestTab]
  );
  const onDashboardOpenJob = useCallback(
    (jobId: string) => {
      const job = allJobs.find((j) => j.jobId === jobId);
      if (!job) return;
      requestTab("filters");
      void handleSelect(job);
    },
    [allJobs, requestTab, handleSelect]
  );

  return (
    <div className="jobs-map">
      <LeftRail
        jobs={allJobs}
        filters={filters}
        setFilters={setFilters}
        onResync={onResync}
        mapRef={mapRef}
        managerMode={isManager}
        availableSupervisors={allSupervisors}
        ziplyPrintLayerVisible={ziplyPrintLayerVisible}
        setZiplyPrintLayerVisible={setZiplyPrintLayerVisible}
        ziply811OverlayVisible={ziply811OverlayVisible}
        setZiply811OverlayVisible={setZiply811OverlayVisible}
        selectedJob={selected}
        setSelectedJob={setSelected}
        selectedFeature={selectedFeature}
        setSelectedFeature={setSelectedFeature}
      />

      <div className="jobs-map__main">
        <ModifiersPanel />
        <div className="map-host" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "row" }}>
          <div style={{ flex: 1, height: "100%", position: "relative", minWidth: 0 }}>
            <Map
              defaultCenter={DEFAULT_CENTER}
              defaultZoom={DEFAULT_ZOOM}
              styles={stylesFor(theme)}
              gestureHandling="greedy"
              disableDefaultUI={false}
              streetViewControl={true}
              mapTypeControl={false} // We use our custom MapTypeToggle instead
              zoomControl={false}     // Hide Google's gamepad — Lumina orb owns the bottom-right corner
              fullscreenControl={false}
              rotateControl={true}
              scaleControl={false}
              // No mapId on Ziply: cloud map IDs can suppress classic Marker/Polyline
              // overlays that the print CAD layer uses. Lumen keeps mapId for 3D tilt.
              {...(contract === "Ziply"
                ? {}
                : { mapId: (import.meta as any).env?.VITE_GOOGLE_MAPS_ID || "DEMO_MAP_ID", tilt: 45, heading: 0 })}
            >
              <MapHandle mapRef={mapRef} />
              {selected && (
                <JobPrintOverlays job={selected} visible={ziplyPrintLayerVisible} />
              )}
              <StreetViewCone panoRef={panoRef} onActiveChange={setStreetViewActive} />
              <JobMarkers
                jobs={mapped}
                onSelect={handleSelect}
                allJobs={allJobs}
              />
              <AllJobsMarkupsOverlay
                onMarkupClick={(jobId) => {
                  const j = allJobs.find((x) => x.jobId === jobId);
                  if (j) void handleSelect(j);
                }}
              />
              <CentralOfficesOverlay visible={showCOs} />

              <DrawingOverlay />
              <SavedDigShapeOverlay />
              {filters.showDigPolygons !== false && (
                <>
                  <AllDigShapesOverlay jobs={mapped} activeJobId={selected?.jobId} />
                  <DigPolygonOverlay />
                </>
              )}
              <MeasuringOverlay />
              {/* MapTypeToggle is in the topbar; this applier (inside the Map
                  context) actually applies the chosen style to the live map. */}
              <MapTypeApplier />
              {/* Lumina map bridge — registers an imperative handle the
                  navigation tools call into. Renders nothing. */}
              <LuminaMapBridge />

            </Map>
          </div>
          <div
            ref={panoRef}
            style={{
              display: streetViewActive ? "block" : "none",
              width: "50%",
              height: "100%",
              position: "relative",
              borderLeft: "2.5px solid var(--chrome-trim-dark, #6e757f)",
              boxShadow: "inset 5px 0 15px rgba(0,0,0,0.3)"
            }}
          />
          {/* Lumina orb — floats above Google's pan/Pegman controls. */}
          <LuminaOrb />
          <Suspense fallback={null}>
            <LuminaChatPanel />
          </Suspense>

          {/* Full-screen Calendar overlay — sits above the map and all
              in-map overlays (markers, drawings, Lumina orb) but below the
              right-side JobCard panel. The map keeps rendering underneath
              so re-entry is instant when the user switches tabs back. */}
          {calendarFullscreen && (
            <div
              className="calendar-fullscreen-overlay"
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 50,
                background: "#0b1118",
              }}
            >
              <CalendarTab />
            </div>
          )}

          {/* Full-screen Dashboard overlay — default landing view. Same
              layering contract as the calendar overlay. Kept mounted only
              while active so its data hook / second map tear down cleanly. */}
          {dashboardFullscreen && (
            <div
              className="dashboard-fullscreen-overlay"
              style={{ position: "absolute", inset: 0, zIndex: 50 }}
            >
              <DashboardPage
                jobs={allJobs}
                onFilterStatus={onDashboardFilterStatus}
                onOpenMap={() => requestTab("filters")}
                onOpenCalendar={() => requestTab("calendar")}
                onOpenJob={onDashboardOpenJob}
              />
            </div>
          )}

          {/* Full-screen 811 Dig Ticket Manager overlay. Same layering as the
              calendar/dashboard overlays. */}
          {ticketsFullscreen && (
            <div
              className="tickets-fullscreen-overlay"
              style={{ position: "absolute", inset: 0, zIndex: 50, background: "#f8fafc" }}
            >
              <DigTicketsTab
                jobs={allJobs}
                onOpenJob={(job) => onDashboardOpenJob(job.jobId)}
              />
            </div>
          )}

          {/* Ziply Job Tracker Full-screen overlay */}
          {ziplyJobsFullscreen && contract === "Ziply" && (
            <div
              className="ziply-jobs-fullscreen-overlay"
              style={{ position: "absolute", inset: 0, zIndex: 50, background: "#f8fafc", overflow: "auto" }}
            >
              <ZiplyJobsTab 
                jobs={allJobs} 
                selected={selected} 
                setSelected={setSelected}
                onClose={() => requestTab("filters")}
              />
            </div>
          )}
        </div>

        {/* Records banner removed per redesign — the topbar info boxes show the
            selected job; no banner needed. */}

        <div className="status-pill status-pill--bottom job-count-pill">
          {jobsState.state === "loading"
            ? "Loading jobs…"
            : jobsState.state === "error"
              ? `Error: ${jobsState.message}`
              : `${mapped.length} on map · ${unmapped} unmapped · ${allJobs.length} total`}
        </div>
      </div>
    </div>
  );
}

/** Ziply map chrome: print layer status + jump-to-prints. */
function ZiplyPrintMapBanner({
  readyCount,
  orphanCount,
  layerOn,
  sheetExperiment,
  onToggleExperiment,
  onToggleLayer,
  onFitPrints,
}: {
  readyCount: number;
  orphanCount: number;
  layerOn: boolean;
  sheetExperiment: boolean;
  onToggleExperiment: () => void;
  onToggleLayer: () => void;
  onFitPrints: () => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        padding: "9px 14px",
        borderRadius: 12,
        background: "linear-gradient(180deg, #f4f6f8 0%, #d8dde4 55%, #c5ccd6 100%)",
        border: "1px solid #8e96a0",
        color: "#15202c",
        fontSize: 11,
        fontFamily: "var(--font-mono, ui-monospace, Consolas, monospace)",
        boxShadow:
          "0 8px 22px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.85)",
        maxWidth: "min(920px, calc(100% - 160px))",
      }}
    >
      <span
        style={{
          color: "#1d4ed8",
          fontWeight: 800,
          letterSpacing: "0.12em",
        }}
      >
        {sheetExperiment ? "✦ SHEET EXPERIMENT" : "✦ PRINT CAD"}
      </span>
      <span style={{ color: "#3a4654" }}>
        {sheetExperiment
          ? "CAD noise off · plan pages as map overlays"
          : readyCount > 0
            ? `${readyCount} live design${readyCount === 1 ? "" : "s"}`
            : "No plottable prints yet"}
      </span>
      {!sheetExperiment && orphanCount > 0 && (
        <span style={{ color: "#b45309" }} title="Ingest finished but no lat/lng for hub or job">
          · {orphanCount} need location
        </span>
      )}
      <button
        type="button"
        onClick={onToggleExperiment}
        style={{
          background: sheetExperiment
            ? "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)"
            : "linear-gradient(180deg, #ffffff 0%, #e4e9f0 100%)",
          border: "1px solid #1d4ed8",
          color: sheetExperiment ? "#fff" : "#1d4ed8",
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: 10,
          fontWeight: 800,
          cursor: "pointer",
          letterSpacing: "0.04em",
        }}
        title="Quiet mode: hide plant CAD; overlay Lake Stevens design PDF pages on the basemap"
      >
        {sheetExperiment ? "EXIT EXPERIMENT" : "SHEET EXPERIMENT"}
      </button>
      {!sheetExperiment && (
        <>
          <button
            type="button"
            onClick={onToggleLayer}
            style={{
              background: layerOn
                ? "linear-gradient(180deg, #e8f0ff 0%, #d0e0ff 100%)"
                : "linear-gradient(180deg, #ffffff 0%, #e4e9f0 100%)",
              border: "1px solid #1e5eff",
              color: "#1d4ed8",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 10,
              fontWeight: 800,
              cursor: "pointer",
              letterSpacing: "0.06em",
            }}
          >
            {layerOn ? "LAYER ON" : "LAYER OFF"}
          </button>
          <button
            type="button"
            onClick={onFitPrints}
            disabled={readyCount === 0}
            style={{
              background: readyCount
                ? "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)"
                : "linear-gradient(180deg, #e4e9f0 0%, #c5ccd6 100%)",
              border: "1px solid #1d4ed8",
              color: readyCount ? "#ffffff" : "#5b6776",
              borderRadius: 6,
              padding: "4px 12px",
              fontSize: 10,
              fontWeight: 800,
              cursor: readyCount ? "pointer" : "not-allowed",
              letterSpacing: "0.04em",
            }}
          >
            FLY TO PRINTS
          </button>
        </>
      )}
    </div>
  );
}

// Tiny invisible child whose only purpose is to push the live google.maps.Map
// instance up into a ref the LeftRail (and other UI outside <Map>) can use.
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

// ── Dual-Pane Street View Cone component (#5) ──────────────────────────────
interface StreetViewConeProps {
  panoRef: React.RefObject<HTMLDivElement>;
  onActiveChange: (active: boolean) => void;
}

function StreetViewCone({ panoRef, onActiveChange }: StreetViewConeProps) {
  const map = useMap();
  const cameraConeMarkerRef = useRef<google.maps.Marker | null>(null);

  useEffect(() => {
    if (!map || !panoRef.current) return;
    
    const sv = new google.maps.StreetViewPanorama(panoRef.current, {
      enableCloseButton: true,
      visible: false,
    });
    map.setStreetView(sv);

    const updateCone = (heading: number, position: google.maps.LatLng | null, visible: boolean) => {
      if (!visible || !position) {
        if (cameraConeMarkerRef.current) {
          cameraConeMarkerRef.current.setMap(null);
          cameraConeMarkerRef.current = null;
        }
        return;
      }

      const rotatedConeSvg = (h: number) => `
        <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
          <g transform="rotate(${h} 30 30)">
            <path d="M 30 30 L 10 5 A 25 25 0 0 1 50 5 Z" fill="rgba(30, 167, 255, 0.35)" stroke="#1ea7ff" stroke-width="1.5" />
            <circle cx="30" cy="30" r="5" fill="#ffffff" stroke="#1ea7ff" stroke-width="2" />
          </g>
        </svg>
      `;

      const svg = rotatedConeSvg(heading);
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

      if (!cameraConeMarkerRef.current) {
        cameraConeMarkerRef.current = new google.maps.Marker({
          position,
          map,
          zIndex: 99999,
          icon: {
            url,
            scaledSize: new google.maps.Size(60, 60),
            anchor: new google.maps.Point(30, 30),
          },
        });
      } else {
        cameraConeMarkerRef.current.setPosition(position);
        cameraConeMarkerRef.current.setIcon({
          url,
          scaledSize: new google.maps.Size(60, 60),
          anchor: new google.maps.Point(30, 30),
        });
      }
    };

    const visListener = sv.addListener("visible_changed", () => {
      const v = sv.getVisible();
      onActiveChange(v);
      updateCone(sv.getPov().heading, sv.getPosition(), v);
    });

    const povListener = sv.addListener("pov_changed", () => {
      updateCone(sv.getPov().heading, sv.getPosition(), sv.getVisible());
    });

    const posListener = sv.addListener("position_changed", () => {
      updateCone(sv.getPov().heading, sv.getPosition(), sv.getVisible());
    });

    return () => {
      google.maps.event.removeListener(visListener);
      google.maps.event.removeListener(povListener);
      google.maps.event.removeListener(posListener);
      if (cameraConeMarkerRef.current) {
        cameraConeMarkerRef.current.setMap(null);
        cameraConeMarkerRef.current = null;
      }
      map.setStreetView(null);
    };
  }, [map, panoRef, onActiveChange]);

  return null;
}

const WO_LABEL_MIN_ZOOM = 13;

// Renders neon-pin markers + WO label markers above each pin.
// WO labels hide when map zoom < 13 to avoid clutter.
function JobMarkers({
  jobs,
  onSelect,
  allJobs,
}: {
  jobs: Job[];
  onSelect: (j: Job) => void;
  allJobs: Job[];
}) {
  const map = useMap();
  const { contract } = useActiveContract();
  const { focus, clearFocus } = useSearchFocus();
  const fittedRef = useRef(false);
  const markersRef = useRef<globalThis.Map<string, google.maps.Marker> | null>(null);
  const labelMarkersRef = useRef<google.maps.Marker[]>([]);
  // Billy 6/5: marker that pins the search result. For free-form addresses
  // we drop a standard red Google pin; for known jobs we briefly bounce the
  // existing neon pin so it pops visually.
  const searchPinRef = useRef<google.maps.Marker | null>(null);
  const searchInfoRef = useRef<google.maps.InfoWindow | null>(null);

  // Keep latest onSelect in a ref to prevent marker recreation when selection logic changes
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!map) return;
    const created = new globalThis.Map<string, google.maps.Marker>();
    const labelMarkers: google.maps.Marker[] = [];
    const currentZoom = map.getZoom() ?? 0;
    const showClusters = false; // Disabled per user request
    const labelsVisible = currentZoom >= WO_LABEL_MIN_ZOOM && !showClusters;

    if (showClusters) {
      // Group mapped jobs by City
      const cityGroups = new globalThis.Map<string, Job[]>();
      jobs.forEach((job) => {
        const city = (job.city ?? "").trim().toLowerCase();
        if (!city || !job.geocode) return;
        if (!cityGroups.has(city)) cityGroups.set(city, []);
        cityGroups.get(city)!.push(job);
      });

      cityGroups.forEach((cityJobs: Job[], cityName: string) => {
        // Calculate center of cluster
        let sumLat = 0;
        let sumLng = 0;
        let totalCompleted = 0;
        let totalEstimated = 0;
        let count = 0;

        cityJobs.forEach((j: Job) => {
          sumLat += j.geocode!.lat;
          sumLng += j.geocode!.lng;
          totalCompleted += (j.completedBoreFt ?? 0) + (j.completedPlacingFt ?? 0) + (j.completedAerialFt ?? 0);
          totalEstimated += (j.estBoreFt ?? 0) + (j.estPlacingFt ?? 0) + (j.estAerialFt ?? 0);
          count++;
        });

        if (count === 0) return;
        const center = { lat: sumLat / count, lng: sumLng / count };
        const pct = totalEstimated > 0 ? Math.round((totalCompleted / totalEstimated) * 100) : 45; 
        const color = pct >= 80 ? "#1d4ed8" : pct >= 50 ? "#ffb300" : "#ff7043";

        const safeCityName = escapeHtml(cityName);
        // Draw a large glowing radar circle SVG
        const clusterSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="30" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2"/>
          <circle cx="40" cy="40" r="38" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 2" stroke-opacity="0.6"/>
          <circle cx="40" cy="40" r="10" fill="${color}" fill-opacity="0.8"/>
          <text x="40" y="44" text-anchor="middle" font-size="10" font-weight="900" fill="white" font-family="sans-serif">${count}</text>
          <text x="40" y="76" text-anchor="middle" font-size="9" font-weight="700" fill="${color}" font-family="sans-serif" letter-spacing="0.05em" text-transform="uppercase">${safeCityName}</text>
        </svg>`;
        const clusterUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clusterSvg)}`;

        const cm = new google.maps.Marker({
          position: center,
          map,
          title: `${cityName} Area Buildout (${count} jobs)`,
          icon: {
            url: clusterUrl,
            scaledSize: new google.maps.Size(80, 80),
            anchor: new google.maps.Point(40, 40),
          },
        });

        cm.addListener("click", () => {
          map.setCenter(center);
          map.setZoom(12);
        });

        created.set(`cluster-${cityName}`, cm);
      });
    } else {
      jobs.forEach((job) => {
        const colorKey = colorKeyForJob(job, contract);
        const color = MARKER_COLORS[colorKey];

        // Pin marker
        const m = new google.maps.Marker({
          position: { lat: job.geocode!.lat, lng: job.geocode!.lng },
          map,
          title: `${job.workOrder} · ${job.secondaryJobStatus ?? job.jobStatus ?? ""}`,
          icon: {
            url: neonPinDataUrl(color, (job.inTracker ? 1 : 0.55) * (isJobCompleted(job) ? 0.6 : 1)),
            scaledSize: new google.maps.Size(26, 36),
            anchor: new google.maps.Point(13, 33),
          },
        });
        m.addListener("click", () => {
          onSelectRef.current(job);
          focusMapOnLatLng(map, job.geocode!.lat, job.geocode!.lng);
        });
        created.set(job.jobId, m);

        // WO label marker — positioned slightly above the pin
        const woText = contract === "Ziply" ? (job.ziplyPrintLayer?.hubId || job.workOrder) : job.workOrder;
        if (woText) {
          const pinColor = color.core;
          
          const safeWoText = escapeHtml(woText);
          const textW = Math.max(80, woText.length * 8 + 18);
          const pillW = textW;
          
          // Luxurious Light Mode & High-Tech Map Engineer Aesthetic
          // Add 16px padding for glow filter
          const paddedW = pillW + 16;
          const paddedH = 22 + 16;
          
          const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${paddedW}" height="${paddedH}">
    <defs>
      <filter id="glow-${pillW}" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#0f172a" flood-opacity="0.12"/>
      </filter>
    </defs>
    <rect x="8" y="8" width="${pillW}" height="22" rx="11" fill="rgba(255, 255, 255, 0.98)" stroke="${pinColor}" stroke-width="1.5" filter="url(#glow-${pillW})"/>
    <rect x="9.5" y="9.5" width="${pillW - 3}" height="19" rx="9.5" fill="none" stroke="rgba(255, 255, 255, 0.9)" stroke-width="1"/>
    <text x="${pillW / 2 + 8}" y="22.5" text-anchor="middle" font-size="10.5" font-weight="700" letter-spacing="0.4"
      fill="#0f172a" font-family="Inter, Roboto, system-ui, sans-serif">${safeWoText}</text>
  </svg>`;
          const labelUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelSvg)}`;
          const lm = new google.maps.Marker({
            position: { lat: job.geocode!.lat, lng: job.geocode!.lng },
            map: labelsVisible ? map : null,
            icon: {
              url: labelUrl,
              scaledSize: new google.maps.Size(paddedW, paddedH),
              // Original anchor was pillW/2, 58 (above pin tip). 
              // We shifted SVG content by 8px X and 8px Y, so add 8 to X and Y.
              anchor: new google.maps.Point(pillW / 2 + 8, 58 + 8), 
            },
            clickable: false,
            zIndex: 1,
          });
          labelMarkers.push(lm);
        }
      });
    }
    markersRef.current = created;
    labelMarkersRef.current = labelMarkers;

    // Zoom listener: efficiently toggle label visibility on existing label markers without tearing down pins
    const zoomListener = map.addListener("zoom_changed", () => {
      const z = map.getZoom() ?? 0;
      const showLabels = z >= WO_LABEL_MIN_ZOOM;
      labelMarkersRef.current.forEach((lm) => lm.setMap(showLabels ? map : null));
    });

    if (!fittedRef.current && jobs.length > 0) {
      // Only extend bounds with geocodes inside the Pacific Northwest window
      // (roughly WA + N Oregon). A single stray marker in Kansas/Florida would
      // otherwise cause fitBounds to zoom out to the whole country — which is
      // exactly the bug Billy reported 8/6.
      const PNW = { minLat: 45.0, maxLat: 49.5, minLng: -125.0, maxLng: -116.0 };
      const inPNW = (lat: number, lng: number) =>
        lat >= PNW.minLat && lat <= PNW.maxLat && lng >= PNW.minLng && lng <= PNW.maxLng;
      const bounds = new google.maps.LatLngBounds();
      let extended = 0;
      let firstPt: { lat: number; lng: number } | null = null;
      jobs.forEach((j) => {
        const lat = j.geocode!.lat;
        const lng = j.geocode!.lng;
        if (!inPNW(lat, lng)) return;
        bounds.extend({ lat, lng });
        extended++;
        if (!firstPt) firstPt = { lat, lng };
      });
      if (extended === 0) {
        // Nothing inside the PNW window — fall back to the first geocode we
        // have so we at least don't sit on the whole country.
        const j = jobs[0];
        if (j?.geocode) {
          map.setCenter({ lat: j.geocode.lat, lng: j.geocode.lng });
          map.setZoom(11);
        }
      } else if (extended === 1 && firstPt) {
        map.setCenter(firstPt);
        map.setZoom(14);
      } else {
        map.fitBounds(bounds, 80);
        // Cap zoom so a tight cluster doesn't slam us into street-level.
        const cap = google.maps.event.addListenerOnce(map, "idle", () => {
          const z = map.getZoom() ?? 0;
          if (z > 13) map.setZoom(13);
          void cap;
        });
      }
      fittedRef.current = true;
    }

    return () => {
      created.forEach((m) => m.setMap(null));
      labelMarkers.forEach((lm) => lm.setMap(null));
      labelMarkersRef.current = [];
      if (markersRef.current === created) markersRef.current = null;
      google.maps.event.removeListener(zoomListener);
    };
  }, [map, jobs, contract]); // removed onSelect from deps to prevent re-renders

  useEffect(() => {
    if (!map || !focus) return;

    // Clear any prior search pin/info before placing a new one.
    if (searchPinRef.current) {
      searchPinRef.current.setMap(null);
      searchPinRef.current = null;
    }
    if (searchInfoRef.current) {
      searchInfoRef.current.close();
      searchInfoRef.current = null;
    }

    if (focus.kind === "latLng") {
      focusMapOnLatLng(map, focus.lat, focus.lng);
      // Drop a standard red Google pin so the user can SEE where the address is.
      const pin = new google.maps.Marker({
        position: { lat: focus.lat, lng: focus.lng },
        map,
        animation: google.maps.Animation.DROP,
        zIndex: 9999,
        title: focus.label ?? "Search result",
      });
      if (focus.label) {
        const info = new google.maps.InfoWindow({ content: `<div style="font:600 12px ui-sans-serif,system-ui;color:#0b1220;max-width:240px">${escapeHtml(focus.label)}</div>` });
        info.open({ map, anchor: pin });
        searchInfoRef.current = info;
      }
      pin.addListener("click", () => {
        pin.setMap(null);
        searchInfoRef.current?.close();
        searchPinRef.current = null;
        searchInfoRef.current = null;
      });
      searchPinRef.current = pin;
      clearFocus();
      return;
    }

    if (focus.kind === "job") {
      const job = allJobs.find((j) => j.jobId === focus.jobId);
      if (!job) {
        clearFocus();
        return;
      }
      onSelect(job);
      if (job.geocode?.status === "OK" && job.geocode.lat !== 0) {
        focusMapOnLatLng(map, job.geocode.lat, job.geocode.lng);
        // Bounce the existing neon job marker so the user can SEE which one
        // matched (filters may have hidden it — we also ensure it's on the map).
        const existing = markersRef.current?.get(job.jobId);
        if (existing) {
          existing.setMap(map);
          existing.setAnimation(google.maps.Animation.BOUNCE);
          setTimeout(() => existing.setAnimation(null), 1800);
        } else {
          // Filtered out — drop a temporary neon pin so the user can still see it.
          const colorKey = colorKeyForJob(job);
          const color = MARKER_COLORS[colorKey];
          const tempPin = new google.maps.Marker({
            position: { lat: job.geocode.lat, lng: job.geocode.lng },
            map,
            animation: google.maps.Animation.DROP,
            zIndex: 9999,
            title: `${job.workOrder} (hidden by filter)`,
            icon: {
              url: neonPinDataUrl(color, 1),
              scaledSize: new google.maps.Size(26, 36),
              anchor: new google.maps.Point(13, 33),
            },
          });
          tempPin.addListener("click", () => {
            onSelectRef.current(job);
          });
          searchPinRef.current = tempPin;
        }
      }
      clearFocus();
    }
  }, [map, focus, allJobs, onSelect, clearFocus]);

  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function focusMapOnLatLng(map: google.maps.Map, lat: number, lng: number, overrideZoom?: number) {
  map.panTo({ lat, lng });
  const targetZoom = overrideZoom ?? FOCUS_ZOOM;
  const currentZoom = map.getZoom();
  if (currentZoom !== targetZoom) {
    map.setZoom(targetZoom);
  }
}
