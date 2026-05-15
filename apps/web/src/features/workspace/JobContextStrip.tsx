// JobContextStrip — Phase 5: slim bar below the topbar showing active job info.
// Renders only in workspace mode (/jobs/:jobId routes).
import { useJob } from "./useJob.js";
import { colorForSecondaryStatus } from "../jobs-map/markerStyle.js";

interface Props {
  jobId: string;
}

export default function JobContextStrip({ jobId }: Props) {
  const jobState = useJob(jobId);

  if (jobState.state === "loading") {
    return (
      <div className="job-context-strip">
        <div className="job-context-strip__skeleton" />
      </div>
    );
  }

  if (jobState.state !== "ready") {
    return (
      <div className="job-context-strip">
        <span className="job-context-strip__wo">{jobId}</span>
      </div>
    );
  }

  const { job } = jobState;
  const statusColor = colorForSecondaryStatus(job.secondaryJobStatus);

  // Permit state
  const permit = job.permitRequired;
  let permitLabel: string | null = null;
  if (permit) {
    const lp = permit.toLowerCase();
    if (lp.includes("yes") || lp.includes("required") || lp.includes("approved")) {
      permitLabel = "Permit ✓";
    } else if (lp.includes("no") || lp.includes("n/a") || lp.includes("not required")) {
      permitLabel = null;
    } else {
      permitLabel = `Permit: ${permit}`;
    }
  }

  return (
    <div className="job-context-strip">
      {/* WO number */}
      <span className="job-context-strip__wo">{job.workOrder}</span>

      {/* Address */}
      {(job.city || job.address) && (
        <>
          <span className="job-context-strip__sep">·</span>
          <span className="job-context-strip__addr">
            {[job.address, job.city].filter(Boolean).join(", ")}
          </span>
        </>
      )}

      {/* Secondary status chip */}
      {job.secondaryJobStatus && (
        <>
          <span className="job-context-strip__sep">·</span>
          <span
            className="job-context-strip__status-chip"
            style={{
              background: statusColor.core + "22",
              borderColor: statusColor.core,
              color: statusColor.core,
            }}
          >
            {job.secondaryJobStatus}
          </span>
        </>
      )}

      {/* Permit state */}
      {permitLabel && (
        <>
          <span className="job-context-strip__sep">·</span>
          <span className="job-context-strip__permit">{permitLabel}</span>
        </>
      )}
    </div>
  );
}
