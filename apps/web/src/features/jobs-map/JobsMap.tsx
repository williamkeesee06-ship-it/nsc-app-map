// Jobs Map — Phase 2.1
// Architecture:
//   <div.jobs-map>
//     <LeftRail/>   ← always-visible scrollable rail (tools + filters)
//     <main>
//       <Map>
//         <JobMarkers/>      ← markers + click-to-zoom
//         <MapHandle/>       ← captures the google.maps.Map instance into ref
//       </Map>
//       <statusPill/>
//       <JobCard popup/>
//     </main>
//   </div>
//
// SearchFocus integration: external SearchBar can request "focus job <id>"
// or "focus lat/lng" → JobMarkers handles both by panTo + zoom-in.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import { useJobs } from "./useJobs.js";
import { defaultFilters, applyFilters } from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import LeftRail from "./LeftRail.js";
import JobCard from "./JobCard.js";
import type { Job } from "@nsc/types";
import { useSearchFocus } from "../search/searchContext.js";
import { MARKER_COLORS, colorKeyForJob, neonPinDataUrl } from "./markerStyle.js";
import { api } from "../../lib/api.js";

const FOCUS_ZOOM = 17;

export default function JobsMap() {
  const jobsState = useJobs();
  const reload = jobsState.reload;
  const { theme } = useMapTheme();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [selected, setSelected] = useState<Job | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  const allJobs = jobsState.state === "ready" ? jobsState.jobs : [];
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
    <div className="jobs-map">
      <LeftRail
        jobs={allJobs}
        filters={filters}
        setFilters={setFilters}
        onResync={onResync}
        mapRef={mapRef}
      />

      <div className="jobs-map__main">
        <div className="map-host">
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
              onSelect={setSelected}
              allJobs={allJobs}
            />
          </Map>
        </div>

        <div className="status-pill status-pill--bottom">
          {jobsState.state === "loading"
            ? "Loading jobs…"
            : jobsState.state === "error"
              ? `Error: ${jobsState.message}`
              : `${mapped.length} on map · ${unmapped} unmapped · ${allJobs.length} total`}
        </div>

        {selected && (
          <div className="job-popup-wrap">
            <JobCard job={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
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

// Renders neon-pin markers for each visible job and wires:
//   - marker click → onSelect + zoom-in
//   - search-driven focus requests → pan + zoom
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

  // Build/replace markers when jobs change.
  useEffect(() => {
    if (!map) return;
    const created = new globalThis.Map<string, google.maps.Marker>();

    jobs.forEach((job) => {
      const colorKey = colorKeyForJob(job);
      const color = MARKER_COLORS[colorKey];
      const m = new google.maps.Marker({
        position: { lat: job.geocode!.lat, lng: job.geocode!.lng },
        map,
        title: `${job.workOrder} · ${job.secondaryJobStatus ?? job.jobStatus ?? ""}`,
        icon: {
          url: neonPinDataUrl(color, job.inTracker ? 1 : 0.55),
          scaledSize: new google.maps.Size(40, 55),
          anchor: new google.maps.Point(20, 50),
        },
      });
      m.addListener("click", () => {
        onSelect(job);
        focusMapOnLatLng(map, job.geocode!.lat, job.geocode!.lng);
      });
      created.set(job.jobId, m);
    });
    markersRef.current = created;

    // Auto-fit only on first render with jobs.
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
      if (markersRef.current === created) markersRef.current = null;
    };
  }, [map, jobs, onSelect]);

  // External focus requests (from SearchBar).
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
