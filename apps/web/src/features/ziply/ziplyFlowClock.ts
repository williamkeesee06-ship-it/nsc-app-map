/**
 * Shared RAF clock for Ziply fiber flow icons + hub beacon.
 * One rAF loop for the whole map instead of N independent loops (scalability).
 */

type Tick = (phase01to100: number) => void;

const subs = new Set<Tick>();
let rafId = 0;
let phase = 0;
/** Hard cap concurrent animated consumers (lines + beacon). */
const MAX_SUBS = 14;

function loop() {
  phase = (phase + 1.25) % 100;
  for (const fn of subs) fn(phase);
  if (subs.size > 0) {
    rafId = window.requestAnimationFrame(loop);
  } else {
    rafId = 0;
  }
}

/** Subscribe to shared flow phase (0–100). Returns unsubscribe. */
export function subscribeFlowTick(fn: Tick): () => void {
  if (subs.size >= MAX_SUBS) {
    // Still call once so consumer has a static offset; don't animate
    fn(0);
    return () => undefined;
  }
  subs.add(fn);
  if (!rafId) rafId = window.requestAnimationFrame(loop);
  return () => {
    subs.delete(fn);
    if (subs.size === 0 && rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}
