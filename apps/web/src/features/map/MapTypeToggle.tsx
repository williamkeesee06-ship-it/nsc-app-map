// Enhanced Map Style Control - Dark map + full label toggling
import { useEffect, useState, useRef, useCallback } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { getMapStyles } from "./mapStyles.js";

type MapType = "roadmap" | "satellite" | "hybrid" | "terrain";

export interface MapPreferences {
  mapType: MapType;
  dark: boolean;
  showRoadLabels: boolean;
  showPoiLabels: boolean;
  showCityLabels: boolean;
}

const LABELS: Record<MapType, string> = {
  roadmap: "Classic",
  satellite: "Satellite",
  hybrid: "Satellite",
  terrain: "Terrain",
};

const PREFS_KEY = "nsc:mapPrefs";

function loadPrefs(): MapPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    mapType: "roadmap",
    dark: false,
    showRoadLabels: true,
    showPoiLabels: true,
    showCityLabels: true,
  };
}

function savePrefs(prefs: MapPreferences) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function broadcast(prefs: MapPreferences) {
  window.dispatchEvent(new CustomEvent("nsc:map-prefs-changed", { detail: prefs }));
}

export default function MapTypeToggle() {
  const map = useMap();
  const [prefs, setPrefs] = useState<MapPreferences>(loadPrefs);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { mapType, dark, showRoadLabels, showPoiLabels, showCityLabels } = prefs;

  // Apply everything to the map
  useEffect(() => {
    if (!map) return;

    map.setMapTypeId(mapType);

    const styles = getMapStyles({
      dark,
      showRoadLabels,
      showPoiLabels,
      showCityLabels,
    });
    map.setOptions({ styles });

    savePrefs(prefs);
    broadcast(prefs);
  }, [map, prefs]);

  // Sync between map instances
  useEffect(() => {
    const h = (e: Event) => setPrefs((e as CustomEvent<MapPreferences>).detail);
    window.addEventListener("nsc:map-prefs-changed", h);
    return () => window.removeEventListener("nsc:map-prefs-changed", h);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function update(update: Partial<MapPreferences>) {
    setPrefs(prev => ({ ...prev, ...update }));
  }

  return (
    <div style={{ position: "absolute", top: 14, right: 14, zIndex: 50 }}>
      <button
        type="button"
        className="map-type-toggle"
        onClick={() => setOpen(!open)}
        title="Map style & labels"
        style={{ position: "static" }}
      >
        <span className="map-type-toggle__icon">
          {dark ? "🌙" : mapType === "roadmap" ? "🗺" : mapType === "satellite" ? "🛰" : mapType === "hybrid" ? "🌐" : "🏔"}
        </span>
        <span className="map-type-toggle__label">
          {dark ? "Dark" : LABELS[mapType]}
        </span>
        <span style={{ fontSize: 9, marginLeft: 2 }}>▼</span>
      </button>

      {open && (
        <div
          ref={dropdownRef}
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 6,
            background: "rgba(28, 33, 45, 0.97)",
            border: "1px solid rgba(200, 208, 218, 0.3)",
            borderRadius: 10,
            padding: "6px 0",
            minWidth: 215,
            zIndex: 400,
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            fontSize: 13,
          }}
        >
          {/* Base Maps */}
          <div style={{ padding: "4px 14px 2px", fontSize: 10, color: "#8a96a3", fontWeight: 600 }}>BASE MAP</div>

          <button
            onClick={() => update({ mapType: "roadmap", dark: false })}
            style={{
              display: "flex", width: "100%", padding: "6px 14px", gap: 8, alignItems: "center",
              background: mapType === "roadmap" && !dark ? "rgba(58,167,255,0.18)" : "transparent",
              border: "none", color: "#f4f8ff", cursor: "pointer", textAlign: "left"
            }}
          >
            <span style={{ width: 20 }}>🗺</span>
            Classic
          </button>

          <button
            onClick={() => update({ mapType: "hybrid", dark: false })}
            style={{
              display: "flex", width: "100%", padding: "6px 14px", gap: 8, alignItems: "center",
              background: mapType === "hybrid" && !dark ? "rgba(58,167,255,0.18)" : "transparent",
              border: "none", color: "#f4f8ff", cursor: "pointer", textAlign: "left"
            }}
          >
            <span style={{ width: 20 }}>🛰</span>
            Satellite
          </button>

          <button
            onClick={() => update({ dark: true, mapType: "roadmap" })}
            style={{
              display: "flex", width: "100%", padding: "6px 14px", gap: 8, alignItems: "center",
              background: dark ? "rgba(58,167,255,0.18)" : "transparent",
              border: "none", color: "#f4f8ff", cursor: "pointer", textAlign: "left"
            }}
          >
            <span style={{ width: 20 }}>🌙</span>
            Dark
          </button>

          <div style={{ height: 1, background: "rgba(200,208,218,0.2)", margin: "6px 10px" }} />

          {/* Label Toggles */}
          <div style={{ padding: "2px 14px 4px", fontSize: 10, color: "#8a96a3", fontWeight: 600 }}>LABELS</div>

          <label style={{ display: "flex", alignItems: "center", padding: "5px 14px", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showCityLabels}
              onChange={e => update({ showCityLabels: e.target.checked })}
            />
            City &amp; town names
          </label>

          <label style={{ display: "flex", alignItems: "center", padding: "5px 14px", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showRoadLabels}
              onChange={e => update({ showRoadLabels: e.target.checked })}
            />
            Street / road names
          </label>

          <label style={{ display: "flex", alignItems: "center", padding: "5px 14px", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showPoiLabels}
              onChange={e => update({ showPoiLabels: e.target.checked })}
            />
            Businesses &amp; places
          </label>
        </div>
      )}
    </div>
  );
}
