// Tiny shared store for the "show Lumen Central Offices" toggle.
// Lets the topbar pill and the JobsMap overlay stay in sync without a context.
import { useEffect, useState } from "react";

const LS_KEY = "nsc.showCOs";
const EVT = "nsc:showCOs-changed";

function read(): boolean {
  try { return localStorage.getItem(LS_KEY) === "1"; } catch { return false; }
}

export function setShowCOs(v: boolean): void {
  try { localStorage.setItem(LS_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVT, { detail: v }));
}

export function useShowCOs(): boolean {
  const [v, setV] = useState<boolean>(read);
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setV(typeof detail === "boolean" ? detail : read());
    };
    window.addEventListener(EVT, onChange as EventListener);
    return () => window.removeEventListener(EVT, onChange as EventListener);
  }, []);
  return v;
}
