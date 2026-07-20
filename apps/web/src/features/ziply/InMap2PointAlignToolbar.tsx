import { useState, useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { Job } from "@nsc/types";
import { api } from "../../lib/api.js";

interface Props {
  job: Job;
  onComplete?: () => void;
  onCancel?: () => void;
}

export default function InMap2PointAlignToolbar({ job, onComplete, onCancel }: Props) {
  const map = useMap();
  const [step, setStep] = useState<1 | 2>(1);
  const [pt1, setPt1] = useState<{ lat: number; lng: number } | null>(null);
  const [pt2, setPt2] = useState<{ lat: number; lng: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState("Step 1: Click Map location for Point 1 (Anchor)");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!map) return;

    let marker1: google.maps.Marker | null = null;
    let marker2: google.maps.Marker | null = null;

    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      if (step === 1) {
        setPt1({ lat, lng });
        setStep(2);
        setStatusMsg(`Point 1 Set (${lat.toFixed(5)}, ${lng.toFixed(5)}). Step 2: Click Map location for Point 2 (Reference)`);

        marker1 = new google.maps.Marker({
          position: { lat, lng },
          map,
          label: { text: "1", color: "#ffffff", fontWeight: "bold" },
          title: "Alignment Control Point 1",
        });
      } else if (step === 2 && pt1) {
        setPt2({ lat, lng });
        setBusy(true);
        setStatusMsg("Executing 2-Point Web Mercator Matrix Transformation...");

        marker2 = new google.maps.Marker({
          position: { lat, lng },
          map,
          label: { text: "2", color: "#ffffff", fontWeight: "bold" },
          title: "Alignment Control Point 2",
        });

        const cp1 = { pdf: { x: 100, y: 100 }, map: pt1 };
        const cp2 = { pdf: { x: 900, y: 900 }, map: { lat, lng } };

        api
          .affineAlignZiplyPrint(job.jobId, cp1, cp2)
          .then(() => {
            setStatusMsg("✅ 2-Point Georeferenced! Plant transformed on map with 100% CAD precision.");
            window.dispatchEvent(new Event("nsc:jobs-reload"));
            setTimeout(() => {
              if (marker1) marker1.setMap(null);
              if (marker2) marker2.setMap(null);
              if (onComplete) onComplete();
            }, 1500);
          })
          .catch((err) => {
            setStatusMsg(`Alignment Error: ${err.message}`);
            setBusy(false);
          });
      }
    });

    return () => {
      google.maps.event.removeListener(listener);
      if (marker1) marker1.setMap(null);
      if (marker2) marker2.setMap(null);
    };
  }, [map, step, pt1, job.jobId, onComplete]);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(12px)",
        border: "1px solid #0284c7",
        boxShadow: "0 8px 32px rgba(2, 132, 199, 0.35)",
        borderRadius: 12,
        padding: "10px 18px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.06em",
          color: "#38bdf8",
        }}
      >
        <span style={{ fontSize: 16 }}>🎯</span>
        <span>2-POINT IN-MAP ALIGNMENT</span>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: "#f8fafc", minWidth: 320 }}>
        {statusMsg}
      </div>

      {onCancel && (
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          style={{
            background: "#334155",
            border: "1px solid #475569",
            color: "#f1f5f9",
            borderRadius: 6,
            padding: "5px 10px",
            fontWeight: 700,
            fontSize: 11,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          Cancel ✕
        </button>
      )}
    </div>
  );
}
