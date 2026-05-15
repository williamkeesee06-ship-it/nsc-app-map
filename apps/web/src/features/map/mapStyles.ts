// Google Maps style JSON for both themes. Selected via the theme toggle.
//
// Light = Google default (empty array = no style overrides).
// Dark = tactical field-ops style tuned for low-light + high-contrast overlays.

export const darkTacticalStyle: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0b0f13" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b0f13" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a95a3" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d8dde3" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6b7785" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0f1a14" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a212a" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#2a3540" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ba6b3" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2a3540" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#3a4754" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#11161c" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a2226" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#20808d" }] },
];

export const lightStyle: google.maps.MapTypeStyle[] = [];

export function stylesFor(theme: "dark" | "light"): google.maps.MapTypeStyle[] {
  return theme === "dark" ? darkTacticalStyle : lightStyle;
}

// Snoqualmie / Seattle area default — user is based in WA.
export const DEFAULT_CENTER = { lat: 47.5301, lng: -121.8255 };
export const DEFAULT_ZOOM = 11;
