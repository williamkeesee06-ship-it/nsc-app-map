// Hook: load / save the asbuilt document for one job.
import { useCallback, useEffect, useState } from "react";
import { type AsbuiltDoc, emptyAsbuilt } from "@nsc/types";
import { api } from "../../lib/api.js";

type LoadState = "idle" | "loading" | "ready" | "error";

export function useAsbuilt(jobId: string) {
  const [doc, setDoc] = useState<AsbuiltDoc>(emptyAsbuilt(jobId));
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError(null);
    api.getAsbuilt(jobId)
      .then((d) => { if (!cancelled) { setDoc(d); setState("ready"); } })
      .catch((e: Error) => { if (!cancelled) { setError(e.message); setState("error"); } });
    return () => { cancelled = true; };
  }, [jobId]);

  const save = useCallback(async (next: AsbuiltDoc) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.putAsbuilt(jobId, next);
      setDoc(saved);
      return saved;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [jobId]);

  return { doc, setDoc, save, state, error, saving };
}
