// Segmented control to switch the map between dark and light.
import { useMapTheme } from "./themeContext.js";

export default function ThemeToggle() {
  const { theme, setTheme } = useMapTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Map theme">
      <button
        type="button"
        className={theme === "dark" ? "active" : ""}
        onClick={() => setTheme("dark")}
        aria-pressed={theme === "dark"}
        title="Dark tactical map"
      >
        Dark
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
