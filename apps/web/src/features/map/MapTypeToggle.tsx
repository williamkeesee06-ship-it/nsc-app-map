// Phase 9.6 (Billy 5/26): floating Map / Satellite toggle.
// Sits in the top-right corner of the map area (below the modifier strip).
// Cycles: Roadmap → Satellite → Hybrid → Roadmap.
import { useEffect, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";

type MapType = "roadmap" | "satellite" | "hybrid" | "terrain";

const LABELS: Record<MapType, string> = {
  roadmap: "Map",
  satellite: "Satellite",
  hybrid: "Hybrid",
  terrain: "Terrain",
};

const NEXT: Record<MapType, MapType> = {
  roadmap: "satellite",
  satellite: "hybrid",
  hybrid: "terrain",
  terrain: "roadmap",
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
  const [open, setOpen] = useState(false);

  // Apply on mount and whenever it changes — ensures smooth transitions
  useEffect(() => {
    if (!map) return;
    map.setMapTypeId(mapType);

    // Re-apply custom styles when switching (especially important for satellite/hybrid + dark theme combo)
    // Google Maps will blend our styles where possible.
    try { window.localStorage.setItem(STORAGE_KEY, mapType); } catch { /* ignore */ }
  }, [map, mapType]);

  function selectType(type: MapType) {
    setMapType(type);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="map-type-toggle"
        onClick={() => setOpen(!open)}
        title="Change base map style"
        aria-label="Base map options"
      >
        <span className="map-type-toggle__icon" aria-hidden="true">
          {mapType === "roadmap" ? "🗺" : 
           mapType === "satellite" ? "🛰" : 
           mapType === "hybrid" ? "🌐" : "🏔"}
        </span>
        <span className="map-type-toggle__label">{LABELS[mapType]}</span>
        <span style={{ marginLeft: 4, fontSize: 9 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          right: 0,
          marginTop: 4,
          background: "var(--surface, #1f2836)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 4,
          zIndex: 200,
          minWidth: 140,
          boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
          fontFamily: "inherit",
        }}>
          {(["roadmap", "satellite", "hybrid", "terrain"] as MapType[]).map((t) => (
            <button
              key={t}
              onClick={() => selectType(t)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                background: t === mapType ? "rgba(58,167,255,0.15)" : "transparent",
                border: "none",
                color: "#f4f8ff",
                cursor: "pointer",
                fontSize: 12,
                borderRadius: 4,
              }}
            >
              {LABELS[t]}
            </button>
          ))}

          <div style={{ height: 1, background: "rgba(200,208,218,0.15)", margin: "4px 0" }} />

          <div style={{ padding: "4px 10px", fontSize: 10, color: "#8a96a3" }}>
            Satellite + Street View works best in Hybrid
          </div>
        </div>
      )}
    </div>
  );
}
