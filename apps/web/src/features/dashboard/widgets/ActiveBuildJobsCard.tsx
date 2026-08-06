// Active Build Jobs — Phase 10 dashboard card that replaces the old "Active
// Dig Tickets" panel at the top of the row. Shows every Ziply job in an
// active bucket (Commitment / In Progress / RTS / Ready Soon / Resto / Gigs)
// with:
//   • Hub Number
//   • Address (city subtitle)
//   • Neon high-tech radial gauge for % Complete (from Smartsheet)
//   • Markup count (drawings on the print overlay canvas)
//   • [Print Overlay] button — deep-links to /print-overlay/jobs/:jobId
//
// This is the primary "what am I building today" view for Billy: everything
// he needs to grab a print, open the overlay canvas, and place features.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Job } from "@nsc/types";
import { api } from "../../../lib/api.js";
import { bucketForJob } from "../../jobs-map/markerStyle.js";
import Bezel from "../components/Bezel.js";
import RadialGauge from "../components/RadialGauge.js";

export interface ActiveBuildJobsCardProps {
  jobs: Job[];
  onOpenJob: (jobId: string) => void;
}

// The set of buckets we count as "actively building". Per Billy 8/6: show
// ALL Ziply jobs so he can see every job in the tracker on one screen.
// Anything not-Ziply is filtered upstream.
const ACTIVE_BUCKETS = new Set([
  "commitment",
  "in_progress",
  "rts",
  "ready_soon",
  "resto",
  "gigs",
]);

// Markup counts are stored in a separate AsBuiltDocument (objects[]) per job,
// not on the Job doc itself — loading each one would flood the dashboard, so
// we lazily fetch the global roll-up (api.getAllDrawings) once and index
// counts by jobId. That single request returns every drawing document at
// once, keeping the initial render fast and avoiding an N+1 fetch pattern.

export default function ActiveBuildJobsCard({ jobs, onOpenJob }: ActiveBuildJobsCardProps) {
  const navigate = useNavigate();

  // Load markup counts once for every job. api.getAllDrawings returns the
  // set of AsBuiltDocuments; we index by jobId and read length of objects[].
  const [markupCounts, setMarkupCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    api
      .getAllDrawings()
      .then((res: any) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        const docs: any[] = res?.docs ?? res?.drawings ?? res ?? [];
        for (const d of Array.isArray(docs) ? docs : []) {
          if (d?.jobId) map[d.jobId] = Array.isArray(d.objects) ? d.objects.length : 0;
        }
        setMarkupCounts(map);
      })
      .catch(() => {
        // Non-fatal — the card still renders with 0 markup counts.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter to active Ziply jobs, sorted by % complete desc (closest-to-done
  // rises to the top so Billy sees near-finished work first). Ties break on
  // hub number for stable ordering across renders.
  const activeJobs = useMemo(() => {
    return jobs
      .filter((j) => j.customerProject === "Ziply")
      .filter((j) => ACTIVE_BUCKETS.has(bucketForJob(j)))
      .sort((a, b) => {
        const pa = a.percentComplete ?? -1;
        const pb = b.percentComplete ?? -1;
        if (pb !== pa) return pb - pa;
        return (a.hubNumber || "").localeCompare(b.hubNumber || "");
      });
  }, [jobs]);

  return (
    <Bezel className="active-build">
      <header className="active-build__head">
        <h2 className="active-build__title">Active Build Jobs</h2>
        <span className="active-build__count" aria-label={`${activeJobs.length} active jobs`}>
          {activeJobs.length}
        </span>
      </header>

      {activeJobs.length === 0 ? (
        <div className="active-build__empty">No active Ziply jobs.</div>
      ) : (
        <ul className="active-build__list" role="list">
          {activeJobs.map((job) => {
            const markups = markupCounts[job.jobId] ?? 0;
            const pct = job.percentComplete ?? 0;
            return (
              <li key={job.jobId} className="active-build__row">
                {/* Left: inline neon gauge for % complete */}
                <div className="active-build__gauge">
                  <RadialGauge
                    value={pct}
                    max={100}
                    display={job.percentComplete == null ? "—" : `${pct}%`}
                    label=""
                    color={
                      pct >= 80 ? "#39ff14" : pct >= 40 ? "#3aa7ff" : "#ff8a1f"
                    }
                    size={64}
                  />
                </div>

                {/* Middle: hub + address, click opens the job detail */}
                <button
                  type="button"
                  className="active-build__info"
                  onClick={() => onOpenJob(job.jobId)}
                  title="Open job details"
                >
                  <div className="active-build__hub">
                    {job.hubNumber || job.wireCenter || "—"}
                  </div>
                  <div className="active-build__address">
                    {job.address || "(no address)"}
                    {job.city ? <span className="active-build__city"> · {job.city}</span> : null}
                  </div>
                </button>

                {/* Right: markup count pill + Print Overlay button */}
                <div className="active-build__actions">
                  <span
                    className={`active-build__markups${markups > 0 ? " is-nonzero" : ""}`}
                    aria-label={`${markups} markup${markups === 1 ? "" : "s"}`}
                    title={`${markups} canvas markup${markups === 1 ? "" : "s"}`}
                  >
                    {markups}
                    <span aria-hidden> ✎</span>
                  </span>
                  <button
                    type="button"
                    className="active-build__print-btn"
                    onClick={() => navigate(`/print-overlay/jobs/${job.jobId}`)}
                  >
                    Print Overlay
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Bezel>
  );
}
