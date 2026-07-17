// Dashboard home — default landing view. Mounted full-screen over the map by
// JobsMap when the Dashboard tab is active.
//
// NEW LAYOUT (post-redesign):
//   Row 0 — Hero card: Weather + Job Status Gauges + Quick Links (merged)
//   Row 1 — Active Dig Tickets (wide) | Calendar (large)
//   Row 2 — Map Overview (small) | Lumina Briefing | At Risk Jobs (small)

import { Suspense, useMemo } from "react";
import type { Job } from "@nsc/types";
import { useAuth } from "../auth/authContext.js";
import { useDashboardData } from "./hooks/useDashboardData.js";
import type { StatusBucket } from "../jobs-map/markerStyle.js";
import { useActiveContract } from "../workspace/contractStore.js";
import WeatherStrip from "./widgets/WeatherStrip.js";
import MapPreviewCard from "./widgets/MapPreviewCard.js";
import ActiveDigTicketsCard from "./widgets/ActiveDigTicketsCard.js";
import CalendarCard from "./widgets/CalendarCard.js";
import LuminaBriefingCard from "./widgets/LuminaBriefingCard.js";
import AtRiskJobsCard from "./widgets/AtRiskJobsCard.js";
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

function firstNameOf(username: string | null): string {
  if (!username) return "";
  return username.trim().split(/\s+/)[0] || "";
}

export default function DashboardPage({
  jobs,
  onFilterStatus,
  onOpenMap,
  onOpenCalendar,
  onOpenJob,
}: DashboardPageProps) {
  const { username, isManager } = useAuth();
  const { contract } = useActiveContract();
  const data = useDashboardData(jobs);
  const firstName = firstNameOf(username);

  const supervisorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const j of jobs) {
      const status = (j.jobStatus ?? "").trim().toLowerCase();
      if (status === "completed") continue;
      const supervisor = (j.constructionSupervisor ?? "").trim();
      if (!supervisor) continue;
      counts[supervisor] = (counts[supervisor] || 0) + 1;
    }
    return counts;
  }, [jobs]);

  const ziplyJobs = useMemo(
    () => jobs.filter((j) => j.customerProject === "Ziply"),
    [jobs]
  );
  const isZiply = contract === "Ziply";

  return (
    <div className="nsc-dashboard" role="region" aria-label="Dashboard home">
      <div className="nsc-dashboard__scroll">

        {/* ── Row 0: Hero card — Weather + Gauges + Quick Links ── */}
        <WeatherStrip
          jobCounts={data.statusCounts}
          onSelectBucket={onFilterStatus}
          isManager={isManager}
          supervisorCounts={supervisorCounts}
        />

        {/* ── Row 1: Active Dig Tickets | Calendar (Lumen) / Rollup (Ziply) ── */}
        <div className="nsc-dashboard__row nsc-dashboard__row--tickets-cal">
          <ActiveDigTicketsCard jobs={jobs} />
          {isZiply ? (
            <ZiplyRollupCard jobs={jobs} />
          ) : (
            <CalendarCard
              weekStart={data.weekStart}
              weekSchedule={data.weekSchedule}
              loading={false}
              onOpenCalendar={onOpenCalendar}
            />
          )}
        </div>

        {/* ── Row 2: Map | Lumina | At Risk (Lumen) / Gig Work (Ziply) ── */}
        <div className="nsc-dashboard__row nsc-dashboard__row--map-ai">
          <Suspense fallback={<div className="dash-skel dash-skel--map" aria-hidden />}>
            <MapPreviewCard jobs={data.myJobs} onOpenMap={onOpenMap} />
          </Suspense>
          <LuminaBriefingCard firstName={firstName} username={username} />
          {isZiply ? (
            <GigWorkCard ziplyJobs={ziplyJobs} onOpenJob={onOpenJob} />
          ) : (
            <AtRiskJobsCard atRiskJobs={data.atRiskJobs} onOpenJob={onOpenJob} />
          )}
        </div>

      </div>
    </div>
  );
}
