import { useState } from "react";

interface PrintCropperModalProps {
  sheetName: string;
  url: string;
  onConfirmCrop: (cropBox: { x: number; y: number; width: number; height: number }) => void;
  onCancel: () => void;
}

export function PrintCropperModal({
  sheetName,
  url,
  onConfirmCrop,
  onCancel,
}: PrintCropperModalProps) {
  // Default smart crop: 5% left/top margin, 90% width, 85% height (slices bottom/side CAD title block)
  const [cropBox, setCropBox] = useState({
    x: 0.05,
    y: 0.05,
    width: 0.9,
    height: 0.82,
  });

  const isPdf = url.toLowerCase().includes(".pdf");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        background: "rgba(10, 15, 26, 0.88)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        userSelect: "none",
      }}
    >
      {/* Container Box */}
      <div
        style={{
          width: "min(850px, 92vw)",
          height: "min(600px, 85vh)",
          background: "#0f172a",
          border: "2px solid #0077ff",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0, 119, 255, 0.35)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: "10px 16px",
            background: "linear-gradient(135deg, #0052cc 0%, #0077ff 100%)",
            color: "#fff",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>✂️</span>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              TITLE BLOCK AUTO-CROPPER — {sheetName}
            </span>
          </div>
          <span style={{ fontSize: 10, opacity: 0.8 }}>Isolating Technical Drawing Area</span>
        </div>

        {/* Interactive Crop Preview Canvas */}
        <div
          style={{
            flex: 1,
            position: "relative",
            background: "#1e293b",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "90%",
              height: "90%",
              background: "#fff",
              borderRadius: 6,
              overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            {isPdf ? (
              <object
                data={`${url}#toolbar=0&navpanes=0&scrollbar=0`}
                type="application/pdf"
                style={{ width: "100%", height: "100%", border: 0, pointerEvents: "none" }}
              >
                <embed src={`${url}#toolbar=0&navpanes=0&scrollbar=0`} type="application/pdf" style={{ width: "100%", height: "100%", pointerEvents: "none" }} />
              </object>
            ) : (
              <img src={url} alt="Print preview" style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />
            )}

            {/* Darkened Mask Outside Crop Box */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0, 0, 0, 0.45)",
                pointerEvents: "none",
              }}
            />

            {/* Active Crop Box Bounding Box */}
            <div
              style={{
                position: "absolute",
                left: `${cropBox.x * 100}%`,
                top: `${cropBox.y * 100}%`,
                width: `${cropBox.width * 100}%`,
                height: `${cropBox.height * 100}%`,
                border: "2.5px solid #38bdf8",
                boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45), 0 0 16px rgba(56, 189, 248, 0.6)",
                cursor: "move",
              }}
            >
              {/* Tag Header */}
              <div
                style={{
                  position: "absolute",
                  top: 6,
                  left: 6,
                  background: "#0077ff",
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 900,
                  padding: "2px 6px",
                  borderRadius: 3,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                CROP AREA (Title Block Sliced)
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "12px 16px",
            background: "#0f172a",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => setCropBox({ x: 0, y: 0, width: 1, height: 1 })}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "#cbd5e1",
                fontSize: 10,
                fontWeight: 700,
                padding: "6px 12px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Reset Full Page
            </button>
            <button
              type="button"
              onClick={() => setCropBox({ x: 0.05, y: 0.05, width: 0.9, height: 0.82 })}
              style={{
                background: "rgba(0, 119, 255, 0.15)",
                border: "1px solid rgba(0, 119, 255, 0.35)",
                color: "#60a5fa",
                fontSize: 10,
                fontWeight: 700,
                padding: "6px 12px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              ✂️ Auto-Slice Title Block
            </button>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: "transparent",
                border: "1px solid #475569",
                color: "#94a3b8",
                fontSize: 11,
                fontWeight: 700,
                padding: "8px 16px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirmCrop(cropBox)}
              style={{
                background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                border: "none",
                color: "#fff",
                fontSize: 11,
                fontWeight: 900,
                padding: "8px 18px",
                borderRadius: 6,
                cursor: "pointer",
                boxShadow: "0 0 16px rgba(16, 185, 129, 0.5)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Confirm Crop & Drop on Map ➔
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
