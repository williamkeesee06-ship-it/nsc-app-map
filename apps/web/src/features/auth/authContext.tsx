// Phase 9: lightweight username login (no real auth).
// Stored in localStorage as "nsc.username". Used to filter the Smartsheet
// job list by the Supervisor column (case-insensitive match on the value).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { hydratePrefs } from "../../lib/prefsSync.js";

const LS_KEY = "nsc.username";

interface AuthCtxValue {
  username: string | null;
  setUsername: (s: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthCtxValue | null>(null);

export function useAuth(): AuthCtxValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsernameRaw] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_KEY);
    } catch {
      return null;
    }
  });

  const setUsername = useCallback((s: string) => {
    const trimmed = s.trim();
    setUsernameRaw(trimmed || null);
    try {
      if (trimmed) localStorage.setItem(LS_KEY, trimmed);
      else localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
    // Pull server prefs for this user so settings follow them across devices.
    if (trimmed) {
      hydratePrefs().catch(() => { /* swallow */ });
    }
  }, []);

  // On initial mount with a stored username, hydrate prefs from server.
  useEffect(() => {
    if (username) {
      hydratePrefs().catch(() => { /* swallow */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(() => {
    setUsernameRaw(null);
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }, []);

  // Keep storage in sync across tabs
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === LS_KEY) setUsernameRaw(e.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <AuthContext.Provider value={{ username, setUsername, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
