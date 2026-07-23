import { useMemo } from "react";
import type { Job } from "@nsc/types";
import { listZiplyPrintFiles } from "./ziplyUtils.js";

interface ZiplyPrintTrayProps {
  job: Job;
  activeSheetId?: string | null;
  onSelectSheet: (file: { name: string; downloadUrl: string; sheetIndex: number }) => void;
  onToggleSheetVisibility?: (sheetId: string) => void;
}

export function ZiplyPrintTray({
  job,
  activeSheetId,
  onSelectSheet,
}: ZiplyPrintTrayProps) {
  const printFiles = useMemo(() => listZiplyPrintFiles(job), [job]);

  if (printFiles.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1500,
        background: "linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(10, 16, 28, 0.98) 100%)",
        border: "1.5px solid rgba(0, 119, 255, 0.4)",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
        borderRadius: 12,
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: "85vw",
        overflowX: "auto",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, paddingRight: 6, borderRight: "1px solid rgba(255,255,255,0.1)" }}>
        <span style={{ fontSize: 14 }}>📄</span>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 10, fontWeight: 900, color: "#38bdf8", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "var(--font-mono, monospace)" }}>
            PRINT SHEETS
          </span>
          <span style={{ fontSize: 9, color: "#94a3b8" }}>
            {printFiles.length} file{printFiles.length > 1 ? "s" : ""} uploaded
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {printFiles.map((file, idx) => {
          const downloadUrl = file.downloadUrl || "";
          if (!downloadUrl) return null;
          const sheetName = file.name || `Sheet ${idx + 1}`;
          const isPdf = file.contentType?.includes("pdf") || file.name?.toLowerCase().endsWith(".pdf");

          return (
            <div
              key={idx}
              onClick={() => onSelectSheet({ name: sheetName, downloadUrl, sheetIndex: idx })}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                width: 96,
                padding: 6,
                borderRadius: 8,
                background: activeSheetId === sheetName ? "rgba(0, 119, 255, 0.25)" : "rgba(255, 255, 255, 0.04)",
                border: activeSheetId === sheetName ? "1.5px solid #0077ff" : "1px solid rgba(255, 255, 255, 0.12)",
                boxShadow: activeSheetId === sheetName ? "0 0 12px rgba(0, 119, 255, 0.5)" : "none",
                cursor: "pointer",
                transition: "all 0.2s ease",
                flexShrink: 0,
              }}
              title={`Click to auto-crop & position ${sheetName} on map`}
            >
              <div
                style={{
                  width: 84,
                  height: 56,
                  borderRadius: 4,
                  overflow: "hidden",
                  background: "#1e293b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {isPdf ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: "#60a5fa" }}>
                    <span style={{ fontSize: 16 }}>📐</span>
                    <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase" }}>PDF CAD</span>
                  </div>
                ) : (
                  <img src={file.downloadUrl} alt={sheetName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                )}
              </div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: activeSheetId === sheetName ? "#60a5fa" : "#e2e8f0",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
                }}
              >
                {sheetName}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
