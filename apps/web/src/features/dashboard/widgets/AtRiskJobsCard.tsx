// At-risk jobs table. Rules live in computeAtRisk (useDashboardData): schedule
// slip, permit pending, traffic control needed soon, stale hold — all from
// real Job fields. Tapping a row opens that job's card on the map.

import type { AtRiskJob } from "../hooks/useDashboardData.js";
import Bezel from "../components/Bezel.js";

export interface AtRiskJobsCardProps {
  atRiskJobs: AtRiskJob[];
  onOpenJob: (jobId: string) => void;
}

function locationOf(job: AtRiskJob["job"]): string {
  return [job.address, job.city].filter(Boolean).join(", ") || "—";
}

export default function AtRiskJobsCard({ atRiskJobs, onOpenJob }: AtRiskJobsCardProps) {
  return (
    <Bezel className="card atrisk-card" accent="#ff3b5c">
      <div className="card__header">
        <h2 className="card__title atrisk-card__title">At-Risk Jobs</h2>
        <span className="atrisk-card__count">{atRiskJobs.length}</span>
      </div>

      {atRiskJobs.length === 0 ? (
        <p className="atrisk-card__empty">No at-risk jobs. All clear.</p>
      ) : (
        <div className="atrisk-card__scroll">
          <table className="atrisk-card__table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Location</th>
                <th>Schedule</th>
                <th>Risk</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {atRiskJobs.map((r) => (
                <tr
                  key={r.job.jobId}
                  className="atrisk-card__row"
                  tabIndex={0}
                  role="button"
                  aria-label={`Open job ${r.job.workOrder}`}
                  onClick={() => onOpenJob(r.job.jobId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenJob(r.job.jobId);
                    }
                  }}
                >
                  <td className="atrisk-card__id">{r.job.workOrder}</td>
                  <td>{locationOf(r.job)}</td>
                  <td>{r.dueDate ?? "—"}</td>
                  <td>
                    <span
                      className={`atrisk-card__risk atrisk-card__risk--${r.risk.toLowerCase()}`}
                    >
                      {r.risk}
                    </span>
                  </td>
                  <td className="atrisk-card__reason">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Bezel>
  );
}
