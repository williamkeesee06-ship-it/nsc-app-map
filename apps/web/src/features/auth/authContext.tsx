// Phase 9: lightweight username login (no real auth).
// Stored in localStorage as "nsc.username". Used to filter the Smartsheet
// job list by the Supervisor column (case-insensitive match on the value).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { hydratePrefs } from "../../lib/prefsSync.js";
import { api } from "../../lib/api.js";

const LS_KEY = "nsc.username";

interface AuthCtxValue {
  username: string | null;
  setUsername: (s: string) => void;
  logout: () => void;
  /** Phase 9.7: list of supervisor names who get manager-mode UI. */
  managers: string[];
  setManagers: (m: string[]) => void;
  /** True when the signed-in user's name is in the managers list. */
  isManager: boolean;
}

const AuthContext = createContext<AuthCtxValue | null>(null);

export function useAuth(): AuthCtxValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

const LS_MANAGERS = "nsc.managers";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsernameRaw] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_KEY);
    } catch {
      return null;
    }
  });
  const [managers, setManagersRaw] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LS_MANAGERS);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const setManagers = useCallback((m: string[]) => {
    setManagersRaw(m);
    try {
      localStorage.setItem(LS_MANAGERS, JSON.stringify(m));
    } catch {
      // ignore
    }
  }, []);

  const isManager =
    !!username &&
    managers.some((m) => m.trim().toLowerCase() === username.trim().toLowerCase());

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

  // On initial mount with a stored username, hydrate prefs AND refresh data
  // from Smartsheet. Managers refresh ALL supervisors; everyone else just
  // refreshes their own rows.
  useEffect(() => {
    if (username) {
      hydratePrefs().catch(() => { /* swallow */ });
      const isManagerOnMount = managers.some(
        (m) => m.trim().toLowerCase() === username.trim().toLowerCase()
      );
      const p = isManagerOnMount
        ? api.syncAllSupervisors(username)
        : api.syncSupervisor(username);
      p.catch(() => { /* swallow */ });
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
    <AuthContext.Provider
      value={{ username, setUsername, logout, managers, setManagers, isManager }}
    >
      {children}
    </AuthContext.Provider>
  );
}
