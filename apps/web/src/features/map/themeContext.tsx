// Map theme context — toggles the whole map view between the standard "light"
// basemap and "network" view, which turns the basemap dark and lights every
// drawn cable with a zoom-band-driven halo/glow (see darkFiberMode.ts + .css).
//
// State is persisted to localStorage so a supervisor's preference survives
// hard-refreshes and re-deploys.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type MapTheme = "light" | "network";

const LS_KEY = "nsc:mapTheme";

interface MapThemeCtx {
  theme: MapTheme;
  setTheme: (t: MapTheme) => void;
  toggle: () => void;
}

const Ctx = createContext<MapThemeCtx | null>(null);

function readInitialTheme(): MapTheme {
  if (typeof window === "undefined") return "light";
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    // Back-compat: an older build stored "dark" — treat that as "network".
    if (raw === "network" || raw === "dark") return "network";
    return "light";
  } catch {
    return "light";
  }
}

export function MapThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<MapTheme>(readInitialTheme);

  const setTheme = useCallback((t: MapTheme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(LS_KEY, t);
    } catch {
      // Storage may be blocked in private mode — non-fatal.
    }
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: MapTheme = prev === "network" ? "light" : "network";
      try {
        window.localStorage.setItem(LS_KEY, next);
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  // Mirror the theme on <html data-map-theme=...> so CSS in darkFiberMode.css
  // can gate every rule with `[data-map-theme="network"]` and survive React
  // portals (Google Maps InfoWindows, floating menus, etc.) that render
  // outside the map container.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-map-theme", theme);
    return () => {
      document.documentElement.removeAttribute("data-map-theme");
    };
  }, [theme]);

  const value = useMemo<MapThemeCtx>(
    () => ({ theme, setTheme, toggle }),
    [theme, setTheme, toggle]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMapTheme(): MapThemeCtx {
  const v = useContext(Ctx);
  if (!v) {
    return { theme: "light", setTheme: () => {}, toggle: () => {} };
  }
  return v;
}
