import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { APIProvider } from "@vis.gl/react-google-maps";
import JobsMap from "./features/jobs-map/JobsMap.js";
import JobWorkspace from "./features/workspace/JobWorkspace.js";
import SyncAdmin from "./features/sync-admin/SyncAdmin.js";
import { MapThemeProvider, useMapTheme } from "./features/map/themeContext.js";
import ThemeToggle from "./features/map/ThemeToggle.js";

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export default function App() {
  return (
    <APIProvider apiKey={apiKey ?? ""} libraries={["geometry"]}>
      <MapThemeProvider>
        <Shell />
      </MapThemeProvider>
    </APIProvider>
  );
}

// Inner shell that can read the theme context to set the body-level class.
function Shell() {
  const { theme } = useMapTheme();
  return (
    <>
        <div className={`shell theme-${theme}`}>
          <header className="topbar">
            <img src="/northsky-logo.jpg" alt="North Sky — Building Tomorrow's Broadband" className="logo" />
            <h1>APP MAP</h1>
            <nav>
              <NavLink to="/" end>Jobs Map</NavLink>
              <NavLink to="/sync">Sync</NavLink>
              <NavLink to="/jobs/sample">Sample Job</NavLink>
            </nav>
            <ThemeToggle />
          </header>
          <Routes>
            <Route path="/" element={<JobsMap />} />
            <Route path="/jobs/:jobId" element={<JobWorkspace />} />
            <Route path="/sync" element={<SyncAdmin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {!apiKey && <MissingKeyOverlay />}
    </>
  );
}

function MissingKeyOverlay() {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      display: "grid", placeItems: "center", zIndex: 1000, padding: 24,
    }}>
      <div style={{ maxWidth: 480, textAlign: "center", lineHeight: 1.5 }}>
        <h2 style={{ marginTop: 0 }}>VITE_GOOGLE_MAPS_API_KEY missing</h2>
        <p style={{ color: "var(--text-muted)" }}>
          Add it to <code>.env</code> in the repo root, then restart <code>npm run dev</code>.
          For Vercel, add it under Project Settings → Environment Variables.
        </p>
      </div>
    </div>
  );
}
