// Map theme provider — toggle between dark tactical and light styles.
// Preference is persisted to localStorage so it survives reloads.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type MapTheme = "dark" | "light";

interface MapThemeCtx {
  theme: MapTheme;
  setTheme: (t: MapTheme) => void;
  toggle: () => void;
}

const Ctx = createContext<MapThemeCtx | null>(null);

const STORAGE_KEY = "nsc.mapTheme";

function readInitial(): MapTheme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

export function MapThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<MapTheme>(readInitial);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo<MapThemeCtx>(() => ({
    theme,
    setTheme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  }), [theme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMapTheme(): MapThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMapTheme must be used inside MapThemeProvider");
  return v;
}
