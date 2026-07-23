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
  <g stroke="${color}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${inner}
  </g>
</svg>`;
}

// ── Icon SVG bodies (32×32) ───────────────────────────────────────────────────

// MH — circle outline, "MH" text centered
function mhSvg(color: string): string {
  return wrap(
    `<circle cx="16" cy="16" r="12" fill="#ffffff"/>
    <text x="16" y="20" text-anchor="middle" font-size="9" font-weight="bold"
      fill="${color}" stroke="none" font-family="system-ui, sans-serif">MH</text>`,
    color
  );
}

// HH — rectangle outline, "HH" text centered
function hhSvg(color: string, status?: string): string {
  const isPlanned = status === "planned";
  const isFilled = status === "placed" || status === "Complete";
  const fillVal = isFilled ? color : (isPlanned ? "none" : "#ffffff");
  const strokeOpacity = isPlanned ? "0.5" : "1.0";
  const textFill = isFilled ? "#ffffff" : color;

  return wrap(
    `<rect x="4" y="8" width="24" height="16" rx="2" fill="${fillVal}" stroke-opacity="${strokeOpacity}"/>
    <text x="16" y="20" text-anchor="middle" font-size="9" font-weight="bold"
      fill="${textFill}" stroke="none" font-family="system-ui, sans-serif" fill-opacity="${strokeOpacity}">HH</text>`,
    color
  );
}

// PED — square outline with cross inside
function pedSvg(color: string, status?: string): string {
  const isPlanned = status === "planned";
  const isFilled = status === "placed" || status === "Complete";
  const fillVal = isFilled ? color : (isPlanned ? "none" : "#ffffff");
  const strokeOpacity = isPlanned ? "0.5" : "1.0";
  const innerLineColor = isFilled ? "#ffffff" : color;

  return wrap(
    `<rect x="6" y="6" width="20" height="20" rx="2" fill="${fillVal}" stroke-opacity="${strokeOpacity}"/>
    <line x1="16" y1="8" x2="16" y2="24" stroke="${innerLineColor}" stroke-opacity="${strokeOpacity}"/>
    <line x1="8" y1="16" x2="24" y2="16" stroke="${innerLineColor}" stroke-opacity="${strokeOpacity}"/>`,
    color
  );
}

// POLE — black circle outline with X and cross inside, white backing fill for max visibility
function poleSvg(color: string = "#000000"): string {
  return wrap(
    `<circle cx="16" cy="16" r="11" fill="#ffffff" />
    <line x1="8.2" y1="8.2" x2="23.8" y2="23.8"/>
    <line x1="8.2" y1="23.8" x2="23.8" y2="8.2"/>`,
    color
  );
}

// CABINET — rectangle outline with cross inside
function cabinetSvg(color: string): string {
  return wrap(
    `<rect x="3" y="8" width="26" height="16" rx="2"/>
    <line x1="16" y1="10" x2="16" y2="22"/>
    <line x1="5" y1="16" x2="27" y2="16"/>`,
    color
  );
}

// SPLICE — diamond outline with "SP" text centered (Edit 3)
function spliceSvg(color: string): string {
  return wrap(
    `<polygon points="16,4 28,16 16,28 4,16"/>
    <text x="16" y="20" text-anchor="middle" font-size="9" font-weight="bold"
      fill="${color}" stroke="none" font-family="system-ui, sans-serif">SP</text>`,
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

// Ziply specific point icons
function ziplyHubSvg(color: string): string {
  return wrap(
    `<rect x="12" y="21" width="8" height="4" fill="${color}"/>
    <rect x="13.5" y="17" width="5" height="4" fill="${color}"/>
    <line x1="16" y1="17" x2="16" y2="10" stroke="${color}" stroke-width="1.8"/>
    <circle cx="16" cy="9.5" r="2" fill="${color}"/>
    
    <path d="M 16 17 L 16 14 L 12 14 L 12 12" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="12" cy="11.5" r="2" fill="${color}"/>
    
    <path d="M 16 17 L 16 14 L 20 14 L 20 12" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="20" cy="11.5" r="2" fill="${color}"/>
    
    <path d="M 16 19 L 9 19 L 9 16" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="9" cy="15.5" r="2" fill="${color}"/>
    
    <path d="M 16 19 L 23 19 L 23 16" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="23" cy="15.5" r="2" fill="${color}"/>
    
    <path d="M 12 25 A 11 11 0 1 1 20 25" fill="none" stroke="${color}" stroke-width="1.8"/>`,
    color
  );
}

function ziplyTerminalSvg(color: string): string {
  return wrap(
    `<polygon points="8,10 24,16 8,22" fill="#f8fafc" stroke="${color}" stroke-width="2"/>
    <circle cx="12" cy="16" r="2.5" fill="${color}"/>`,
    color
  );
}

function ziplyAddressSvg(color: string): string {
  return wrap(
    `<polygon points="16,6 6,15 6,26 26,26 26,15" fill="#f8fafc" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="13" y="17" width="6" height="9" fill="${color}"/>`,
    color
  );
}

function ziplyHandholeSvg(color: string, status?: string): string {
  const isPlanned = status === "planned";
  const isFilled = status === "placed" || status === "Complete";
  const fillVal = isFilled ? color : (isPlanned ? "none" : "#f8fafc");
  const strokeOpacity = isPlanned ? "0.5" : "1.0";

  return wrap(
    `<rect x="6" y="6" width="20" height="20" rx="1.5" fill="${fillVal}" stroke-opacity="${strokeOpacity}"/>
    <line x1="16" y1="6" x2="16" y2="26" stroke="${color}" stroke-width="1.2" stroke-dasharray="2,2" stroke-opacity="${strokeOpacity}"/>
    <line x1="6" y1="16" x2="26" y2="16" stroke="${color}" stroke-width="1.2" stroke-dasharray="2,2" stroke-opacity="${strokeOpacity}"/>`,
    color
  );
}

function flowerPotSvg(color: string): string {
  return wrap(
    `<circle cx="16" cy="7" r="4.5" fill="#f8fafc" stroke="${color}" stroke-width="1.8"/>
    <circle cx="16" cy="25" r="4.5" fill="#f8fafc" stroke="${color}" stroke-width="1.8"/>
    <circle cx="7" cy="16" r="4.5" fill="#f8fafc" stroke="${color}" stroke-width="1.8"/>
    <circle cx="25" cy="16" r="4.5" fill="#f8fafc" stroke="${color}" stroke-width="1.8"/>
    <circle cx="10" cy="10" r="4.5" fill="#f8fafc" stroke="${color}" stroke-width="1.8"/>
    <circle cx="22" cy="10" r="4.5" fill="#f8fafc" stroke="${color}" stroke-width="1.8"/>
    <circle cx="10" cy="22" r="4.5" fill="#f8fafc" stroke="${color}" stroke-width="1.8"/>
    <circle cx="22" cy="22" r="4.5" fill="#f8fafc" stroke="${color}" stroke-width="1.8"/>
    <circle cx="16" cy="16" r="7.5" fill="#f8fafc" stroke="${color}" stroke-width="1.8"/>
    <text x="16" y="19" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="8.5" font-weight="900" fill="${color}">FP</text>`,
    color
  );
}

// Returns raw SVG string for use in rail tiles (not data-URI)
export function railSvgForTool(tool: string, color?: string): string {
  const c = color ?? DEFAULT_ICON_COLOR;
  const t = (tool || "").toLowerCase();
  if (t === "ziply_hub" || t.includes("hub")) return ziplyHubSvg(c);
  if (t === "ziply_terminal" || t.includes("terminal")) return ziplyTerminalSvg(c);
  if (t === "ziply_address" || t.includes("address")) return ziplyAddressSvg(c);
  if (t === "ziply_handhole" || t.includes("handhole")) return ziplyHandholeSvg(c);
  if (t === "ziply_pole" || t.includes("pole")) return poleSvg(c);
  if (t.includes("flower_pot") || t.includes("flowerpot")) return flowerPotSvg(c);

  if (t.includes("pole")) return poleSvg(c);
  if (t.includes("mh") || t.includes("manhole")) return mhSvg(c);
  if (t.includes("hh") || t.includes("handhole")) return hhSvg(c);
  if (t.includes("ped")) return pedSvg(c);
  if (t.includes("cabinet") || t.includes("cab")) return cabinetSvg(c);
  if (t.includes("anchor") || t.includes("guy")) return anchorSvg(c);
  if (t.includes("splice")) return spliceSvg(c);
  return poleSvg(c); // fallback
}

// ── Map icon generator ────────────────────────────────────────────────────────

export function iconForTool(
  tool: string,
  overrideColor?: string,
  pointSize = 1.0,
  ziplyStatus?: string
): { url: string; size: google.maps.Size; scaledSize?: google.maps.Size; anchor: google.maps.Point } {
  const t = (tool || "").toLowerCase();
  const isPole = t.includes("pole");
  const isPed = t.includes("ped");
  const isHH = t.includes("handhole") || t.includes("hh");

  let color = overrideColor ?? DEFAULT_ICON_COLOR;
  if (isPole) color = "#000000";
  else if (isPed) color = "#10b981"; // green square for pedestals
  else if (isHH) color = "#475569"; // slate rectangle for handholes

  const px = Math.max(24, Math.round(ICON_SIZE * pointSize));

  let svg: string;
  if (t === "ziply_hub" || t.includes("hub")) svg = ziplyHubSvg(color);
  else if (t === "ziply_terminal" || t.includes("terminal")) svg = ziplyTerminalSvg(color);
  else if (t === "ziply_address" || t.includes("address")) svg = ziplyAddressSvg(color);
  else if (t === "ziply_handhole" || t.includes("handhole")) svg = ziplyHandholeSvg(color, ziplyStatus);
  else if (t === "ziply_pole" || t.includes("pole")) svg = poleSvg(color);
  else if (t.includes("flower_pot") || t.includes("flowerpot")) svg = flowerPotSvg(color);

  else if (t.includes("pole")) svg = poleSvg(color);
  else if (t.includes("mh") || t.includes("manhole")) svg = mhSvg(color);
  else if (t.includes("hh") || t.includes("handhole")) svg = hhSvg(color, ziplyStatus);
  else if (t.includes("ped")) svg = pedSvg(color, ziplyStatus);
  else if (t.includes("cabinet") || t.includes("cab")) svg = cabinetSvg(color);
  else if (t.includes("anchor") || t.includes("guy")) svg = anchorSvg(color);
  else if (t.includes("splice")) svg = spliceSvg(color);
  else svg = poleSvg(color); // fallback

  return {
    url: svgUri(svg),
    size: new google.maps.Size(px, px),
    scaledSize: new google.maps.Size(px, px),
    anchor: new google.maps.Point(px / 2, px / 2),
  };
}

// Legacy color exports (kept for compat with drawingContext defaults)
export const NEW_COLOR = "#000000"; // Phase 4: black
export const REM_COLOR = "#000000"; // Phase 4: black (cable colors are hardcoded in DrawingOverlay)
