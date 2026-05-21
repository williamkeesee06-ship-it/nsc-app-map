// useFilters.ts — Phase 9: persisted bucket-based filter state.
// Default = everything EXCEPT "completed". Stored under "nsc.filters.v2".

import { useState, useEffect, useCallback } from "react";
import type { Filters } from "./FilterRail.js";
import type { Job } from "@nsc/types";
import type { StatusBucket } from "./markerStyle.js";

const LS_KEY = "nsc.filters.v2";

const ACTIVE_BY_DEFAULT: StatusBucket[] = [
  "needs_fielding",
  "rts",
  "on_hold",
  "pending",
  "in_progress",
];

interface PersistedFilters {
  buckets: StatusBucket[];
}

function saveFilters(f: Filters): void {
  try {
    const data: PersistedFilters = { buckets: Array.from(f.buckets) };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function loadPersistedFilters(): PersistedFilters | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedFilters;
    if (!Array.isArray(parsed.buckets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function useFilters(_jobs: Job[]): [Filters, (f: Filters) => void] {
  const [filters, setFiltersRaw] = useState<Filters>(() => {
    const persisted = loadPersistedFilters();
    const buckets = new Set<StatusBucket>(
      persisted?.buckets ?? ACTIVE_BY_DEFAULT
    );
    return {
      inTrackerOnly: false,
      hideUnmapped: false,
      hideCompleted: !buckets.has("completed"),
      statuses: new Set(),
      secondaryStatuses: new Set(),
      buckets,
      workTypeTags: new Set(),
    };
  });

  const setFilters = useCallback((f: Filters) => {
    setFiltersRaw(f);
    saveFilters(f);
  }, []);

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  return [filters, setFilters];
}
