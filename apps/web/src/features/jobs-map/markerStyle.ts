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
  red:    { key: "red",    label: "On Hold",             core: "#ff2d4a", glow: "#ff3355" },
  green:  { key: "green",  label: "Scheduled",           core: "#00C853", glow: "#00A040" },
  yellow: { key: "yellow", label: "Fielded RTS / RTS",   core: "#ffe338", glow: "#e0c022" },
  blue:   { key: "blue",   label: "In Progress",         core: "#3aa7ff", glow: "#1f7ad6" },
  purple: { key: "purple", label: "Needs Fielding",      core: "#c44dff", glow: "#9b2bd1" },
  orange: { key: "orange", label: "Pending",             core: "#ff8a1f", glow: "#e06a00" },
  silver: { key: "silver", label: "Completed",           core: "#A7F3A0", glow: "#86EFAC" },
  gray:   { key: "gray",   label: "Other / Unset",       core: "#9aa3ad", glow: "#5a6168" },
};

// All raw Secondary-Job-Status strings observed in the live sheet are grouped
// into one of the buckets above. The match is case-insensitive on the trimmed
// value. Anything not listed here falls into "gray".
const STATUS_TO_COLOR: Array<{ test: (s: string) => boolean; key: MarkerColorKey }> = [
  // RED — On Hold (only)
  { test: (s) => s === "on hold", key: "red" },

  // ORANGE — Pending bucket (includes pending permit / pending engineering /
  // plain pending). These used to be RED; Billy 5/20: pending = orange.
  { test: (s) => s === "pending", key: "orange" },
  { test: (s) => s === "pending permit", key: "orange" },
  { test: (s) => s === "pending engineering", key: "orange" },

  // PURPLE — Needs Fielding (Billy 5/20: needs fielding = purple)
  { test: (s) => s === "needs fielding", key: "purple" },

  // YELLOW — fielded rts / rts (covers "FIELDED - RTS" and bare "RTS")
  { test: (s) => s === "rts" || (s.includes("fielded") && s.includes("rts")), key: "yellow" },

  // BLUE — In Progress bucket members (scheduled, routed to sub,
  // pending splicing, pending HSR). Billy 5/20: pending splicing should
  // match In Progress, not stand alone as purple.
  { test: (s) => s === "scheduled", key: "blue" },
  { test: (s) => s === "routed to sub", key: "blue" },
  { test: (s) => s === "pending splicing", key: "blue" },
  { test: (s) => s === "pending hsr", key: "blue" },
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

// ── Phase 9: Status bucket regrouping ────────────────────────────────────────
// The Smartsheet has many raw status strings; we collapse to 6 user-facing buckets.

export type StatusBucket =
  | "needs_fielding"
  | "rts"
  | "on_hold"
  | "pending"
  | "in_progress"
  | "completed";

export interface StatusBucketDef {
  key: StatusBucket;
  label: string;
  colorKey: MarkerColorKey;
}

export const STATUS_BUCKETS: StatusBucketDef[] = [
  { key: "needs_fielding", label: "Needs Fielding", colorKey: "purple" },
  { key: "rts",            label: "RTS",            colorKey: "yellow" },
  { key: "on_hold",        label: "On Hold",        colorKey: "red" },
  { key: "pending",        label: "Pending",        colorKey: "orange" },
  { key: "in_progress",    label: "In Progress",    colorKey: "blue" },
  { key: "completed",      label: "Completed",      colorKey: "silver" },
];

export function bucketForJob(job: {
  jobStatus?: string | null;
  secondaryJobStatus?: string | null;
}): StatusBucket {
  if (isJobCompleted(job)) return "completed";
  const s = (job.secondaryJobStatus || "").trim().toLowerCase();
  if (!s) return "pending";
  if (s === "needs fielding") return "needs_fielding";
  if (s === "rts" || (s.includes("fielded") && s.includes("rts"))) return "rts";
  if (s === "on hold") return "on_hold";
  if (
    s === "scheduled" ||
    s === "routed to sub" ||
    s === "pending splicing" ||
    s === "pending hsr"
  )
    return "in_progress";
  if (
    s === "pending" ||
    s === "pending permit" ||
    s === "pending engineering"
  )
    return "pending";
  return "pending";
}

export function bucketLabel(b: StatusBucket): string {
  return STATUS_BUCKETS.find((x) => x.key === b)?.label ?? b;
}

export function bucketColorKey(b: StatusBucket): MarkerColorKey {
  return STATUS_BUCKETS.find((x) => x.key === b)?.colorKey ?? "gray";
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
