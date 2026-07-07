// Dashboard home — default landing view. Mounted full-screen over the map by
// JobsMap when the Dashboard tab is active. Map at 58% width; the calendar
// shows crews scheduled per day. No search bar, no "Good Day to Bore" chip.

import { Suspense } from "react";
import type { Job } from "@nsc/types";
import { useAuth } from "../auth/authContext.js";
import { useDashboardData } from "./hooks/useDashboardData.js";
import type { StatusBucket } from "../jobs-map/markerStyle.js";
import WeatherStrip from "./widgets/WeatherStrip.js";
import JobStatusBar from "./widgets/JobStatusBar.js";
import MapPreviewCard from "./widgets/MapPreviewCard.js";
import ActiveDigTicketsCard from "./widgets/ActiveDigTicketsCard.js";
import CalendarCard from "./widgets/CalendarCard.js";
import LuminaBriefingCard from "./widgets/LuminaBriefingCard.js";
import AtRiskJobsCard from "./widgets/AtRiskJobsCard.js";
import QuickLinksCard from "./widgets/QuickLinksCard.js";
import "./styles/dashboard.css";

export interface DashboardPageProps {
  jobs: Job[];
  onFilterStatus: (bucket: StatusBucket) => void;
  onOpenMap: () => void;
  onOpenCalendar: () => void;
  onOpenJob: (jobId: string) => void;
}

function firstNameOf(username: string | null): string {
  if (!username) return "Billy";
  return username.trim().split(/\s+/)[0] || "Billy";
}

export default function DashboardPage({
  jobs,
  onFilterStatus,
  onOpenMap,
  onOpenCalendar,
  onOpenJob,
}: DashboardPageProps) {
  const { username } = useAuth();
  const data = useDashboardData(jobs);
  const firstName = firstNameOf(username);

  return (
    <div className="nsc-dashboard" role="region" aria-label="Dashboard home">
      <div className="nsc-dashboard__scroll">
        <WeatherStrip />

        <JobStatusBar counts={data.statusCounts} onSelectBucket={onFilterStatus} />

        <div className="nsc-dashboard__row nsc-dashboard__row--three">
          <Suspense fallback={<div className="dash-skel dash-skel--map" aria-hidden />}>
            <MapPreviewCard jobs={data.myJobs} onOpenMap={onOpenMap} />
          </Suspense>
          <LuminaBriefingCard firstName={firstName} username={username} />
          <CalendarCard
            weekStart={data.weekStart}
            weekSchedule={data.weekSchedule}
            loading={false}
            onOpenCalendar={onOpenCalendar}
          />
        </div>

        <div className="nsc-dashboard__row nsc-dashboard__row--bottom">
          <ActiveDigTicketsCard jobs={jobs} />
          <div className="nsc-dashboard__right-stack">
            <AtRiskJobsCard atRiskJobs={data.atRiskJobs} onOpenJob={onOpenJob} />
            <QuickLinksCard />
          </div>
        </div>
      </div>
    </div>
  );
}
