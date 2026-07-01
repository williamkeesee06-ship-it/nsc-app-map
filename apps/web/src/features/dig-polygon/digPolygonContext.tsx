// 811 Phase 1 — shared state for the "Draw Dig Polygon" tool.
//
// The toggle button lives in the Telecom tab (LeftRail) while the actual
// drawing surface (DigPolygonOverlay) lives inside <Map>. This context is the
// thin bridge between them: which job we're targeting, whether draw mode is
// on, and the currently-saved polygon (so we can render/re-edit it on load).
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PolygonData } from "@nsc/types";

interface DigPolygonContextValue {
  /** True while the user is actively drawing/editing the dig polygon. */
  active: boolean;
  setActive: (b: boolean) => void;
  toggle: () => void;

  /** Job currently open in the panel (null when none selected). */
  jobId: string | null;
  /** The polygon persisted on that job, if any. */
  existing: PolygonData | null;
  /** Called by JobsMap when the selected job changes. */
  setTarget: (jobId: string | null, existing: PolygonData | null) => void;

  /** True when the target job already has a saved polygon. */
  hasPolygon: boolean;

  /** Overlay calls this after a successful save (or clear). */
  onSaved: (polygon: PolygonData | null) => void;
}

const DigPolygonContext = createContext<DigPolygonContextValue | null>(null);

export function useDigPolygon(): DigPolygonContextValue {
  const ctx = useContext(DigPolygonContext);
  if (!ctx) {
    throw new Error("useDigPolygon must be used within a DigPolygonProvider");
  }
  return ctx;
}

export function DigPolygonProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [existing, setExisting] = useState<PolygonData | null>(null);

  const setTarget = useCallback(
    (nextJobId: string | null, nextExisting: PolygonData | null) => {
      setJobId(nextJobId);
      setExisting(nextExisting);
      // Leaving/switching a job must never strand us in draw mode against the
      // wrong document.
      setActive(false);
    },
    []
  );

  const onSaved = useCallback((polygon: PolygonData | null) => {
    setExisting(polygon);
    setActive(false);
  }, []);

  const toggle = useCallback(() => setActive((a) => !a), []);

  const value = useMemo<DigPolygonContextValue>(
    () => ({
      active,
      setActive,
      toggle,
      jobId,
      existing,
      setTarget,
      hasPolygon: existing !== null,
      onSaved,
    }),
    [active, toggle, jobId, existing, setTarget, onSaved]
  );

  return (
    <DigPolygonContext.Provider value={value}>
      {children}
    </DigPolygonContext.Provider>
  );
}
