// filtersContext.tsx — lift filter state and jobs list above JobsMap so the
// topbar StatusFilterPills can read/write filters and display per-bucket counts.

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Job } from "@nsc/types";
import { useFilters } from "./useFilters.js";
import type { Filters } from "./FilterRail.js";
import { defaultFilters } from "./FilterRail.js";

interface FiltersContextValue {
  filters: Filters;
  setFilters: (f: Filters) => void;
  jobs: Job[];
  setJobs: (jobs: Job[]) => void;
}

const FiltersContext = createContext<FiltersContextValue | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filters, setFilters] = useFilters(jobs);
  return (
    <FiltersContext.Provider value={{ filters, setFilters, jobs, setJobs }}>
      {children}
    </FiltersContext.Provider>
  );
}

export function useFiltersContext(): FiltersContextValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) {
    // Fallback for any consumer rendered outside provider — should not happen
    // in normal flow, but avoid hard-crash.
    return {
      filters: defaultFilters(),
      setFilters: () => {},
      jobs: [],
      setJobs: () => {},
    };
  }
  return ctx;
}
