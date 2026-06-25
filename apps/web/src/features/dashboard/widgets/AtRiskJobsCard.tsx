// At-risk jobs table — jobs whose schedule date has passed (HIGH) or that are
// permit-required and scheduled within 7 days (MED). See computeAtRisk in
// useDashboardData for why "submitted >7 days, no approval" is omitted (no
// submission-date field on Job).

import type { AtRiskJob } from "../hooks/useDashboardData.js";

export interface AtRiskJobsCardProps {
  atRiskJobs: AtRiskJob[];
}

function descriptionOf(job: AtRiskJob["job"]): string {
  return job.customerProject || job.workType || "—";
}

function locationOf(job: AtRiskJob["job"]): string {
  return [job.address, job.city].filter(Boolean).join(", ") || "—";
}

export default function AtRiskJobsCard({ atRiskJobs }: AtRiskJobsCardProps) {
  return (
    <div className="card card--light atrisk-card">
      <div className="card__header">
        <h2 className="card__title">At-Risk Jobs</h2>
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
                <th>Description</th>
                <th>Location</th>
                <th>Due Date</th>
                <th>Risk</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {atRiskJobs.map((r) => (
                <tr key={r.job.jobId}>
                  <td className="atrisk-card__id">{r.job.workOrder}</td>
                  <td>{descriptionOf(r.job)}</td>
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
    </div>
  );
}
