// AllJobsPrintOverlays.tsx — Paints saved print overlays for ALL jobs onto the map.
// Supports global show/hide filtering + per-job overlay toggles.

import { useMap } from "@vis.gl/react-google-maps";
import type { Job } from "@nsc/types";
import JobPrintOverlays from "./JobPrintOverlays.js";

interface Props {
  jobs: Job[];
  showGlobal?: boolean;
  hiddenJobIds?: Set<string>;
}

export default function AllJobsPrintOverlays({
  jobs,
  showGlobal = true,
  hiddenJobIds,
}: Props) {
  const map = useMap();
  if (!map || !showGlobal) return null;

  return (
    <>
      {jobs.map((job) => {
        if (!job.printOverlay || hiddenJobIds?.has(job.jobId)) return null;
        return <JobPrintOverlays key={job.jobId} job={job} visible={true} />;
      })}
    </>
  );
}
