// Telecom point icon generators — Phase 4 redesign.
// All icons render BLACK (#000000) by default on 32×32 viewBox.
// The stroke color modifier overrides this if the user picks a color.
// Icons support a `size` multiplier (0.5–2.0); default 1.0.
// For the left-rail tile preview, pass `forRail: true` to get inline SVG strings.

export const ICON_SIZE = 32; // px, square bounding box
export const DEFAULT_ICON_COLOR = "#000000";

// ── helpers ──────────────────────────────────────────────────────────────────

function svgUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function wrap(inner: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${inner}
  </g>
</svg>`;
}

// ── Icon SVG bodies (32×32) ───────────────────────────────────────────────────

// MH — circle outline, "MH" text centered
function mhSvg(color: string): string {
  return wrap(
    `<circle cx="16" cy="16" r="12"/>
    <text x="16" y="20" text-anchor="middle" font-size="9" font-weight="bold"
      fill="${color}" stroke="none" font-family="system-ui, sans-serif">MH</text>`,
    color
  );
}

// HH — rectangle outline, "HH" text centered
function hhSvg(color: string): string {
  return wrap(
    `<rect x="4" y="8" width="24" height="16" rx="2"/>
    <text x="16" y="20" text-anchor="middle" font-size="9" font-weight="bold"
      fill="${color}" stroke="none" font-family="system-ui, sans-serif">HH</text>`,
    color
  );
}

// PED — square outline with X inside (cross rotated 45°)
function pedSvg(color: string): string {
  return wrap(
    `<rect x="6" y="6" width="20" height="20" rx="2"/>
    <g transform="rotate(45 16 16)">
      <line x1="16" y1="8" x2="16" y2="24"/>
      <line x1="8" y1="16" x2="24" y2="16"/>
    </g>`,
    color
  );
}

// POLE — circle outline with X inside (cross rotated 45°)
function poleSvg(color: string): string {
  return wrap(
    `<circle cx="16" cy="16" r="12"/>
    <g transform="rotate(45 16 16)">
      <line x1="16" y1="4" x2="16" y2="28"/>
      <line x1="4" y1="16" x2="28" y2="16"/>
    </g>`,
    color
  );
}

// CABINET — rectangle outline with X inside (cross rotated 45°)
function cabinetSvg(color: string): string {
  return wrap(
    `<rect x="3" y="8" width="26" height="16" rx="2"/>
    <g transform="rotate(45 16 16)">
      <line x1="16" y1="10" x2="16" y2="22"/>
      <line x1="5" y1="16" x2="27" y2="16"/>
    </g>`,
    color
  );
}

// ANCHOR — classic anchor glyph: ring + T-bar + curved hooks
function anchorSvg(color: string): string {
  return wrap(
    `<!-- ring at top -->
    <circle cx="16" cy="7" r="3"/>
    <!-- vertical shaft -->
    <line x1="16" y1="10" x2="16" y2="26"/>
    <!-- T-bar -->
    <line x1="8" y1="14" x2="24" y2="14"/>
    <!-- left hook -->
    <path d="M8 14 Q4 20 8 25"/>
    <!-- right hook -->
    <path d="M24 14 Q28 20 24 25"/>
    <!-- hook tips -->
    <line x1="8" y1="25" x2="12" y2="25"/>
    <line x1="24" y1="25" x2="20" y2="25"/>`,
    color
  );
}

// ── Rail SVG strings (for React inline rendering) ────────────────────────────

// Returns raw SVG string for use in rail tiles (not data-URI)
export function railSvgForTool(tool: string, color?: string): string {
  const c = color ?? DEFAULT_ICON_COLOR;
  if (tool.startsWith("mh")) return mhSvg(c);
  if (tool.startsWith("hh")) return hhSvg(c);
  if (tool.startsWith("ped")) return pedSvg(c);
  if (tool.startsWith("pole")) return poleSvg(c);
  if (tool.startsWith("cabinet")) return cabinetSvg(c);
  if (tool.startsWith("anchor")) return anchorSvg(c);
  return mhSvg(c); // fallback
}

// ── Map icon generator ────────────────────────────────────────────────────────

export function iconForTool(
  tool: string,
  overrideColor?: string,
  pointSize = 1.0
): { url: string; size: google.maps.Size; anchor: google.maps.Point } {
  const color = overrideColor ?? DEFAULT_ICON_COLOR;
  const px = Math.round(ICON_SIZE * pointSize);

  let svg: string;
  if (tool.startsWith("mh")) svg = mhSvg(color);
  else if (tool.startsWith("hh")) svg = hhSvg(color);
  else if (tool.startsWith("ped")) svg = pedSvg(color);
  else if (tool.startsWith("pole")) svg = poleSvg(color);
  else if (tool.startsWith("cabinet")) svg = cabinetSvg(color);
  else if (tool.startsWith("anchor")) svg = anchorSvg(color);
  else svg = pedSvg(color); // fallback

  return {
    url: svgUri(svg),
    size: new google.maps.Size(px, px),
    anchor: new google.maps.Point(px / 2, px / 2),
  };
}

// Legacy color exports (kept for compat with drawingContext defaults)
export const NEW_COLOR = "#000000"; // Phase 4: black
export const REM_COLOR = "#000000"; // Phase 4: black (cable colors are hardcoded in DrawingOverlay)
