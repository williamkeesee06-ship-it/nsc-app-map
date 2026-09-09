// Segmented control to switch the map between Network View and Light.
// (Legacy component — MapThemeToggleSwitch is what actually renders in the UI.)
import { useMapTheme } from "./themeContext.js";

export default function ThemeToggle() {
  const { theme, setTheme } = useMapTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Map theme">
      <button
        type="button"
        className={theme === "network" ? "active" : ""}
        onClick={() => setTheme("network")}
        aria-pressed={theme === "network"}
        title="Network View — dark basemap with illuminated fiber"
      >
        Network
      </button>
      <button
        type="button"
        className={theme === "light" ? "active" : ""}
        onClick={() => setTheme("light")}
        aria-pressed={theme === "light"}
        title="Light map"
      >
        Light
      </button>
    </div>
  );
}
