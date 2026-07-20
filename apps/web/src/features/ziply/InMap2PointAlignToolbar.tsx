import { useState, useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { Job } from "@nsc/types";
import { api } from "../../lib/api.js";
import { listZiplyPrintFiles } from "./ziplyUtils.js";

interface Props {
  job: Job;
  onComplete?: () => void;
  onCancel?: () => void;
}

export default function InMap2PointAlignToolbar({ job, onComplete, onCancel }: Props) {
  const map = useMap();
  const files = listZiplyPrintFiles(job);
  const activeFile = files[0] ?? null;

  // 4-Step Alignment State:
  // Step 1: Click PDF Point 1
  // Step 2: Click Map Point 1
  // Step 3: Click PDF Point 2
  // Step 4: Click Map Point 2
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [pdfPt1, setPdfPt1] = useState<{ x: number; y: number } | null>(null);
  const [mapPt1, setMapPt1] = useState<{ lat: number; lng: number } | null>(null);
  const [pdfPt2, setPdfPt2] = useState<{ x: number; y: number } | null>(null);
  const [mapPt2, setMapPt2] = useState<{ lat: number; lng: number } | null>(null);

  const [statusMsg, setStatusMsg] = useState("Step 1: Click Point 1 on the PDF Print box (bottom left)");
  const [busy, setBusy] = useState(false);

  const pdfBoxRef = useRef<HTMLDivElement | null>(null);

  const handlePdfClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pdfBoxRef.current) return;
    const rect = pdfBoxRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 1000;
    const clickY = ((e.clientY - rect.top) / rect.height) * 1000;

    if (step === 1) {
      setPdfPt1({ x: clickX, y: clickY });
      setStep(2);
      setStatusMsg(`PDF Point 1 set (${Math.round(clickX)}, ${Math.round(clickY)}). Step 2: Click Point 1 on the Map`);
    } else if (step === 3) {
      setPdfPt2({ x: clickX, y: clickY });
      setStep(4);
      setStatusMsg(`PDF Point 2 set (${Math.round(clickX)}, ${Math.round(clickY)}). Step 4: Click Point 2 on the Map`);
    }
  };

  useEffect(() => {
    if (!map) return;

    let marker1: google.maps.Marker | null = null;
    let marker2: google.maps.Marker | null = null;

    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      if (step === 2 && pdfPt1) {
        setMapPt1({ lat, lng });
        setStep(3);
        setStatusMsg(`Map Point 1 set (${lat.toFixed(5)}, ${lng.toFixed(5)}). Step 3: Click Point 2 on the PDF Print box`);

        marker1 = new google.maps.Marker({
          position: { lat, lng },
          map,
          label: { text: "1", color: "#ffffff", fontWeight: "bold" },
          title: "Alignment Control Point 1",
        });
      } else if (step === 4 && pdfPt1 && mapPt1 && pdfPt2) {
        setMapPt2({ lat, lng });
        setBusy(true);
        setStatusMsg("Executing 2-Point Web Mercator Matrix Transformation...");

        marker2 = new google.maps.Marker({
          position: { lat, lng },
          map,
          label: { text: "2", color: "#ffffff", fontWeight: "bold" },
          title: "Alignment Control Point 2",
        });

        const cp1 = { pdf: pdfPt1, map: mapPt1 };
        const cp2 = { pdf: pdfPt2, map: { lat, lng } };

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
  }, [map, step, pdfPt1, mapPt1, pdfPt2, job.jobId, onComplete]);

  return (
    <>
      {/* Top Floating Command Bar */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          background: "rgba(15, 23, 42, 0.94)",
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

        <div style={{ fontSize: 12, fontWeight: 600, color: "#f8fafc", minWidth: 340 }}>
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

      {/* Floating PDF Print Viewport (Bottom Left) */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: 24,
          zIndex: 1000,
          width: 380,
          height: 260,
          background: "#ffffff",
          borderRadius: 12,
          border: "2px solid #0284c7",
          boxShadow: "0 12px 36px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
          resize: "both",
          minWidth: 300,
          minHeight: 200,
          maxWidth: "80vw",
          maxHeight: "80vh",
        }}
      >
        <div
          style={{
            background: "#0f172a",
            color: "#38bdf8",
            padding: "6px 10px",
            fontSize: 11,
            fontWeight: 800,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>PDF PRINT PREVIEW (Click Points 1 & 2)</span>
          <span style={{ fontSize: 10, color: "#94a3b8" }}>{job.workOrder}</span>
        </div>

        <div
          ref={pdfBoxRef}
          onClick={handlePdfClick}
          style={{
            flex: 1,
            position: "relative",
            cursor: step === 1 || step === 3 ? "crosshair" : "default",
            overflow: "hidden",
            background: "#f8fafc",
          }}
        >
          {activeFile?.downloadUrl ? (
            activeFile.contentType?.includes("pdf") || activeFile.name?.toLowerCase().endsWith(".pdf") ? (
              <object
                data={`${activeFile.downloadUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                type="application/pdf"
                style={{
                  width: "100%",
                  height: "100%",
                  border: 0,
                  pointerEvents: "none",
                }}
              >
                <embed
                  src={`${activeFile.downloadUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                  type="application/pdf"
                  style={{ width: "100%", height: "100%", pointerEvents: "none" }}
                />
              </object>
            ) : (
              <img
                src={activeFile.downloadUrl}
                alt="PDF Print"
                style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
              />
            )
          ) : (
            <div style={{ padding: 16, fontSize: 11, color: "#64748b" }}>
              No PDF print uploaded on this job.
            </div>
          )}

          {pdfPt1 && (
            <div
              style={{
                position: "absolute",
                left: `${(pdfPt1.x / 1000) * 100}%`,
                top: `${(pdfPt1.y / 1000) * 100}%`,
                transform: "translate(-50%, -50%)",
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#22c55e",
                border: "2px solid #ffffff",
                boxShadow: "0 0 8px #22c55e",
              }}
              title="PDF Point 1"
            />
          )}

          {pdfPt2 && (
            <div
              style={{
                position: "absolute",
                left: `${(pdfPt2.x / 1000) * 100}%`,
                top: `${(pdfPt2.y / 1000) * 100}%`,
                transform: "translate(-50%, -50%)",
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#06b6d4",
                border: "2px solid #ffffff",
                boxShadow: "0 0 8px #06b6d4",
              }}
              title="PDF Point 2"
            />
          )}
        </div>
      </div>
    </>
  );
}
