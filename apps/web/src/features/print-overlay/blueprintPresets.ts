/**
 * High-resolution SVG CAD blueprint data URL generators for site engineering overlays
 */

function createSvgDataUrl(svgString: string): string {
  const encoded = encodeURIComponent(svgString)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

export function generateStructuralFoundationSvg(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
    <rect width="1000" height="1000" fill="#021526" fill-opacity="0.88"/>
    <!-- Grid pattern -->
    <defs>
      <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
        <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#00f2fe" stroke-width="0.8" stroke-opacity="0.25"/>
      </pattern>
    </defs>
    <rect width="1000" height="1000" fill="url(#grid)"/>

    <!-- Main Foundation Slab Perimeter -->
    <rect x="150" y="150" width="700" height="700" fill="none" stroke="#00f2fe" stroke-width="4" stroke-dasharray="10 5"/>
    <rect x="180" y="180" width="640" height="640" fill="rgba(0, 242, 254, 0.08)" stroke="#00f2fe" stroke-width="2"/>

    <!-- Concrete Pillar / Column Footing Grid -->
    <g fill="#00f2fe" stroke="#38bdf8" stroke-width="2">
      <!-- Row 1 -->
      <rect x="200" y="200" width="60" height="60" rx="4"/>
      <rect x="470" y="200" width="60" height="60" rx="4"/>
      <rect x="740" y="200" width="60" height="60" rx="4"/>

      <!-- Row 2 -->
      <rect x="200" y="470" width="60" height="60" rx="4"/>
      <rect x="470" y="470" width="60" height="60" rx="4"/>
      <rect x="740" y="470" width="60" height="60" rx="4"/>

      <!-- Row 3 -->
      <rect x="200" y="740" width="60" height="60" rx="4"/>
      <rect x="470" y="740" width="60" height="60" rx="4"/>
      <rect x="740" y="740" width="60" height="60" rx="4"/>
    </g>

    <!-- Structural Steel Beam Axes -->
    <line x1="230" y1="100" x2="230" y2="900" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="8 4"/>
    <line x1="500" y1="100" x2="500" y2="900" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="8 4"/>
    <line x1="770" y1="100" x2="770" y2="900" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="8 4"/>

    <line x1="100" y1="230" x2="900" y2="230" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="8 4"/>
    <line x1="100" y1="500" x2="900" y2="500" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="8 4"/>
    <line x1="100" y1="770" x2="900" y2="770" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="8 4"/>

    <!-- Dimension Callouts & Text -->
    <g fill="#38bdf8" font-family="monospace" font-size="18" font-weight="bold">
      <text x="230" y="80" text-anchor="middle">GRID A-1</text>
      <text x="500" y="80" text-anchor="middle">GRID A-2</text>
      <text x="770" y="80" text-anchor="middle">GRID A-3</text>
      
      <text x="70" y="235" text-anchor="end">AXIS 1</text>
      <text x="70" y="505" text-anchor="end">AXIS 2</text>
      <text x="70" y="775" text-anchor="end">AXIS 3</text>

      <text x="500" y="140" text-anchor="middle">SPAN 27.00 m (88.58 FT)</text>
      <text x="500" y="880" text-anchor="middle">FOUNDATION PAD B-4 — REINFORCED SLAB 350mm</text>
    </g>

    <!-- Cross bracing diagonals -->
    <line x1="260" y1="260" x2="470" y2="470" stroke="#00f2fe" stroke-width="1" stroke-dasharray="4 4" stroke-opacity="0.6"/>
    <line x1="470" y1="260" x2="260" y2="470" stroke="#00f2fe" stroke-width="1" stroke-dasharray="4 4" stroke-opacity="0.6"/>
    <line x1="530" y1="470" x2="740" y2="740" stroke="#00f2fe" stroke-width="1" stroke-dasharray="4 4" stroke-opacity="0.6"/>
    <line x1="740" y1="470" x2="530" y2="740" stroke="#00f2fe" stroke-width="1" stroke-dasharray="4 4" stroke-opacity="0.6"/>
  </svg>`;
  return createSvgDataUrl(svg);
}

export function generateCivilSiteGradingSvg(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
    <rect width="1000" height="1000" fill="#041c1e" fill-opacity="0.88"/>
    
    <!-- Topographic Contour Lines -->
    <g fill="none" stroke="#2dd4bf" stroke-width="2" stroke-opacity="0.8">
      <path d="M 50 200 C 300 180, 700 250, 950 190" />
      <path d="M 50 320 C 350 300, 650 380, 950 300" stroke-width="3" />
      <path d="M 50 450 C 400 420, 600 500, 950 430" />
      <path d="M 50 580 C 320 540, 680 620, 950 550" />
      <path d="M 50 720 C 380 680, 620 780, 950 700" stroke-width="3" />
      <path d="M 50 850 C 300 810, 700 900, 950 820" />
    </g>

    <!-- Property Easement & Drainage Buffer -->
    <polygon points="120,120 880,120 880,880 120,880" fill="rgba(45, 212, 191, 0.06)" stroke="#14b8a6" stroke-width="3" stroke-dasharray="12 6"/>

    <!-- Catch Basins & Storm Drainage Pipes -->
    <g fill="#2dd4bf" stroke="#0f766e" stroke-width="2">
      <circle cx="200" cy="200" r="18" />
      <circle cx="800" cy="200" r="18" />
      <circle cx="800" cy="800" r="18" />
      <circle cx="200" cy="800" r="18" />
    </g>

    <line x1="200" y1="200" x2="800" y2="200" stroke="#2dd4bf" stroke-width="4" />
    <line x1="800" y1="200" x2="800" y2="800" stroke="#2dd4bf" stroke-width="4" />
    <line x1="800" y1="800" x2="200" y2="800" stroke="#2dd4bf" stroke-width="4" />
    <line x1="200" y1="800" x2="200" y2="200" stroke="#2dd4bf" stroke-width="4" />

    <!-- Contour Elevation Labels -->
    <g fill="#5eead4" font-family="monospace" font-size="16" font-weight="bold">
      <text x="500" y="310">EL +142.5 m</text>
      <text x="500" y="710">EL +140.0 m</text>
      <text x="500" y="100" text-anchor="middle">CIVIL GRADING &amp; DRAINAGE SITE PLAN</text>
      <text x="500" y="930" text-anchor="middle">STORM RUNOFF RETENTION SLOPE 2.5%</text>
    </g>
  </svg>`;
  return createSvgDataUrl(svg);
}

export function generateElectricalMepSvg(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
    <rect width="1000" height="1000" fill="#1b1202" fill-opacity="0.88"/>

    <!-- Main Building Outline -->
    <rect x="100" y="100" width="800" height="800" fill="rgba(245, 158, 11, 0.05)" stroke="#f59e0b" stroke-width="3"/>

    <!-- Transformer Vault Pad -->
    <rect x="150" y="150" width="180" height="180" fill="rgba(245, 158, 11, 0.2)" stroke="#f59e0b" stroke-width="3"/>
    <text x="240" y="245" fill="#fbbf24" font-family="monospace" font-size="16" font-weight="bold" text-anchor="middle">HV TRANSFORMER 15KV</text>

    <!-- Main Electrical Conduit Trunk Lines -->
    <path d="M 330 240 L 750 240 L 750 750 L 240 750 L 240 330" fill="none" stroke="#fbbf24" stroke-width="5" />

    <!-- Sub-panels & Junction Boxes -->
    <g fill="#f59e0b" stroke="#78350f" stroke-width="2">
      <rect x="730" y="220" width="40" height="40"/>
      <rect x="730" y="730" width="40" height="40"/>
      <rect x="220" y="730" width="40" height="40"/>
    </g>

    <!-- HVAC Ducting Runs -->
    <path d="M 200 500 L 800 500" stroke="#06b6d4" stroke-width="8" stroke-dasharray="15 5"/>
    <circle cx="500" cy="500" r="40" fill="none" stroke="#06b6d4" stroke-width="4"/>

    <!-- Text Annotations -->
    <g fill="#fbbf24" font-family="monospace" font-size="16" font-weight="bold">
      <text x="500" y="70" text-anchor="middle">ELECTRICAL &amp; MECHANICAL MEP SITE SCHEMATIC</text>
      <text x="500" y="480" text-anchor="middle" fill="#22d3ee">HVAC CHILLER SUPPLY DUCT TRUNK</text>
      <text x="500" y="930" text-anchor="middle">MAIN FEED 480V 3-PHASE UNDERGROUND</text>
    </g>
  </svg>`;
  return createSvgDataUrl(svg);
}

export function generateCommercialSiteSvg(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
    <rect width="1000" height="1000" fill="#0f172a" fill-opacity="0.88"/>

    <!-- Roads & Access Network -->
    <rect x="50" y="50" width="900" height="900" fill="none" stroke="#64748b" stroke-width="4"/>
    <path d="M 50 500 L 950 500 M 500 50 L 500 950" stroke="#94a3b8" stroke-width="30" stroke-opacity="0.4"/>
    <path d="M 50 500 L 950 500 M 500 50 L 500 950" stroke="#f8fafc" stroke-width="2" stroke-dasharray="10 10"/>

    <!-- Building Blocks -->
    <rect x="100" y="100" width="350" height="350" fill="rgba(59, 130, 246, 0.2)" stroke="#3b82f6" stroke-width="3"/>
    <rect x="550" y="100" width="350" height="350" fill="rgba(16, 185, 129, 0.2)" stroke="#10b981" stroke-width="3"/>
    <rect x="100" y="550" width="350" height="350" fill="rgba(168, 85, 247, 0.2)" stroke="#a855f7" stroke-width="3"/>
    <rect x="550" y="550" width="350" height="350" fill="rgba(244, 63, 94, 0.2)" stroke="#f43f5e" stroke-width="3"/>

    <!-- Labels -->
    <g font-family="sans-serif" font-weight="bold" font-size="20" text-anchor="middle">
      <text x="275" y="285" fill="#60a5fa">BUILDING A (COMMERCIAL)</text>
      <text x="725" y="285" fill="#34d399">BUILDING B (LOGISTICS)</text>
      <text x="275" y="735" fill="#c084fc">PLAZA &amp; RETAIL</text>
      <text x="725" y="735" fill="#fb7185">PARKING STRUCTURE</text>
    </g>
  </svg>`;
  return createSvgDataUrl(svg);
}

export function getPresetBlueprintImageUri(presetKey: string): string {
  switch (presetKey) {
    case "preset_foundation":
      return generateStructuralFoundationSvg();
    case "preset_civil":
      return generateCivilSiteGradingSvg();
    case "preset_electrical":
      return generateElectricalMepSvg();
    case "preset_commercial":
      return generateCommercialSiteSvg();
    default:
      return generateStructuralFoundationSvg();
  }
}

export function convertFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}
