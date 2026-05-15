// Map theme — Phase 4: always light. ThemeToggle removed.
// Context kept for backward compat with any components that read `theme`,
// but it always returns "light" and the toggle is a no-op.
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

export type MapTheme = "dark" | "light";

interface MapThemeCtx {
  theme: MapTheme;
  setTheme: (t: MapTheme) => void;
  toggle: () => void;
}

const Ctx = createContext<MapThemeCtx | null>(null);

export function MapThemeProvider({ children }: { children: ReactNode }) {
  const value = useMemo<MapThemeCtx>(() => ({
    theme: "light" as const,
    setTheme: (_t: MapTheme) => { /* no-op — always light */ },
    toggle: () => { /* no-op */ },
  }), []);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMapTheme(): MapThemeCtx {
  const v = useContext(Ctx);
  // Return a default when used outside provider (e.g. App.tsx no longer wraps in it)
  if (!v) {
    return { theme: "light", setTheme: () => {}, toggle: () => {} };
  }
  return v;
}
