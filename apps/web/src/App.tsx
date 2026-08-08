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
import MapTypeToggle from "./features/map/MapTypeToggle.js";
import MapStatusFilterPill from "./features/jobs-map/MapStatusFilterPill.js";
import MapAllOverlaysPill from "./features/jobs-map/MapAllOverlaysPill.js";
// JobInfoBoxes removed from topbar — info shown in JobCard detail panel
import { LuminaProvider } from "./features/lumina/store/luminaStore.js";
import { useActiveContract } from "./features/workspace/contractStore.js";
import PrintOverlayStandalone from "./features/print-overlay/PrintOverlayStandalone.js";
import "./features/lumina/lumina.css";
import "./features/lumina/pegmanTint.css";

import React, { Component, type ReactNode } from "react";

interface EBProps { children: ReactNode }
interface EBState { error: Error | null; errorInfo: React.ErrorInfo | null }

class AppErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { error: null, errorInfo: null };

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo });
    console.error("AppErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: "fixed", inset: 0, zIndex: 99999, background: "#111827", color: "#f87171",
          padding: 32, fontFamily: "monospace", overflow: "auto", fontSize: 13, lineHeight: 1.6
        }}>
          <h2 style={{ color: "#ef4444", marginTop: 0 }}>⚠️ Application Runtime Error</h2>
          <pre style={{ background: "#1f2937", padding: 16, borderRadius: 8, color: "#fca5a5", whiteSpace: "pre-wrap" }}>
            {this.state.error.toString()}
            {"\n\nStack:\n"}
            {this.state.error.stack}
            {"\n\nComponent Stack:\n"}
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const LIBRARIES: ("geometry" | "places")[] = ["geometry", "places"];

export default function App() {
  return (
    <AppErrorBoundary>
      <APIProvider apiKey={apiKey ?? ""} libraries={LIBRARIES}>
        <AuthProvider>
          <SearchFocusProvider>
            <FiltersProvider>
              <LuminaProvider>
                <AppRoutes />
              </LuminaProvider>
            </FiltersProvider>
          </SearchFocusProvider>
        </AuthProvider>
      </APIProvider>
    </AppErrorBoundary>
  );
}

function AppRoutes() {
  const { username, authReady } = useAuth();
  const needsLogin = !import.meta.env.DEV && authReady && username === null;

  return (
    <>
      <Routes>
        <Route path="/print-overlay/jobs/:jobId" element={<PrintOverlayStandalone />} />
        <Route path="/*" element={<Shell />} />
      </Routes>

      {!authReady && !import.meta.env.DEV && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4999,
            display: "grid",
            placeItems: "center",
            background: "rgba(255, 255, 255, 0.9)",
            color: "#1a1a1a",
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
  const { contract } = useActiveContract();
  return (
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
            <MapTypeToggle />
            <MapStatusFilterPill />
            <MapAllOverlaysPill />
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
      position: "fixed", inset: 0, background: "rgba(29,78,216,0.12)",
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
