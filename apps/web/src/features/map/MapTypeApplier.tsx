// MapTypeApplier — lives INSIDE the <Map> so it has access to useMap().
// Listens for "nsc:map-prefs-changed" broadcast from MapTypeToggle (which
// lives outside the Map in the topbar) and applies base map type + theme +
// detail toggles.
import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { getMapStyles, type MapTheme } from "./mapStyles.js";

const PREFS_KEY = "nsc:mapPrefs";

type MapType = "roadmap" | "satellite" | "hybrid" | "terrain";

interface MapPreferences {
  mapType: MapType;
  theme: MapTheme;
  dark: boolean;
  showRoadLabels: boolean;
  showPoiLabels: boolean;
  showCityLabels: boolean;
  showTransit: boolean;
}

const DEFAULT_PREFS: MapPreferences = {
  mapType: "roadmap",
  theme: "classic",
  dark: false,
  showRoadLabels: true,
  showPoiLabels: true,
  showCityLabels: true,
  showTransit: true,
};

function loadPrefs(): MapPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const theme: MapTheme = parsed.theme ?? (parsed.dark ? "dark" : "classic");
      return { ...DEFAULT_PREFS, ...parsed, theme };
    }
  } catch {}
  return { ...DEFAULT_PREFS };
}

export default function MapTypeApplier() {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const apply = (prefs: MapPreferences) => {
      // Billy 6/5: in Satellite mode honor the road-labels toggle.
      // Google Satellite imagery has no labels at all; Hybrid is satellite +
      // labels. So when the user picks Satellite WITH labels on, switch the
      // tile layer to Hybrid under the hood. When labels are off, stay on
      // pure Satellite.
      const effectiveMapType: MapType =
        prefs.mapType === "satellite" && prefs.showRoadLabels
          ? "hybrid"
          : prefs.mapType;
      map.setMapTypeId(effectiveMapType);
      // Satellite/hybrid imagery should not be re-colored — only style
      // roadmap/terrain base layers.
      const styleable = effectiveMapType === "roadmap" || effectiveMapType === "terrain";
      map.setOptions({
        styles: styleable
          ? getMapStyles({
              theme: prefs.theme,
              showRoadLabels: prefs.showRoadLabels,
              showPoiLabels: prefs.showPoiLabels,
              showCityLabels: prefs.showCityLabels,
              showTransit: prefs.showTransit,
            })
          : [],
      });
    };
    // Apply current prefs on mount
    apply(loadPrefs());
    // Re-apply whenever the topbar toggle broadcasts
    const handler = (e: Event) => {
      apply((e as CustomEvent<MapPreferences>).detail);
    };
    window.addEventListener("nsc:map-prefs-changed", handler);
    return () => window.removeEventListener("nsc:map-prefs-changed", handler);
  }, [map]);

  return null;
}
