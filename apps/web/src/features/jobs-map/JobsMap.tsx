// Jobs Map — Phase 3: full drawing toolbar + Firestore persistence
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import { useJobs } from "./useJobs.js";
import { applyFilters } from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import { useFiltersContext } from "./filtersContext.js";
import LeftRail from "./LeftRail.js";
import CalendarTab from "./CalendarTab.js";
import DashboardPage from "../dashboard/DashboardPage.js";
import type { StatusBucket } from "./markerStyle.js";
import JobCard from "./JobCard.js";
import LayersPanel from "../workspace/LayersPanel.js";
import type { Job } from "@nsc/types";
import { useSearchFocus } from "../search/searchContext.js";
import { MARKER_COLORS, colorKeyForJob, isJobCompleted, neonPinDataUrl } from "./markerStyle.js";
import { api } from "../../lib/api.js";
import { DrawingProvider, useDrawing } from "../drawing/drawingContext.js";
import DrawingOverlay from "../drawing/DrawingOverlay.js";
import AllJobsMarkupsOverlay from "../drawing/AllJobsMarkupsOverlay.js";
import CentralOfficesOverlay from "./CentralOfficesOverlay.js";
import { useShowCOs } from "./centralOfficesStore.js";
import ModifiersPanel from "../drawing/ModifiersPanel.js";
import JobsShownPill from "./JobsShownPill.js";
// MapTypeToggle moved to LeftRail Filters tab (MapTypeFilterSection). MapTypeApplier still listens to the same broadcast.
import MapTypeApplier from "../map/MapTypeApplier.js";
import type { MapTheme } from "../map/themeContext.js";
import { JobsProvider } from "./jobsContext.js";
import { useAuth } from "../auth/authContext.js";
import LuminaOrb from "../lumina/Orb.js";
import LuminaMapBridge from "../lumina/MapBridge.js";

const FOCUS_ZOOM = 17;

export default function JobsMap() {
  const jobsState = useJobs();
  const reload = jobsState.reload;
  const { theme } = useMapTheme();
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
  // Phase 9.7: strict filter by supervisor (case-insensitive).
  // Managers (e.g. Robbie Thoman) see jobs for EVERY supervisor in the
  // allowlist — their FilterRail exposes a Supervisor multi-select instead
  // of the usual status buckets.
  const allJobs = useMemo(() => {
    if (isManager) return rawJobs;
    const u = (username ?? "").trim().toLowerCase();
    if (!u) return [];
    return rawJobs.filter(
      (j) => (j.constructionSupervisor ?? "").trim().toLowerCase() === u
    );
  }, [rawJobs, username, isManager]);
  const { filters, setFilters, setJobs: setFiltersJobs } = useFiltersContext();
  // Keep the FiltersContext jobs list in sync with the supervisor-scoped
  // allJobs so the topbar StatusFilterPills show accurate per-bucket counts.
  useEffect(() => {
    setFiltersJobs(allJobs);
  }, [allJobs, setFiltersJobs]);
  const [selected, setSelected] = useState<Job | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  // Mirror the locally-tracked `selected` job into the global search context
  // so the topbar job-info boxes (rendered outside this component) can read it.
  // Cleared when the JobCard closes.
  const { setSelectedJobId } = useSearchFocus();
  useEffect(() => {
    setSelectedJobId(selected?.jobId ?? null);
  }, [selected, setSelectedJobId]);
  const filtered = useMemo(() => applyFilters(allJobs, filters), [allJobs, filters]);
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
        <JobsMapInner
          allJobs={allJobs}
          mapped={mapped}
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
        />
      </DrawingProvider>
    </JobsProvider>
  );
}

// Inner component can now access DrawingContext
function JobsMapInner({
  allJobs,
  mapped,
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
}: {
  allJobs: Job[];
  mapped: Job[];
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
}) {
  const { state: drawState, setTarget, loadObjects, save: saveDrawing } = useDrawing();

  // When selected job changes, update the drawing target
  useEffect(() => {
    if (selected) {
      setTarget(selected.jobId, selected.workOrder);
    } else {
      setTarget(null, null);
    }
  }, [selected, setTarget]);

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
      // Now fetch the newly-selected job's markups and load them in.
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
    },
    [setSelected, loadObjects, saveDrawing, drawState.dirty, drawState.objects, drawState.targetJobId]
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
  useEffect(() => {
    function onActiveTab(e: Event) {
      const detail = (e as CustomEvent<{ tab: string; collapsed: boolean }>).detail;
      if (!detail) return;
      setCalendarFullscreen(detail.tab === "calendar");
      setDashboardFullscreen(detail.tab === "dashboard");
    }
    window.addEventListener("nsc:active-tab", onActiveTab);
    return () => window.removeEventListener("nsc:active-tab", onActiveTab);
  }, []);

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
      />

      <div className="jobs-map__main">
        <ModifiersPanel />
        <JobsShownPill shown={mapped.length} total={allJobs.length} />
        <div className="map-host" style={{ position: "absolute", inset: 0, top: 0 }}>
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
            rotateControl={false}
            scaleControl={false}
          >
            <MapHandle mapRef={mapRef} />
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
            {/* MapTypeToggle is in the topbar; this applier (inside the Map
                context) actually applies the chosen style to the live map. */}
            <MapTypeApplier />
            {/* Lumina map bridge — registers an imperative handle the
                navigation tools call into. Renders nothing. */}
            <LuminaMapBridge />
          </Map>
          {/* Lumina orb — floats above Google's pan/Pegman controls. */}
          <LuminaOrb />

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

      {/* Right-side detail panel: opens when a job pin is clicked.
          Contains the job card on top and that job's drawing layers below.
          Top style toolbar (ModifiersPanel) is unaffected — it stays
          pinned above the map area in .jobs-map__main. */}
      {selected && (
        <aside className="job-right-panel">
          <div className="job-right-panel__card">
            <JobCard
              job={selected}
              onClose={() => {
                setSelected(null);
                // Force the permanent records layer to update immediately after finishing edits on a job.
                // This guarantees the user's new markups appear on the main map right away.
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
    const labelsVisible = currentZoom >= WO_LABEL_MIN_ZOOM;

    jobs.forEach((job) => {
      const colorKey = colorKeyForJob(job);
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
      if (job.workOrder) {
        const pinColor = color.core;
        const woText = job.workOrder;
        // Build a tiny SVG label pill
        const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="22">
  <rect x="0" y="0" width="80" height="22" rx="11" fill="white" stroke="#C8D0DA" stroke-width="1.5"/>
  <text x="40" y="15" text-anchor="middle" font-size="10" font-weight="700"
    fill="${pinColor}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${woText}</text>
</svg>`;
        const labelUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelSvg)}`;
        const lm = new google.maps.Marker({
          position: { lat: job.geocode!.lat, lng: job.geocode!.lng },
          map: labelsVisible ? map : null,
          icon: {
            url: labelUrl,
            scaledSize: new google.maps.Size(80, 22),
            anchor: new google.maps.Point(40, 48), // above pin tip
          },
          clickable: false,
          zIndex: 1,
        });
        labelMarkers.push(lm);
      }
    });
    markersRef.current = created;
    labelMarkersRef.current = labelMarkers;

    // Zoom listener to toggle label visibility
    const zoomListener = map.addListener("zoom_changed", () => {
      const zoom = map.getZoom() ?? 0;
      const show = zoom >= WO_LABEL_MIN_ZOOM;
      labelMarkersRef.current.forEach((lm) => lm.setMap(show ? map : null));
    });

    if (!fittedRef.current && jobs.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      jobs.forEach((j) =>
        bounds.extend({ lat: j.geocode!.lat, lng: j.geocode!.lng })
      );
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      if (ne.lat() !== sw.lat() || ne.lng() !== sw.lng()) {
        map.fitBounds(bounds, 60);
      } else {
        map.setCenter({ lat: jobs[0]!.geocode!.lat, lng: jobs[0]!.geocode!.lng });
        map.setZoom(14);
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
  }, [map, jobs]); // removed onSelect from deps to prevent re-renders

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

function focusMapOnLatLng(map: google.maps.Map, lat: number, lng: number) {
  map.panTo({ lat, lng });
  const currentZoom = map.getZoom() ?? 0;
  if (currentZoom < FOCUS_ZOOM) {
    map.setZoom(FOCUS_ZOOM);
  }
}
