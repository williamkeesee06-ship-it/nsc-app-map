// Fetch a single job by id, for the workspace job-card panel.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import type { Job } from "@nsc/types";

export type JobState =
  | { state: "loading" }
  | { state: "ready"; job: Job }
  | { state: "missing" }
  | { state: "error"; message: string };

export function useJob(jobId: string): JobState {
  const [s, setS] = useState<JobState>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    setS({ state: "loading" });
    api
      .getJob(jobId)
      .then(({ job }) => {
        if (!cancelled) setS({ state: "ready", job });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        if (err.message.includes("404")) setS({ state: "missing" });
        else setS({ state: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);
  return s;
}
