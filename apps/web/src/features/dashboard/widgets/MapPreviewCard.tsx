// Map preview card — a live second <Map> (the app-level <APIProvider> makes
// this safe) showing the signed-in user's geocoded jobs as neon pins. Tapping
// the card jumps to the full Jobs/map tab.
//
// KPI chips, all derived from live jobs (dashboard_fix_spec §3):
//   Active Jobs     — bucket ∈ {needs_fielding, rts, pending, in_progress}
//   Permits Pending — permitRequired truthy AND no actualCompletionDate
//   Traffic Control — trafficControlRequired === true AND no actualCompletionDate

import { useEffect, useMemo } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import type { Job } from "@nsc/types";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../../map/mapStyles.js";
import {
  MARKER_COLORS,
  bucketForJob,
  colorKeyForJob,
  isJobCompleted,
  neonPinDataUrl,
} from "../../jobs-map/markerStyle.js";

const ACTIVE_BUCKETS = new Set(["needs_fielding", "rts", "pending", "in_progress"]);

function isTruthyFlag(value: string | null | undefined): boolean {
  return /^(y|yes|true|required|1)/i.test((value ?? "").trim());
}

function notCompleted(job: Job): boolean {
  return !(job.actualCompletionDate && job.actualCompletionDate.trim());
}

export interface MapPreviewCardProps {
  jobs: Job[];
  onOpenMap: () => void;
}

interface KpiChip {
  label: string;
  value: string;
}

function hasGeocode(job: Job): boolean {
  return job.geocode?.status === "OK" && job.geocode.lat !== 0;
}

function PreviewMarkers({ jobs }: { jobs: Job[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const markers: google.maps.Marker[] = [];
    const bounds = new google.maps.LatLngBounds();
    for (const job of jobs) {
      if (!hasGeocode(job)) continue;
      const pos = { lat: job.geocode!.lat, lng: job.geocode!.lng };
      const color = MARKER_COLORS[colorKeyForJob(job)];
      const marker = new google.maps.Marker({
        map,
        position: pos,
        icon: {
          url: neonPinDataUrl(color, isJobCompleted(job) ? 0.5 : 1),
          scaledSize: new google.maps.Size(24, 33),
          anchor: new google.maps.Point(12, 33),
        },
        clickable: false,
      });
      markers.push(marker);
      bounds.extend(pos);
    }
    if (markers.length > 1) {
      map.fitBounds(bounds, 32);
    } else if (markers.length === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(13);
    }
    return () => {
      for (const m of markers) m.setMap(null);
    };
  }, [map, jobs]);

  return null;
}

export default function MapPreviewCard({ jobs, onOpenMap }: MapPreviewCardProps) {
  const kpis = useMemo<KpiChip[]>(() => {
    let active = 0;
    let permits = 0;
    let traffic = 0;
    for (const j of jobs) {
      if (ACTIVE_BUCKETS.has(bucketForJob(j))) active += 1;
      if (isTruthyFlag(j.permitRequired) && notCompleted(j)) permits += 1;
      if (j.trafficControlRequired === true && notCompleted(j)) traffic += 1;
    }
    return [
      { label: "Active Jobs", value: String(active) },
      { label: "Permits Pending", value: String(permits) },
      { label: "Traffic Control", value: String(traffic) },
    ];
  }, [jobs]);

  return (
    <div className="card card--dark map-preview">
      <div className="card__header">
        <h2 className="card__title">Map</h2>
        <span className="map-preview__live">
          <span className="map-preview__live-dot" aria-hidden />
          LIVE
        </span>
      </div>

      <button
        type="button"
        className="map-preview__canvas"
        onClick={onOpenMap}
        aria-label="Open full map"
      >
        <Map
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          styles={stylesFor("dark")}
          gestureHandling="none"
          disableDefaultUI
          clickableIcons={false}
        >
          <PreviewMarkers jobs={jobs} />
        </Map>
        <span className="map-preview__scrim" aria-hidden />
      </button>

      <div className="map-preview__kpis">
        {kpis.map((k) => (
          <div className="map-preview__kpi" key={k.label}>
            <span className="map-preview__kpi-value">{k.value}</span>
            <span className="map-preview__kpi-label">{k.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
