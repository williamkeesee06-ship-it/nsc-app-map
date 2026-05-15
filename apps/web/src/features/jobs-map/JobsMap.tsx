// Jobs Map — Phase 2. Loads jobs from /api/jobs, renders markers for jobs with
// a valid geocode, and shows a left filter rail + click-to-preview JobCard.
import { useEffect, useMemo, useState } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";
import { useJobs } from "./useJobs.js";
import FilterRail, { defaultFilters, applyFilters } from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import JobCard from "./JobCard.js";
import type { Job } from "@nsc/types";

export default function JobsMap() {
  const jobsState = useJobs();
  const { theme } = useMapTheme();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [selected, setSelected] = useState<Job | null>(null);

  const allJobs = jobsState.state === "ready" ? jobsState.jobs : [];
  const filtered = useMemo(() => applyFilters(allJobs, filters), [allJobs, filters]);
  const mapped = filtered.filter(
    (j) => j.geocode?.status === "OK" && j.geocode.lat !== 0
  );
  const unmapped = filtered.length - mapped.length;

  return (
    <div className="jobs-map">
      <FilterRail jobs={allJobs} filters={filters} setFilters={setFilters} />

      <div className="jobs-map__main">
        <div className="map-host">
          <Map
            defaultCenter={DEFAULT_CENTER}
            defaultZoom={DEFAULT_ZOOM}
            styles={stylesFor(theme)}
            gestureHandling="greedy"
            disableDefaultUI={false}
          >
            <JobMarkers jobs={mapped} onSelect={setSelected} />
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

// Renders a marker per job, color-coded by Job Status.
function JobMarkers({
  jobs,
  onSelect,
}: {
  jobs: Job[];
  onSelect: (j: Job) => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const markers = jobs.map((job) => {
      const m = new google.maps.Marker({
        position: { lat: job.geocode!.lat, lng: job.geocode!.lng },
        map,
        title: `${job.workOrder} · ${job.jobStatus ?? ""}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: statusColor(job.jobStatus),
          fillOpacity: job.inTracker ? 1 : 0.55,
          strokeColor: "#0b0f13",
          strokeWeight: 2,
        },
      });
      m.addListener("click", () => onSelect(job));
      return m;
    });

    // Fit bounds if we have jobs.
    if (jobs.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      jobs.forEach((j) => bounds.extend({ lat: j.geocode!.lat, lng: j.geocode!.lng }));
      // Only fit if bounds make sense (>1 distinct point).
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      if (ne.lat() !== sw.lat() || ne.lng() !== sw.lng()) {
        map.fitBounds(bounds, 60);
      } else {
        map.setCenter({ lat: jobs[0]!.geocode!.lat, lng: jobs[0]!.geocode!.lng });
        map.setZoom(14);
      }
    }
    return () => markers.forEach((m) => m.setMap(null));
  }, [map, jobs, onSelect]);
  return null;
}

function statusColor(status: string | null): string {
  switch (status) {
    case "In Progress":
      return "#20808d"; // teal
    case "On Hold":
      return "#d4a017"; // amber
    case "Complete":
      return "#4a8a4a"; // green
    case "In Billing":
      return "#7a5cd1"; // purple
    case "In Review":
      return "#3b78c2"; // blue
    default:
      return "#888";
  }
}
