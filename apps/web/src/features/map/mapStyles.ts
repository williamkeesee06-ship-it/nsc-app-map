// Dynamic map styling system
// Supports:
// - Multiple base themes: classic / dark / silver(light) / retro / night-tactical
// - Toggle road / street labels
// - Toggle POI / Business labels
// - Toggle city / town labels
// - Toggle transit lines
// - Good dark map for field work at night

export type MapTheme = "classic" | "dark" | "silver" | "retro";

export interface MapStyleOptions {
  /** Deprecated boolean kept for back-compat; maps to theme "dark". */
  dark?: boolean;
  theme?: MapTheme;
  showRoadLabels?: boolean;
  showPoiLabels?: boolean;
  showCityLabels?: boolean;
  showTransit?: boolean;
}

// ─── Base theme geometry palettes ──────────────────────────────────────────

const DARK_THEME: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0b0f13" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b0f13" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a95a3" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a2226" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a212a" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#2a3540" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2a3540" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#11161c" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#2a3540" }] },
];

const SILVER_THEME: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#bdbdbd" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#dadada" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e5e5e5" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9e6f2" }] },
];

const RETRO_THEME: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#ebe3cd" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#523735" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f1e6" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#c9b2a6" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#dfd2ae" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#f5f1e6" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#fdfcf8" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f8c967" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#e9bc62" }] },
  { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#b9d3c2" }] },
];

export function getMapStyles(options: MapStyleOptions = {}): google.maps.MapTypeStyle[] {
  const {
    dark = false,
    showRoadLabels = true,
    showPoiLabels = true,
    showCityLabels = true,
    showTransit = true,
  } = options;

  // Resolve theme — `dark: true` still maps to the dark theme for back-compat.
  const theme: MapTheme = options.theme ?? (dark ? "dark" : "classic");
  const isDark = theme === "dark";

  const styles: google.maps.MapTypeStyle[] = [];

  if (theme === "dark") styles.push(...DARK_THEME);
  else if (theme === "silver") styles.push(...SILVER_THEME);
  else if (theme === "retro") styles.push(...RETRO_THEME);
  // "classic" => no geometry overrides (default Google look)

  // City / Locality labels
  if (!showCityLabels) {
    styles.push(
      { featureType: "administrative.locality", elementType: "labels.text", stylers: [{ visibility: "off" }] },
      { featureType: "administrative.neighborhood", elementType: "labels.text", stylers: [{ visibility: "off" }] },
    );
  }

  // Road / Street name labels
  if (!showRoadLabels) {
    styles.push(
      { featureType: "road", elementType: "labels.text", stylers: [{ visibility: "off" }] },
      { featureType: "road.highway", elementType: "labels.text", stylers: [{ visibility: "off" }] },
      { featureType: "road.local", elementType: "labels.text", stylers: [{ visibility: "off" }] },
    );
  } else if (isDark) {
    styles.push(
      { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ba6b3" }] },
    );
  }

  // POI / Business / Place labels
  if (!showPoiLabels) {
    styles.push(
      { featureType: "poi", stylers: [{ visibility: "off" }] }
    );
  } else if (isDark) {
    styles.push(
      { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6b7785" }] },
    );
  }

  // Transit lines / stations
  if (!showTransit) {
    styles.push(
      { featureType: "transit", stylers: [{ visibility: "off" }] }
    );
  }

  return styles;
}

// Backwards compatibility
export const darkTacticalStyle = getMapStyles({ dark: true });
export const lightStyle: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

// ─── Network View basemap ─────────────────────────────────────────────────
// Deep-blue near-black land, dim charcoal roads, quiet water. The point is to
// give every drawn cable a dark surface to burn against — the map itself
// should almost disappear and let the fiber network be the picture.
// Roads stay visible (slightly warmer than land) so a run reads as following
// the street, not floating in space.
export const NETWORK_VIEW_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#060a12" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#060a12" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4a5566" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#03080f" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#080d17" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#171d28" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0f141c" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#1c2432" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#232d3d" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1a2230" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#5a6478" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#6b7688" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1e2836" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#7a8698" }] },
];

export function stylesFor(theme: "network" | "light" | "dark"): google.maps.MapTypeStyle[] {
  if (theme === "network") return NETWORK_VIEW_STYLE;
  // "dark" kept for back-compat with any old caller — collapse into network.
  if (theme === "dark") return NETWORK_VIEW_STYLE;
  return lightStyle;
}

// ─── Ziply / CAD-blueprint base map (spec §9) ──────────────────────────────
// A desaturated, low-contrast basemap so the colored fiber/terminal/hub
// overlays read like a CAD print laid over muted streets. POI/transit noise is
// dropped; roads stay visible but pale so the print layer dominates.
export const ZIPLY_MUTED_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#eceff1" }, { saturation: -70 }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#607d8b" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#eceff1" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#e0e0e0" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#d6d6d6" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#e6eaec" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#cfe3ec" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#b0bec5" }] },
];

// Snoqualmie / Seattle area default — user is based in WA.
// Centered on the North Metro Ziply job cluster (Snohomish / Marysville /
// Lake Stevens). Prevents the map from flashing a country-wide view on mount
// before fitBounds runs against the loaded jobs.
export const DEFAULT_CENTER = { lat: 48.05, lng: -122.15 };
export const DEFAULT_ZOOM = 10;
