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

import { useMemo } from "react";
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
  onOpenCalendar,
  onOpenJob,
}: DashboardPageProps) {
  const { isManager } = useAuth();
  const { contract } = useActiveContract();

  // Dashboard-wide Ziply filter. Lumen jobs still live in Firestore (per user
  // directive: "IGNORE" them, don't delete) but the entire dashboard now
  // renders Ziply-only — status buckets, active builds, dig tickets, rollup,
  // gigs, and the supervisor gauge all read from this filtered list.
  const ziplyJobs = useMemo(
    () => jobs.filter((j) => j.customerProject === "Ziply"),
    [jobs]
  );

  const data = useDashboardData(ziplyJobs);

  // Supervisor rollup counts (fed to WeatherStrip for the manager gauge).
  const supervisorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const j of ziplyJobs) {
      const status = (j.jobStatus ?? "").trim().toLowerCase();
      if (status === "completed") continue;
      const supervisor = (j.constructionSupervisor ?? "").trim();
      if (!supervisor) continue;
      counts[supervisor] = (counts[supervisor] || 0) + 1;
    }
    return counts;
  }, [ziplyJobs]);

  const isZiply = contract === "Ziply";

  return (
    <div className="nsc-dashboard" role="region" aria-label="Dashboard home">
      <div className="nsc-dashboard__scroll">

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
    </div>
  );
}
