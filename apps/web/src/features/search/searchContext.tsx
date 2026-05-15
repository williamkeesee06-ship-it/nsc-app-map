// Global "focus on the map" channel.
// The topbar's SearchBar and the JobsMap both read/write this so the search
// bar (in the always-visible header) can drive the map (in the route below).
//
// Two kinds of focus requests:
//   - { kind: "job", jobId }      → JobsMap looks up the job, zooms to its
//                                   geocode (or shows JobCard if unmapped).
//   - { kind: "latLng", lat, lng, label? } → free-form geocoded address.
import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type FocusRequest =
  | { kind: "job"; jobId: string; requestedAt: number }
  | { kind: "latLng"; lat: number; lng: number; label?: string; requestedAt: number };

interface SearchCtx {
  focus: FocusRequest | null;
  focusJob: (jobId: string) => void;
  focusLatLng: (lat: number, lng: number, label?: string) => void;
  clearFocus: () => void;
}

const Ctx = createContext<SearchCtx | null>(null);

export function SearchFocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState<FocusRequest | null>(null);

  const value = useMemo<SearchCtx>(
    () => ({
      focus,
      focusJob: (jobId) => setFocus({ kind: "job", jobId, requestedAt: Date.now() }),
      focusLatLng: (lat, lng, label) =>
        setFocus({ kind: "latLng", lat, lng, label, requestedAt: Date.now() }),
      clearFocus: () => setFocus(null),
    }),
    [focus]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSearchFocus(): SearchCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSearchFocus must be used inside SearchFocusProvider");
  return v;
}
