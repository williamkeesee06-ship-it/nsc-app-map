// Neon SVG glyph generators for telecom point tools.
// Each returns a data-URI SVG suitable for google.maps.Marker icon.url
// Colors: green #39ff7a (new), red #ff2d4a (removed)

export const NEW_COLOR = "#39ff7a";
export const NEW_GLOW = "#22cc55";
export const REM_COLOR = "#ff2d4a";
export const REM_GLOW = "#ff3355";
export const ICON_SIZE = 28; // px, square bounding box

function svgUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function glowFilter(id: string, color: string): string {
  return `<defs>
    <filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feFlood flood-color="${color}" flood-opacity="0.8" result="glow"/>
      <feComposite in="glow" in2="blur" operator="in" result="coloredBlur"/>
      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;
}

// MH = hexagon
export function mhIcon(removed = false): string {
  const c = removed ? REM_COLOR : NEW_COLOR;
  const g = removed ? REM_GLOW : NEW_GLOW;
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${(14 + 10 * Math.cos(a)).toFixed(1)},${(14 + 10 * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    ${glowFilter("g", g)}
    <polygon points="${pts}" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="2" filter="url(#g)"/>
    <text x="14" y="18" text-anchor="middle" font-size="8" font-weight="bold" fill="${c}" font-family="monospace">MH</text>
  </svg>`);
}

// HH = square
export function hhIcon(removed = false): string {
  const c = removed ? REM_COLOR : NEW_COLOR;
  const g = removed ? REM_GLOW : NEW_GLOW;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    ${glowFilter("g", g)}
    <rect x="4" y="4" width="20" height="20" rx="1" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="2" filter="url(#g)"/>
    <text x="14" y="18" text-anchor="middle" font-size="8" font-weight="bold" fill="${c}" font-family="monospace">HH</text>
  </svg>`);
}

// PED = circle
export function pedIcon(removed = false): string {
  const c = removed ? REM_COLOR : NEW_COLOR;
  const g = removed ? REM_GLOW : NEW_GLOW;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    ${glowFilter("g", g)}
    <circle cx="14" cy="14" r="10" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="2" filter="url(#g)"/>
    <text x="14" y="18" text-anchor="middle" font-size="7" font-weight="bold" fill="${c}" font-family="monospace">PED</text>
  </svg>`);
}

// POLE = upward triangle
export function poleIcon(removed = false): string {
  const c = removed ? REM_COLOR : NEW_COLOR;
  const g = removed ? REM_GLOW : NEW_GLOW;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    ${glowFilter("g", g)}
    <polygon points="14,3 25,24 3,24" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="2" filter="url(#g)"/>
    <text x="14" y="21" text-anchor="middle" font-size="6" font-weight="bold" fill="${c}" font-family="monospace">PLT</text>
  </svg>`);
}

// CABINET = rounded rectangle (wider than tall)
export function cabinetIcon(removed = false): string {
  const c = removed ? REM_COLOR : NEW_COLOR;
  const g = removed ? REM_GLOW : NEW_GLOW;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    ${glowFilter("g", g)}
    <rect x="2" y="7" width="24" height="14" rx="4" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="2" filter="url(#g)"/>
    <text x="14" y="18" text-anchor="middle" font-size="6" font-weight="bold" fill="${c}" font-family="monospace">CAB</text>
  </svg>`);
}

// ANCHOR = diamond
export function anchorIcon(removed = false): string {
  const c = removed ? REM_COLOR : NEW_COLOR;
  const g = removed ? REM_GLOW : NEW_GLOW;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    ${glowFilter("g", g)}
    <polygon points="14,2 26,14 14,26 2,14" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="2" filter="url(#g)"/>
    <text x="14" y="18" text-anchor="middle" font-size="6" font-weight="bold" fill="${c}" font-family="monospace">ANC</text>
  </svg>`);
}

// Map from tool name to icon generator
export function iconForTool(
  tool: string
): { url: string; size: google.maps.Size; anchor: google.maps.Point } {
  const removed = tool.endsWith("_removed");
  let url: string;

  if (tool.startsWith("mh_")) url = mhIcon(removed);
  else if (tool.startsWith("hh_")) url = hhIcon(removed);
  else if (tool.startsWith("ped_")) url = pedIcon(removed);
  else if (tool.startsWith("pole_")) url = poleIcon(removed);
  else if (tool.startsWith("cabinet_")) url = cabinetIcon(removed);
  else if (tool.startsWith("anchor_")) url = anchorIcon(removed);
  else url = pedIcon(removed); // fallback

  return {
    url,
    size: new google.maps.Size(ICON_SIZE, ICON_SIZE),
    anchor: new google.maps.Point(ICON_SIZE / 2, ICON_SIZE / 2),
  };
}
