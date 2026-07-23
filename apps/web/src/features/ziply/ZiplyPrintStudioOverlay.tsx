import { useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { Job, ZiplyPrintSheetOverlay } from "@nsc/types";
import ZiplyPrintHtmlOverlay from "./ZiplyPrintHtmlOverlay.js";

interface ZiplyPrintStudioOverlayProps {
  job: Job;
  activeSheet: ZiplyPrintSheetOverlay | null;
  bounds?: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } } | null;
  onSaveTransform: (sheetId: string, updates: Partial<ZiplyPrintSheetOverlay>) => void;
  onCloseStudio: () => void;
}

export function ZiplyPrintStudioOverlay({
  job: _job,
  activeSheet,
  bounds,
  onSaveTransform,
  onCloseStudio,
}: ZiplyPrintStudioOverlayProps) {
  const map = useMap();
  const [opacity, setOpacity] = useState(activeSheet?.opacity ?? 0.55);
  const [locked, setLocked] = useState(activeSheet?.locked ?? false);
  const [visible, setVisible] = useState(activeSheet?.visible ?? true);

  if (!activeSheet || !bounds) return null;

  const handleToggleLock = () => {
    const nextLocked = !locked;
    setLocked(nextLocked);
    onSaveTransform(activeSheet.id, { locked: nextLocked, opacity });
  };

  const handleOpacityChange = (val: number) => {
    setOpacity(val);
    onSaveTransform(activeSheet.id, { opacity: val });
  };

  return (
    <>
      {/* ── Georeferenced HTML Canvas Overlay ── */}
      {visible && (
        <ZiplyPrintHtmlOverlay
          url={activeSheet.pdfUrl}
          bounds={bounds}
          opacity={opacity}
          visible={visible}
        />
      )}

      {/* ── TOP FLOATING TRACING HUD BAR ── */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 2000,
          background: "linear-gradient(180deg, #0f172a 0%, #090d16 100%)",
          border: "1.5px solid #0284c7",
          boxShadow: "0 8px 32px rgba(2, 132, 199, 0.4)",
          borderRadius: 12,
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontFamily: "var(--font-mono, monospace)",
          minWidth: 460,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>{locked ? "🔒" : "🔓"}</span>
          <span style={{ fontSize: 11, fontWeight: 900, color: "#38bdf8", letterSpacing: "0.08em" }}>
            {activeSheet.sheetName}
          </span>
        </div>

        {/* Opacity Slider */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>Opacity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#0284c7" }}
          />
          <span style={{ fontSize: 10, fontWeight: 800, color: "#f8fafc", width: 32, textAlign: "right" }}>
            {Math.round(opacity * 100)}%
          </span>
        </div>

        {/* Visibility Toggle */}
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          style={{
            background: visible ? "rgba(2, 132, 199, 0.2)" : "rgba(255,255,255,0.06)",
            border: visible ? "1px solid #0284c7" : "1px solid rgba(255,255,255,0.15)",
            color: visible ? "#38bdf8" : "#94a3b8",
            fontSize: 10,
            fontWeight: 800,
            padding: "4px 8px",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          {visible ? "👁️ ON" : "🙈 OFF"}
        </button>

        {/* Lock / Unlock Toggle */}
        <button
          type="button"
          onClick={handleToggleLock}
          style={{
            background: locked ? "linear-gradient(135deg, #059669 0%, #10b981 100%)" : "linear-gradient(135deg, #d97706 0%, #f59e0b 100%)",
            border: "none",
            color: "#fff",
            fontSize: 10,
            fontWeight: 900,
            padding: "5px 12px",
            borderRadius: 6,
            cursor: "pointer",
            boxShadow: locked ? "0 0 12px rgba(16, 185, 129, 0.4)" : "0 0 12px rgba(245, 158, 11, 0.4)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {locked ? "🔒 Locked" : "🔓 Re-align"}
        </button>

        {/* Close Button */}
        <button
          type="button"
          onClick={onCloseStudio}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            fontSize: 14,
            cursor: "pointer",
            padding: "0 2px",
          }}
          title="Exit Print Studio"
        >
          ✕
        </button>
      </div>

      {/* ── UNLOCKED DIRECT CANVAS TRANSFORM HANDLES ── */}
      {!locked && (
        <div
          style={{
            position: "absolute",
            bottom: 84,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2000,
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid #f59e0b",
            borderRadius: 8,
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            ⚠️ Placement Mode
          </span>
          <button
            type="button"
            onClick={() => {
              if (map) {
                const center = map.getCenter();
                if (center) {
                  map.panTo(center);
                }
              }
            }}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#f8fafc",
              fontSize: 10,
              fontWeight: 700,
              padding: "4px 8px",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Center on Map
          </button>
          <button
            type="button"
            onClick={handleToggleLock}
            style={{
              background: "#10b981",
              border: "none",
              color: "#fff",
              fontSize: 10,
              fontWeight: 900,
              padding: "4px 10px",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Lock Overlay & Start Tracing ➔
          </button>
        </div>
      )}
    </>
  );
}
