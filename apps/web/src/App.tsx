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
import JobInfoBoxes from "./features/jobs-map/JobInfoBoxes.js";
import { LuminaProvider } from "./features/lumina/store/luminaStore.js";
import { useActiveContract, setActiveContract } from "./features/workspace/contractStore.js";
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
      style={{
        display: "flex",
        gap: 3,
        marginRight: 10,
        background: "rgba(0,0,0,0.4)",
        borderRadius: 8,
        padding: 3,
        border: "1px solid rgba(255,255,255,0.12)",
        alignItems: "center",
        flexShrink: 0,
      }}
      role="group"
      aria-label="Active contract workspace"
    >
      <button
        style={{
          background: contract === "Lumen" ? "linear-gradient(135deg, #0052cc, #0070f3)" : "transparent",
          color: contract === "Lumen" ? "#fff" : "rgba(255,255,255,0.4)",
          border: contract === "Lumen" ? "1px solid rgba(0,112,243,0.8)" : "1px solid transparent",
          padding: "5px 14px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          boxShadow: contract === "Lumen" ? "0 0 12px rgba(0,112,243,0.5)" : "none",
          transition: "all 0.2s ease",
          whiteSpace: "nowrap",
        }}
        onClick={() => setActiveContract("Lumen")}
        title="Switch to Lumen contract jobs"
      >
        Lumen
      </button>
      <button
        style={{
          background: contract === "Ziply" ? "linear-gradient(135deg, #00843d, #00b248)" : "transparent",
          color: contract === "Ziply" ? "#fff" : "rgba(255,255,255,0.4)",
          border: contract === "Ziply" ? "1px solid rgba(0,178,72,0.8)" : "1px solid transparent",
          padding: "5px 14px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          boxShadow: contract === "Ziply" ? "0 0 12px rgba(0,178,72,0.5)" : "none",
          transition: "all 0.2s ease",
          whiteSpace: "nowrap",
        }}
        onClick={() => setActiveContract("Ziply")}
        title="Switch to Ziply contract jobs"
      >
        ⚡ Ziply
      </button>
    </div>
  );
}

function Shell() {
  const { username } = useAuth();
  const { contract } = useActiveContract();
  const needsLogin = username === null;
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
              {/* AsBuilt-style info row: 7 boxes that auto-fill when a job is
                  selected via search or by clicking a pin. Empty otherwise. */}
              <JobInfoBoxes />
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
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        marginLeft: 6,
        fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
        letterSpacing: "0.04em",
        color: "var(--text-muted, #8a96a3)",
        flexShrink: 0,
      }}
      title={`Filtering jobs for supervisor: ${username}`}
    >
      <span
        style={{
          padding: "2px 7px",
          borderRadius: 8,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(200,208,218,0.18)",
          color: "var(--text, #f4f8ff)",
          fontWeight: 700,
          fontSize: 9,
          lineHeight: 1.2,
          maxWidth: 90,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {username}
      </span>
      <button
        type="button"
        onClick={logout}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-muted, #8a96a3)",
          fontFamily: "inherit",
          fontSize: 9,
          cursor: "pointer",
          textDecoration: "underline",
          padding: 0,
          lineHeight: 1,
        }}
      >
        Log out
      </button>
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
