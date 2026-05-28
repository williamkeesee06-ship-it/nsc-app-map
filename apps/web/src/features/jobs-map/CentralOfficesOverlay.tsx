// CentralOfficesOverlay — read-only layer of Lumen WA Central Offices.
// Neon-cyan Greek temple / courthouse icon (classic CO symbol) ALWAYS visible
// at the same size as job pin markers. The text label appears only at zoom
// >= LABEL_MIN_ZOOM (same threshold as WO labels in JobsMap).
import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import centralOffices from "../../data/centralOffices.json";

interface Props {
  visible: boolean;
}

// Match WO_LABEL_MIN_ZOOM in JobsMap.tsx
const LABEL_MIN_ZOOM = 13;

const NEON_CYAN = "#22D3FF";

// Greek temple / courthouse SVG — variant F: solid cyan columns + thin neon
// outline for pediment / architrave / base. Sized to match job pin markers.
const TEMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
  <defs>
    <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="0.8" result="blur"/>
      <feFlood flood-color="${NEON_CYAN}" flood-opacity="0.7"/>
      <feComposite in2="blur" operator="in" result="glow"/>
      <feMerge>
        <feMergeNode in="glow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <g filter="url(#neonGlow)" shape-rendering="geometricPrecision">
    <g fill="none" stroke="${NEON_CYAN}" stroke-width="0.75" stroke-linecap="square" stroke-linejoin="miter">
      <!-- Pediment (triangular roof) -->
      <polygon points="22,5 6,15 38,15" />
      <!-- Architrave (beam under pediment) -->
      <line x1="6" y1="17" x2="38" y2="17" />
      <!-- Base / stylobate (two thin lines) -->
      <line x1="5" y1="33" x2="39" y2="33" />
      <line x1="3" y1="36" x2="41" y2="36" />
    </g>
    <!-- 4 solid columns -->
    <rect x="9" y="18" width="2" height="14" fill="${NEON_CYAN}"/>
    <rect x="16.5" y="18" width="2" height="14" fill="${NEON_CYAN}"/>
    <rect x="25.5" y="18" width="2" height="14" fill="${NEON_CYAN}"/>
    <rect x="33" y="18" width="2" height="14" fill="${NEON_CYAN}"/>
  </g>
</svg>`;

const TEMPLE_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(TEMPLE_SVG)}`;

function nameLabelUrl(name: string): { url: string; w: number } {
  const w = Math.max(70, name.length * 6.8 + 18);
  // Neon pill: dark glass background, cyan stroke + glow, cyan text.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="22">
  <defs>
    <filter id="lblGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.2" result="blur"/>
      <feFlood flood-color="${NEON_CYAN}" flood-opacity="0.7"/>
      <feComposite in2="blur" operator="in" result="glow"/>
      <feMerge>
        <feMergeNode in="glow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect x="1.5" y="1.5" width="${w - 3}" height="19" rx="9.5"
    fill="rgba(8,18,28,0.92)" stroke="${NEON_CYAN}" stroke-width="1.5" filter="url(#lblGlow)"/>
  <text x="${w / 2}" y="15" text-anchor="middle" font-size="10" font-weight="700"
    fill="${NEON_CYAN}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace"
    style="letter-spacing:0.04em">${name.toUpperCase()}</text>
</svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, w };
}

export default function CentralOfficesOverlay({ visible }: Props) {
  const map = useMap();
  const markersRef = useRef<google.maps.Marker[]>([]);
  const labelsRef = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    if (!map) return;

    // Always start with everything cleared.
    const clear = () => {
      markersRef.current.forEach((m) => m.setMap(null));
      labelsRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      labelsRef.current = [];
    };

    if (!visible) {
      clear();
      return;
    }

    const markers: google.maps.Marker[] = [];
    const labels: google.maps.Marker[] = [];

    for (const co of centralOffices as Array<{ name: string; address: string; lat: number; lng: number }>) {
      // CO icon — ALWAYS visible (matches job pin behavior, sized like a job pin).
      const pin = new google.maps.Marker({
        position: { lat: co.lat, lng: co.lng },
        map,
        title: `Lumen CO · ${co.name}\n${co.address}`,
        icon: {
          url: TEMPLE_URL,
          scaledSize: new google.maps.Size(28, 28),
          anchor: new google.maps.Point(14, 24), // base of building
        },
        zIndex: 9999,
      });
      markers.push(pin);

      // CO label — only visible at zoom >= LABEL_MIN_ZOOM, same rule as WO labels.
      const { url: labelUrl, w } = nameLabelUrl(co.name);
      const initialZoom = map.getZoom() ?? 0;
      const label = new google.maps.Marker({
        position: { lat: co.lat, lng: co.lng },
        map: initialZoom >= LABEL_MIN_ZOOM ? map : null,
        icon: {
          url: labelUrl,
          scaledSize: new google.maps.Size(w, 22),
          anchor: new google.maps.Point(w / 2, -4), // sits below the temple base
        },
        clickable: false,
        zIndex: 9998,
      });
      labels.push(label);
    }

    markersRef.current = markers;
    labelsRef.current = labels;

    // Watch zoom — only the labels respond to zoom; icons stay visible always.
    const applyLabelZoom = () => {
      const z = map.getZoom() ?? 0;
      const target = z >= LABEL_MIN_ZOOM ? map : null;
      labelsRef.current.forEach((m) => m.setMap(target));
    };
    const zoomListener = map.addListener("zoom_changed", applyLabelZoom);

    return () => {
      zoomListener.remove();
      clear();
    };
  }, [map, visible]);

  return null;
}
