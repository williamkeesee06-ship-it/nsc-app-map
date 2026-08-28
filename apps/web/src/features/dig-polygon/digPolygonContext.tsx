// 811 Phase 1.5 — shared state for the dig-shape drawing tools.
//
// The tool switcher lives in the Telecom tab (LeftRail) while the actual
// drawing surface (DigPolygonOverlay) lives inside <Map>. This context is the
// thin bridge between them: which job we're targeting, which shape tool is
// active, and the currently-saved shape (so we can render/re-edit it on load).
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DigShape } from "@nsc/types";

/** The three ITIC-matching dig tools. `null` = not drawing. */
export type DigTool = "radius" | "route" | "polygon";

interface DigPolygonContextValue {
  /** The active drawing tool, or null when the overlay is idle. */
  tool: DigTool | null;
  setTool: (t: DigTool | null) => void;
  /** True while any tool is active (drawing/editing). */
  active: boolean;

  /** Job currently open in the panel (null when none selected). */
  jobId: string | null;
  /** The dig shape persisted on that job, if any. */
  existing: DigShape | null;
  /** Called by JobsMap when the selected job changes. */
  setTarget: (jobId: string | null, existing: DigShape | null) => void;

  /** True when the target job already has a saved shape. */
  hasShape: boolean;

  /** Overlay calls this after a successful save (or clear). */
  onSaved: (shape: DigShape | null) => void;
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
  const [tool, setTool] = useState<DigTool | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [existing, setExisting] = useState<DigShape | null>(null);

  const setTarget = useCallback(
    (nextJobId: string | null, nextExisting: DigShape | null) => {
      setJobId(nextJobId);
      setExisting(nextExisting);
      // Leaving/switching a job must never strand us in draw mode against the
      // wrong document.
      setTool(null);
    },
    []
  );

  const onSaved = useCallback((shape: DigShape | null) => {
    setExisting(shape);
    setTool(null);
  }, []);

  const value = useMemo<DigPolygonContextValue>(
    () => ({
      tool,
      setTool,
      active: tool !== null,
      jobId,
      existing,
      setTarget,
      hasShape: existing !== null,
      onSaved,
    }),
    [tool, jobId, existing, setTarget, onSaved]
  );

  return (
    <DigPolygonContext.Provider value={value}>
      {children}
    </DigPolygonContext.Provider>
  );
}
