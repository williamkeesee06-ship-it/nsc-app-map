import { useEffect, useState, useRef } from "react";
import type { MapTheme } from "./mapStyles.js";

export type MapType = "roadmap" | "satellite" | "hybrid";

export interface MapPreferences {
  mapType: "roadmap" | "satellite" | "hybrid" | "terrain";
  theme: MapTheme;
  dark: boolean;
  showRoadLabels: boolean;
  showPoiLabels: boolean;
  showCityLabels: boolean;
  showTransit: boolean;
}

const PREFS_KEY = "nsc:mapPrefs";

const DEFAULT_PREFS: MapPreferences = {
  mapType: "roadmap",
  theme: "classic",
  dark: false,
  showRoadLabels: true,
  showPoiLabels: false,
  showCityLabels: true,
  showTransit: false,
};

export function loadPrefs(): MapPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const theme: MapTheme = parsed.theme ?? (parsed.dark ? "dark" : "classic");
      const mapType = parsed.mapType === "terrain" ? "roadmap" : (parsed.mapType ?? "roadmap");
      
      // Keep details permanently on for roadmap/hybrid, off for pure satellite road labels.
      const showRoadLabels = mapType === "satellite" ? false : true;

      return {
        ...DEFAULT_PREFS,
        ...parsed,
        mapType,
        theme,
        dark: theme === "dark",
        showRoadLabels,
        showPoiLabels: parsed.showPoiLabels ?? false,
        showCityLabels: parsed.showCityLabels ?? true,
        showTransit: parsed.showTransit ?? false,
      };
    }
  } catch {}
  return { ...DEFAULT_PREFS };
}

export function savePrefs(prefs: MapPreferences) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

export function broadcastPrefs(prefs: MapPreferences) {
  window.dispatchEvent(new CustomEvent("nsc:map-prefs-changed", { detail: prefs }));
}

export const MAP_PREFS_EVENT = "nsc:map-prefs-changed";

export default function MapTypeToggle() {
  const [prefs, setPrefs] = useState<MapPreferences>(loadPrefs);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { mapType, theme } = prefs;

  useEffect(() => {
    savePrefs(prefs);
    broadcastPrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Synchronize from other sources if needed
  useEffect(() => {
    function onChange(e: Event) {
      const next = (e as CustomEvent<MapPreferences>).detail;
      if (!next) return;
      setPrefs((curr) => (JSON.stringify(curr) === JSON.stringify(next) ? curr : next));
    }
    window.addEventListener(MAP_PREFS_EVENT, onChange);
    return () => window.removeEventListener(MAP_PREFS_EVENT, onChange);
  }, []);

  function setType(type: "roadmap" | "satellite" | "hybrid") {
    setPrefs((prev) => ({
      ...prev,
      mapType: type,
      showRoadLabels: type !== "satellite",
    }));
  }

  function toggleTheme(newTheme: MapTheme) {
    setPrefs((prev) => ({
      ...prev,
      theme: newTheme,
      dark: newTheme === "dark",
    }));
  }

  const isImagery = mapType === "satellite" || mapType === "hybrid";

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Map settings"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(6, 182, 212, 0.05)",
          border: "1.5px solid #06B6D4",
          boxShadow: "0 0 8px rgba(6, 182, 212, 0.25)",
          borderRadius: "9999px",
          padding: "5px 14px",
          color: "#06B6D4",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.08em",
          cursor: "pointer",
          transition: "all 0.2s ease",
          outline: "none",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = "0 0 14px rgba(6, 182, 212, 0.45)";
          e.currentTarget.style.background = "rgba(6, 182, 212, 0.1)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = "0 0 8px rgba(6, 182, 212, 0.25)";
          e.currentTarget.style.background = "rgba(6, 182, 212, 0.05)";
        }}
      >
        <span>MAP</span>
        <span style={{ fontSize: 8, opacity: 0.8 }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 8,
            background: "rgba(15, 23, 42, 0.96)",
            border: "1px solid rgba(6, 182, 212, 0.25)",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 10px rgba(6, 182, 212, 0.1)",
            borderRadius: 12,
            padding: "10px",
            minWidth: 200,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {/* MAP TYPE */}
          <div>
            <div style={sectionHeaderStyle}>MAP TYPE</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {[
                { id: "roadmap", label: "Classic" },
                { id: "satellite", label: "Satellite" },
                { id: "hybrid", label: "Hybrid" },
              ].map((opt) => {
                const active = mapType === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setType(opt.id as any)}
                    style={itemBtnStyle(active)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {!isImagery && (
            <>
              <div style={dividerStyle} />
              {/* THEME */}
              <div>
                <div style={sectionHeaderStyle}>THEME</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                  {[
                    { id: "classic", label: "Light" },
                    { id: "dark", label: "Dark" },
                  ].map((opt) => {
                    const active = theme === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleTheme(opt.id as MapTheme)}
                        style={itemBtnStyle(active)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: "0.08em",
  color: "#94a3b8",
  fontWeight: 800,
  paddingLeft: 4,
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: "rgba(6, 182, 212, 0.15)",
};

function itemBtnStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "6px 10px",
    borderRadius: 6,
    background: active ? "rgba(6, 182, 212, 0.15)" : "transparent",
    border: active ? "1px solid rgba(6, 182, 212, 0.4)" : "1px solid transparent",
    color: active ? "#06B6D4" : "#94a3b8",
    textAlign: "left",
    fontSize: 11,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    transition: "all 0.15s ease",
  };
}
