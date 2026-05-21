// Phase 9: Locate Me — uses navigator.geolocation, drops a temporary cross
// at the user's lat/lng, centers the map, and exposes a mini-toolbar to
// drop a Pole / MH / HH / PED / Line / Custom at that location.
import { useContext, useState, useEffect, useRef } from "react";
import { DrawingContext } from "./drawingContext.js";
import type { DrawingObject, DrawingTool } from "@nsc/types";

const LOCATE_ZOOM = 19;

interface Hit {
  lat: number;
  lng: number;
  cross: google.maps.Marker | null;
}

export default function LocateMeButton() {
  const ctx = useContext(DrawingContext);
  const [hit, setHit] = useState<Hit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const crossRef = useRef<google.maps.Marker | null>(null);

  // Clean up the cross when component unmounts
  useEffect(() => {
    return () => {
      crossRef.current?.setMap(null);
    };
  }, []);

  function clearHit() {
    crossRef.current?.setMap(null);
    crossRef.current = null;
    setHit(null);
  }

  function handleClick() {
    if (!ctx) return;
    if (!("geolocation" in navigator)) {
      setError("Geolocation not supported by this browser.");
      return;
    }
    const map = ctx.mapRef?.current;
    if (!map) {
      setError("Map not ready.");
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const { latitude: lat, longitude: lng } = pos.coords;
        // Drop a blue cross at the location
        crossRef.current?.setMap(null);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="10" fill="#3aa7ff" fill-opacity="0.15" stroke="#3aa7ff" stroke-width="2"/>
          <line x1="14" y1="3" x2="14" y2="25" stroke="#3aa7ff" stroke-width="2"/>
          <line x1="3" y1="14" x2="25" y2="14" stroke="#3aa7ff" stroke-width="2"/>
        </svg>`;
        const marker = new google.maps.Marker({
          position: { lat, lng },
          map,
          icon: {
            url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
            scaledSize: new google.maps.Size(28, 28),
            anchor: new google.maps.Point(14, 14),
          },
          clickable: false,
          zIndex: 9999,
        });
        crossRef.current = marker;
        map.panTo({ lat, lng });
        if ((map.getZoom() ?? 0) < LOCATE_ZOOM) map.setZoom(LOCATE_ZOOM);
        setHit({ lat, lng, cross: marker });
      },
      (err) => {
        setBusy(false);
        setError(err.message || "Unable to retrieve location.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  }

  function drop(tool: DrawingTool) {
    if (!ctx || !hit) return;
    // For point tools — create the object directly at the located lat/lng.
    if (
      tool === "pole_new" || tool === "mh_new" ||
      tool === "hh_new" || tool === "ped_new"
    ) {
      const id = `loc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const obj: DrawingObject = {
        id,
        tool,
        position: { lat: hit.lat, lng: hit.lng },
        style: {
          strokeColor: "#000000",
          strokeWidth: 2,
          strokeStyle: "solid",
          fill: { kind: "none" },
          opacity: 1,
        },
      };
      ctx.addObject(obj);
      clearHit();
      return;
    }
    // For line / custom — just activate the tool. User can then click on the
    // glowing target to drop the first vertex (snap will catch it).
    ctx.setTool(tool);
    clearHit();
  }

  if (!ctx) return null;

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title="Locate Me — drop pin at your GPS location"
        style={{
          background: "rgba(58, 167, 255, 0.12)",
          border: "1px solid rgba(58, 167, 255, 0.45)",
          color: "#3aa7ff",
          fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          padding: "5px 10px",
          borderRadius: 999,
          cursor: busy ? "wait" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {busy ? "Locating…" : "📍 Locate Me"}
      </button>

      {hit && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "rgba(18, 26, 40, 0.97)",
            border: "1px solid rgba(200,208,218,0.22)",
            borderRadius: 8,
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            zIndex: 9999,
            boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
            minWidth: 200,
            fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
          }}
        >
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
            color: "#8a96a3", textTransform: "uppercase",
          }}>
            Drop object here
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {([
              ["pole_new", "Pole"],
              ["mh_new", "MH"],
              ["hh_new", "HH"],
              ["ped_new", "PED"],
              ["line", "Line"],
              ["placed_cable", "Cable"],
            ] as Array<[DrawingTool, string]>).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => drop(t)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(200,208,218,0.2)",
                  color: "#f4f8ff",
                  borderRadius: 4,
                  padding: "4px 8px",
                  fontSize: 10,
                  fontFamily: "inherit",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={clearHit}
            style={{
              background: "transparent",
              border: "none",
              color: "#8a96a3",
              fontSize: 10,
              cursor: "pointer",
              textAlign: "right",
              padding: 0,
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "rgba(198, 40, 40, 0.95)",
            color: "#fff",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 10,
            zIndex: 9999,
            maxWidth: 260,
          }}
          onClick={() => setError(null)}
        >
          {error}
        </div>
      )}
    </div>
  );
}
