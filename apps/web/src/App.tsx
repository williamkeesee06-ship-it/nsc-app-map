import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { APIProvider } from "@vis.gl/react-google-maps";
import JobsMap from "./features/jobs-map/JobsMap.js";
import JobWorkspace from "./features/workspace/JobWorkspace.js";
import SyncAdmin from "./features/sync-admin/SyncAdmin.js";
import { SearchFocusProvider } from "./features/search/searchContext.js";
import SearchBar from "./features/search/SearchBar.js";
import TopbarActions from "./features/drawing/TopbarActions.js";

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export default function App() {
  return (
    <APIProvider apiKey={apiKey ?? ""} libraries={["geometry"]}>
      <SearchFocusProvider>
        <Shell />
      </SearchFocusProvider>
    </APIProvider>
  );
}

function Shell() {
  return (
    <>
      <div className="app-frame">
        {/* Industrial rivets at inner corners */}
        <div className="rivet rivet-tl" />
        <div className="rivet rivet-tr" />
        <div className="rivet rivet-bl" />
        <div className="rivet rivet-br" />
        <div className="app-shell">
          <div className="shell">
            <header className="topbar">
              <img src="/northsky-logo.jpg" alt="North Sky — Building Tomorrow's Broadband" className="logo" />
              <h1>APP MAP</h1>
              <SearchBar />
              <nav>
                <NavLink to="/" end>Jobs Map</NavLink>
                <NavLink to="/sync">Sync</NavLink>
              </nav>
              <TopbarActions />
            </header>
            <Routes>
              <Route path="/" element={<JobsMap />} />
              <Route path="/jobs/:jobId" element={<JobWorkspace />} />
              <Route path="/sync" element={<SyncAdmin />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </div>
      </div>
      {!apiKey && <MissingKeyOverlay />}
    </>
  );
}

function MissingKeyOverlay() {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "grid", placeItems: "center", zIndex: 1000, padding: 24,
    }}>
      <div style={{ maxWidth: 480, textAlign: "center", lineHeight: 1.5, background: "var(--surface)", borderRadius: 12, padding: 32, border: "1.5px solid var(--border)" }}>
        <h2 style={{ marginTop: 0, color: "var(--text)" }}>VITE_GOOGLE_MAPS_API_KEY missing</h2>
        <p style={{ color: "var(--text-muted)" }}>
          Add it to <code>.env</code> in the repo root, then restart <code>npm run dev</code>.
          For Vercel, add it under Project Settings → Environment Variables.
        </p>
      </div>
    </div>
  );
}
