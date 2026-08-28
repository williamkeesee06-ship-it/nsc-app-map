// Jobs Map — Phase 3: full drawing toolbar + Firestore persistence
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers } from "lucide-react";
import { Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { stylesFor, ZIPLY_MUTED_STYLE, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import { computeZoomBand, useNetworkViewBands } from "./networkView.js";
import "./networkView.css";
import { useJobs } from "./useJobs.js";
import { applyFilters } from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import { useFiltersContext } from "./filtersContext.js";
import FilterRail from "./FilterRail.js";
import MapThemeToggleSwitch from "./MapThemeToggleSwitch.js";
import MapStatusFilterPill from "./MapStatusFilterPill.js";
import StructureDetailCard from "./StructureDetailCard.js";
import MeasuringOverlay from "./MeasuringOverlay.js";
import LeftRail from "./LeftRail.js";
import type { StatusBucket } from "./markerStyle.js";
import JobCard from "./JobCard.js";
import Eight11Section from "./Eight11Section.js";
import LayersPanel from "../workspace/LayersPanel.js";
import type { Job, DrawingObject } from "@nsc/types";
import { normalizeDigShape } from "@nsc/types";
import type { PlatformFeature } from "../ziply/FeatureDetailSheet.js";
import { useSearchFocus } from "../search/searchContext.js";

const CalendarTab = lazy(() => import("./CalendarTab.js"));
const DashboardPage = lazy(() => import("../dashboard/DashboardPage.js"));
const DigTicketsTab = lazy(() => import("../dig-tickets/DigTicketsTab.js"));
import { useActiveContract } from "../workspace/contractStore.js";
import {
  MARKER_COLORS,
  colorKeyForJob,
  isJobCompleted,
  precisionPinDataUrl,
  precisionWoLabelDataUrl,
  precisionHubBadgeDataUrl,
  neonPinDataUrl,
} from "./markerStyle.js";
import { api } from "../../lib/api.js";
import { DrawingProvider, useDrawing } from "../drawing/drawingContext.js";
import DrawingOverlay from "../drawing/DrawingOverlay.js";
import { DigPolygonProvider, useDigPolygon } from "../dig-polygon/digPolygonContext.js";
import JobPrintOverlays from "../print-overlay/JobPrintOverlays.js";
import AllJobsPrintOverlays from "../print-overlay/AllJobsPrintOverlays.js";
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
import { computeCentroidFromObjects, resolveJobLocation } from "./locationResolver.js";
import { computeSpiderfiedPositions, type MarkerPoint } from "./spiderfy.js";
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
  const drawingOwner = username ?? "";
  const rawJobs = jobsState.state === "ready" ? jobsState.jobs : [];
  const mapRef = useRef<google.maps.Map | null>(null);
  const [allSupervisors, setAllSupervisors] = useState<string[]>([]);
  const [centroidsMap, setCentroidsMap] = useState<Map<string, { lat: number; lng: number }>>(new Map());

  useEffect(() => {
    if (!isManager) return;
    api
      .listSupervisors()
      .then(({ supervisors }) => setAllSupervisors(supervisors))
      .catch(() => { /* swallow */ });
  }, [isManager]);

  // Load all drawing centroids to auto-snap pins to drawn geometry when available
  const loadCentroids = useCallback(async () => {
    if (!drawingOwner) return;
    try {
      const res = await api.getAllDrawings(drawingOwner);
      const nextMap = new Map<string, { lat: number; lng: number }>();
      for (const doc of res.docs) {
        if (Array.isArray(doc.objects) && doc.objects.length > 0) {
          const centroid = computeCentroidFromObjects(doc.objects as DrawingObject[]);
          if (centroid) {
            nextMap.set(doc.jobId, centroid);
          }
        }
      }
      setCentroidsMap(nextMap);
    } catch {
      // Best-effort
    }
  }, [drawingOwner]);

  useEffect(() => {
    void loadCentroids();
    const handler = () => void loadCentroids();
    window.addEventListener("nsc:markups-saved", handler);
    window.addEventListener("nsc:jobs-reload", handler);
    return () => {
      window.removeEventListener("nsc:markups-saved", handler);
      window.removeEventListener("nsc:jobs-reload", handler);
    };
  }, [loadCentroids]);

  // Phase 9.7: strict Lumen filter by supervisor (case-insensitive) and contract.
  // Ziply intentionally uses broad contract visibility: every logged-in Ziply
  // viewer sees every customerProject="Ziply" job, regardless of supervisor,
  // crew, foreman, or inspector names.
  const allJobs = useMemo(() => {
    if (contract === "Ziply") {
      // Ziply is authoritative from Billy's rolled-up tracker report — rows
      // dropped from that report get flipped to inTracker:false on the API
      // side. Filter here too so the total-jobs count, filter-rail progress
      // ring, and every downstream memo reflect the tracker, not the raw
      // Firestore superset.
      return rawJobs.filter((j) => isZiplyJob(j) && j.inTracker !== false);
    }

    let filtered = rawJobs.filter((j) => !isZiplyJob(j));

    if (!isManager) {
      const u = String(username ?? "").trim().toLowerCase();
      if (!u) return [];
      // Lumen assignment-based visibility: a supervisor sees a job when they
      // are named on any of its assignment fields.
      filtered = filtered.filter((j) => {
        const assignees = [
          j.constructionSupervisor,
          j.constructionCrewForeman,
          j.crewName,
          j.ziplyInspector,
        ];
        return assignees.some((a) => String(a ?? "").trim().toLowerCase() === u);
      });
    }

    return filtered;
  }, [rawJobs, username, isManager, contract]);
  const { filters, setFilters, setJobs: setFiltersJobs } = useFiltersContext();
  const prevAllJobsLenRef = useRef<number>(-1);
  useEffect(() => {
    if (prevAllJobsLenRef.current !== allJobs.length) {
      prevAllJobsLenRef.current = allJobs.length;
      setFiltersJobs(allJobs);
    }
  }, [allJobs, setFiltersJobs]);

  const [selected, setSelected] = useState<Job | null>(null);
  // Keep selected job object reference fresh when allJobs updates (e.g. after nsc:jobs-reload)
  useEffect(() => {
    if (selected) {
      const fresh = allJobs.find((j) => j.jobId === selected.jobId);
      if (fresh && fresh !== selected) {
        setSelected(fresh);
      }
    }
  }, [allJobs, selected]);

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
    // Ziply contract: strictly isolate Ziply jobs and exclude Lumen/off-tracker rows
    const ziplyOnly = allJobs.filter((j) => j.customerProject === "Ziply" && j.inTracker !== false);
    let list = applyFilters(ziplyOnly, { ...filters, buckets: new Set() });
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
    (j) => resolveJobLocation(j, centroidsMap.get(j.jobId)) !== null
  ), [filtered, centroidsMap]);

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
          centroidsMap={centroidsMap}
          isLakeStevensExperimentJob={isLakeStevensExperimentJob}
        />
        </DigPolygonProvider>
      </DrawingProvider>
    </JobsProvider>
  );
}

// Inner component can access DrawingContext
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
  centroidsMap,
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
  centroidsMap: Map<string, { lat: number; lng: number }>;
  isLakeStevensExperimentJob: (j: Job) => boolean;
}) {
  const { contract } = useActiveContract();
  const { state: drawState, setTarget, loadObjects, save: saveDrawing } = useDrawing();
  const [pinNotice, setPinNotice] = useState<string | null>(null);
  const { setTarget: setDigTarget } = useDigPolygon();
  const [selectedFeature, setSelectedFeature] = useState<PlatformFeature | null>(null);
  // Floating structure detail card — shows next to the cursor when a
  // structure marker or polyline is clicked. Independent from selectedFeature
  // so the card can dismiss without collapsing the LeftRail's pop-out.
  const [structureCard, setStructureCard] = useState<{
    feature: PlatformFeature;
    anchor: { x: number; y: number };
  } | null>(null);
  const [ziplyPrintLayerVisible, setZiplyPrintLayerVisible] = useState(true);
  const [ziply811OverlayVisible, setZiply811OverlayVisible] = useState(false);

  // Live map instance mirror. MapHandle populates it via onMap so hooks that
  // depend on the actual google.maps.Map (Network View zoom bands) can react.
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const handleMapReady = useCallback((m: google.maps.Map | null) => {
    if (mapRef) mapRef.current = m;
    setMapInstance((prev) => (prev === m ? prev : m));
  }, [mapRef]);
  useNetworkViewBands(mapInstance, theme === "network");
  const ziplyJobs = useMemo(
    () => allJobs.filter((j) => j.customerProject === "Ziply" && j.inTracker !== false),
    [allJobs]
  );

  // ── Dual-Pane Street View (#5) ──────────────────────────
  const panoRef = useRef<HTMLDivElement>(null);
  const [streetViewActive, setStreetViewActive] = useState(false);

  useEffect(() => {
    if (selected) {
      setTarget(selected.jobId, selected.workOrder);
    } else {
      setTarget(null, null);
    }
  }, [selected, setTarget]);

  // Keep selected job object reference fresh whenever allJobs updates from backend reloads
  useEffect(() => {
    if (!selected) return;
    const fresh = allJobs.find((j) => j.jobId === selected.jobId);
    if (fresh && fresh !== selected) {
      setSelected(fresh);
    }
  }, [allJobs, selected, setSelected]);

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

  const handlePinMoved = useCallback(async (job: Job, newLat: number, newLng: number) => {
    try {
      await api.updateJobLocation(job.jobId, newLat, newLng);
      setPinNotice(`Saved pin location for ${job.workOrder}`);
      setTimeout(() => setPinNotice(null), 3000);
      onJobsRefresh();
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch (e) {
      console.error("Failed to save pin position override", e);
    }
  }, [onJobsRefresh]);

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
        <div className="map-host" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "row" }}>
          <div style={{ flex: 1, height: "100%", position: "relative", minWidth: 0 }}>
            <GoogleMap
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
              <MapHandle
                mapRef={mapRef}
                onMap={handleMapReady}
              />
              <AllJobsPrintOverlays jobs={mapped} selectedJobId={selected?.jobId} showGlobal={ziplyPrintLayerVisible} />
              <StreetViewCone panoRef={panoRef} onActiveChange={setStreetViewActive} />
              <JobMarkers
                jobs={mapped}
                onSelect={handleSelect}
                allJobs={allJobs}
                centroidsMap={centroidsMap}
                selectedJobId={selected?.jobId ?? null}
                onPinMoved={handlePinMoved}
                theme={theme}
              />
              <AllJobsMarkupsOverlay
                onFeatureClick={(feature, screenXY) => {
                  // Show the floating detail card next to the cursor.
                  // We do NOT auto-open the LeftRail — that stays a
                  // user-driven action via the card's "Open in Left Rail"
                  // button so casual clicks don't disrupt the current view.
                  setStructureCard({ feature, anchor: screenXY });
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

            </GoogleMap>

            {pinNotice && (
              <div className="status-pill status-pill--top" style={{ position: "absolute", top: 58, left: "50%", transform: "translateX(-50%)", background: "rgba(0, 255, 170, 0.9)", color: "#000", fontWeight: 800, zIndex: 1000 }}>
                📍 {pinNotice}
              </div>
            )}

            {/* Floating structure detail card. Sibling of the Google Map so
                its absolute positioning is scoped to the visible map area. */}
            <StructureDetailCard
              feature={structureCard?.feature ?? null}
              anchor={structureCard?.anchor ?? null}
              allJobs={allJobs}
              onClose={() => setStructureCard(null)}
              onOpenInRail={(feature) => {
                setSelectedFeature(feature);
                setStructureCard(null);
              }}
              onNavigate={(feature) => {
                const lat = feature.properties.lat;
                const lng = feature.properties.lng;
                if (
                  typeof lat === "number" &&
                  typeof lng === "number" &&
                  mapInstance
                ) {
                  mapInstance.panTo({ lat, lng });
                  const z = mapInstance.getZoom() ?? 12;
                  if (z < 17) mapInstance.setZoom(18);
                }
              }}
            />
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
              <Suspense fallback={null}>
                <CalendarTab />
              </Suspense>
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
              <Suspense fallback={null}>
                <DashboardPage
                  jobs={allJobs}
                  onFilterStatus={onDashboardFilterStatus}
                  onOpenMap={() => requestTab("filters")}
                  onOpenCalendar={() => requestTab("calendar")}
                  onOpenJob={onDashboardOpenJob}
                />
              </Suspense>
            </div>
          )}

          {/* Full-screen 811 Dig Ticket Manager overlay. Same layering as the
              calendar/dashboard overlays. */}
          {ticketsFullscreen && (
            <div
              className="tickets-fullscreen-overlay"
              style={{ position: "absolute", inset: 0, zIndex: 50, background: "#f8fafc" }}
            >
              <Suspense fallback={null}>
                <DigTicketsTab
                  jobs={allJobs}
                  onOpenJob={(job) => onDashboardOpenJob(job.jobId)}
                />
              </Suspense>
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

        <div className="status-pill status-pill--bottom job-count-pill">
          {jobsState.state === "loading"
            ? "Loading jobs…"
            : jobsState.state === "error"
              ? `Error: ${jobsState.message}`
              : `${mapped.length} on map · ${unmapped} unmapped · ${allJobs.length} total`}
        </div>
      </div>

      {selected && (
        <aside className="job-right-panel">
          <div className="job-right-panel__card">
            <JobCard
              job={selected}
              onClose={() => {
                setSelected(null);
                window.dispatchEvent(new Event("nsc:markups-saved"));
              }}
              variant="panel"
            />
          </div>
          <div className="job-right-panel__layers">
            <LayersPanel />
          </div>
        </aside>
      )}
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
function MapHandle({
  mapRef,
  onMap,
}: {
  mapRef: React.MutableRefObject<google.maps.Map | null>;
  onMap?: (m: google.maps.Map | null) => void;
}) {
  const map = useMap();
  const onMapRef = useRef(onMap);
  useEffect(() => {
    onMapRef.current = onMap;
  }, [onMap]);

  useEffect(() => {
    mapRef.current = map ?? null;
    onMapRef.current?.(map ?? null);
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

function isHubJob(job: Job): boolean {
  const wo = (job.workOrder || "").trim().toUpperCase();
  if (wo.startsWith("H2") || wo.startsWith("HUB")) return true;
  const cust = (job.customerProject || "").toLowerCase();
  if (cust.includes("hub")) return true;
  const notes = (job.nscProjectNotes || "").toLowerCase();
  if (notes.startsWith("hub") || notes.includes("hub site")) return true;
  return false;
}

// Renders Precision GIS Vector Pins, dynamic zero-clipping labels/hub badges, and spiderfy fanning
function JobMarkers({
  jobs,
  onSelect,
  allJobs,
  centroidsMap,
  selectedJobId,
  onPinMoved,
  theme,
}: {
  jobs: Job[];
  onSelect: (j: Job) => void;
  allJobs: Job[];
  centroidsMap: Map<string, { lat: number; lng: number }>;
  selectedJobId: string | null;
  onPinMoved: (job: Job, lat: number, lng: number) => void;
  theme: string;
}) {
  const map = useMap();
  const { contract } = useActiveContract();
  const { focus, clearFocus } = useSearchFocus();
  const fittedRef = useRef(false);
  const markersRef = useRef<globalThis.Map<string, google.maps.Marker>>(new globalThis.Map());
  const labelMarkersRef = useRef<google.maps.Marker[]>([]);
  const leaderLinesRef = useRef<google.maps.Polyline[]>([]);
  const searchPinRef = useRef<google.maps.Marker | null>(null);
  const searchInfoRef = useRef<google.maps.InfoWindow | null>(null);

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const onPinMovedRef = useRef(onPinMoved);
  useEffect(() => {
    onPinMovedRef.current = onPinMoved;
  }, [onPinMoved]);

  useEffect(() => {
    if (!map) return;

    // Clear previous overlays
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current.clear();
    labelMarkersRef.current.forEach((lm) => lm.setMap(null));
    labelMarkersRef.current = [];
    leaderLinesRef.current.forEach((line) => line.setMap(null));
    leaderLinesRef.current = [];

    const currentZoom = map.getZoom() ?? 0;
    const showClusters = false; // Disabled per user request
    const labelsVisible = currentZoom >= WO_LABEL_MIN_ZOOM && !showClusters;

    // 1. Resolve true coordinate for each job (custom override > drawn route centroid > address geocode)
    const markerPoints: MarkerPoint[] = [];
    const jobByPointId = new Map<string, Job>();
    const resolvedLocByJobId = new Map<string, { lat: number; lng: number; isManual: boolean; isGeometry: boolean }>();

    jobs.forEach((job) => {
      const loc = resolveJobLocation(job, centroidsMap.get(job.jobId));
      if (!loc) return;
      markerPoints.push({
        id: job.jobId,
        position: { lat: loc.lat, lng: loc.lng },
        isHub: isHubJob(job),
      });
      jobByPointId.set(job.jobId, job);
      resolvedLocByJobId.set(job.jobId, {
        lat: loc.lat,
        lng: loc.lng,
        isManual: loc.source === "custom",
        isGeometry: loc.source === "geometry",
      });
    });

    // 2. Compute spiderfied fan-out positions for overlapping pins / hubs
    const spiderfied = computeSpiderfiedPositions(markerPoints, map);

    // 3. Render precision markers and labels
    spiderfied.forEach((sp) => {
      const job = jobByPointId.get(sp.id);
      if (!job) return;

      const resLoc = resolvedLocByJobId.get(job.jobId);
      const isManual = resLoc?.isManual ?? false;
      const isGeometry = resLoc?.isGeometry ?? false;
      const colorKey = colorKeyForJob(job);
      const color = MARKER_COLORS[colorKey];
      const isHub = isHubJob(job);
      const isSelected = selectedJobId === job.jobId;

      // Draw subtle leader line if marker is spiderfied away from its origin
      if (sp.isSpiderfied) {
        const line = new google.maps.Polyline({
          path: [sp.originalPosition, sp.displayPosition],
          strokeColor: isHub ? "#00ffaa" : color.core,
          strokeWeight: 1.5,
          strokeOpacity: 0.8,
          map,
          zIndex: 10,
        });
        leaderLinesRef.current.push(line);
      }

      // Pin marker (Draggable to allow instant relocation to exact site)
      const pinIconUrl = precisionPinDataUrl(
        color,
        (job.inTracker ? 1 : 0.65) * (isJobCompleted(job) ? 0.65 : 1),
        isSelected,
        isManual
      );

      const m = new google.maps.Marker({
        position: sp.displayPosition,
        map,
        title: `${job.workOrder} · ${job.secondaryJobStatus ?? job.jobStatus ?? ""} ${isManual ? "(Custom Location)" : isGeometry ? "(Snapped to Cable Route)" : ""}\nDrag to set exact site location`,
        draggable: true,
        zIndex: isSelected ? 999 : isHub ? 500 : 100,
        icon: {
          url: pinIconUrl,
          scaledSize: new google.maps.Size(28, 38),
          anchor: new google.maps.Point(14, 37),
        },
      });

      m.addListener("click", () => {
        onSelectRef.current(job);
        focusMapOnLatLng(map, sp.displayPosition.lat, sp.displayPosition.lng);
      });

      m.addListener("dragend", (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          const newLat = e.latLng.lat();
          const newLng = e.latLng.lng();
          onPinMovedRef.current(job, newLat, newLng);
        }
      });

      markersRef.current.set(job.jobId, m);

      // Dynamic WO / Hub label marker — zero clipping
      if (job.workOrder) {
        let labelUrl = "";
        let lblWidth = 70;
        let lblHeight = 24;

        if (isHub) {
          const hubBadge = precisionHubBadgeDataUrl(job.workOrder);
          labelUrl = hubBadge.url;
          lblWidth = hubBadge.width;
          lblHeight = hubBadge.height;
        } else {
          const woBadge = precisionWoLabelDataUrl(job.workOrder, color.core, isSelected);
          labelUrl = woBadge.url;
          lblWidth = woBadge.width;
          lblHeight = woBadge.height;
        }

        const lm = new google.maps.Marker({
          position: sp.displayPosition,
          map: labelsVisible ? map : null,
          icon: {
            url: labelUrl,
            scaledSize: new google.maps.Size(lblWidth, lblHeight),
            anchor: new google.maps.Point(lblWidth / 2, isHub ? 48 : 46),
          },
          clickable: true,
          zIndex: isSelected ? 1000 : isHub ? 501 : 101,
        });

        lm.addListener("click", () => {
          onSelectRef.current(job);
          focusMapOnLatLng(map, sp.displayPosition.lat, sp.displayPosition.lng);
        });

        labelMarkersRef.current.push(lm);
      }
    });

    // Zoom listener to toggle label visibility on existing label markers
    const zoomListener = map.addListener("zoom_changed", () => {
      const z = map.getZoom() ?? 0;
      const showLabels = z >= WO_LABEL_MIN_ZOOM;
      labelMarkersRef.current.forEach((lm) => lm.setMap(showLabels ? map : null));
    });

    // Auto fit bounds on initial load with PNW window
    if (!fittedRef.current && markerPoints.length > 0) {
      const PNW = { minLat: 45.0, maxLat: 49.5, minLng: -125.0, maxLng: -116.0 };
      const inPNW = (lat: number, lng: number) =>
        lat >= PNW.minLat && lat <= PNW.maxLat && lng >= PNW.minLng && lng <= PNW.maxLng;
      const bounds = new google.maps.LatLngBounds();
      let extended = 0;
      let firstPt: { lat: number; lng: number } | null = null;
      markerPoints.forEach((pt) => {
        if (!inPNW(pt.position.lat, pt.position.lng)) return;
        bounds.extend(pt.position);
        extended++;
        if (!firstPt) firstPt = pt.position;
      });

      if (extended === 0) {
        map.setCenter(markerPoints[0]!.position);
        map.setZoom(11);
      } else if (extended === 1 && firstPt) {
        map.setCenter(firstPt);
        map.setZoom(14);
      } else {
        map.fitBounds(bounds, 80);
        const cap = google.maps.event.addListenerOnce(map, "idle", () => {
          const z = map.getZoom() ?? 0;
          if (z > 13) map.setZoom(13);
          void cap;
        });
      }
      fittedRef.current = true;
    }

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();
      labelMarkersRef.current.forEach((lm) => lm.setMap(null));
      labelMarkersRef.current = [];
      leaderLinesRef.current.forEach((line) => line.setMap(null));
      leaderLinesRef.current = [];
      google.maps.event.removeListener(zoomListener);
    };
  }, [map, jobs, centroidsMap, selectedJobId, contract]);

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
      const loc = resolveJobLocation(job, centroidsMap.get(job.jobId));
      if (loc) {
        focusMapOnLatLng(map, loc.lat, loc.lng);
        const existing = markersRef.current?.get(job.jobId);
        if (existing) {
          existing.setMap(map);
          existing.setAnimation(google.maps.Animation.BOUNCE);
          setTimeout(() => existing.setAnimation(null), 1800);
        } else {
          const colorKey = colorKeyForJob(job, contract);
          const color = MARKER_COLORS[colorKey];
          const tempPin = new google.maps.Marker({
            position: { lat: loc.lat, lng: loc.lng },
            map,
            animation: google.maps.Animation.DROP,
            zIndex: 9999,
            title: `${job.workOrder} (hidden by filter)`,
            icon: {
              url: precisionPinDataUrl(color, 1),
              scaledSize: new google.maps.Size(28, 38),
              anchor: new google.maps.Point(14, 37),
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
  }, [map, focus, allJobs, onSelect, clearFocus, centroidsMap, contract]);

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

