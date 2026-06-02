// JobInfoBoxes — AsBuilt-style topbar info row.
//
// Always renders 7 read-only boxes: JOB#, ADDRESS, CITY, FOREMAN, SCHED DATE,
// TC REQ (checkbox), STATUS (pill). When no job is selected the boxes are empty
// placeholders. When a pin is clicked or a search picks a job, every box fills
// in automatically from the global SearchFocus.selectedJobId.

import { useMemo } from "react";
import { useSearchFocus } from "../search/searchContext.js";
import { useJobs } from "./useJobs.js";

export default function JobInfoBoxes() {
  const { selectedJobId } = useSearchFocus();
  const jobsState = useJobs();
  const allJobs = jobsState.state === "ready" ? jobsState.jobs : [];

  const job = useMemo(
    () => (selectedJobId ? allJobs.find((j) => j.jobId === selectedJobId) ?? null : null),
    [selectedJobId, allJobs],
  );

  const v = (s: string | null | undefined) => (s && s.trim() ? s : "");

  return (
    <div className="job-info-row" role="group" aria-label="Selected job info">
      <Field label="JOB #" value={v(job?.workOrder)} width={110} />
      <Field label="ADDRESS" value={v(job?.address)} width={200} />
      <Field label="CITY" value={v(job?.city)} width={120} />
      <Field label="FOREMAN" value={v(job?.constructionCrewForeman)} width={130} />
      <Field label="SCHED DATE" value={v(job?.scheduleDate)} width={110} />

      <label className="job-info-tc" title="Traffic Control Required">
        <input
          type="checkbox"
          checked={!!job?.trafficControlRequired}
          readOnly
          aria-label="Traffic Control Required"
        />
        <span className="job-info-tc__text">TC REQ</span>
      </label>

      <div className="job-info-status">
        <span className="job-info-status__label">STATUS</span>
        <span className={`job-info-status__pill${job?.secondaryJobStatus ? "" : " job-info-status__pill--empty"}`}>
          {v(job?.secondaryJobStatus) || "—"}
        </span>
      </div>
    </div>
  );
}

function Field({ label, value, width }: { label: string; value: string; width: number }) {
  return (
    <div className="job-info-field" style={{ width }}>
      <span className="job-info-field__label">{label}</span>
      <span className={`job-info-field__value${value ? "" : " job-info-field__value--empty"}`} title={value || label}>
        {value || "—"}
      </span>
    </div>
  );
}
