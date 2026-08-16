// Dashboard home — default landing view. Mounted full-screen over the map by
// JobsMap when the Dashboard tab is active.
//
// LAYOUT (Phase 10 — Ziply-first redesign, 2026-08):
//   Row 0 — Hero card: Weather + 7 Ziply status gauges + Quick Links
//   Row 1 — Active Build Jobs (Hub / Address / % gauge / markups / Print btn)
//   Row 2 — Active Dig Tickets  (moved BELOW the build jobs panel)
//   Row 3 — Ziply Rollup (contract=Ziply) or Calendar (contract=Lumen)
//   Row 4 — Gig Work + Go-Backs (tied to the "gigs" status bucket)
//
// Removed in this pass: Map Overview preview, Lumina AI Briefing card.
// Reason (per Billy 8/6): "I only care about building on the map — overlaying
// prints with our parse feature". The remaining widgets are all
// build-execution focused; map preview and daily briefing were signal-noise.

import { useMemo, useState } from "react";
import type { Job } from "@nsc/types";
import { useAuth } from "../auth/authContext.js";
import { useDashboardData } from "./hooks/useDashboardData.js";
import type { StatusBucket } from "../jobs-map/markerStyle.js";
import { useActiveContract } from "../workspace/contractStore.js";
import WeatherStrip from "./widgets/WeatherStrip.js";
import ActiveBuildJobsCard from "./widgets/ActiveBuildJobsCard.js";
import ActiveDigTicketsCard from "./widgets/ActiveDigTicketsCard.js";
import CalendarCard from "./widgets/CalendarCard.js";
import GigWorkCard from "./widgets/GigWorkCard.js";
import ZiplyRollupCard from "./widgets/ZiplyRollupCard.js";
import PortfolioDashboard from "./PortfolioDashboard.js";
import { TitaniumHexBolt } from "../../components/HorologyMetalBezel.js";
import "./styles/dashboard.css";

export interface DashboardPageProps {
  jobs: Job[];
  onFilterStatus: (bucket: StatusBucket) => void;
  onOpenMap: () => void;
  onOpenCalendar: () => void;
  onOpenJob: (jobId: string) => void;
}

export default function DashboardPage({
  jobs,
  onFilterStatus,
  onOpenMap,
  onOpenCalendar,
  onOpenJob,
}: DashboardPageProps) {
  const { isManager } = useAuth();
  const { contract } = useActiveContract();
  // Boot into the full Ziply build dashboard (WeatherStrip + gauges + active
  // builds + rollup + gigs). The plain "portfolio" grid is opt-in via the
  // switcher for jobs-across-contracts triage.
  const [viewMode, setViewMode] = useState<"portfolio" | "build">("build");

  // Dashboard-wide Ziply filter. Lumen jobs still live in Firestore (per user
  // directive: "IGNORE" them, don't delete) but the entire dashboard now
  // renders Ziply-only — status buckets, active builds, dig tickets, rollup,
  // gigs, and the supervisor gauge all read from this filtered list.
  const ziplyJobs = useMemo(
    () => jobs.filter((j) => j.customerProject === "Ziply" && j.inTracker !== false),
    [jobs]
  );

  const data = useDashboardData(ziplyJobs);

  // Supervisor rollup counts (fed to WeatherStrip for the manager gauge).
  const supervisorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const j of ziplyJobs) {
      const status = String(j.jobStatus ?? "").trim().toLowerCase();
      if (status === "completed") continue;
      const supervisor = String(j.constructionSupervisor ?? "").trim();
      if (!supervisor) continue;
      counts[supervisor] = (counts[supervisor] || 0) + 1;
    }
    return counts;
  }, [ziplyJobs]);

  const isZiply = contract === "Ziply";

  const handleSelectJobFromPortfolio = (job: Job) => {
    onOpenJob(job.jobId);
  };

  const handleOpenEarth = () => {
    window.open("https://earth.google.com/web", "_blank", "noopener,noreferrer");
  };

  return (
    <div className="nsc-dashboard" role="region" aria-label="Dashboard home" style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      {/* View Mode Switcher — sapphire-glass segmented control with titanium
          rivets to match the rest of the app chrome. */}
      <div
        className="absolute z-[100] flex items-center gap-1 rounded-xl px-2 py-1.5 backdrop-blur-md
                   bg-slate-900/85 border border-slate-400/40
                   shadow-[0_6px_20px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]"
        style={{ top: 12, right: 24 }}
        role="tablist"
        aria-label="Dashboard view mode"
      >
        <TitaniumHexBolt size={10} className="opacity-70" />
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "build"}
          onClick={() => setViewMode("build")}
          className={`px-3 py-1 rounded-md text-[11px] font-black uppercase tracking-widest transition-all duration-150 font-['Audiowide'] ${
            viewMode === "build"
              ? "bg-blue-600/85 text-white shadow-[0_0_12px_rgba(37,99,235,0.55)] border border-blue-400/70"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent"
          }`}
        >
          Ziply Build
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "portfolio"}
          onClick={() => setViewMode("portfolio")}
          className={`px-3 py-1 rounded-md text-[11px] font-black uppercase tracking-widest transition-all duration-150 font-['Audiowide'] ${
            viewMode === "portfolio"
              ? "bg-blue-600/85 text-white shadow-[0_0_12px_rgba(37,99,235,0.55)] border border-blue-400/70"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent"
          }`}
        >
          Portfolio Hub
        </button>
        <TitaniumHexBolt size={10} className="opacity-70" />
      </div>

      {viewMode === "portfolio" ? (
        <PortfolioDashboard
          jobs={ziplyJobs.length > 0 ? ziplyJobs : jobs}
          onSelectJob={handleSelectJobFromPortfolio}
          onOpenMap={onOpenMap}
          onOpenEarth={handleOpenEarth}
        />
      ) : (
        <div className="nsc-dashboard__scroll" style={{ paddingTop: 48 }}>
          {/* ── Row 0: Hero — Weather + 7 Ziply status gauges + Quick Links ── */}
          <WeatherStrip
            jobCounts={data.statusCounts}
            onSelectBucket={onFilterStatus}
            isManager={isManager}
            supervisorCounts={supervisorCounts}
          />

          {/* ── Row 1: Active Build Jobs (primary focus panel) ────────────── */}
          <div className="nsc-dashboard__row nsc-dashboard__row--build">
            <ActiveBuildJobsCard jobs={ziplyJobs} onOpenJob={onOpenJob} />
          </div>

          {/* ── Row 2: Active Dig Tickets (moved BELOW build panel) ───────── */}
          <div className="nsc-dashboard__row nsc-dashboard__row--tickets">
            <ActiveDigTicketsCard jobs={ziplyJobs} />
          </div>

          {/* ── Row 3: Calendar (Lumen) / Rollup (Ziply) ──────────────────── */}
          <div className="nsc-dashboard__row nsc-dashboard__row--calendar">
            {isZiply ? (
              <ZiplyRollupCard jobs={ziplyJobs} />
            ) : (
              <CalendarCard
                weekStart={data.weekStart}
                weekSchedule={data.weekSchedule}
                loading={false}
                onOpenCalendar={onOpenCalendar}
              />
            )}
          </div>

          {/* ── Row 4: Gig Work + Go-Backs (tied to "gigs" bucket) ────────── */}
          <div className="nsc-dashboard__row nsc-dashboard__row--gigs">
            <GigWorkCard ziplyJobs={ziplyJobs} onOpenJob={onOpenJob} />
          </div>
        </div>
      )}
    </div>
  );
}
