import { useEffect, useState, useRef, useCallback } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { Ruler, Square, X, Trash2, Save, Move, Check } from "lucide-react";
import { useDrawing } from "../drawing/drawingContext.js";
import type { DrawingObject } from "@nsc/types";
import "./measuringOverlay.css";

type MeasuringMode = "distance" | "area";
type UnitSystem = "ft" | "mi" | "m";

export default function MeasuringOverlay() {
  const map = useMap();
  const { state, setTool, addObject } = useDrawing();

  const isMeasuring = state.activeTool === "measure";
  const [mode, setMode] = useState<MeasuringMode>("distance");
  const [unit, setUnit] = useState<UnitSystem>("ft");
  const [points, setPoints] = useState<google.maps.LatLngLiteral[]>([]);
  const [mousePos, setMousePos] = useState<google.maps.LatLngLiteral | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const polygonRef = useRef<google.maps.Polygon | null>(null);
  const ghostLineRef = useRef<google.maps.Polyline | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const segmentBadgesRef = useRef<google.maps.Marker[]>([]);

  // Reset state when measure tool is exited
  useEffect(() => {
    if (!isMeasuring) {
      setPoints([]);
      setMousePos(null);
      setSavedSuccess(false);
    }
  }, [isMeasuring]);

  // Clean up shapes & markers on unmount or mode/tool change
  const clearMapOverlays = useCallback(() => {
    polylineRef.current?.setMap(null);
    polylineRef.current = null;
    polygonRef.current?.setMap(null);
    polygonRef.current = null;
    ghostLineRef.current?.setMap(null);
    ghostLineRef.current = null;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    segmentBadgesRef.current.forEach((b) => b.setMap(null));
    segmentBadgesRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      clearMapOverlays();
    };
  }, [clearMapOverlays]);

  // Map Click Listener to add vertices
  useEffect(() => {
    if (!isMeasuring || !map) return;

    const clickListener = google.maps.event.addListener(map, "click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      setPoints((prev) => [...prev, { lat, lng }]);
    });

    const moveListener = google.maps.event.addListener(map, "mousemove", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      setMousePos({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    });

    return () => {
      google.maps.event.removeListener(clickListener);
      google.maps.event.removeListener(moveListener);
    };
  }, [isMeasuring, map]);

  // Render Rubber-band Ghost Polyline to Cursor
  useEffect(() => {
    if (!map || !isMeasuring || points.length === 0 || !mousePos) {
      ghostLineRef.current?.setMap(null);
      return;
    }

    const lastPt = points[points.length - 1];
    const path = [lastPt, mousePos];
    if (mode === "area" && points.length >= 2) {
      path.push(points[0]); // Close area loop preview
    }

    if (!ghostLineRef.current) {
      ghostLineRef.current = new google.maps.Polyline({
        map,
        strokeColor: "#ffeb3b",
        strokeOpacity: 0.6,
        strokeWeight: 2,
        clickable: false,
        zIndex: 99,
      });
    }

    ghostLineRef.current.setPath(path);
  }, [map, isMeasuring, points, mousePos, mode]);

  // Render Shapes, Node Markers & Segment Badges
  useEffect(() => {
    if (!map || !isMeasuring) {
      clearMapOverlays();
      return;
    }

    // 1. Render main line or polygon
    if (mode === "distance") {
      polygonRef.current?.setMap(null);
      polygonRef.current = null;

      if (!polylineRef.current) {
        polylineRef.current = new google.maps.Polyline({
          map,
          strokeColor: "#ffeb3b",
          strokeOpacity: 0.9,
          strokeWeight: 4,
          clickable: false,
          zIndex: 100,
        });
      }
      polylineRef.current.setPath(points);
    } else {
      polylineRef.current?.setMap(null);
      polylineRef.current = null;

      if (!polygonRef.current) {
        polygonRef.current = new google.maps.Polygon({
          map,
          strokeColor: "#ffeb3b",
          strokeOpacity: 0.9,
          strokeWeight: 3,
          fillColor: "#ffeb3b",
          fillOpacity: 0.2,
          clickable: false,
          zIndex: 100,
        });
      }
      polygonRef.current.setPath(points);
    }

    // 2. Sync Vertex Markers (Google Earth style draggable node handles)
    while (markersRef.current.length > points.length) {
      const m = markersRef.current.pop();
      m?.setMap(null);
    }

    points.forEach((pt, index) => {
      let marker = markersRef.current[index];
      if (!marker) {
        marker = new google.maps.Marker({
          position: pt,
          map,
          draggable: true,
          cursor: "grab",
          title: `Node ${index + 1} (Drag to adjust)`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: "#ffeb3b",
            fillOpacity: 1,
            strokeColor: "#0b1118",
            strokeWeight: 2,
          },
          zIndex: 105,
        });

        marker.addListener("drag", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          const lat = e.latLng.lat();
          const lng = e.latLng.lng();
          setPoints((prev) => {
            const next = [...prev];
            next[index] = { lat, lng };
            return next;
          });
        });

        markersRef.current[index] = marker;
      } else {
        marker.setPosition(pt);
      }
    });

    // 3. Render Midpoint Segment Footage Badges
    while (segmentBadgesRef.current.length > 0) {
      const b = segmentBadgesRef.current.pop();
      b?.setMap(null);
    }

    if (points.length >= 2 && google.maps.geometry?.spherical) {
      const segmentCount = mode === "area" && points.length >= 3 ? points.length : points.length - 1;

      for (let i = 0; i < segmentCount; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];

        const midLat = (p1.lat + p2.lat) / 2;
        const midLng = (p1.lng + p2.lng) / 2;
        const distMeters = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
        const distFeet = distMeters * 3.28084;
        const labelText = distFeet > 5280 ? `${(distFeet / 5280).toFixed(2)} mi` : `${distFeet.toFixed(0)} ft`;

        const badgeWidth = Math.max(48, labelText.length * 8 + 12);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="20" viewBox="0 0 ${badgeWidth} 20">
          <rect x="0" y="0" width="${badgeWidth}" height="20" rx="4" fill="#0b1118" stroke="#ffeb3b" stroke-width="1.5" opacity="0.95"/>
          <text x="${badgeWidth / 2}" y="14" font-family="ui-monospace, monospace" font-size="11" font-weight="bold" fill="#ffeb3b" text-anchor="middle">${labelText}</text>
        </svg>`;
        const iconUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

        const badgeMarker = new google.maps.Marker({
          position: { lat: midLat, lng: midLng },
          map,
          clickable: false,
          icon: {
            url: iconUrl,
            anchor: new google.maps.Point(badgeWidth / 2, 10),
          },
          zIndex: 102,
        });

        segmentBadgesRef.current.push(badgeMarker);
      }
    }
  }, [map, isMeasuring, points, mode, clearMapOverlays]);

  // Compute Total Metrics
  const metrics = useCallback(() => {
    if (points.length < 2 || !google.maps.geometry?.spherical) {
      return { lengthFt: 0, areaSqFt: 0 };
    }

    const lengthMeters = google.maps.geometry.spherical.computeLength(points);
    const lengthFt = lengthMeters * 3.28084;

    let areaSqFt = 0;
    if (mode === "area" && points.length >= 3) {
      const areaSqM = google.maps.geometry.spherical.computeArea(points);
      areaSqFt = areaSqM * 10.7639;
    }

    return { lengthFt, areaSqFt };
  }, [points, mode]);

  const { lengthFt, areaSqFt } = metrics();

  const formatDistance = (feet: number) => {
    if (unit === "mi") return `${(feet / 5280).toFixed(2)} mi`;
    if (unit === "m") return `${(feet / 3.28084).toFixed(1)} m`;
    return `${feet.toLocaleString(undefined, { maximumFractionDigits: 0 })} ft`;
  };

  const formatArea = (sqFt: number) => {
    if (sqFt > 43560) return `${(sqFt / 43560).toFixed(2)} acres`;
    return `${sqFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft`;
  };

  const handleSaveAsMarkup = () => {
    if (points.length < 2) return;
    const desc = mode === "area"
      ? `Area: ${formatArea(areaSqFt)} (Perimeter: ${formatDistance(lengthFt)})`
      : `Measurement: ${formatDistance(lengthFt)}`;

    const newObj: DrawingObject = mode === "area" ? {
      id: `measure_${Date.now()}`,
      tool: "polygon",
      vertices: points,
      style: {
        strokeColor: "#ffeb3b",
        strokeWidth: 3,
        strokeStyle: "solid",
        fill: { kind: "solid", color: "#ffeb3b" },
        opacity: 0.8,
      },
    } : {
      id: `measure_${Date.now()}`,
      tool: "line",
      vertices: points,
      style: {
        strokeColor: "#ffeb3b",
        strokeWidth: 3,
        strokeStyle: "solid",
        fill: { kind: "none" },
        opacity: 1,
      },
    };

    addObject(newObj);

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  if (!isMeasuring) return null;

  return (
    <div className="google-earth-measure-card">
      <div className="gem-card-header">
        <div className="gem-title">
          <Ruler size={15} style={{ color: "#ffeb3b" }} />
          <span>MEASURE TOOL</span>
        </div>
        <button
          type="button"
          className="gem-close-btn"
          onClick={() => setTool("select")}
          title="Exit Measurement Mode"
        >
          <X size={16} />
        </button>
      </div>

      <div className="gem-mode-switcher">
        <button
          type="button"
          className={`gem-mode-btn ${mode === "distance" ? "active" : ""}`}
          onClick={() => setMode("distance")}
        >
          <Ruler size={14} />
          <span>Path (Distance)</span>
        </button>
        <button
          type="button"
          className={`gem-mode-btn ${mode === "area" ? "active" : ""}`}
          onClick={() => setMode("area")}
        >
          <Square size={14} />
          <span>Polygon (Area)</span>
        </button>
      </div>

      <div className="gem-readout-section">
        {points.length < 2 ? (
          <div className="gem-hint">
            <Move size={14} />
            <span>Click on the map to place measurement points. Drag yellow node handles to adjust.</span>
          </div>
        ) : (
          <>
            <div className="gem-metric-row">
              <span className="gem-metric-label">
                {mode === "area" ? "Perimeter:" : "Total Distance:"}
              </span>
              <span className="gem-metric-value">{formatDistance(lengthFt)}</span>
            </div>

            {mode === "area" && points.length >= 3 && (
              <div className="gem-metric-row">
                <span className="gem-metric-label">Total Area:</span>
                <span className="gem-metric-value highlight">{formatArea(areaSqFt)}</span>
              </div>
            )}

            <div className="gem-units-row">
              <span className="gem-units-label">Units:</span>
              <button
                type="button"
                className={`gem-unit-btn ${unit === "ft" ? "active" : ""}`}
                onClick={() => setUnit("ft")}
              >
                ft
              </button>
              <button
                type="button"
                className={`gem-unit-btn ${unit === "mi" ? "active" : ""}`}
                onClick={() => setUnit("mi")}
              >
                mi
              </button>
              <button
                type="button"
                className={`gem-unit-btn ${unit === "m" ? "active" : ""}`}
                onClick={() => setUnit("m")}
              >
                m
              </button>
            </div>
          </>
        )}
      </div>

      {points.length >= 2 && (
        <div className="gem-actions-row">
          <button
            type="button"
            className="gem-action-btn save"
            onClick={handleSaveAsMarkup}
            title="Save measurement shape as persistent markup"
          >
            {savedSuccess ? <Check size={14} /> : <Save size={14} />}
            <span>{savedSuccess ? "Saved!" : "Save Markup"}</span>
          </button>
          <button
            type="button"
            className="gem-action-btn clear"
            onClick={() => setPoints([])}
            title="Clear all points"
          >
            <Trash2 size={14} />
            <span>Clear</span>
          </button>
        </div>
      )}
    </div>
  );
}
