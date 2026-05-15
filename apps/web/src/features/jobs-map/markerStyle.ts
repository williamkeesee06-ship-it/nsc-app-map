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

export function colorForSecondaryStatus(
  secondaryJobStatus: string | null | undefined
): MarkerColor {
  return MARKER_COLORS[colorKeyForSecondaryStatus(secondaryJobStatus)];
}

// Build a neon "map pin" SVG matching the user's reference screenshots.
// Returns a data URL suitable for google.maps.Marker icon.url.
//
// Design:
//  - Outline-only pin (no fill) with a thick stroke in `core` and a softer
//    blurred halo in `glow`.
//  - Concentric inner circles for that "neon ring" look.
//  - Tiny ground-ellipse under the pin for the projected-glow feel.
//
// Size: 64×88 viewBox, anchored so the pin tip sits at the marker position.
export function neonPinDataUrl(color: MarkerColor, opacity = 1): string {
  const { core, glow } = color;
  // Use a tiny stable id so multiple defs don't collide if browsers ever
  // batch-render these inline. Data URLs are isolated anyway, but harmless.
  const id = color.key;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 88" width="64" height="88">
  <defs>
    <filter id="g-${id}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <g opacity="${opacity}" filter="url(#g-${id})">
    <!-- Soft outer halo (drawn first, underneath) -->
    <path d="M32 6
             C 17 6, 8 17, 8 30
             C 8 44, 24 60, 32 74
             C 40 60, 56 44, 56 30
             C 56 17, 47 6, 32 6 Z"
          fill="none"
          stroke="${glow}"
          stroke-opacity="0.55"
          stroke-width="7"
          stroke-linejoin="round"/>
    <!-- Bright neon body -->
    <path d="M32 6
             C 17 6, 8 17, 8 30
             C 8 44, 24 60, 32 74
             C 40 60, 56 44, 56 30
             C 56 17, 47 6, 32 6 Z"
          fill="none"
          stroke="${core}"
          stroke-width="3"
          stroke-linejoin="round"/>
    <!-- Outer ring -->
    <circle cx="32" cy="30" r="10"
            fill="none" stroke="${core}" stroke-width="2.5"/>
    <!-- Inner ring -->
    <circle cx="32" cy="30" r="5"
            fill="none" stroke="${core}" stroke-width="2"/>
    <!-- Ground ellipse -->
    <ellipse cx="32" cy="80" rx="12" ry="2.5"
             fill="none" stroke="${core}" stroke-opacity="0.8" stroke-width="1.5"/>
  </g>
</svg>`.trim();
  // encodeURIComponent so '#' in colors is safe inside a data URL.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
