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
        gap: 2,
        marginRight: 12,
        alignItems: "center",
        flexShrink: 0,
        background: "rgba(0,0,0,0.5)",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "2px",
        clipPath: "polygon(6px 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%)",
      }}
      role="group"
      aria-label="Active contract workspace"
    >
      <button
        style={{
          background: contract === "Lumen"
            ? "linear-gradient(135deg, #0052cc 0%, #0077ff 100%)"
            : "transparent",
          color: contract === "Lumen" ? "#fff" : "rgba(255,255,255,0.3)",
          border: "none",
          padding: "6px 16px",
          fontSize: 10,
          fontWeight: 800,
          cursor: "pointer",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          boxShadow: contract === "Lumen" ? "0 0 16px rgba(0,119,255,0.6), inset 0 1px 0 rgba(255,255,255,0.15)" : "none",
          transition: "all 0.15s ease",
          clipPath: "polygon(4px 0%, 100% 0%, calc(100% - 4px) 100%, 0% 100%)",
          fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
        }}
        onClick={() => setActiveContract("Lumen")}
        title="Switch to Lumen contract jobs"
      >
        LUMEN
      </button>
      <button
        style={{
          background: contract === "Ziply"
            ? "linear-gradient(135deg, #00843d 0%, #00d45a 100%)"
            : "transparent",
          color: contract === "Ziply" ? "#fff" : "rgba(255,255,255,0.3)",
          border: "none",
          padding: "6px 16px",
          fontSize: 10,
          fontWeight: 800,
          cursor: "pointer",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          boxShadow: contract === "Ziply" ? "0 0 18px rgba(0,212,90,0.65), inset 0 1px 0 rgba(255,255,255,0.15)" : "none",
          transition: "all 0.15s ease",
          clipPath: "polygon(4px 0%, 100% 0%, calc(100% - 4px) 100%, 0% 100%)",
          fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
        }}
        onClick={() => setActiveContract("Ziply")}
        title="Switch to Ziply contract jobs"
      >
        ⚡ ZIPLY
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
        alignItems: "center",
        gap: 8,
        marginLeft: 8,
        flexShrink: 0,
        background: "rgba(0,0,0,0.45)",
        border: "1px solid rgba(0,212,255,0.2)",
        boxShadow: "0 0 10px rgba(0,212,255,0.1)",
        padding: "5px 12px 5px 8px",
        clipPath: "polygon(8px 0%, 100% 0%, calc(100% - 0px) 100%, 0% 100%)",
        fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
      }}
      title={`Logged in as: ${username}`}
    >
      {/* Avatar circle */}
      <div style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #00d4ff, #0077ff)",
        boxShadow: "0 0 8px rgba(0,212,255,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        fontWeight: 900,
        color: "#fff",
        flexShrink: 0,
        letterSpacing: 0,
      }}>
        {username.slice(0, 2).toUpperCase()}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{
          color: "#e2e8f0",
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: "0.08em",
          maxWidth: 80,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {username.toUpperCase()}
        </span>
        <button
          type="button"
          onClick={logout}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(0,212,255,0.5)",
            fontFamily: "inherit",
            fontSize: 8,
            cursor: "pointer",
            padding: 0,
            letterSpacing: "0.06em",
            textAlign: "left",
          }}
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
