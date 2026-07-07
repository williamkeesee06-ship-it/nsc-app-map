import { useEffect, useState, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { Ruler, Square, X, Trash2 } from "lucide-react";
import "./measuringOverlay.css";

type MeasuringMode = "off" | "distance" | "area";

export default function MeasuringOverlay() {
  const map = useMap();
  const [mode, setMode] = useState<MeasuringMode>("off");
  const [points, setPoints] = useState<google.maps.LatLngLiteral[]>([]);
  const [measureText, setMeasureText] = useState<string | null>(null);

  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const polygonRef = useRef<google.maps.Polygon | null>(null);

  // Clean up shapes on unmount or mode change
  useEffect(() => {
    return () => {
      polylineRef.current?.setMap(null);
      polygonRef.current?.setMap(null);
    };
  }, [mode]);

  useEffect(() => {
    if (mode === "off") {
      setPoints([]);
      setMeasureText(null);
      return;
    }

    if (!map) return;

    const clickListener = google.maps.event.addListener(map, "click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      setPoints(prev => [...prev, { lat, lng }]);
    });

    return () => {
      google.maps.event.removeListener(clickListener);
    };
  }, [mode, map]);

  // Update shapes and calculations when points change
  useEffect(() => {
    if (!map) return;

    if (mode === "distance") {
      if (!polylineRef.current) {
        polylineRef.current = new google.maps.Polyline({
          map,
          strokeColor: "#ffeb3b",
          strokeOpacity: 0.8,
          strokeWeight: 4,
          clickable: false,
        });
      }
      polylineRef.current.setPath(points);
      
      if (points.length >= 2) {
        const lengthMeters = google.maps.geometry.spherical.computeLength(points);
        const lengthFeet = lengthMeters * 3.28084;
        if (lengthFeet > 5280) {
          setMeasureText(`${(lengthFeet / 5280).toFixed(2)} mi`);
        } else {
          setMeasureText(`${lengthFeet.toFixed(0)} ft`);
        }
      } else {
        setMeasureText(null);
      }
    } else if (mode === "area") {
      if (!polygonRef.current) {
        polygonRef.current = new google.maps.Polygon({
          map,
          strokeColor: "#ffeb3b",
          strokeOpacity: 0.8,
          strokeWeight: 3,
          fillColor: "#ffeb3b",
          fillOpacity: 0.25,
          clickable: false,
        });
      }
      polygonRef.current.setPath(points);

      if (points.length >= 3) {
        const areaSqMeters = google.maps.geometry.spherical.computeArea(points);
        const areaSqFt = areaSqMeters * 10.7639;
        setMeasureText(`${areaSqFt.toFixed(0)} sq ft`);
      } else {
        setMeasureText(null);
      }
    }
  }, [points, mode, map]);

  return (
    <>
      <div className="measuring-toolbar">
        <button
          className={`measuring-btn ${mode === "distance" ? "active" : ""}`}
          onClick={() => setMode("distance")}
          title="Measure Distance"
        >
          <Ruler size={18} />
        </button>
        <button
          className={`measuring-btn ${mode === "area" ? "active" : ""}`}
          onClick={() => setMode("area")}
          title="Measure Area"
        >
          <Square size={18} />
        </button>
        
        {mode !== "off" && (
          <>
            <div className="measuring-divider" />
            <div className="measuring-readout">
              {measureText || (mode === "distance" ? "Click points to measure..." : "Click 3+ points...")}
            </div>
            <button
              className="measuring-btn clear"
              onClick={() => { setPoints([]); setMeasureText(null); }}
              title="Clear Points"
            >
              <Trash2 size={16} />
            </button>
            <button
              className="measuring-btn close"
              onClick={() => setMode("off")}
              title="Exit Measuring Mode"
            >
              <X size={18} />
            </button>
          </>
        )}
      </div>
    </>
  );
}
