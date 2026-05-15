// Compact job card. Shows exactly the fields the user picked:
//   Work Order (job #), Address, City, Secondary Job Status,
//   Construction Crew/Foreman, Schedule Date, Traffic Control,
//   NSC Project Notes, Actual Completion Date.
// Plus Job Status as a pill (used for marker color too).
import type { Job } from "@nsc/types";
import { Link } from "react-router-dom";

interface Props {
  job: Job;
  onClose?: () => void;
  variant?: "popup" | "panel";
}

export default function JobCard({ job, onClose, variant = "popup" }: Props) {
  const wo = job.workOrder;
  const status = job.jobStatus ?? "—";
  return (
    <div className={`job-card job-card--${variant}`}>
      <header className="job-card__head">
        <div>
          <div className="job-card__wo">{wo}</div>
          <span className={`status-pill status-${slugify(status)}`}>
            {status}
          </span>
          {!job.inTracker && (
            <span className="status-pill status-archived">Archived</span>
          )}
        </div>
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </header>

      <Row label="Address" value={job.address} />
      <Row label="City" value={job.city} />
      <Row label="Secondary Status" value={job.secondaryJobStatus} />
      <Row label="Crew / Foreman" value={job.constructionCrewForeman} />
      <Row label="Schedule Date" value={fmtDate(job.scheduleDate)} />
      <Row
        label="Traffic Control"
        value={
          job.trafficControlRequired === true
            ? "Required"
            : job.trafficControlRequired === false
              ? "Not required"
              : null
        }
      />
      <Row
        label="Completed"
        value={fmtDate(job.actualCompletionDate)}
      />

      {job.nscProjectNotes && (
        <div className="job-card__notes">
          <div className="job-card__notes-label">NSC Project Notes</div>
          <div className="job-card__notes-body">{job.nscProjectNotes}</div>
        </div>
      )}

      <footer className="job-card__foot">
        <Link to={`/jobs/${job.jobId}`} className="btn btn--primary">
          Open workspace →
        </Link>
      </footer>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="job-card__row">
      <span className="job-card__row-label">{label}</span>
      <span className="job-card__row-value">{value}</span>
    </div>
  );
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  // Smartsheet returns "YYYY-MM-DD" for DATE columns. Render as-is.
  return d;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
