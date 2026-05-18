// useFilters.ts — Phase 5.3: persisted filter state with smart defaults.
// Saves/loads from localStorage under "nsc.filters.v1".
// On first load (no saved state), pre-selects the "active work" statuses.

import { useState, useEffect, useCallback } from "react";
import type { Filters } from "./FilterRail.js";
import { colorKeyForSecondaryStatus } from "./markerStyle.js";
import type { Job } from "@nsc/types";

const LS_KEY = "nsc.filters.v1";

// Color keys that are "active work" — shown by default
const DEFAULT_ACTIVE_COLOR_KEYS = new Set([
  "orange",  // Needs Fielding
  "yellow",  // Fielded RTS / RTS
  "green",   // Scheduled
  "blue",    // Routed to Sub
]);

// ── Serialization ─────────────────────────────────────────────────────────────

interface PersistedFilters {
  secondaryStatuses: string[];
  hideCompleted: boolean;
}

function saveFilters(f: Filters): void {
  try {
    const data: PersistedFilters = {
      secondaryStatuses: Array.from(f.secondaryStatuses),
      hideCompleted: f.hideCompleted,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

function loadPersistedFilters(): PersistedFilters | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedFilters;
    if (!Array.isArray(parsed.secondaryStatuses)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Default filter generation (first-run only) ────────────────────────────────
// Called with the live job list to find exact status strings matching the
// "active work" color keys. Falls back to empty set if jobs not loaded yet —
// the hook re-seeds once jobs are available.

function computeDefaultSecondaryStatuses(jobs: Job[]): Set<string> {
  const result = new Set<string>();
  for (const job of jobs) {
    const s = job.secondaryJobStatus?.trim();
    if (!s) continue;
    const key = colorKeyForSecondaryStatus(s);
    if (DEFAULT_ACTIVE_COLOR_KEYS.has(key)) {
      result.add(s);
    }
  }
  return result;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFilters(jobs: Job[]): [Filters, (f: Filters) => void] {
  const [seeded, setSeeded] = useState(false);

  const [filters, setFiltersRaw] = useState<Filters>(() => {
    const persisted = loadPersistedFilters();
    if (persisted) {
      return {
        inTrackerOnly: false,
        hideUnmapped: false,
        hideCompleted: persisted.hideCompleted,
        statuses: new Set(),
        secondaryStatuses: new Set(persisted.secondaryStatuses),
        workTypeTags: new Set(),
      };
    }
    // No persisted state — will seed from jobs once loaded
    return {
      inTrackerOnly: false,
      hideUnmapped: false,
      hideCompleted: true, // hide completed by default
      statuses: new Set(),
      secondaryStatuses: new Set(), // will be populated below
      workTypeTags: new Set(),
    };
  });

  // On first render with no persisted state, seed secondaryStatuses from jobs
  useEffect(() => {
    if (seeded) return;
    const persisted = loadPersistedFilters();
    if (persisted) {
      // Already loaded from LS — mark seeded
      setSeeded(true);
      return;
    }
    if (jobs.length === 0) return; // wait for jobs
    const defaults = computeDefaultSecondaryStatuses(jobs);
    if (defaults.size > 0) {
      setFiltersRaw((f) => ({ ...f, secondaryStatuses: defaults }));
    }
    setSeeded(true);
  }, [jobs, seeded]);

  const setFilters = useCallback((f: Filters) => {
    setFiltersRaw(f);
    saveFilters(f);
  }, []);

  // Whenever filters change (including the seeded defaults), persist them
  useEffect(() => {
    if (!seeded) return;
    saveFilters(filters);
  }, [filters, seeded]);

  return [filters, setFilters];
}
