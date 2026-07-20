// Map theme context — support switching between light and dark themes
import { createContext, useContext, useState, useMemo, useCallback } from "react";
import type { ReactNode } from "react";

export type MapTheme = "dark" | "light";

interface MapThemeCtx {
  theme: MapTheme;
  setTheme: (t: MapTheme) => void;
  toggle: () => void;
}

const Ctx = createContext<MapThemeCtx | null>(null);

export function MapThemeProvider({ children }: { children: ReactNode }) {
  const theme = "light";
  const setTheme = useCallback(() => {}, []);
  const toggle = useCallback(() => {}, []);

  const value = useMemo<MapThemeCtx>(() => ({
    theme,
    setTheme,
    toggle,
  }), [theme, setTheme, toggle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMapTheme(): MapThemeCtx {
  const v = useContext(Ctx);
  if (!v) {
    return { theme: "light", setTheme: () => {}, toggle: () => {} };
  }
  return v;
}
