// Fetch & cache jobs list for the Jobs Map.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import type { Job } from "@nsc/types";

export type JobsState =
  | { state: "loading" }
  | { state: "ready"; jobs: Job[] }
  | { state: "error"; message: string };

export function useJobs(): JobsState & { reload: () => void } {
  const [s, setS] = useState<JobsState>({ state: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setS({ state: "loading" });
    api
      .listJobs()
      .then(({ jobs }) => {
        if (!cancelled) setS({ state: "ready", jobs });
      })
      .catch((err: Error) => {
        if (!cancelled) setS({ state: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);
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
