import React, { useEffect, useRef, useState } from "react";
import type { Job } from "@nsc/types";
import { Layers, RotateCw, Maximize2, Check, X, ShieldAlert, Sliders } from "lucide-react";

interface Props {
  job: Job;
  onClose: () => void;
}

interface SplitPage {
  pageNum: number;
  originalUrl: string;
  croppedUrl: string;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  opacity: number;
  locked: boolean;
  centerOffset: { x: number; y: number };
}

export default function ZiplyAlignmentStudio({ job, onClose }: Props) {
  const [pages, setPages] = useState<SplitPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active page values for direct manipulation
  const activePage = activePageIndex !== null ? pages[activePageIndex] : null;

  // Handle PDF Parsing & Margin Auto-Cropping
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setPages([]);
    setActivePageIndex(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      setLoadingProgress("Parsing PDF document...");
      const pdfjsLib = await import("pdfjs-dist");
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
      }
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const parsedPages: SplitPage[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setLoadingProgress(`Processing page ${i} of ${pdf.numPages}...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;

        const originalUrl = canvas.toDataURL("image/png");

        // --- Auto-Cropping Algorithm ---
        // Scan the canvas pixels to detect the drawing boundaries.
        // We detect margins (whitespace / title blocks on the bottom & right side) and trim them.
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        let minX = canvas.width;
        let maxX = 0;
        let minY = canvas.height;
        let maxY = 0;

        // Sample pixels to find boundaries of the actual drawing area
        for (let y = 0; y < canvas.height; y += 4) {
          for (let x = 0; x < canvas.width; x += 4) {
            const index = (y * canvas.width + x) * 4;
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            // Detect non-white pixels (drawing details)
            if (r < 240 || g < 240 || b < 240) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        // Apply a safe fallback padding or trim standard 10% from bottom/right title blocks
        const cropX = minX;
        const cropY = minY;
        const cropW = Math.max(100, (maxX - minX) * 0.95); // Trim outer 5% of potential border details
        const cropH = Math.max(100, (maxY - minY) * 0.9);  // Trim bottom 10% representing title blocks

        const cropCanvas = document.createElement("canvas");
        const cropCtx = cropCanvas.getContext("2d");
        if (cropCtx) {
          cropCanvas.width = cropW;
          cropCanvas.height = cropH;
          cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        }
        const croppedUrl = cropCtx ? cropCanvas.toDataURL("image/png") : originalUrl;

        parsedPages.push({
          pageNum: i,
          originalUrl,
          croppedUrl,
          width: cropW,
          height: cropH,
          rotation: 0,
          scale: 1.0,
          opacity: 0.6,
          locked: false,
          centerOffset: { x: 0, y: 0 },
        });
      }

      setPages(parsedPages);
      if (parsedPages.length > 0) setActivePageIndex(0);
    } catch (err) {
      alert("Error splitting PDF: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
      setLoadingProgress("");
    }
  };

  const updateActivePage = (patch: Partial<SplitPage>) => {
    if (activePageIndex === null) return;
    setPages((prev) =>
      prev.map((p, idx) => (idx === activePageIndex ? { ...p, ...patch } : p))
    );
  };

  // Listen to mouse drag over map to update centerOffset (panning the overlay sheet)
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!activePage || activePage.locked) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...activePage.centerOffset };
  };

  useEffect(() => {
    if (!dragging) return;

    const onWindowMouseMove = (e: MouseEvent) => {
      if (!activePage || activePage.locked) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const nextOffset = {
        x: offsetStart.current.x + dx,
        y: offsetStart.current.y + dy,
      };
      setPages((prev) =>
        prev.map((p, idx) => (idx === activePageIndex ? { ...p, centerOffset: nextOffset } : p))
      );
    };

    const onWindowMouseUp = () => {
      setDragging(false);
    };

    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
    };
  }, [dragging, activePage, activePageIndex]);

  // Broadcast layout state when alignment changes (deduplicated key prevents broadcast floods)
  const lastBroadcastRef = useRef("");
  useEffect(() => {
    if (!activePage) return;
    const key = `${job.jobId}:${activePage.croppedUrl}:${activePage.scale}:${activePage.rotation}:${activePage.opacity}:${activePage.centerOffset.x}:${activePage.centerOffset.y}:${activePage.locked}`;
    if (lastBroadcastRef.current === key) return;
    lastBroadcastRef.current = key;

    window.dispatchEvent(
      new CustomEvent("nsc:ziply-align-preview", {
        detail: {
          jobId: job.jobId,
          imageUrl: activePage.croppedUrl,
          scale: activePage.scale,
          rotation: activePage.rotation,
          opacity: activePage.opacity,
          offset: activePage.centerOffset,
          locked: activePage.locked,
        },
      })
    );
  }, [activePage, job.jobId]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(10, 15, 26, 0.94)",
        display: "flex",
        flexDirection: "column",
        color: "#f1f5f9",
      }}
    >
      {/* Top Header */}
      <header
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid rgba(6, 182, 212, 0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(15, 23, 42, 0.95)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Layers size={18} color="#06B6D4" />
          <h2 style={{ fontSize: "14px", fontWeight: 800, margin: 0, letterSpacing: "0.05em" }}>
            PRINT OVERLAY STUDIO · {job.workOrder}
          </h2>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <X size={20} />
        </button>
      </header>

      {/* Main Workspace Area */}
      <div style={{ flexGrow: 1, display: "flex", position: "relative", overflow: "hidden" }}>
        {/* Interactive Canvas Alignment Preview */}
        <div
          style={{
            flexGrow: 1,
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: activePage && !activePage.locked ? (dragging ? "grabbing" : "grab") : "default",
            userSelect: "none",
          }}
          onMouseDown={handleMouseDown}
        >
          {loading ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 40, height: 40, border: "3px solid #06b6d4", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
              <p style={{ fontSize: 13, color: "#94a3b8" }}>{loadingProgress}</p>
            </div>
          ) : activePage ? (
            <div
              style={{
                position: "absolute",
                transform: `translate(${activePage.centerOffset.x}px, ${activePage.centerOffset.y}px) rotate(${activePage.rotation}deg) scale(${activePage.scale})`,
                opacity: activePage.opacity,
                transition: dragging ? "none" : "transform 0.1s ease",
              }}
            >
              <img
                src={activePage.croppedUrl}
                alt="Active Align Layer"
                style={{
                  maxHeight: "60vh",
                  maxWidth: "80vw",
                  boxShadow: "0 0 30px rgba(6, 182, 212, 0.25)",
                  border: activePage.locked ? "2px solid #34d399" : "2px dashed #06b6d4",
                  background: "#fff",
                }}
              />
            </div>
          ) : (
            <div style={{ textAlign: "center", maxWidth: 320 }}>
              <ShieldAlert size={48} color="#64748b" style={{ margin: "0 auto 12px" }} />
              <h3 style={{ fontSize: "14px", fontWeight: 700, marginBottom: 8 }}>No Print Uploaded Yet</h3>
              <p style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.5, marginBottom: 16 }}>
                Upload an engineering PDF print file to split, crop, and align pages onto the map layer.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "1.5px solid #06B6D4",
                  background: "rgba(6, 182, 212, 0.05)",
                  color: "#06B6D4",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  fontSize: "11px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Upload PDF
              </button>
            </div>
          )}
        </div>

        {/* Right Manipulation Panel */}
        {activePage && (
          <div
            style={{
              width: 280,
              background: "rgba(15, 23, 42, 0.95)",
              borderLeft: "1px solid rgba(6, 182, 212, 0.2)",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Sliders size={16} color="#06B6D4" />
              <h3 style={{ fontSize: "12px", fontWeight: 800, margin: 0, textTransform: "uppercase" }}>
                Transform controls
              </h3>
            </div>

            {/* Rotation */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: "#94a3b8" }}>Rotate</span>
                <span style={{ fontWeight: 700 }}>{activePage.rotation}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                value={activePage.rotation}
                disabled={activePage.locked}
                onChange={(e) => updateActivePage({ rotation: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "#06b6d4" }}
              />
            </div>

            {/* Scale */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: "#94a3b8" }}>Resize (Scale)</span>
                <span style={{ fontWeight: 700 }}>{activePage.scale.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.05"
                value={activePage.scale}
                disabled={activePage.locked}
                onChange={(e) => updateActivePage({ scale: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "#06b6d4" }}
              />
            </div>

            {/* Opacity */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: "#94a3b8" }}>Opaque Levels</span>
                <span style={{ fontWeight: 700 }}>{Math.round(activePage.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={activePage.opacity}
                disabled={activePage.locked}
                onChange={(e) => updateActivePage({ opacity: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "#06b6d4" }}
              />
            </div>

            <div style={{ flexGrow: 1 }} />

            {/* Lock Overlay button */}
            <button
              onClick={() => updateActivePage({ locked: !activePage.locked })}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                border: activePage.locked ? "1.5px solid #34d399" : "1.5px solid #06B6D4",
                background: activePage.locked ? "rgba(52, 211, 153, 0.1)" : "rgba(6, 182, 212, 0.05)",
                color: activePage.locked ? "#34d399" : "#06B6D4",
                borderRadius: "8px",
                padding: "10px",
                fontSize: "11px",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {activePage.locked ? (
                <>
                  <Check size={14} /> LOCKED
                </>
              ) : (
                <>
                  <RotateCw size={14} /> LOCK POSITION
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={handlePdfUpload}
      />

      {/* Bottom Page Carousel */}
      {pages.length > 0 && (
        <div
          style={{
            height: 120,
            background: "rgba(15, 23, 42, 0.98)",
            borderTop: "1px solid rgba(6, 182, 212, 0.2)",
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: 16,
            overflowX: "auto",
          }}
        >
          {pages.map((p, idx) => {
            const isActive = idx === activePageIndex;
            return (
              <div
                key={p.pageNum}
                onClick={() => setActivePageIndex(idx)}
                style={{
                  height: 90,
                  width: 120,
                  flexShrink: 0,
                  position: "relative",
                  borderRadius: 6,
                  border: isActive ? "2px solid #06b6d4" : "1px solid rgba(255,255,255,0.1)",
                  cursor: "pointer",
                  overflow: "hidden",
                  background: "#1e293b",
                  boxShadow: isActive ? "0 0 10px rgba(6, 182, 212, 0.3)" : "none",
                }}
              >
                <img
                  src={p.croppedUrl}
                  alt={`Page ${p.pageNum}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <span
                  style={{
                    position: "absolute",
                    bottom: 4,
                    left: 4,
                    background: "rgba(0,0,0,0.7)",
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "1px 4px",
                    borderRadius: 3,
                  }}
                >
                  Page {p.pageNum}
                </span>
                {p.locked && (
                  <span
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      background: "#34d399",
                      color: "#000",
                      fontSize: 8,
                      fontWeight: 800,
                      padding: "1px 3px",
                      borderRadius: 3,
                    }}
                  >
                    LOCKED
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Spin Animation Definition */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
