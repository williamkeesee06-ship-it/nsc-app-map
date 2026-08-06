import { useMapTheme } from "../map/themeContext.js";
import "./mapThemeToggleSwitch.css";

/**
 * Two-state toggle: LIGHT ↔ NETWORK.
 *
 * "Network" mode swaps the basemap to a dark surface and turns every drawn
 * cable into an illuminated route with a zoom-driven halo. See:
 *   - features/map/mapStyles.ts       (NETWORK_VIEW_STYLE)
 *   - features/jobs-map/networkView.ts (zoom-band CSS var pump)
 *   - features/jobs-map/networkView.css (illumination rules)
 */
export default function MapThemeToggleSwitch() {
  const { theme, toggle } = useMapTheme();
  const isNetwork = theme === "network";

  return (
    <div className="map-theme-toggle-root">
      <button
        type="button"
        className={`map-theme-toggle-btn ${isNetwork ? "network-mode" : "light-mode"}`}
        onClick={toggle}
        title={isNetwork ? "Switch to Light Map" : "Switch to Network View"}
      >
        <div className="toggle-track">
          <div className="toggle-thumb" />
        </div>
        <span>{isNetwork ? "NETWORK" : "LIGHT"}</span>
      </button>
    </div>
  );
}
