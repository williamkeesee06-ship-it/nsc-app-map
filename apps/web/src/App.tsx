import { Routes, Route, Navigate, useMatch } from "react-router-dom";
import { APIProvider } from "@vis.gl/react-google-maps";
import JobsMap from "./features/jobs-map/JobsMap.js";
import JobWorkspace from "./features/workspace/JobWorkspace.js";
import SyncAdmin from "./features/sync-admin/SyncAdmin.js";
import { SearchFocusProvider } from "./features/search/searchContext.js";
import SearchBar from "./features/search/SearchBar.js";
import TopbarActions from "./features/drawing/TopbarActions.js";
import JobContextStrip from "./features/workspace/JobContextStrip.js";
import { AuthProvider, useAuth } from "./features/auth/authContext.js";
import LoginScreen from "./features/auth/LoginScreen.js";
import { FiltersProvider } from "./features/jobs-map/filtersContext.js";
// JobInfoBoxes removed from topbar — info shown in JobCard detail panel
import { LuminaProvider } from "./features/lumina/store/luminaStore.js";
import { useActiveContract } from "./features/workspace/contractStore.js";
import "./features/lumina/lumina.css";
import "./features/lumina/pegmanTint.css";

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const LIBRARIES: ("geometry" | "places")[] = ["geometry", "places"];

export default function App() {
  return (
    <APIProvider apiKey={apiKey ?? ""} libraries={LIBRARIES}>
      <AuthProvider>
        <SearchFocusProvider>
          <FiltersProvider>
            <LuminaProvider>
              <Shell />
            </LuminaProvider>
          </FiltersProvider>
        </SearchFocusProvider>
      </AuthProvider>
    </APIProvider>
  );
}

function ContractSelector() {
  const { contract, setActiveContract } = useActiveContract();
  return (
    <div
      className="contract-selector"
      role="group"
      aria-label="Active contract workspace"
    >
      <button
        className={`contract-btn ${contract === "Lumen" ? "lumen-active" : "lumen-inactive"}`}
        onClick={() => setActiveContract("Lumen")}
        title="Switch to Lumen contract jobs"
      >
        LUMEN
      </button>
      <button
        className={`contract-btn ${contract === "Ziply" ? "ziply-active" : "ziply-inactive"}`}
        onClick={() => setActiveContract("Ziply")}
        title="Switch to Ziply contract jobs"
      >
        ⚡ ZIPLY
      </button>
    </div>
  );
}

function Shell() {
  const { username, authReady } = useAuth();
  const { contract } = useActiveContract();
  const needsLogin = authReady && username === null;
  return (
    <>
      <div className={`app-frame ${contract === "Ziply" ? "contract-ziply" : ""}`}>
        {/* Industrial rivets at inner corners */}
        <div className="rivet rivet-tl" />
        <div className="rivet rivet-tr" />
        <div className="rivet rivet-bl" />
        <div className="rivet rivet-br" />
        <div className="app-shell">
          <div className="shell">
            <header className="topbar" style={{ gap: 8 }}>
              <img src="/northsky-logo.jpg" alt="North Sky — Building Tomorrow's Broadband" className="logo" />
              <ContractSelector />
              <SearchBar />
              {/* Job info boxes removed — detail shown in JobCard panel */}
              {/* Phase 9.6: inline job-info strip when in workspace mode */}
              <InlineJobContext />
              <TopbarActions />
              <UserChip />
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
      {!authReady && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4999,
            display: "grid",
            placeItems: "center",
            background: "rgba(20, 26, 36, 0.4)",
            color: "#e8eef6",
            fontFamily: "ui-monospace, Consolas, monospace",
            fontSize: 12,
            letterSpacing: "0.12em",
          }}
        >
          CHECKING ACCESS…
        </div>
      )}
      {needsLogin && <LoginScreen />}
      {!apiKey && <MissingKeyOverlay />}
    </>
  );
}

// Phase 9.6: renders the JobContextStrip inline inside the topbar when on /jobs/:jobId.
// This collapses what used to be a second row into the same row as the brand+search.
function InlineJobContext() {
  const match = useMatch("/jobs/:jobId");
  if (!match || !match.params.jobId) return null;
  return (
    <div className="topbar-job-context">
      <JobContextStrip jobId={match.params.jobId} />
    </div>
  );
}

function UserChip() {
  const { username, logout } = useAuth();
  if (!username) return null;
  return (
    <div
      className="user-chip"
      title={`Logged in as: ${username}`}
    >
      <div className="user-avatar">
        {username.slice(0, 2).toUpperCase()}
      </div>
      <div className="user-info">
        <span className="user-name">
          {username.toUpperCase()}
        </span>
        <button
          type="button"
          className="logout-btn"
          onClick={logout}
        >
          LOG OUT
        </button>
      </div>
    </div>
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
