// MapTypeFilterSection — Filters-tab home for the map-type controls.
//
// We moved Map Type out of the topbar to free horizontal room for the
// search bar. This component renders TWO radio groups inside the Filters
// rail content:
//
//   MAP TYPE   — Classic / Satellite / Hybrid / Terrain  (base tile layer)
//   MAP THEME  — Default / Dark / Silver / Retro         (styled overlay)
//
// It shares the SAME persistence + broadcast pipeline as MapTypeToggle
// (localStorage key `nsc:mapPrefs`, event `nsc:map-prefs-changed`), so
// MapTypeApplier (which lives inside <Map>) keeps applying changes the
// instant a user taps a radio. We also listen for the same event so this
// component stays in sync if any other surface ever changes the prefs.
import { useEffect, useState } from "react";
import {
  BASE_MAPS,
  THEMES,
  loadPrefs,
  savePrefs,
  broadcastPrefs,
  MAP_PREFS_EVENT,
  type MapPreferences,
} from "./MapTypeToggle.js";

export default function MapTypeFilterSection() {
  const [prefs, setPrefs] = useState<MapPreferences>(loadPrefs);

  // Persist + broadcast on any local change. Identical contract to
  // MapTypeToggle so MapTypeApplier doesn't care which UI drove the update.
  useEffect(() => {
    savePrefs(prefs);
    broadcastPrefs(prefs);
  }, [prefs]);

  // Stay in sync if another surface (or another tab) updates the prefs.
  // We skip events we just fired ourselves to avoid an update loop —
  // shallow JSON compare is cheap on a 7-field object.
  useEffect(() => {
    function onChange(e: Event) {
      const next = (e as CustomEvent<MapPreferences>).detail;
      if (!next) return;
      setPrefs((curr) =>
        JSON.stringify(curr) === JSON.stringify(next) ? curr : next
      );
    }
    window.addEventListener(MAP_PREFS_EVENT, onChange);
    return () => window.removeEventListener(MAP_PREFS_EVENT, onChange);
  }, []);

  function setMapType(id: MapPreferences["mapType"]) {
    setPrefs((p) => ({ ...p, mapType: id }));
  }
  function setTheme(id: MapPreferences["theme"]) {
    setPrefs((p) => ({ ...p, theme: id, dark: id === "dark" }));
  }
  function toggleDetail(key: "showCityLabels" | "showRoadLabels" | "showPoiLabels" | "showTransit") {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  }

  const detailRows: { key: "showCityLabels" | "showRoadLabels" | "showPoiLabels" | "showTransit"; label: string }[] = [
    { key: "showCityLabels", label: "City & town names" },
    { key: "showRoadLabels", label: "Street / road names" },
    { key: "showPoiLabels", label: "Businesses & places" },
    { key: "showTransit", label: "Transit lines" },
  ];

  return (
    <>
      <div className="filters-tab__group">
        <div className="filters-tab__heading">MAP TYPE</div>
        <div className="map-pref-list">
          {BASE_MAPS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`map-pref-row${prefs.mapType === b.id ? " is-active" : ""}`}
              onClick={() => setMapType(b.id)}
              aria-pressed={prefs.mapType === b.id}
            >
              <span className="map-pref-row__radio" aria-hidden="true" />
              <span className="map-pref-row__icon" aria-hidden="true">{b.icon}</span>
              <span className="map-pref-row__label">{b.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filters-tab__group">
        <div className="filters-tab__heading">MAP THEME</div>
        <div className="map-pref-list">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`map-pref-row${prefs.theme === t.id ? " is-active" : ""}`}
              onClick={() => setTheme(t.id)}
              aria-pressed={prefs.theme === t.id}
            >
              <span className="map-pref-row__radio" aria-hidden="true" />
              <span className="map-pref-row__icon" aria-hidden="true">{t.icon}</span>
              <span className="map-pref-row__label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filters-tab__group">
        <div className="filters-tab__heading">MAP DETAIL</div>
        <div className="map-pref-list">
          {detailRows.map((row) => {
            const checked = prefs[row.key];
            return (
              <button
                key={row.key}
                type="button"
                className={`map-pref-row map-pref-row--check${checked ? " is-active" : ""}`}
                onClick={() => toggleDetail(row.key)}
                aria-pressed={checked}
              >
                <span className="map-pref-row__check" aria-hidden="true">
                  {checked ? "✓" : ""}
                </span>
                <span className="map-pref-row__label">{row.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Styles colocated with the component so we don't have to touch the
          global stylesheet. The radio button is drawn with pure CSS so we
          stay consistent with the rest of the Filters tab's brushed-steel
          on royal-blue look. */}
      <style>{`
        .map-pref-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-top: 4px;
        }
        .map-pref-row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 7px 6px;
          background: transparent;
          border: none;
          border-radius: 6px;
          color: #cfd6df;
          font: 500 12.5px "Inter", system-ui, sans-serif;
          text-align: left;
          cursor: pointer;
          transition: background 0.12s ease;
        }
        .map-pref-row:hover { background: rgba(74,158,255,0.08); }
        .map-pref-row.is-active { background: rgba(21,101,192,0.14); }
        .map-pref-row__radio {
          width: 16px;
          height: 16px;
          flex: 0 0 16px;
          border-radius: 50%;
          border: 1.5px solid #4a5868;
          background: #14181f;
          position: relative;
          transition: border-color 0.12s ease;
        }
        .map-pref-row.is-active .map-pref-row__radio {
          border-color: #1565C0;
        }
        .map-pref-row.is-active .map-pref-row__radio::after {
          content: "";
          position: absolute;
          inset: 3px;
          border-radius: 50%;
          background: #1565C0;
        }
        .map-pref-row__icon {
          width: 16px;
          text-align: center;
          font-size: 13px;
          opacity: 0.92;
        }
        .map-pref-row__label {
          flex: 1;
          font-weight: 500;
        }
        .map-pref-row.is-active .map-pref-row__label {
          font-weight: 700;
          color: #ffffff;
        }
        /* Checkbox variant for MAP DETAIL rows */
        .map-pref-row__check {
          width: 16px;
          height: 16px;
          flex: 0 0 16px;
          border-radius: 3px;
          border: 1.5px solid #4a5868;
          background: #14181f;
          color: #ffffff;
          font-size: 11px;
          line-height: 14px;
          text-align: center;
          font-weight: 700;
          transition: background 0.12s ease, border-color 0.12s ease;
        }
        .map-pref-row--check.is-active .map-pref-row__check {
          background: #1565C0;
          border-color: #1565C0;
        }
      `}</style>
    </>
  );
}
