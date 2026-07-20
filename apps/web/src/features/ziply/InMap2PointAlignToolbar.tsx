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

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [pdfPt1, setPdfPt1] = useState<{ x: number; y: number } | null>(null);
  const [mapPt1, setMapPt1] = useState<{ lat: number; lng: number } | null>(null);
  const [pdfPt2, setPdfPt2] = useState<{ x: number; y: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState("Step 1: Click a point on the PDF preview (bottom-left box)");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pdfBoxRef = useRef<HTMLDivElement | null>(null);
  // Track pins as DOM overlays so we don't need deprecated google.maps.Marker
  const pin1Ref = useRef<google.maps.OverlayView | null>(null);
  const pin2Ref = useRef<google.maps.OverlayView | null>(null);

  // Helper: create a simple coloured dot overlay on the map
  function makePin(lat: number, lng: number, color: string, label: string): google.maps.OverlayView {
    class DotOverlay extends google.maps.OverlayView {
      private el: HTMLDivElement;
      private pos: google.maps.LatLng;
      constructor(position: google.maps.LatLng) {
        super();
        this.pos = position;
        this.el = document.createElement("div");
        this.el.style.cssText = `
          position:absolute;width:24px;height:24px;border-radius:50%;
          background:${color};border:3px solid #fff;
          box-shadow:0 0 12px ${color};
          display:flex;align-items:center;justify-content:center;
          color:#fff;font-size:11px;font-weight:900;
          transform:translate(-50%,-50%);pointer-events:none;
          font-family:sans-serif;
        `;
        this.el.textContent = label;
      }
      onAdd() { this.getPanes()!.overlayMouseTarget.appendChild(this.el); }
      draw() {
        const p = this.getProjection().fromLatLngToDivPixel(this.pos);
        if (p) { this.el.style.left = p.x + "px"; this.el.style.top = p.y + "px"; }
      }
      onRemove() { this.el.parentNode?.removeChild(this.el); }
    }
    const overlay = new DotOverlay(new google.maps.LatLng(lat, lng));
    overlay.setMap(map);
    return overlay;
  }

  const handlePdfClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pdfBoxRef.current) return;
    const rect = pdfBoxRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 1000;
    const clickY = ((e.clientY - rect.top) / rect.height) * 1000;

    if (step === 1) {
      setPdfPt1({ x: clickX, y: clickY });
      setStep(2);
      setStatusMsg(`✅ PDF Point 1 set. Now Step 2: Click the same spot on the Google Map`);
    } else if (step === 3) {
      setPdfPt2({ x: clickX, y: clickY });
      setStep(4);
      setStatusMsg(`✅ PDF Point 2 set. Now Step 4: Click the same spot on the Google Map`);
    }
  };

  useEffect(() => {
    if (!map) return;

    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      if (step === 2 && pdfPt1) {
        setMapPt1({ lat, lng });
        setStep(3);
        setStatusMsg(`✅ Map Point 1 pinned. Now Step 3: Click Point 2 on the PDF preview`);
        if (pin1Ref.current) { pin1Ref.current.setMap(null); }
        pin1Ref.current = makePin(lat, lng, "#22c55e", "1");

      } else if (step === 4 && pdfPt1 && mapPt1 && pdfPt2) {
        setBusy(true);
        setError(null);
        setStatusMsg("⏳ Computing affine transformation matrix…");
        if (pin2Ref.current) { pin2Ref.current.setMap(null); }
        pin2Ref.current = makePin(lat, lng, "#06b6d4", "2");

        const cp1 = { pdf: pdfPt1, map: mapPt1 };
        const cp2 = { pdf: pdfPt2, map: { lat, lng } };

        api.affineAlignZiplyPrint(job.jobId, cp1, cp2)
          .then(() => {
            setStatusMsg("✅ Aligned! Telecom plant georeferenced on map.");
            window.dispatchEvent(new Event("nsc:jobs-reload"));
            setTimeout(() => {
              if (pin1Ref.current) pin1Ref.current.setMap(null);
              if (pin2Ref.current) pin2Ref.current.setMap(null);
              if (onComplete) onComplete();
            }, 2000);
          })
          .catch((err: Error) => {
            setError(`API Error: ${err.message}`);
            setBusy(false);
            setStatusMsg("❌ Alignment failed. See error below.");
          });
      }
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, step, pdfPt1, mapPt1, pdfPt2, job.jobId]);

  // Cleanup pins on unmount
  useEffect(() => {
    return () => {
      if (pin1Ref.current) pin1Ref.current.setMap(null);
      if (pin2Ref.current) pin2Ref.current.setMap(null);
    };
  }, []);

  const stepColor = busy ? "#f59e0b" : error ? "#ef4444" : "#22c55e";

  return (
    <>
      {/* ── Top HUD Command Bar ── */}
      <div style={{
        position: "absolute", top: 16, left: "50%",
        transform: "translateX(-50%)", zIndex: 2000,
        background: "#0f172a", border: "1.5px solid #0284c7",
        boxShadow: "0 8px 32px rgba(2,132,199,0.4)",
        borderRadius: 12, padding: "10px 18px",
        display: "flex", alignItems: "center", gap: 14,
        fontFamily: "ui-monospace, Consolas, monospace", minWidth: 520,
      }}>
        <span style={{ fontSize: 18 }}>🎯</span>
        <span style={{ fontSize: 11, fontWeight: 900, color: "#38bdf8", letterSpacing: "0.08em", flexShrink: 0 }}>
          2-POINT ALIGN
        </span>
        {/* Step indicators */}
        {([1,2,3,4] as const).map(n => (
          <div key={n} style={{
            width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
            background: step > n ? "#22c55e" : step === n ? "#0284c7" : "#334155",
            border: step === n ? "2px solid #7dd3fc" : "2px solid transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 900, color: "#fff",
          }}>{n}</div>
        ))}
        <span style={{ fontSize: 11, color: stepColor, fontWeight: 700, flex: 1 }}>
          {statusMsg}
        </span>
        {error && <span style={{ fontSize: 10, color: "#ef4444", maxWidth: 160 }}>{error}</span>}
        {onCancel && (
          <button type="button" onClick={() => {
            if (pin1Ref.current) pin1Ref.current.setMap(null);
            if (pin2Ref.current) pin2Ref.current.setMap(null);
            onCancel();
          }} disabled={busy} style={{
            background: "#1e293b", border: "1px solid #475569",
            color: "#94a3b8", borderRadius: 6, padding: "4px 10px",
            fontSize: 11, fontWeight: 700, cursor: busy ? "wait" : "pointer", flexShrink: 0,
          }}>
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
          zIndex: 2000,
          width: 380,
          height: 260,
          background: "#ffffff",
          borderRadius: 12,
          border: "2px solid #0284c7",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
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
            padding: "6px 12px",
            fontSize: 10,
            fontWeight: 800,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "ui-monospace, Consolas, monospace",
          }}
        >
          <span>PDF PRINT — {step === 1 ? "CLICK POINT 1" : step === 3 ? "CLICK POINT 2" : "✓ DONE"}</span>
          <span style={{ color: "#64748b" }}>{job.workOrder}</span>
        </div>

        {/* Clickable area */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            background: "#f1f5f9",
            position: "relative"
          }}
        >
          <div
            ref={pdfBoxRef}
            onClick={handlePdfClick}
            style={{
              width: "100%",
              height: "100%",
              position: "relative",
              cursor: (step === 1 || step === 3) && !busy ? "crosshair" : "default",
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
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: "100%", gap: 8, color: "#64748b", fontFamily: "ui-monospace, Consolas, monospace",
            }}>
              <span style={{ fontSize: 24 }}>📄</span>
              <span style={{ fontSize: 10, fontWeight: 700 }}>No PDF print on this job</span>
              <span style={{ fontSize: 9, color: "#94a3b8" }}>Upload a print in the job card first</span>
            </div>
          )}

          {/* Green dot for PDF Point 1 */}
          {pdfPt1 && (
            <div style={{
              position: "absolute",
              left: `${(pdfPt1.x / 1000) * 100}%`,
              top: `${(pdfPt1.y / 1000) * 100}%`,
              transform: "translate(-50%,-50%)",
              width: 16, height: 16, borderRadius: "50%",
              background: "#22c55e", border: "2.5px solid #fff",
              boxShadow: "0 0 10px #22c55e",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 900, color: "#fff",
              pointerEvents: "none",
            }}>1</div>
          )}

          {/* Cyan dot for PDF Point 2 */}
          {pdfPt2 && (
            <div style={{
              position: "absolute",
              left: `${(pdfPt2.x / 1000) * 100}%`,
              top: `${(pdfPt2.y / 1000) * 100}%`,
              transform: "translate(-50%,-50%)",
              width: 16, height: 16, borderRadius: "50%",
              background: "#06b6d4", border: "2.5px solid #fff",
              boxShadow: "0 0 10px #06b6d4",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 900, color: "#fff",
              pointerEvents: "none",
            }}>2</div>
          )}
        </div>
        </div>
      </div>
    </>
  );
}
