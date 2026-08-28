// Jobs Map — Phase 3: full drawing toolbar + Firestore persistence
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import { useJobs } from "./useJobs.js";
import { applyFilters } from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import { useFiltersContext } from "./filtersContext.js";
import LeftRail from "./LeftRail.js";
import JobCard from "./JobCard.js";
import LayersPanel from "../workspace/LayersPanel.js";
import type { Job, DrawingObject } from "@nsc/types";
import { useSearchFocus } from "../search/searchContext.js";
import {
  MARKER_COLORS,
  colorKeyForJob,
  isJobCompleted,
  precisionPinDataUrl,
  precisionWoLabelDataUrl,
  precisionHubBadgeDataUrl,
} from "./markerStyle.js";
import { api } from "../../lib/api.js";
import { DrawingProvider, useDrawing } from "../drawing/drawingContext.js";
import DrawingOverlay from "../drawing/DrawingOverlay.js";
import AllJobsMarkupsOverlay from "../drawing/AllJobsMarkupsOverlay.js";
import CentralOfficesOverlay from "./CentralOfficesOverlay.js";
import { useShowCOs } from "./centralOfficesStore.js";
import ModifiersPanel from "../drawing/ModifiersPanel.js";
import MapTypeToggle from "../map/MapTypeToggle.js";
import type { MapTheme } from "../map/themeContext.js";
import { JobsProvider } from "./jobsContext.js";
import { useAuth } from "../auth/authContext.js";
import { computeCentroidFromObjects, resolveJobLocation } from "./locationResolver.js";
import { computeSpiderfiedPositions, type MarkerPoint } from "./spiderfy.js";

const FOCUS_ZOOM = 17;

export default function JobsMap() {
  const jobsState = useJobs();
  const reload = jobsState.reload;
  const { theme } = useMapTheme();
  const { username, isManager } = useAuth();
  const drawingOwner = username ?? "";
  const rawJobs = jobsState.state === "ready" ? jobsState.jobs : [];
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

  const allJobs = useMemo(() => {
    if (isManager) return rawJobs;
    const u = (username ?? "").trim().toLowerCase();
    if (!u) return [];
    return rawJobs.filter(
      (j) => (j.constructionSupervisor ?? "").trim().toLowerCase() === u
    );
  }, [rawJobs, username, isManager]);

  const { filters, setFilters, setJobs: setFiltersJobs } = useFiltersContext();
  useEffect(() => {
    setFiltersJobs(allJobs);
  }, [allJobs, setFiltersJobs]);

  const [selected, setSelected] = useState<Job | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const filtered = useMemo(() => applyFilters(allJobs, filters), [allJobs, filters]);

  // Map jobs whose location can be resolved via manual override, drawn geometry, or geocode
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
          centroidsMap={centroidsMap}
        />
      </DrawingProvider>
    </JobsProvider>
  );
}

// Inner component can access DrawingContext
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
  centroidsMap,
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
  centroidsMap: Map<string, { lat: number; lng: number }>;
}) {
  const { state: drawState, setTarget, loadObjects, save: saveDrawing } = useDrawing();
  const [pinNotice, setPinNotice] = useState<string | null>(null);

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
        if (prevJobId) {
          try {
            await saveDrawing();
          } catch {
            // silent
          }
        }
      }

      setSelected(job);
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
    [setSelected, loadObjects, saveDrawing, drawState.dirty, drawState.objects, drawState.targetJobId, drawingOwner]
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
        <div className="map-host" style={{ position: "absolute", inset: 0, top: 0 }}>
          <GoogleMap
            defaultCenter={DEFAULT_CENTER}
            defaultZoom={DEFAULT_ZOOM}
            styles={stylesFor(theme)}
            gestureHandling="greedy"
            disableDefaultUI={false}
            streetViewControl={true}
            mapTypeControl={false}
          >
            <MapHandle mapRef={mapRef} />
            <JobMarkers
              jobs={mapped}
              onSelect={handleSelect}
              allJobs={allJobs}
              centroidsMap={centroidsMap}
              selectedJobId={selected?.jobId ?? null}
              onPinMoved={handlePinMoved}
            />
            <AllJobsMarkupsOverlay
              onMarkupClick={(jobId) => {
                const j = allJobs.find((x) => x.jobId === jobId);
                if (j) void handleSelect(j);
              }}
            />
            <CentralOfficesOverlay visible={showCOs} />
            <DrawingOverlay />
            <MapTypeToggle />
          </GoogleMap>
        </div>

        {pinNotice && (
          <div className="status-pill status-pill--top" style={{ position: "absolute", top: 58, left: "50%", transform: "translateX(-50%)", background: "rgba(0, 255, 170, 0.9)", color: "#000", fontWeight: 800, zIndex: 1000 }}>
            📍 {pinNotice}
          </div>
        )}

        <div className="status-pill status-pill--bottom records-banner">
          {selected ? (
            <span>
              Editing <strong>{selected.workOrder}</strong> — drag pin to reposition exact site · markups stay visible
            </span>
          ) : (
            <span>
              <strong>🗺️ Permanent As-Built Records</strong> — drag any pin to set exact job site · click hub/pin to inspect
            </span>
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

const WO_LABEL_MIN_ZOOM = 12;

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
}: {
  jobs: Job[];
  onSelect: (j: Job) => void;
  allJobs: Job[];
  centroidsMap: Map<string, { lat: number; lng: number }>;
  selectedJobId: string | null;
  onPinMoved: (job: Job, lat: number, lng: number) => void;
}) {
  const map = useMap();
  const { focus, clearFocus } = useSearchFocus();
  const fittedRef = useRef(false);
  const markersRef = useRef<globalThis.Map<string, google.maps.Marker>>(new globalThis.Map());
  const labelMarkersRef = useRef<google.maps.Marker[]>([]);
  const leaderLinesRef = useRef<google.maps.Polyline[]>([]);

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
    const labelsVisible = currentZoom >= WO_LABEL_MIN_ZOOM;

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

    // Zoom listener to re-evaluate spiderfy and label visibility
    const zoomListener = map.addListener("zoom_changed", () => {
      const zoom = map.getZoom() ?? 0;
      const show = zoom >= WO_LABEL_MIN_ZOOM;
      labelMarkersRef.current.forEach((lm) => lm.setMap(show ? map : null));
    });

    // Auto fit bounds on initial load
    if (!fittedRef.current && markerPoints.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      markerPoints.forEach((pt) => bounds.extend(pt.position));
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      if (ne.lat() !== sw.lat() || ne.lng() !== sw.lng()) {
        map.fitBounds(bounds, 60);
      } else {
        map.setCenter(markerPoints[0]!.position);
        map.setZoom(14);
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
  }, [map, jobs, centroidsMap, selectedJobId]);

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
      const loc = resolveJobLocation(job, centroidsMap.get(job.jobId));
      if (loc) {
        focusMapOnLatLng(map, loc.lat, loc.lng);
      }
      clearFocus();
    }
  }, [map, focus, allJobs, onSelect, clearFocus, centroidsMap]);

  return null;
}

function focusMapOnLatLng(map: google.maps.Map, lat: number, lng: number) {
  map.panTo({ lat, lng });
  const currentZoom = map.getZoom() ?? 0;
  if (currentZoom < FOCUS_ZOOM) {
    map.setZoom(FOCUS_ZOOM);
  }
}

