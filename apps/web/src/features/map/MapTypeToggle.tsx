// Phase 9.6 (Billy 5/26): floating Map / Satellite toggle.
// Sits in the top-right corner of the map area (below the modifier strip).
// Cycles: Roadmap → Satellite → Hybrid → Roadmap.
import { useEffect, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";

type MapType = "roadmap" | "satellite" | "hybrid";

const LABELS: Record<MapType, string> = {
  roadmap: "Map",
  satellite: "Satellite",
  hybrid: "Hybrid",
};

const NEXT: Record<MapType, MapType> = {
  roadmap: "satellite",
  satellite: "hybrid",
  hybrid: "roadmap",
};

const STORAGE_KEY = "nsc:mapType";

function readStored(): MapType {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "roadmap" || v === "satellite" || v === "hybrid") return v;
  } catch { /* ignore */ }
  return "roadmap";
}

export default function MapTypeToggle() {
  const map = useMap();
  const [mapType, setMapType] = useState<MapType>(() => readStored());

  // Apply on mount and whenever it changes
  useEffect(() => {
    if (!map) return;
    map.setMapTypeId(mapType);
    try { window.localStorage.setItem(STORAGE_KEY, mapType); } catch { /* ignore */ }
  }, [map, mapType]);

  function onClick() {
    setMapType((t) => NEXT[t]);
  }

  return (
    <button
      type="button"
      className="map-type-toggle"
      onClick={onClick}
      title={`Map view: ${LABELS[mapType]} — click to cycle`}
      aria-label="Toggle map view"
    >
      <span className="map-type-toggle__icon" aria-hidden="true">
        {mapType === "roadmap" ? "🗺" : mapType === "satellite" ? "🛰" : "🌐"}
      </span>
      <span className="map-type-toggle__label">{LABELS[mapType]}</span>
    </button>
  );
}
