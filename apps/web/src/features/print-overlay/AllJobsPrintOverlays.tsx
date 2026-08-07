// AllJobsPrintOverlays.tsx — Paints saved print overlays for ALL jobs onto the map.
// Supports global show/hide filtering + per-job overlay toggles.

import { useMap } from "@vis.gl/react-google-maps";
import type { Job } from "@nsc/types";
import JobPrintOverlays from "./JobPrintOverlays.js";

interface Props {
  jobs: Job[];
  selectedJobId?: string | null;
  showGlobal?: boolean;
  hiddenJobIds?: Set<string>;
}

export default function AllJobsPrintOverlays({
  jobs,
  selectedJobId,
  showGlobal = true,
  hiddenJobIds,
}: Props) {
  const map = useMap();
  if (!map) return null;

  return (
    <>
      {jobs.map((job) => {
        if (!job.printOverlay) return null;

        const isSelected = Boolean(selectedJobId && selectedJobId === job.jobId);
        const isHiddenIndividually = hiddenJobIds?.has(job.jobId) ?? false;

        // Selection Isolation:
        // Currently selected job overlay is driven EXCLUSIVELY by its own per-job toggle (!isHiddenIndividually).
        // Non-selected jobs overlay requires showGlobal === true AND !isHiddenIndividually.
        const shouldShow = isSelected
          ? !isHiddenIndividually
          : showGlobal && !isHiddenIndividually;

        if (!shouldShow) return null;

        return <JobPrintOverlays key={job.jobId} job={job} visible={true} />;
      })}
    </>
  );
}
