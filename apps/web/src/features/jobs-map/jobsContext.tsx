// JobsContext — shares the jobs list + refresh callback with descendants,
// including TopbarActions (which lives outside the JobsMap component tree but
// inside the same React root).
import { createContext, useContext, type ReactNode } from "react";
import type { Job } from "@nsc/types";

interface JobsContextValue {
  jobs: Job[];
  refreshJobs: () => void;
}

const JobsContext = createContext<JobsContextValue>({
  jobs: [],
  refreshJobs: () => undefined,
});

export function JobsProvider({
  jobs,
  refreshJobs,
  children,
}: {
  jobs: Job[];
  refreshJobs: () => void;
  children: ReactNode;
}) {
  return (
    <JobsContext.Provider value={{ jobs, refreshJobs }}>
      {children}
    </JobsContext.Provider>
  );
}

export function useJobsContext(): JobsContextValue {
  return useContext(JobsContext);
}
