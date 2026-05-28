// CentralOfficesOverlay — read-only layer of Lumen WA Central Offices.
// Distinctive gold star + red ring + "CO" label. Always visible when enabled.
import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import centralOffices from "../../data/centralOffices.json";

interface Props {
  visible: boolean;
}

// SVG marker — gold star with red ring + dark center, "CO" text inside.
// 36×36, anchored at center.
const STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <filter id="g" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <polygon points="18,2 22.5,13.5 35,13.5 25,21 28.5,33 18,26 7.5,33 11,21 1,13.5 13.5,13.5"
    fill="#FFC107" stroke="#D32F2F" stroke-width="2" stroke-linejoin="round" filter="url(#g)"/>
  <text x="18" y="22" text-anchor="middle" font-size="9" font-weight="900"
    fill="#1A1A1A" font-family="system-ui,-apple-system,sans-serif">CO</text>
</svg>`;

const STAR_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(STAR_SVG)}`;

function nameLabelUrl(name: string): string {
  // approximate width: 7px per char + padding
  const w = Math.max(60, name.length * 6.5 + 14);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20">
  <rect x="0" y="0" width="${w}" height="20" rx="10" fill="#1A1A1A" stroke="#FFC107" stroke-width="1.5"/>
  <text x="${w / 2}" y="14" text-anchor="middle" font-size="10" font-weight="700"
    fill="#FFC107" font-family="system-ui,-apple-system,sans-serif">${name}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default function CentralOfficesOverlay({ visible }: Props) {
  const map = useMap();
  const markersRef = useRef<google.maps.Marker[]>([]);
  const labelsRef = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    if (!map) return;
    if (!visible) {
      // Clean up if hiding
      markersRef.current.forEach((m) => m.setMap(null));
      labelsRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      labelsRef.current = [];
      return;
    }

    const markers: google.maps.Marker[] = [];
    const labels: google.maps.Marker[] = [];

    for (const co of centralOffices as Array<{ name: string; address: string; lat: number; lng: number }>) {
      const pin = new google.maps.Marker({
        position: { lat: co.lat, lng: co.lng },
        map,
        title: `Lumen CO · ${co.name}\n${co.address}`,
        icon: {
          url: STAR_URL,
          scaledSize: new google.maps.Size(36, 36),
          anchor: new google.maps.Point(18, 18),
        },
        zIndex: 9999,
      });
      markers.push(pin);

      const labelUrl = nameLabelUrl(co.name);
      const w = Math.max(60, co.name.length * 6.5 + 14);
      const label = new google.maps.Marker({
        position: { lat: co.lat, lng: co.lng },
        map,
        icon: {
          url: labelUrl,
          scaledSize: new google.maps.Size(w, 20),
          anchor: new google.maps.Point(w / 2, -2), // sits below the star
        },
        clickable: false,
        zIndex: 9998,
      });
      labels.push(label);
    }

    markersRef.current = markers;
    labelsRef.current = labels;

    return () => {
      markers.forEach((m) => m.setMap(null));
      labels.forEach((m) => m.setMap(null));
    };
  }, [map, visible]);

  return null;
}
