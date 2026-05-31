// Dynamic map styling system
// Supports:
// - Dark / Light base
// - Toggle road labels (street names)
// - Toggle POI / Business labels
// - Good dark map for field work at night

export interface MapStyleOptions {
  dark?: boolean;
  showRoadLabels?: boolean;
  showPoiLabels?: boolean;
}

export function getMapStyles(options: MapStyleOptions = {}): google.maps.MapTypeStyle[] {
  const { dark = false, showRoadLabels = true, showPoiLabels = true } = options;

  const styles: google.maps.MapTypeStyle[] = [];

  if (dark) {
    // Base dark tactical theme
    styles.push(
      { elementType: "geometry", stylers: [{ color: "#0b0f13" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#0b0f13" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#8a95a3" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a2226" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a212a" }] },
      { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#2a3540" }] },
      { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2a3540" }] },
      { featureType: "transit", elementType: "geometry", stylers: [{ color: "#11161c" }] },
    );
  }

  // Road / Street name labels
  if (!showRoadLabels) {
    styles.push(
      { featureType: "road", elementType: "labels.text", stylers: [{ visibility: "off" }] },
      { featureType: "road.highway", elementType: "labels.text", stylers: [{ visibility: "off" }] },
      { featureType: "road.local", elementType: "labels.text", stylers: [{ visibility: "off" }] },
    );
  } else if (dark) {
    styles.push(
      { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ba6b3" }] },
    );
  }

  // POI / Business / Place labels
  if (!showPoiLabels) {
    styles.push(
      { featureType: "poi", elementType: "labels.text", stylers: [{ visibility: "off" }] },
      { featureType: "poi.business", elementType: "labels.text", stylers: [{ visibility: "off" }] },
      { featureType: "poi.medical", elementType: "labels.text", stylers: [{ visibility: "off" }] },
      { featureType: "poi.park", elementType: "labels.text", stylers: [{ visibility: "off" }] },
    );
  } else if (dark) {
    styles.push(
      { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6b7785" }] },
    );
  }

  return styles;
}

// Backwards compatibility
export const darkTacticalStyle = getMapStyles({ dark: true });
export const lightStyle: google.maps.MapTypeStyle[] = [];

export function stylesFor(theme: "dark" | "light"): google.maps.MapTypeStyle[] {
  return theme === "dark" ? darkTacticalStyle : lightStyle;
}

// Snoqualmie / Seattle area default — user is based in WA.
export const DEFAULT_CENTER = { lat: 47.5301, lng: -121.8255 };
export const DEFAULT_ZOOM = 11;
