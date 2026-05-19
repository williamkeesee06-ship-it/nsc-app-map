// JobsContext — shares the jobs list + refresh callback with descendants,
// including TopbarActions (which lives outside the JobsMap component tree but
// inside the same React root).
// Phase 7: also exposes the JobsMap google.maps.Map ref so dialogs (Quick Mode)
// can attach click listeners.
import { createContext, useContext, type ReactNode, type MutableRefObject } from "react";
import type { Job } from "@nsc/types";

interface JobsContextValue {
  jobs: Job[];
  refreshJobs: () => void;
  mapRef: MutableRefObject<google.maps.Map | null> | null;
}

const JobsContext = createContext<JobsContextValue>({
  jobs: [],
  refreshJobs: () => undefined,
  mapRef: null,
});

export function JobsProvider({
  jobs,
  refreshJobs,
  mapRef,
  children,
}: {
  jobs: Job[];
  refreshJobs: () => void;
  mapRef?: MutableRefObject<google.maps.Map | null>;
  children: ReactNode;
}) {
  return (
    <JobsContext.Provider value={{ jobs, refreshJobs, mapRef: mapRef ?? null }}>
      {children}
    </JobsContext.Provider>
  );
}

export function useJobsContext(): JobsContextValue {
  return useContext(JobsContext);
}

/** Phase 7: convenience accessor for the JobsMap's google.maps.Map ref. */
export function useJobsMapRef(): MutableRefObject<google.maps.Map | null> | null {
  return useContext(JobsContext).mapRef;
}
