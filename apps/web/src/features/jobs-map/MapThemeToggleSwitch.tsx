import { useMapTheme } from "../map/themeContext.js";
import "./mapThemeToggleSwitch.css";

export default function MapThemeToggleSwitch() {
  const { theme, toggle } = useMapTheme();
  
  return (
    <div className="map-theme-toggle-root">
      <button 
        type="button" 
        className={`map-theme-toggle-btn ${theme === "dark" ? "dark-mode" : "light-mode"}`} 
        onClick={toggle}
        title="Toggle Map Theme"
      >
        <div className="toggle-track">
          <div className="toggle-thumb" />
        </div>
        <span>{theme === 'dark' ? 'DARK' : 'LIGHT'}</span>
      </button>
    </div>
  );
}
