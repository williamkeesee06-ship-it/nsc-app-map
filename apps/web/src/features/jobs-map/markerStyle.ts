// Marker color palette + neon-pin SVG generator.
// Source of truth for the Secondary-Job-Status → color mapping used by:
//   - the Google Maps markers in JobsMap.tsx
//   - the legend/filter UI in FilterRail.tsx
//
// Matching is case-insensitive on the trimmed string.

export type MarkerColorKey =
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "purple"
  | "orange"
  | "silver"   // Completed jobs
  | "gray";

export interface MarkerColor {
  key: MarkerColorKey;
  label: string;
  // Bright core color (line + fill of the inner ring).
  core: string;
  // Outer glow color (same hue, slightly darker / used in dropshadow).
  glow: string;
}

export const MARKER_COLORS: Record<MarkerColorKey, MarkerColor> = {
  red:    { key: "red",    label: "On Hold / Pending Permit / Pending Engineering", core: "#ff2d4a", glow: "#ff3355" },
  green:  { key: "green",  label: "Scheduled",          core: "#39ff7a", glow: "#22cc55" },
  yellow: { key: "yellow", label: "Fielded RTS / RTS",  core: "#ffe338", glow: "#e0c022" },
  blue:   { key: "blue",   label: "Routed to Sub",      core: "#3aa7ff", glow: "#1f7ad6" },
  purple: { key: "purple", label: "Pending Splicing",   core: "#c44dff", glow: "#9b2bd1" },
  orange: { key: "orange", label: "Needs Fielding",     core: "#ff8a1f", glow: "#e06a00" },
  silver: { key: "silver", label: "Completed",          core: "#f4f8ff", glow: "#aab8c8" },
  gray:   { key: "gray",   label: "Other / Unset",      core: "#9aa3ad", glow: "#5a6168" },
};

// All raw Secondary-Job-Status strings observed in the live sheet are grouped
// into one of the buckets above. The match is case-insensitive on the trimmed
// value. Anything not listed here falls into "gray".
const STATUS_TO_COLOR: Array<{ test: (s: string) => boolean; key: MarkerColorKey }> = [
  // RED — on hold / pending permit / pending engineering
  { test: (s) => s === "on hold", key: "red" },
  { test: (s) => s === "pending permit", key: "red" },
  { test: (s) => s === "pending engineering", key: "red" },

  // GREEN — scheduled
  { test: (s) => s === "scheduled", key: "green" },

  // YELLOW — fielded rts / rts (covers "FIELDED - RTS" and bare "RTS")
  { test: (s) => s === "rts" || s.includes("fielded") && s.includes("rts"), key: "yellow" },

  // BLUE — routed to sub
  { test: (s) => s === "routed to sub", key: "blue" },

  // PURPLE — pending splicing
  { test: (s) => s === "pending splicing", key: "purple" },

  // ORANGE — needs fielding
  { test: (s) => s === "needs fielding", key: "orange" },
];

export function colorKeyForSecondaryStatus(
  secondaryJobStatus: string | null | undefined
): MarkerColorKey {
  if (!secondaryJobStatus) return "gray";
  const s = secondaryJobStatus.trim().toLowerCase();
  for (const rule of STATUS_TO_COLOR) {
    if (rule.test(s)) return rule.key;
  }
  return "gray";
}

// Completion detector — a job is "Completed" when EITHER:
//   - jobStatus = "Complete" (the Smartsheet primary column), OR
//   - secondaryJobStatus starts with "complete" (covers "Complete",
//     "Complete/Pending Prod", and any future variants).
export function isJobCompleted(job: {
  jobStatus?: string | null;
  secondaryJobStatus?: string | null;
}): boolean {
  const p = (job.jobStatus || "").trim().toLowerCase();
  if (p === "complete" || p === "completed") return true;
  const s = (job.secondaryJobStatus || "").trim().toLowerCase();
  return s.startsWith("complete");
}

// Resolve the marker color for a job, honoring the Completed override.
export function colorKeyForJob(job: {
  jobStatus?: string | null;
  secondaryJobStatus?: string | null;
}): MarkerColorKey {
  if (isJobCompleted(job)) return "silver";
  return colorKeyForSecondaryStatus(job.secondaryJobStatus);
}

export function colorForSecondaryStatus(
  secondaryJobStatus: string | null | undefined
): MarkerColor {
  return MARKER_COLORS[colorKeyForSecondaryStatus(secondaryJobStatus)];
}

// Build a neon "map pin" SVG — Phase 4: smaller (40×55 → 26×36 rendered).
// Design retained: outline-only neon pin with inner rings.
// Size: 40×55 viewBox, rendered at ~26px wide (roughly 60% of old 40px).
export function neonPinDataUrl(color: MarkerColor, opacity = 1): string {
  const { core, glow } = color;
  const id = color.key;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 55" width="40" height="55">
  <defs>
    <filter id="g-${id}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.5" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <g opacity="${opacity}" filter="url(#g-${id})">
    <!-- Soft outer halo -->
    <path d="M20 4 C10 4,4 11,4 19 C4 28,15 38,20 46 C25 38,36 28,36 19 C36 11,30 4,20 4 Z"
          fill="none" stroke="${glow}" stroke-opacity="0.55" stroke-width="5" stroke-linejoin="round"/>
    <!-- Bright neon body -->
    <path d="M20 4 C10 4,4 11,4 19 C4 28,15 38,20 46 C25 38,36 28,36 19 C36 11,30 4,20 4 Z"
          fill="none" stroke="${core}" stroke-width="2.5" stroke-linejoin="round"/>
    <!-- Outer ring -->
    <circle cx="20" cy="19" r="6" fill="none" stroke="${core}" stroke-width="2"/>
    <!-- Inner dot -->
    <circle cx="20" cy="19" r="2.5" fill="${core}" stroke="none"/>
    <!-- Ground ellipse -->
    <ellipse cx="20" cy="51" rx="7" ry="1.8"
             fill="none" stroke="${core}" stroke-opacity="0.7" stroke-width="1.2"/>
  </g>
</svg>`.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
