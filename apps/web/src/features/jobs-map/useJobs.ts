// Fetch & cache jobs list for the Jobs Map.
// Waits for Firebase Auth so requests include a Bearer token (solo lock).
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import type { Job } from "@nsc/types";
import { useAuth } from "../auth/authContext.js";

export type JobsState =
  | { state: "loading" }
  | { state: "ready"; jobs: Job[] }
  | { state: "error"; message: string };

export function useJobs(): JobsState & { reload: () => void } {
  const { authReady, firebaseUser } = useAuth();
  const [s, setS] = useState<JobsState>({ state: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!authReady) {
      setS({ state: "loading" });
      return;
    }
    if (!firebaseUser) {
      setS({ state: "ready", jobs: [] });
      return;
    }

    let cancelled = false;
    setS({ state: "loading" });
    // Small delay lets AuthProvider finish applying session + first token mint
    const t = window.setTimeout(() => {
      if (cancelled) return;
      api
        .listJobs()
        .then(({ jobs }) => {
          if (!cancelled) setS({ state: "ready", jobs });
        })
        .catch((err: Error) => {
          if (!cancelled) setS({ state: "error", message: err.message });
        });
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [nonce, authReady, firebaseUser?.uid]);

  // Global reload bus: anyone can dispatch `nsc:jobs-reload` and the hook
  // refetches from Firestore. Used after Smartsheet writes and after
  // login-time syncs to clear stale data.
  useEffect(() => {
    function onReload() {
      setNonce((n) => n + 1);
    }
    window.addEventListener("nsc:jobs-reload", onReload);
    return () => window.removeEventListener("nsc:jobs-reload", onReload);
  }, []);

  return { ...s, reload: () => setNonce((n) => n + 1) };
}
