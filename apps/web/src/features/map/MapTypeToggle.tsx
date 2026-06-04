// Base Map control — unified button in the topbar.
// Lets the user pick a base map tile layer (Classic / Satellite / Hybrid /
// Terrain) AND a styling theme (Dark / Silver / Retro) AND toggle map detail
// (city names, street names, places, transit).
//
// IMPORTANT: this component lives in the topbar, OUTSIDE the <Map> component,
// so it cannot call useMap() (would return null and never apply). It only
// manages its own panel UI + persists prefs + broadcasts an event.
// A sibling <MapTypeApplier /> mounted INSIDE the <Map> actually applies the
// styles to the live map instance.
import { useEffect, useState, useRef } from "react";
import type { MapTheme } from "./mapStyles.js";

type MapType = "roadmap" | "satellite" | "hybrid" | "terrain";

export interface MapPreferences {
  mapType: MapType;
  theme: MapTheme;
  // legacy flag, kept so older Applier code / persisted prefs stay valid
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
  showPoiLabels: true,
  showCityLabels: true,
  showTransit: true,
};

function loadPrefs(): MapPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate older prefs: derive theme from legacy `dark` flag if missing.
      const theme: MapTheme = parsed.theme ?? (parsed.dark ? "dark" : "classic");
      return { ...DEFAULT_PREFS, ...parsed, theme, dark: theme === "dark" };
    }
  } catch {}
  return { ...DEFAULT_PREFS };
}

function savePrefs(prefs: MapPreferences) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function broadcast(prefs: MapPreferences) {
  window.dispatchEvent(new CustomEvent("nsc:map-prefs-changed", { detail: prefs }));
}

// Base tile layers (Google mapTypeId). Satellite imagery is the underlying
// difference; theme styling only affects roadmap/terrain rendering.
const BASE_MAPS: { id: MapType; label: string; icon: string }[] = [
  { id: "roadmap", label: "Classic", icon: "🗺" },
  { id: "satellite", label: "Satellite", icon: "🛰" },
  { id: "hybrid", label: "Hybrid", icon: "🌐" },
  { id: "terrain", label: "Terrain", icon: "🏔" },
];

// Styled themes — these layer Google styles on top of roadmap/terrain.
const THEMES: { id: MapTheme; label: string; icon: string }[] = [
  { id: "classic", label: "Default", icon: "☀️" },
  { id: "dark", label: "Dark", icon: "🌙" },
  { id: "silver", label: "Silver", icon: "⚪" },
  { id: "retro", label: "Retro", icon: "🟤" },
];

function shortLabel(prefs: MapPreferences): string {
  const base = BASE_MAPS.find(b => b.id === prefs.mapType)?.label ?? "Classic";
  if (prefs.theme !== "classic") {
    const t = THEMES.find(t => t.id === prefs.theme)?.label ?? "";
    return `${base} · ${t}`;
  }
  return base;
}

function currentIcon(prefs: MapPreferences): string {
  if (prefs.theme === "dark") return "🌙";
  return BASE_MAPS.find(b => b.id === prefs.mapType)?.icon ?? "🗺";
}

export default function MapTypeToggle() {
  const [prefs, setPrefs] = useState<MapPreferences>(loadPrefs);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { mapType, theme, showRoadLabels, showPoiLabels, showCityLabels, showTransit } = prefs;

  // Persist + broadcast whenever prefs change. The actual map.setOptions
  // call happens in <MapTypeApplier /> which lives inside the <Map>.
  useEffect(() => {
    savePrefs(prefs);
    broadcast(prefs);
  }, [prefs]);

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

  function update(patch: Partial<MapPreferences>) {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      // Keep the legacy `dark` flag in sync with theme.
      if (patch.theme !== undefined) next.dark = patch.theme === "dark";
      return next;
    });
  }

  // Satellite/hybrid imagery can't be themed; disable theme picker for them.
  const themingDisabled = mapType === "satellite" || mapType === "hybrid";

  return (
    <div style={{ position: "relative", zIndex: 50 }}>
      <button
        type="button"
        className="map-type-toggle"
        onClick={() => setOpen(!open)}
        title="Base map style & detail"
        style={{ position: "static" }}
      >
        <span className="map-type-toggle__icon">{currentIcon(prefs)}</span>
        <span className="map-type-toggle__label">{shortLabel(prefs)}</span>
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
            borderRadius: 12,
            padding: "8px 0",
            minWidth: 248,
            zIndex: 400,
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            fontSize: 13,
          }}
        >
          {/* ── Base Map tiles ── */}
          <div style={sectionHeaderStyle}>BASE MAP</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "0 10px 6px" }}>
            {BASE_MAPS.map(b => {
              const active = mapType === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => update({ mapType: b.id })}
                  style={tileBtnStyle(active)}
                >
                  <span style={{ fontSize: 16 }}>{b.icon}</span>
                  {b.label}
                </button>
              );
            })}
          </div>

          <div style={dividerStyle} />

          {/* ── Theme / color scheme ── */}
          <div style={sectionHeaderStyle}>
            COLOR THEME
            {themingDisabled && (
              <span style={{ fontWeight: 400, color: "#6b7785", marginLeft: 6 }}>
                (n/a for imagery)
              </span>
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
              padding: "0 10px 6px",
              opacity: themingDisabled ? 0.4 : 1,
              pointerEvents: themingDisabled ? "none" : "auto",
            }}
          >
            {THEMES.map(t => {
              const active = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => update({ theme: t.id })}
                  style={tileBtnStyle(active)}
                >
                  <span style={{ fontSize: 16 }}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>

          <div style={dividerStyle} />

          {/* ── Detail toggles ── */}
          <div style={sectionHeaderStyle}>MAP DETAIL</div>

          <ToggleRow
            label="City & town names"
            checked={showCityLabels}
            onChange={v => update({ showCityLabels: v })}
          />
          <ToggleRow
            label="Street / road names"
            checked={showRoadLabels}
            onChange={v => update({ showRoadLabels: v })}
          />
          <ToggleRow
            label="Businesses & places"
            checked={showPoiLabels}
            onChange={v => update({ showPoiLabels: v })}
          />
          <ToggleRow
            label="Transit lines"
            checked={showTransit}
            onChange={v => update({ showTransit: v })}
          />
        </div>
      )}
    </div>
  );
}

const sectionHeaderStyle: React.CSSProperties = {
  padding: "4px 14px 4px",
  fontSize: 10,
  letterSpacing: 0.5,
  color: "#8a96a3",
  fontWeight: 700,
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: "rgba(200,208,218,0.2)",
  margin: "4px 10px",
};

function tileBtnStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "8px 10px",
    borderRadius: 8,
    background: active ? "rgba(58,167,255,0.22)" : "rgba(255,255,255,0.04)",
    border: active ? "1px solid rgba(58,167,255,0.7)" : "1px solid rgba(255,255,255,0.08)",
    color: "#f4f8ff",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 12.5,
    fontWeight: active ? 600 : 500,
  };
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "7px 14px",
        gap: 8,
        cursor: "pointer",
        color: "#e8edf4",
      }}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ accentColor: "#3aa7ff", width: 15, height: 15, cursor: "pointer" }}
      />
    </label>
  );
}
