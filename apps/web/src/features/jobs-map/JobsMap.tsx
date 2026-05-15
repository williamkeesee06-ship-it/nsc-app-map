// Jobs Map — Phase 1 scaffold. Renders the tactical map with one demo pin
// linking to the sample job workspace. Smartsheet sync is Phase 2.
import { useEffect } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { useNavigate } from "react-router-dom";
import { stylesFor, DEFAULT_CENTER, DEFAULT_ZOOM } from "../map/mapStyles.js";
import { useMapTheme } from "../map/themeContext.js";

export default function JobsMap() {
  const navigate = useNavigate();
  const { theme } = useMapTheme();
  return (
    <div className="workspace">
      <div className="map-host">
        <Map
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          styles={stylesFor(theme)}
          gestureHandling="greedy"
          disableDefaultUI={false}
        >
          <SampleJobMarker onOpen={() => navigate("/jobs/sample")} />
        </Map>
      </div>
      <div className="status-pill">Phase 1 · 1 sample job · Smartsheet sync coming in Phase 2</div>
    </div>
  );
}

function SampleJobMarker({ onOpen }: { onOpen: () => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const marker = new google.maps.Marker({
      position: DEFAULT_CENTER,
      map,
      title: "Sample Job — click to open",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#20808d",
        fillOpacity: 1,
        strokeColor: "#0b0f13",
        strokeWeight: 2,
      },
    });
    const listener = marker.addListener("click", onOpen);
    return () => {
      listener.remove();
      marker.setMap(null);
    };
  }, [map, onOpen]);
  return null;
}
