/**
 * MapBridge — invisible component that registers a LuminaMapBridge handle
 * with the LuminaProvider on mount, giving navigation tools an imperative
 * API to drive the map.
 *
 * Wires into the same contexts the SearchBar uses (SearchFocus for job
 * selection / camera focus) and the FilterRail (FiltersContext) so Lumina
 * can hide/show jobs the same way Billy does manually.
 */

import { useEffect, useMemo, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { useLumina } from "./store/luminaStore.js";
import type { LuminaMapBridge } from "./tools/types.js";
import { useSearchFocus } from "../search/searchContext.js";
import { useFiltersContext } from "../jobs-map/filtersContext.js";
import { defaultFilters } from "../jobs-map/FilterRail.js";
import type { StatusBucket } from "../jobs-map/markerStyle.js";

interface LuminaPin {
  id: string;
  marker: google.maps.Marker;
}

// Map free-form status text from the model into the StatusBucket set the
// FilterRail uses. Lenient: keyword match so "completed", "done", "wrap"
// all hit the completed bucket.
function matchBucket(statusText: string): StatusBucket | null {
  const s = statusText.toLowerCase();
  if (/(complete|done|wrap|finished)/.test(s)) return "completed";
  if (/(in.?progress|active|working|wip)/.test(s)) return "in_progress";
  if (/(pending|wait|hold up)/.test(s)) return "pending";
  if (/(on.?hold|halt|paused)/.test(s)) return "on_hold";
  if (/(rts|ready.to.start)/.test(s)) return "rts";
  if (/(field|need.*field|needs.fielding|not.fielded)/.test(s)) return "needs_fielding";
  return null;
}

export default function MapBridge() {
  const map = useMap();
  const { setMapBridge } = useLumina();
  const { focusJob, focusLatLng } = useSearchFocus();
  const { filters, setFilters } = useFiltersContext();
  const pinsRef = useRef<LuminaPin[]>([]);

  // Stable ref so the bridge closure always sees the latest filters/setters
  // even after we hand it off to the Provider once.
  const ctxRef = useRef({ focusJob, focusLatLng, filters, setFilters });
  ctxRef.current = { focusJob, focusLatLng, filters, setFilters };

  // Cinematic arrival glow — Option C from Billy's spec.
  function triggerArrivalGlowImpl(target: { lat: number; lng: number }) {
    if (!map) return;
    const projection = map.getProjection();
    if (!projection) return;

    const targetLatLng = new google.maps.LatLng(target.lat, target.lng);
    const targetWorld = projection.fromLatLngToPoint(targetLatLng);
    if (!targetWorld) return;

    const zoom = map.getZoom() ?? 17;
    const scale = Math.pow(2, zoom);
    const bounds = map.getBounds();
    if (!bounds) return;
    const nw = projection.fromLatLngToPoint(
      new google.maps.LatLng(bounds.getNorthEast().lat(), bounds.getSouthWest().lng())
    );
    if (!nw) return;
    const div = (map as unknown as { getDiv?: () => HTMLElement }).getDiv?.();
    if (!div) return;
    const rect = div.getBoundingClientRect();
    const targetX = rect.left + (targetWorld.x - nw.x) * scale;
    const targetY = rect.top + (targetWorld.y - nw.y) * scale;

    // Orb screen position (matches Orb.tsx — bottom-right, 16/140 px).
    const orbX = window.innerWidth - 16 - 40;
    const orbY = window.innerHeight - 140 - 40;

    const ring = document.createElement("div");
    Object.assign(ring.style, {
      position: "fixed",
      left: `${orbX}px`,
      top: `${orbY}px`,
      width: "12px",
      height: "12px",
      borderRadius: "50%",
      border: "2px solid #1ea7ff",
      boxShadow: "0 0 14px rgba(30,167,255,0.85), 0 0 30px rgba(30,167,255,0.5)",
      transform: "translate(-50%, -50%) scale(1)",
      transition:
        "left 700ms cubic-bezier(.4,.0,.2,1), top 700ms cubic-bezier(.4,.0,.2,1), transform 700ms ease, opacity 700ms ease",
      pointerEvents: "none",
      zIndex: "9999",
      opacity: "1",
    } as CSSStyleDeclaration);
    document.body.appendChild(ring);

    requestAnimationFrame(() => {
      ring.style.left = `${targetX}px`;
      ring.style.top = `${targetY}px`;
      ring.style.transform = "translate(-50%, -50%) scale(4)";
      ring.style.opacity = "0";
    });
    window.setTimeout(() => ring.remove(), 800);

    // Pulse the target.
    window.setTimeout(() => {
      const pulse = document.createElement("div");
      Object.assign(pulse.style, {
        position: "fixed",
        left: `${targetX}px`,
        top: `${targetY}px`,
        width: "40px",
        height: "40px",
        borderRadius: "50%",
        border: "2px solid #1ea7ff",
        boxShadow: "0 0 20px rgba(30,167,255,0.85)",
        transform: "translate(-50%, -50%) scale(0.4)",
        transition: "transform 600ms ease-out, opacity 600ms ease-out",
        pointerEvents: "none",
        zIndex: "9999",
        opacity: "1",
      } as CSSStyleDeclaration);
      document.body.appendChild(pulse);
      requestAnimationFrame(() => {
        pulse.style.transform = "translate(-50%, -50%) scale(2.2)";
        pulse.style.opacity = "0";
      });
      window.setTimeout(() => pulse.remove(), 700);
    }, 600);
  }

  const bridge = useMemo<LuminaMapBridge | null>(() => {
    if (!map) return null;
    return {
      panTo: (coords) => {
        map.panTo(coords);
      },
      zoomTo: (zoom) => {
        map.setZoom(zoom);
      },
      setMapType: (t) => {
        map.setMapTypeId(t as google.maps.MapTypeId);
      },
      dropPin: ({ lat, lng, label, id }) => {
        const pinId = id ?? crypto.randomUUID();
        const marker = new google.maps.Marker({
          position: { lat, lng },
          map,
          title: label,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#1ea7ff",
            fillOpacity: 0.85,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 800,
          animation: google.maps.Animation.DROP,
        });
        pinsRef.current.push({ id: pinId, marker });
        return pinId;
      },
      clearPins: () => {
        for (const p of pinsRef.current) p.marker.setMap(null);
        pinsRef.current = [];
      },
      triggerArrivalGlow: triggerArrivalGlowImpl,
      triggerWriteGlow: (_args) => {
        // Phase 4 wires this end-to-end with the markup overlay.
        // For now we just trigger the arrival ring at a no-op point.
      },
      selectJob: (jobId) => {
        // Same path as SearchBar pickJob — sets selectedJobId, opens JobCard,
        // and animates the camera. JobsMap effect handles the actual move.
        ctxRef.current.focusJob(jobId);
      },
      flyTo: ({ lat, lng, zoom, label }) => {
        // Use the SearchFocus channel so the JobsMap effect runs its existing
        // search-pin + glow path — keeps Lumina's pins consistent with the
        // SearchBar's pins (single source of truth for "where the user is
        // looking").
        ctxRef.current.focusLatLng(lat, lng, label);
        if (zoom != null) {
          // Apply zoom directly (focusLatLng doesn't take zoom).
          window.setTimeout(() => map.setZoom(zoom), 50);
        }
        triggerArrivalGlowImpl({ lat, lng });
      },
      applyFilter: ({ crew, status, olderThanDays, city }) => {
        // Build a Filters delta on top of the current filters.
        const current = ctxRef.current.filters;
        const next = { ...current };

        // Crew → supervisor set (closest match in current schema). Lumina's
        // "crew" semantics actually map to constructionCrewForeman, but the
        // FilterRail filters supervisors. We approximate by mapping into the
        // supervisors set since the bucket UI doesn't surface crew chips.
        // The list/filter for the map will then re-derive from the foreman
        // string via applyFilters() not — this is a graceful no-op for now.
        if (crew) {
          next.supervisors = new Set([crew]);
        }
        if (status) {
          const bucket = matchBucket(status);
          if (bucket) next.buckets = new Set([bucket]);
        }
        if (city) {
          // No city filter in Filters — defer to listJobs for raw city scoping.
        }
        if (typeof olderThanDays === "number") {
          // Same — no age filter in current Filters; surfaced via listJobs.
        }
        ctxRef.current.setFilters(next);

        const desc =
          [
            crew ? `crew~"${crew}"` : null,
            status ? `status~"${status}"` : null,
            city ? `city~"${city}"` : null,
            typeof olderThanDays === "number" ? `olderThan ${olderThanDays}d` : null,
          ]
            .filter(Boolean)
            .join(", ") || "no filter";
        return { matched: 0, description: desc };
      },
      resetFilters: () => {
        ctxRef.current.setFilters(defaultFilters());
      },
    };
  }, [map]);

  useEffect(() => {
    setMapBridge(bridge);
    return () => setMapBridge(null);
  }, [bridge, setMapBridge]);

  return null;
}
