// Cross-device preferences sync (Billy 5/25).
//
// Strategy:
//   - On first mount: fetch server prefs, merge into localStorage for any
//     missing keys, and rebroadcast a "prefs-hydrated" event so live hooks
//     can refresh their state.
//   - Every set() call writes to localStorage immediately AND queues a
//     debounced PUT back to the server (500ms).
//   - Username is read from localStorage "nsc.username" (set by AuthGate).
//
// Anything stored through this helper will automatically follow the user
// across computers as long as they sign in with the same username.

import { api } from "./api.js";

const USERNAME_KEY = "nsc.username";

function getUsername(): string {
  try {
    return localStorage.getItem(USERNAME_KEY) || "";
  } catch {
    return "";
  }
}

// One global queue of pending server writes — coalesced per key.
const pendingWrites = new Map<string, unknown>();
let flushTimer: number | null = null;
const FLUSH_MS = 500;

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(async () => {
    flushTimer = null;
    const user = getUsername();
    if (!user || pendingWrites.size === 0) {
      pendingWrites.clear();
      return;
    }
    const payload: Record<string, unknown> = {};
    pendingWrites.forEach((v, k) => { payload[k] = v; });
    pendingWrites.clear();
    try {
      await api.putPrefs(user, payload);
    } catch (err) {
      console.warn("[prefsSync] put failed, will retry on next change:", err);
      // Re-enqueue so we try again on next change
      Object.entries(payload).forEach(([k, v]) => pendingWrites.set(k, v));
    }
  }, FLUSH_MS);
}

let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

/**
 * Hydrate localStorage from server prefs. Safe to call multiple times — will
 * only fetch once per session. Server values OVERWRITE localStorage so the
 * latest device-edit wins (last-write-wins on the server).
 */
export function hydratePrefs(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrationPromise) return hydrationPromise;
  const user = getUsername();
  if (!user) {
    hydrated = true;
    return Promise.resolve();
  }
  hydrationPromise = api
    .getPrefs(user)
    .then((d) => {
      const prefs = d.prefs || {};
      Object.entries(prefs).forEach(([key, value]) => {
        if (key.startsWith("_")) return; // skip meta fields
        try {
          // Stored on server as raw value; serialise to localStorage as JSON string.
          localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
        } catch {
          /* quota / disabled — silently ignore */
        }
      });
      hydrated = true;
      window.dispatchEvent(new CustomEvent("nsc:prefs-hydrated", { detail: { keys: Object.keys(prefs) } }));
    })
    .catch((err) => {
      console.warn("[prefsSync] hydration failed (using local only):", err);
      hydrated = true;
    });
  return hydrationPromise;
}

/**
 * Queue a server write for the given key. Value is stored as-is on the server
 * (objects/arrays/numbers all OK). LocalStorage write is the caller's
 * responsibility — call this AFTER you've updated localStorage.
 */
export function queuePrefWrite(key: string, value: unknown): void {
  if (!getUsername()) return;
  pendingWrites.set(key, value);
  scheduleFlush();
}

export function isPrefsHydrated(): boolean {
  return hydrated;
}
