// Firebase Auth session + operator profile for the map app.
// Solo lock: only emails in VITE_AUTH_ALLOWED_EMAILS (or any Firebase user in
// dev when that list is empty) may stay signed in. After Firebase login the
// app still uses operator name "Billy Keesee" for Smartsheet / drawings.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { hydratePrefs } from "../../lib/prefsSync.js";
import { api } from "../../lib/api.js";
import {
  getFirebaseAuth,
  onAuthStateChanged,
  signOutFirebase,
  type User,
} from "../../lib/firebase.js";

const LS_KEY = "nsc.username";
const LS_MANAGERS = "nsc.managers";

/** Solo operator profile (Smartsheet supervisor name). Expand later per email. */
const SOLO_OPERATOR_NAME = "Billy Keesee";

/**
 * Billy's known logins — always accepted even if Vercel env only lists one.
 * Work email + personal Firebase user both map to the same operator profile.
 * Client allowlist is advisory only for non-Billy emails; empty = allow any
 * signed-in Firebase user (server still enforces AUTH_ALLOWED_EMAILS).
 */
const SOLO_OPERATOR_EMAILS = [
  "williamkeesee06@gmail.com",
  "wkeesee@northskycomm.com",
];

function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  // Always let Billy stay signed in (do not trust baked VITE allowlist alone).
  if (SOLO_OPERATOR_EMAILS.includes(normalized)) return true;
  const raw = (import.meta.env.VITE_AUTH_ALLOWED_EMAILS as string | undefined) ?? "";
  const allowed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // Empty or unknown: keep session; API will 403 if truly not allowed.
  if (allowed.length === 0) return true;
  if (allowed.includes(normalized)) return true;
  // Non-Billy email not on list — still keep session so a misconfigured
  // VITE_ var does not force-logout after a successful Firebase sign-in.
  // Server requireAuth is the real gate.
  return true;
}

interface AuthCtxValue {
  /** Operator profile used by jobs/filters/drawings (e.g. Billy Keesee). */
  username: string | null;
  /** Firebase user when signed in. */
  firebaseUser: User | null;
  /** True while we resolve the initial Firebase session. */
  authReady: boolean;
  setUsername: (s: string) => void;
  logout: () => void;
  managers: string[];
  setManagers: (m: string[]) => void;
  isManager: boolean;
}

const AuthContext = createContext<AuthCtxValue | null>(null);

export function useAuth(): AuthCtxValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [username, setUsernameRaw] = useState<string | null>(null);
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

  const applyOperatorSession = useCallback((user: User) => {
    const email = user.email;
    if (!isEmailAllowed(email)) {
      void signOutFirebase();
      setFirebaseUser(null);
      setUsernameRaw(null);
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    setFirebaseUser(user);
    // Map email to respective supervisor/manager name
    let operator = SOLO_OPERATOR_NAME;
    const emailNorm = (user.email ?? "").trim().toLowerCase();
    if (emailNorm === "rthoman@northskycomm.com") {
      operator = "Robbie Thoman";
    }
    setUsernameRaw(operator);
    try {
      localStorage.setItem(LS_KEY, operator);
    } catch {
      /* ignore */
    }
  }, []);

  // Subscribe to Firebase Auth; this is the source of truth for login.
  useEffect(() => {
    const unsub = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) {
        applyOperatorSession(user);
      } else {
        setFirebaseUser(null);
        setUsernameRaw(null);
        try {
          localStorage.removeItem(LS_KEY);
        } catch {
          /* ignore */
        }
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [applyOperatorSession]);

  // API 401 → force re-login
  useEffect(() => {
    function onAuthRequired() {
      void signOutFirebase();
      setFirebaseUser(null);
      setUsernameRaw(null);
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("nsc:auth-required", onAuthRequired);
    return () => window.removeEventListener("nsc:auth-required", onAuthRequired);
  }, []);

  // After a valid session, hydrate prefs and refresh Smartsheet for Billy.
  useEffect(() => {
    if (!username || !firebaseUser) return;
    // Always reload jobs once auth is ready (fixes race: first fetch had no token).
    window.dispatchEvent(new Event("nsc:jobs-reload"));

    hydratePrefs().catch(() => {
      /* swallow */
    });
    const isManagerOnMount = managers.some(
      (m) => m.trim().toLowerCase() === username.trim().toLowerCase()
    );
    const p = isManagerOnMount
      ? api.syncAllSupervisors(username)
      : api.syncSupervisor(username);
    p.then(() => {
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    }).catch((err) => {
      // Surface sync failures — empty map is often "sync never ran", not zero jobs.
      console.warn("[auth] Smartsheet sync on login failed:", err);
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    });
    // Only when session becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, firebaseUser?.uid]);

  // Kept for compatibility with older call sites; Firebase login is primary.
  const setUsername = useCallback((s: string) => {
    const trimmed = s.trim();
    if (!trimmed) {
      setUsernameRaw(null);
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    setUsernameRaw(trimmed);
    try {
      localStorage.setItem(LS_KEY, trimmed);
    } catch {
      /* ignore */
    }
    hydratePrefs().catch(() => {
      /* swallow */
    });
  }, []);

  const logout = useCallback(() => {
    void signOutFirebase();
    setFirebaseUser(null);
    setUsernameRaw(null);
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        username,
        firebaseUser,
        authReady,
        setUsername,
        logout,
        managers,
        setManagers,
        isManager,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
