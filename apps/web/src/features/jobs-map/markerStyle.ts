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
  | "completed_green"   // Completed jobs (neon green w/ opacity applied at render)
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
  completed_green: { key: "completed_green", label: "Completed", core: "#39ff14", glow: "#22cc0a" },
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

  // YELLOW — fielded rts / rts / fielded needs coordination
  // Covers "FIELDED - RTS", bare "RTS", and "FIELDED - NEEDS COORDINATION".
  {
    test: (s) =>
      s === "rts" ||
      (s.includes("fielded") && s.includes("rts")) ||
      (s.includes("fielded") && s.includes("coordination")),
    key: "yellow",
  },

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
  const s = String(secondaryJobStatus).trim().toLowerCase();
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
  const p = String(job?.jobStatus ?? "").trim().toLowerCase();
  if (p === "complete" || p === "completed") return true;
  const s = String(job?.secondaryJobStatus ?? "").trim().toLowerCase();
  return s.startsWith("complete");
}

// Resolve the marker color for a job, honoring the Completed override.
//
// Ziply contract (Phase 10): color the pin by its Job Status bucket so the map
// visually matches the 7 dashboard gauges — Commitment=purple, In Progress=blue,
// RTS=yellow, Ready Soon=orange, Resto=green, Gigs=completed_green, On Hold=red.
// Lumen contract: keep the legacy secondaryJobStatus → color mapping.
export function colorKeyForJob(
  job: {
    jobStatus?: string | null;
    secondaryJobStatus?: string | null;
  },
  contract?: string
): MarkerColorKey {
  if (contract === "Ziply") {
    return bucketColorKey(bucketForJob(job));
  }
  if (isJobCompleted(job)) return "completed_green";
  return colorKeyForSecondaryStatus(job.secondaryJobStatus);
}

export function colorForSecondaryStatus(
  secondaryJobStatus: string | null | undefined
): MarkerColor {
  return MARKER_COLORS[colorKeyForSecondaryStatus(secondaryJobStatus)];
}

// ── Phase 9: Status bucket regrouping ────────────────────────────────────────
// The Smartsheet has many raw status strings; we collapse to 6 user-facing buckets.

// Ziply Job Status buckets (Phase 10 rewrite). Ziply's raw Job Status column
// uses numbered prefixes like "01_In Progress - Commitiment", "05_Ready for
// Construction", etc. We collapse those into 7 user-facing buckets. The
// legacy Lumen-era buckets (needs_fielding, pending, completed) are kept as
// type aliases so older code compiles while it's migrated over.
export type StatusBucket =
  | "commitment"
  | "in_progress"
  | "rts"
  | "ready_soon"
  | "resto"
  | "gigs"
  | "on_hold"
  // Legacy Lumen buckets — kept for backwards compatibility, mapped in
  // bucketForJob() below but no longer surfaced in the dashboard.
  | "needs_fielding"
  | "pending"
  | "completed";

export interface StatusBucketDef {
  key: StatusBucket;
  label: string;
  colorKey: MarkerColorKey;
}

// The seven buckets shown in the dashboard's top status bar (Ziply, Phase 10).
// Order left-to-right is the logical pipeline: pre-build → building →
// finishing → on-hold. Colors intentionally reuse the existing marker palette
// so the map/legend/dashboard all agree.
export const STATUS_BUCKETS: StatusBucketDef[] = [
  { key: "commitment",  label: "Commitment",  colorKey: "purple" },
  { key: "in_progress", label: "In Progress", colorKey: "blue" },
  { key: "rts",         label: "RTS",         colorKey: "yellow" },
  { key: "ready_soon",  label: "Ready Soon",  colorKey: "orange" },
  { key: "resto",       label: "Resto",       colorKey: "green" },
  { key: "gigs",        label: "Gigs",        colorKey: "completed_green" },
  { key: "on_hold",     label: "On Hold",     colorKey: "red" },
];

// Map a job to one of the 7 Ziply buckets. Uses the Job Status column's
// numeric prefix ("01_..." … "15_...") first because that's what Ziply's
// tracker actually ships — falls back to the legacy secondaryJobStatus
// matching so any non-Ziply Lumen rows still bucket sensibly.
export function bucketForJob(job: {
  jobStatus?: string | null;
  secondaryJobStatus?: string | null;
}): StatusBucket {
  const raw = String(job?.jobStatus ?? "").trim();
  const lower = raw.toLowerCase();

  // --- Ziply numbered prefixes -------------------------------------------
  // "01_In Progress - Commitiment" (note: Smartsheet has this misspelled;
  // we match the prefix, so the typo doesn't matter).
  if (lower.startsWith("01") || lower.includes("commit")) return "commitment";
  if (lower.startsWith("04") && lower.includes("in progress")) return "in_progress";
  if (lower.startsWith("05") || lower.includes("ready for construction")) return "rts";
  if (lower.startsWith("06") || lower.includes("ready soon")) return "ready_soon";
  if (lower.startsWith("07") || lower.includes("pending resto")) return "resto";
  if (lower.startsWith("08") || lower.includes("pending gigs")) return "gigs";
  // 09 Complete — finished work, surfaces in Gigs alongside other done work.
  if (lower.startsWith("09") || lower.includes("ready for billing") || lower.includes("complete"))
    return "gigs";
  // 10 On Hold + 11 Pending Permit + 12 Awarded to Others + 15 Pending Approval
  // are all forms of "not buildable right now" — Billy 8/6: if it's pending
  // permit or awaiting approval, treat it as on hold. Red pin, on-hold bucket.
  if (
    lower.startsWith("10") ||
    lower.startsWith("11") ||
    lower.startsWith("12") ||
    lower.startsWith("15") ||
    lower.includes("on hold") ||
    lower.includes("pending permit") ||
    lower.includes("pending approval") ||
    lower.includes("awarded to others") ||
    lower.includes("cancel")
  ) {
    return "on_hold";
  }

  // --- Legacy Lumen fallback --------------------------------------------
  // Only runs for jobs whose jobStatus didn't match any numbered Ziply prefix
  // above. Ziply rows with a numbered status prefix never reach this branch,
  // so unknown Ziply statuses fall through to the safest default: on_hold
  // rather than ready_soon (Billy 8/6: don't silently dump unknowns into
  // "ready to build" — mark them as needing attention).
  if (isJobCompleted(job)) return "gigs"; // completed Lumen jobs surface in Gigs
  const s = String(job?.secondaryJobStatus ?? "").trim().toLowerCase();
  // If this looks like a Ziply row (has a numbered jobStatus) with no
  // secondaryJobStatus, we already tried and failed to bucket it above —
  // don't pretend it's Ready Soon. Send it to on_hold so it surfaces as
  // needing attention instead of inflating the build queue.
  if (!s && /^\d/.test(raw)) return "on_hold";
  if (!s) return "ready_soon";
  if (s === "needs fielding") return "commitment";
  if (
    s === "rts" ||
    (s.includes("fielded") && s.includes("rts")) ||
    (s.includes("fielded") && s.includes("coordination"))
  )
    return "rts";
  if (s === "on hold") return "on_hold";
  if (
    s === "scheduled" ||
    s === "routed to sub" ||
    s === "pending splicing" ||
    s === "pending hsr"
  )
    return "in_progress";
  return "ready_soon";
}

export function bucketLabel(b: StatusBucket): string {
  return STATUS_BUCKETS.find((x) => x.key === b)?.label ?? b;
}

export function bucketColorKey(b: StatusBucket): MarkerColorKey {
  return STATUS_BUCKETS.find((x) => x.key === b)?.colorKey ?? "gray";
}

const pinCache = new Map<string, string>();

// Build a high-precision GIS Vector Pin SVG
// Design: Crisp metallic bevels, high-contrast core, reticle base, drop-shadow halo.
export function precisionPinDataUrl(
  color: MarkerColor,
  opacity = 1,
  isSelected = false,
  isManualOverride = false
): string {
  const roundedOpacity = Math.round(opacity * 100) / 100;
  const cacheKey = `${color.key}_${roundedOpacity}_${isSelected ? 1 : 0}_${isManualOverride ? 1 : 0}`;
  const cached = pinCache.get(cacheKey);
  if (cached) return cached;

  const { core, glow } = color;
  const id = color.key;
  const strokeWidth = isSelected ? "2.5" : "2";
  const overrideDot = isManualOverride
    ? `<circle cx="20" cy="8" r="3" fill="#ffcc00" stroke="#000" stroke-width="1"/>`
    : "";

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 56" width="40" height="56">
  <defs>
    <filter id="p-glow-${id}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur"/>
      <feFlood flood-color="${glow}" flood-opacity="0.8"/>
      <feComposite in2="blur" operator="in" result="glow1"/>
      <feMerge>
        <feMergeNode in="glow1"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="p-core-grad-${id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="${core}"/>
      <stop offset="100%" stop-color="${glow}"/>
    </linearGradient>
  </defs>
  <g opacity="${roundedOpacity}" filter="url(#p-glow-${id})">
    <!-- Ground target reticle -->
    <ellipse cx="20" cy="51" rx="9" ry="2.5" fill="none" stroke="${core}" stroke-opacity="0.4" stroke-width="1.2" stroke-dasharray="2 2"/>
    <ellipse cx="20" cy="51" rx="4.5" ry="1.2" fill="${core}" fill-opacity="0.6"/>

    <!-- Pin stem & needle -->
    <path d="M20 50 L14 26 C14 26 8 22 8 16 C8 9.37 13.37 4 20 4 C26.63 4 32 9.37 32 16 C32 22 26 26 26 26 Z"
          fill="#0c121e" stroke="url(#p-core-grad-${id})" stroke-width="${strokeWidth}" stroke-linejoin="round"/>

    <!-- Inner bezel ring -->
    <circle cx="20" cy="16" r="6.5" fill="none" stroke="${core}" stroke-width="1.5" stroke-opacity="0.9"/>

    <!-- Center horology jewel / core -->
    <circle cx="20" cy="16" r="3" fill="url(#p-core-grad-${id})"/>
    <circle cx="19" cy="15" r="1" fill="#ffffff" opacity="0.9"/>
    
    ${overrideDot}
  </g>
</svg>`.trim();
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  pinCache.set(cacheKey, url);
  return url;
}

// Backward-compatible alias for existing callers
export function neonPinDataUrl(color: MarkerColor, opacity = 1): string {
  return precisionPinDataUrl(color, opacity);
}

// Dynamic WO label badge — calculates exact SVG width to guarantee NO text cutoffs
export function precisionWoLabelDataUrl(
  text: string,
  color: string,
  isSelected = false
): { url: string; width: number; height: number } {
  const cleanText = (text || "").trim();
  // Compute width dynamically based on char count: ~7.5px per char + 22px padding
  const width = Math.max(56, Math.ceil(cleanText.length * 7.5 + 22));
  const height = 24;
  const borderColor = isSelected ? "#ffffff" : color;
  const borderWidth = isSelected ? 2 : 1.5;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="wo-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.75"/>
    </filter>
  </defs>
  <g filter="url(#wo-shadow)">
    <!-- Dark glass pill body with crisp status-coded border -->
    <rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="10.5" ry="10.5"
          fill="rgba(10, 16, 26, 0.95)" stroke="${borderColor}" stroke-width="${borderWidth}"/>
    <!-- Micro center jewel indicator -->
    <circle cx="9" cy="${height / 2}" r="2.5" fill="${color}"/>
    <!-- Crisp typography with zero clipping -->
    <text x="${(width + 8) / 2}" y="${height / 2 + 3.5}" text-anchor="middle"
          fill="#f1f5f9" font-size="10.5" font-weight="700"
          font-family="JetBrains Mono, SFMono-Regular, Consolas, monospace"
          letter-spacing="0.04em">${cleanText}</text>
  </g>
</svg>`;

  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
  };
}

// Dynamic Hub badge (e.g. H2006, H2007, H2010) — dynamic width, emerald luminescence, no clipping
export function precisionHubBadgeDataUrl(
  hubName: string,
  subLabel?: string
): { url: string; width: number; height: number } {
  const cleanHub = (hubName || "HUB").trim().toUpperCase();
  const width = Math.max(68, Math.ceil(cleanHub.length * 8.5 + 24));
  const height = 26;
  const emeraldCore = "#00ffaa";
  const emeraldGlow = "rgba(0, 255, 170, 0.35)";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="hub-glow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.85"/>
    </filter>
  </defs>
  <g filter="url(#hub-glow)">
    <!-- Chamfered precision tech badge -->
    <rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="6" ry="6"
          fill="#081018" stroke="${emeraldCore}" stroke-width="1.8"/>
    <rect x="3.5" y="3.5" width="${width - 7}" height="${height - 7}" rx="4" ry="4"
          fill="${emeraldGlow}" opacity="0.2"/>
    <!-- Tech diamond marker -->
    <polygon points="9,${height / 2 - 3.5} 12.5,${height / 2} 9,${height / 2 + 3.5} 5.5,${height / 2}" fill="${emeraldCore}"/>
    <!-- Hub text -->
    <text x="${(width + 10) / 2}" y="${height / 2 + 4}" text-anchor="middle"
          fill="${emeraldCore}" font-size="11" font-weight="800"
          font-family="JetBrains Mono, SFMono-Regular, Consolas, monospace"
          letter-spacing="0.06em">${cleanHub}</text>
  </g>
</svg>`;

  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
  };
}
