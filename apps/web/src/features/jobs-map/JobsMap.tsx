// Jobs Map — Phase 3: full drawing toolbar + Firestore persistence
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import { useJobs } from "./useJobs.js";
import { applyFilters } from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import { useFilters } from "./useFilters.js";
import LeftRail from "./LeftRail.js";
import JobCard from "./JobCard.js";
import LayersPanel from "../workspace/LayersPanel.js";
import type { Job } from "@nsc/types";
import { useSearchFocus } from "../search/searchContext.js";
import { MARKER_COLORS, colorKeyForJob, isJobCompleted, neonPinDataUrl } from "./markerStyle.js";
import { api } from "../../lib/api.js";
import { DrawingProvider, useDrawing } from "../drawing/drawingContext.js";
import DrawingOverlay from "../drawing/DrawingOverlay.js";
import AllJobsMarkupsOverlay from "../drawing/AllJobsMarkupsOverlay.js";
import ModifiersPanel from "../drawing/ModifiersPanel.js";
import MapTypeToggle from "../map/MapTypeToggle.js";
import type { MapTheme } from "../map/themeContext.js";
import { JobsProvider } from "./jobsContext.js";
import { useAuth } from "../auth/authContext.js";

const FOCUS_ZOOM = 17;

export default function JobsMap() {
  const jobsState = useJobs();
  const reload = jobsState.reload;
  const { theme } = useMapTheme();
  const { username } = useAuth();
  const rawJobs = jobsState.state === "ready" ? jobsState.jobs : [];
  // Phase 9: filter by supervisor (case-insensitive). Empty/unmatched → show all.
  const allJobs = useMemo(() => {
    const u = (username ?? "").trim().toLowerCase();
    if (!u) return rawJobs;
    const matched = rawJobs.filter(
      (j) => (j.constructionSupervisor ?? "").trim().toLowerCase() === u
    );
    return matched.length > 0 ? matched : rawJobs;
  }, [rawJobs, username]);
  const [filters, setFilters] = useFilters(allJobs);
  const [selected, setSelected] = useState<Job | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const filtered = useMemo(() => applyFilters(allJobs, filters), [allJobs, filters]);
  const mapped = filtered.filter(
    (j) => j.geocode?.status === "OK" && j.geocode.lat !== 0
  );
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
        // If the current draft has a targetJobId, try to push it to Firestore.
        // On failure we fall back to localStorage (already persisted).
        // If no targetJobId, the draft is unattached — leave it in localStorage.
        if (prevJobId) {
          try {
            await saveDrawing();
          } catch {
            // Save failed — localStorage draft is still intact, user won't lose work.
          }
        }
        // Either way, proceed with the switch — no window.confirm.
      }

      setSelected(job);
      // Load existing drawings for the newly-selected job into the overlay.
      try {
        const doc = await api.getDrawing(job.jobId);
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

  return (
    <div className="jobs-map">
      <LeftRail
        jobs={allJobs}
        filters={filters}
        setFilters={setFilters}
        onResync={onResync}
        mapRef={mapRef}
      />

      <div className="jobs-map__main">
        <ModifiersPanel />
        <div className="map-host" style={{ position: "absolute", inset: 0, top: 0 }}>
          <Map
            defaultCenter={DEFAULT_CENTER}
            defaultZoom={DEFAULT_ZOOM}
            styles={stylesFor(theme)}
            gestureHandling="greedy"
            disableDefaultUI={false}
          >
            <MapHandle mapRef={mapRef} />
            <JobMarkers
              jobs={mapped}
              onSelect={handleSelect}
              allJobs={allJobs}
            />
            <AllJobsMarkupsOverlay />
            <DrawingOverlay />
            <MapTypeToggle />
          </Map>
        </div>

        <div className="status-pill status-pill--bottom">
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
              onClose={() => setSelected(null)}
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
        onSelect(job);
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
  }, [map, jobs, onSelect]);

  useEffect(() => {
    if (!map || !focus) return;

    if (focus.kind === "latLng") {
      focusMapOnLatLng(map, focus.lat, focus.lng);
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
      }
      clearFocus();
    }
  }, [map, focus, allJobs, onSelect, clearFocus]);

  return null;
}

function focusMapOnLatLng(map: google.maps.Map, lat: number, lng: number) {
  map.panTo({ lat, lng });
  const currentZoom = map.getZoom() ?? 0;
  if (currentZoom < FOCUS_ZOOM) {
    map.setZoom(FOCUS_ZOOM);
  }
}
