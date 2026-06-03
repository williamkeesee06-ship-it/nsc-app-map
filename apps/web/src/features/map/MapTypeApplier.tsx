// MapTypeApplier — lives INSIDE the <Map> so it has access to useMap().
// Listens for "nsc:map-prefs-changed" broadcast from MapTypeToggle (which
// lives outside the Map in the topbar) and applies map type + label styles.
import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { getMapStyles } from "./mapStyles.js";

const PREFS_KEY = "nsc:mapPrefs";

type MapType = "roadmap" | "satellite" | "hybrid" | "terrain";

interface MapPreferences {
  mapType: MapType;
  dark: boolean;
  showRoadLabels: boolean;
  showPoiLabels: boolean;
  showCityLabels: boolean;
}

function loadPrefs(): MapPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    mapType: "roadmap",
    dark: false,
    showRoadLabels: true,
    showPoiLabels: true,
    showCityLabels: true,
  };
}

export default function MapTypeApplier() {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const apply = (prefs: MapPreferences) => {
      map.setMapTypeId(prefs.mapType);
      map.setOptions({
        styles: getMapStyles({
          dark: prefs.dark,
          showRoadLabels: prefs.showRoadLabels,
          showPoiLabels: prefs.showPoiLabels,
          showCityLabels: prefs.showCityLabels,
        }),
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
