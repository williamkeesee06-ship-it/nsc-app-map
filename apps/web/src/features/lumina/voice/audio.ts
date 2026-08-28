/**
 * Sound effects disabled per user request. All cues are no-ops.
 * Keeping the export shape so call sites remain stable.
 */
type Cue = "hover" | "select" | "confirm" | "error" | "wake";

const noop = () => {};

export const sfx = {
  hover: noop,
  select: noop,
  confirm: noop,
  error: noop,
  wake: noop,
} satisfies Record<Cue, () => void>;

export function setMuted(_v: boolean) {
  // no-op: audio is fully disabled
}
