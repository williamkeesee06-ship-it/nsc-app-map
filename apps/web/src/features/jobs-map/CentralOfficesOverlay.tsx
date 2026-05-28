// CentralOfficesOverlay — read-only layer of Lumen WA Central Offices.
// Neon-cyan Greek temple / courthouse icon (classic CO symbol) with matching
// neon labels below. Markers + labels only render at zoom >= MIN_ZOOM so they
// behave the same way as WO labels (don't crowd the map when zoomed out).
import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import centralOffices from "../../data/centralOffices.json";

interface Props {
  visible: boolean;
}

// Zoom threshold — match WO_LABEL_MIN_ZOOM in JobsMap.tsx
const MIN_ZOOM = 11;

const NEON_CYAN = "#22D3FF";
const NEON_CYAN_DEEP = "#0A8CC2";

// Greek temple / courthouse SVG — neon stroke, columns, pediment, base.
// 44×44 viewBox, white inner stroke + cyan glow halo via filter.
const TEMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
  <defs>
    <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.6" result="blur"/>
      <feFlood flood-color="${NEON_CYAN}" flood-opacity="0.9"/>
      <feComposite in2="blur" operator="in" result="glow"/>
      <feMerge>
        <feMergeNode in="glow"/>
        <feMergeNode in="glow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <g fill="none" stroke="${NEON_CYAN}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" filter="url(#neonGlow)">
    <!-- Pediment (triangular roof) -->
    <polygon points="22,5 6,15 38,15" />
    <!-- Architrave (beam under pediment) -->
    <line x1="6" y1="17" x2="38" y2="17" />
    <!-- 4 columns -->
    <line x1="10" y1="18" x2="10" y2="32" />
    <line x1="17.5" y1="18" x2="17.5" y2="32" />
    <line x1="26.5" y1="18" x2="26.5" y2="32" />
    <line x1="34" y1="18" x2="34" y2="32" />
    <!-- Base / stylobate -->
    <line x1="5" y1="33" x2="39" y2="33" />
    <line x1="3" y1="36" x2="41" y2="36" />
    <line x1="2" y1="39" x2="42" y2="39" />
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
      const pin = new google.maps.Marker({
        position: { lat: co.lat, lng: co.lng },
        map: null, // toggled below by zoom
        title: `Lumen CO · ${co.name}\n${co.address}`,
        icon: {
          url: TEMPLE_URL,
          scaledSize: new google.maps.Size(44, 44),
          anchor: new google.maps.Point(22, 38), // base of building
        },
        zIndex: 9999,
      });
      markers.push(pin);

      const { url: labelUrl, w } = nameLabelUrl(co.name);
      const label = new google.maps.Marker({
        position: { lat: co.lat, lng: co.lng },
        map: null, // toggled below by zoom
        icon: {
          url: labelUrl,
          scaledSize: new google.maps.Size(w, 22),
          anchor: new google.maps.Point(w / 2, -6), // sits below the temple base
        },
        clickable: false,
        zIndex: 9998,
      });
      labels.push(label);
    }

    markersRef.current = markers;
    labelsRef.current = labels;

    // Apply current zoom visibility, then watch for zoom changes.
    const applyZoom = () => {
      const z = map.getZoom() ?? 0;
      const show = z >= MIN_ZOOM;
      const target = show ? map : null;
      markersRef.current.forEach((m) => m.setMap(target));
      labelsRef.current.forEach((m) => m.setMap(target));
    };
    applyZoom();
    const zoomListener = map.addListener("zoom_changed", applyZoom);

    return () => {
      zoomListener.remove();
      clear();
    };
  }, [map, visible]);

  return null;
}
