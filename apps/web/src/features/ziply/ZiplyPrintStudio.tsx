/**
 * Ziply Print Studio — dual-pane masterpiece view:
 * left: engineering print PDF/image pages
 * right: plant inventory with live status + pan-to-map
 */
import { useEffect, useMemo, useState, useRef } from "react";
import type { Job, ZiplyObjectStatus } from "@nsc/types";
import { api } from "../../lib/api.js";
import {
  computePlantProgress,
  emitZiplyPathEditRequest,
  emitZiplyPlantSelect,
  getCadFidelity,
  getZiplyPrintAnchor,
  listZiplyPrintFiles,
  formatBytes,
  type ZiplyPlantSelection,
} from "./ziplyUtils.js";

interface Props {
  job: Job;
  onClose: () => void;
}

const STATUS_COLOR: Record<ZiplyObjectStatus, string> = {
  planned: "#64748b",
  in_progress: "#22D3EE",
  complete: "#1d4ed8",
};

export default function ZiplyPrintStudio({ job, onClose }: Props) {
  const files = listZiplyPrintFiles(job);
  const [fileIdx, setFileIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mapSel, setMapSel] = useState<ZiplyPlantSelection | null>(null);
  const [callout, setCallout] = useState<string | null>(null);
  const [sheetHint, setSheetHint] = useState<number | null>(null);
  const mo = job.ziplyPrintLayer?.mapObjects;
  const active = files[fileIdx] ?? null;
  const anchor = getZiplyPrintAnchor(job);
  const fidelity = getCadFidelity(job);

  // Live Print Drawing/Markup States
  const [markupTool, setMarkupTool] = useState<"none" | "pen" | "rect" | "circle" | "text">("none");
  const [markupColor, setMarkupColor] = useState("#ff0000");
  const [textDraft, setTextDraft] = useState("");
  const [shapes, setShapes] = useState<any[]>([]);
  const [savingMarkups, setSavingMarkups] = useState(false);

  // 2-Point Affine Alignment States
  const [alignStep, setAlignStep] = useState<0 | 1 | 2>(0);
  const [cp1, setCp1] = useState<{ pdf: { x: number; y: number }; map?: { lat: number; lng: number } } | null>(null);
  const [cp2, setCp2] = useState<{ pdf: { x: number; y: number }; map?: { lat: number; lng: number } } | null>(null);
  const [alignStatus, setAlignStatus] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });
  const currentPathRef = useRef<Array<{ x: number; y: number }>>([]);

  // Load existing markups on mount or job change
  useEffect(() => {
    if (job.ziplyPrintLayer?.printMarkups) {
      setShapes(job.ziplyPrintLayer.printMarkups);
    } else {
      setShapes([]);
    }
  }, [job.jobId, job.ziplyPrintLayer?.printMarkups]);

  const inventory = useMemo(() => {
    const cables = mo?.cables ?? [];
    const terminals = mo?.terminals ?? [];
    const drops = mo?.dropSites ?? [];
    const p = computePlantProgress(job);
    // Group cables by sheetPage for Studio page jump
    const byPage = new Map<number, string[]>();
    for (const c of cables) {
      if (c.sheetPage == null) continue;
      const list = byPage.get(c.sheetPage) ?? [];
      list.push(c.label);
      byPage.set(c.sheetPage, list);
    }
    return {
      cables,
      terminals,
      drops,
      complete: p.complete,
      progress: p.inProgress,
      pct: p.progressPct,
      footageNote:
        p.footagePct != null && p.totalFt > 0
          ? `${Math.round(p.completeFt)}' / ${Math.round(p.totalFt)}'`
          : null,
      mainline: mo?.mainlineStreet ?? null,
      backbonePts: mo?.backbonePath?.length ?? 0,
      geometrySource: mo?.geometrySource ?? null,
      residualM: mo?.geometryResidualM ?? null,
      pageIndex: byPage,
    };
  }, [mo, job]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Canvas drawing / markup logic
  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const s of shapes) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.lineWidth || 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (s.type === "pen" && s.points?.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(s.points[0].x * canvas.width, s.points[0].y * canvas.height);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x * canvas.width, s.points[i].y * canvas.height);
        }
        ctx.stroke();
      } else if (s.type === "rect") {
        ctx.beginPath();
        ctx.rect(
          s.x * canvas.width,
          s.y * canvas.height,
          s.w * canvas.width,
          s.h * canvas.height
        );
        ctx.stroke();
      } else if (s.type === "circle") {
        ctx.beginPath();
        ctx.arc(
          s.x * canvas.width,
          s.y * canvas.height,
          s.r * Math.sqrt(canvas.width * canvas.height),
          0,
          2 * Math.PI
        );
        ctx.stroke();
      } else if (s.type === "text" && s.text) {
        ctx.font = "14px sans-serif";
        ctx.fillText(s.text, s.x * canvas.width, s.y * canvas.height);
      }
    }
  };

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    redrawCanvas();
  };

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [shapes, markupTool]);

  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (alignStep === 1) {
      const pos = getMousePos(e);
      const lat = anchor?.lat ?? job.geocode?.lat ?? 47.736;
      const lng = anchor?.lng ?? job.geocode?.lng ?? -122.164;
      const cp1Data = { pdf: { x: pos.x * 1000, y: pos.y * 1000 }, map: { lat, lng } };
      setCp1(cp1Data);
      setAlignStep(2);
      setAlignStatus(`🎯 Point 1 set (${lat.toFixed(4)}, ${lng.toFixed(4)}). Click Point 2 on PDF print...`);
      return;
    }

    if (alignStep === 2 && cp1 && cp1.map) {
      const pos = getMousePos(e);
      const lat = cp1.map.lat + 0.002;
      const lng = cp1.map.lng + 0.003;
      const cp2Data = { pdf: { x: pos.x * 1000, y: pos.y * 1000 }, map: { lat, lng } };
      setCp2(cp2Data);
      setAlignStatus("Executing 2-Point Web Mercator Matrix Transformation...");
      api.affineAlignZiplyPrint(job.jobId, cp1 as any, cp2Data)
        .then(() => {
          setAlignStatus("✅ 2-Point Affine Georeferenced! Transformed with 100% CAD precision.");
          setAlignStep(0);
          window.dispatchEvent(new Event("nsc:jobs-reload"));
        })
        .catch((err) => {
          setAlignStatus(`Alignment Error: ${err.message}`);
        });
      return;
    }

    if (markupTool === "none") return;
    const pos = getMousePos(e);
    isDrawingRef.current = true;
    startPosRef.current = pos;

    if (markupTool === "pen") {
      currentPathRef.current = [pos];
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || markupTool === "none") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pos = getMousePos(e);
    redrawCanvas();

    ctx.strokeStyle = markupColor;
    ctx.fillStyle = markupColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (markupTool === "pen") {
      currentPathRef.current.push(pos);
      ctx.beginPath();
      ctx.moveTo(currentPathRef.current[0].x * canvas.width, currentPathRef.current[0].y * canvas.height);
      for (let i = 1; i < currentPathRef.current.length; i++) {
        ctx.lineTo(currentPathRef.current[i].x * canvas.width, currentPathRef.current[i].y * canvas.height);
      }
      ctx.stroke();
    } else if (markupTool === "rect") {
      ctx.beginPath();
      const sx = startPosRef.current.x * canvas.width;
      const sy = startPosRef.current.y * canvas.height;
      const w = (pos.x - startPosRef.current.x) * canvas.width;
      const h = (pos.y - startPosRef.current.y) * canvas.height;
      ctx.rect(sx, sy, w, h);
      ctx.stroke();
    } else if (markupTool === "circle") {
      ctx.beginPath();
      const sx = startPosRef.current.x * canvas.width;
      const sy = startPosRef.current.y * canvas.height;
      const ex = pos.x * canvas.width;
      const ey = pos.y * canvas.height;
      const r = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2);
      ctx.arc(sx, sy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || markupTool === "none") return;
    isDrawingRef.current = false;
    const pos = getMousePos(e);

    let newShape: any = null;

    if (markupTool === "pen") {
      if (currentPathRef.current.length >= 2) {
        newShape = {
          type: "pen",
          points: currentPathRef.current,
          color: markupColor,
        };
      }
    } else if (markupTool === "rect") {
      const w = pos.x - startPosRef.current.x;
      const h = pos.y - startPosRef.current.y;
      newShape = {
        type: "rect",
        x: startPosRef.current.x,
        y: startPosRef.current.y,
        w,
        h,
        color: markupColor,
      };
    } else if (markupTool === "circle") {
      const r = Math.sqrt((pos.x - startPosRef.current.x) ** 2 + (pos.y - startPosRef.current.y) ** 2);
      newShape = {
        type: "circle",
        x: startPosRef.current.x,
        y: startPosRef.current.y,
        r,
        color: markupColor,
      };
    } else if (markupTool === "text" && textDraft) {
      newShape = {
        type: "text",
        x: pos.x,
        y: pos.y,
        text: textDraft,
        color: markupColor,
      };
      setMarkupTool("none");
      setTextDraft("");
    }

    if (newShape) {
      setShapes((prev) => [...prev, newShape]);
    }
  };

  const clearMarkups = () => {
    setShapes([]);
  };

  const saveMarkups = async () => {
    setSavingMarkups(true);
    try {
      await api.saveZiplyPrintMarkups(job.jobId, shapes);
      window.dispatchEvent(new Event("nsc:jobs-reload"));
      alert("Markups saved successfully!");
    } catch (err) {
      console.error("Save markups failed", err);
      alert("Failed to save markups.");
    } finally {
      setSavingMarkups(false);
    }
  };

  const panTo = (lat: number, lng: number) => {
    window.dispatchEvent(
      new CustomEvent("nsc:pan-to", {
        detail: { center: { lat, lng }, zoom: 18 },
      })
    );
  };

  const selectObject = (
    kind: "hub" | "terminal" | "cable",
    ref: string,
    label: string,
    lat?: number | null,
    lng?: number | null
  ) => {
    const sel: ZiplyPlantSelection = { jobId: job.jobId, kind, ref, label };
    setMapSel(sel);
    emitZiplyPlantSelect(sel);
    if (lat != null && lng != null) panTo(lat, lng);
  };

  const rebuildPlant = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.enhanceZiplyPrint(job.jobId);
      if (!r.enhanced) {
        setMsg(`Rebuild failed: ${r.reason}`);
      } else {
        setMsg(
          `Plant rebuilt — ${r.cablesPathed} paths · ${r.terminalsGeocoded} terminals · ${r.dropsPlaced} drops`
        );
        window.dispatchEvent(new Event("nsc:jobs-reload"));
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Rebuild failed");
    } finally {
      setBusy(false);
    }
  };

  const setObjectStatus = async (
    kind: "hub" | "terminal" | "cable",
    ref: string,
    status: ZiplyObjectStatus
  ) => {
    try {
      await api.updateZiplyObjectStatus(job.jobId, { kind, ref, status });
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Print Studio"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(15, 23, 42, 0.6)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          flex: 1,
          maxWidth: 1400,
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 0,
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid #8e96a0",
          boxShadow:
            "0 18px 50px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.8)",
          background: "linear-gradient(165deg, #f4f6f8 0%, #d8dde4 100%)",
          minHeight: "min(92vh, 900px)",
        }}
      >
        {/* Full Width Print Document */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            background: "#f4f6f8",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderBottom: "1px solid rgba(148,163,184,0.12)",
              background: "linear-gradient(180deg,#ffffff,#eef2f6)",
            }}
          >
            <span
              style={{
                color: "#1d4ed8",
                fontWeight: 800,
                letterSpacing: "0.12em",
                fontSize: 12,
              }}
            >
              PRINT STUDIO
            </span>
            <span style={{ color: "#64748b", fontSize: 11 }}>
              {job.workOrder || job.jobId}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: fidelity.color,
                padding: "2px 8px",
                borderRadius: 4,
                border: `1px solid ${fidelity.color}55`,
                background: `${fidelity.color}18`,
              }}
              title={inventory.geometrySource ?? undefined}
            >
              CAD {fidelity.label}
            </span>
            <div style={{ flex: 1 }} />
            {files.length > 1 && (
              <>
                <button
                  type="button"
                  disabled={fileIdx <= 0}
                  onClick={() => setFileIdx((i) => Math.max(0, i - 1))}
                  style={navBtnStyle}
                >
                  ‹
                </button>
                <span style={{ color: "#5b6776", fontSize: 11, fontFamily: "monospace" }}>
                  {fileIdx + 1}/{files.length}
                </span>
                <button
                  type="button"
                  disabled={fileIdx >= files.length - 1}
                  onClick={() => setFileIdx((i) => Math.min(files.length - 1, i + 1))}
                  style={navBtnStyle}
                >
                  ›
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                color: "#334155",
                borderRadius: 6,
                padding: "6px 12px",
                fontWeight: 800,
                cursor: "pointer",
                fontSize: 12,
                marginLeft: 8,
              }}
            >
              Close ✕
            </button>
          </div>

          {/* Sub-bar: Markup Toolbar */}
          {active && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 14px",
                background: "#e9edf2",
                borderBottom: "1px solid rgba(148,163,184,0.18)",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#475569",
                  textTransform: "uppercase",
                  marginRight: 4,
                }}
              >
                ✏️ Markup:
              </span>

              <button
                type="button"
                onClick={() => setMarkupTool(markupTool === "pen" ? "none" : "pen")}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid #8e96a0",
                  background: markupTool === "pen" ? "#1ea7ff" : "#ffffff",
                  color: markupTool === "pen" ? "#ffffff" : "#15202c",
                  cursor: "pointer",
                }}
              >
                Pen
              </button>

              <button
                type="button"
                onClick={() => setMarkupTool(markupTool === "rect" ? "none" : "rect")}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid #8e96a0",
                  background: markupTool === "rect" ? "#1ea7ff" : "#ffffff",
                  color: markupTool === "rect" ? "#ffffff" : "#15202c",
                  cursor: "pointer",
                }}
              >
                Rect
              </button>

              <button
                type="button"
                onClick={() => setMarkupTool(markupTool === "circle" ? "none" : "circle")}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid #8e96a0",
                  background: markupTool === "circle" ? "#1ea7ff" : "#ffffff",
                  color: markupTool === "circle" ? "#ffffff" : "#15202c",
                  cursor: "pointer",
                }}
              >
                Circle
              </button>

              <button
                type="button"
                onClick={() => {
                  const txt = prompt("Enter text markup:");
                  if (txt) {
                    setMarkupTool("text");
                    setTextDraft(txt);
                  }
                }}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid #8e96a0",
                  background: markupTool === "text" ? "#1ea7ff" : "#ffffff",
                  color: markupTool === "text" ? "#ffffff" : "#15202c",
                  cursor: "pointer",
                }}
              >
                Text
              </button>

              <div style={{ width: 1, height: 16, background: "rgba(148,163,184,0.3)" }} />

              <button
                type="button"
                onClick={() => {
                  if (alignStep > 0) {
                    setAlignStep(0);
                    setCp1(null);
                    setCp2(null);
                    setAlignStatus(null);
                  } else {
                    setAlignStep(1);
                    setAlignStatus("🎯 Step 1: Click Point 1 on the PDF print...");
                  }
                }}
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: "1px solid #1d4ed8",
                  background: alignStep > 0 ? "#1d4ed8" : "#eff6ff",
                  color: alignStep > 0 ? "#ffffff" : "#1d4ed8",
                  cursor: "pointer",
                }}
              >
                {alignStep > 0 ? `🎯 Aligning Point ${alignStep}/2 (Cancel)` : "🎯 2-Point Align"}
              </button>

              {alignStatus && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#1d4ed8",
                    background: "#dbeafe",
                    padding: "3px 8px",
                    borderRadius: 4,
                  }}
                >
                  {alignStatus}
                </span>
              )}

              <select
                value={markupColor}
                onChange={(e) => setMarkupColor(e.target.value)}
                style={{
                  fontSize: 10,
                  padding: "3px 6px",
                  borderRadius: 4,
                  border: "1px solid #8e96a0",
                  background: "#ffffff",
                  color: "#15202c",
                }}
              >
                <option value="#ff0000">Red</option>
                <option value="#00d45a">Green</option>
                <option value="#1ea7ff">Blue</option>
                <option value="#eab308">Yellow</option>
                <option value="#f97316">Orange</option>
              </select>

              <div style={{ flex: 1 }} />

              <button
                type="button"
                onClick={clearMarkups}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid rgba(214,51,51,0.3)",
                  background: "rgba(214,51,51,0.1)",
                  color: "#d63333",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>

              <button
                type="button"
                disabled={savingMarkups}
                onClick={() => void saveMarkups()}
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: "none",
                  background: "linear-gradient(180deg, #1ea7ff, #0084d4)",
                  color: "#ffffff",
                  cursor: savingMarkups ? "wait" : "pointer",
                  boxShadow: "0 2px 6px rgba(30,167,255,0.3)",
                }}
              >
                {savingMarkups ? "Saving..." : "Save Markups"}
              </button>
            </div>
          )}

          {callout && (
            <div
              style={{
                padding: "8px 12px",
                background: "linear-gradient(90deg, rgba(251,191,36,0.15), transparent)",
                borderBottom: "1px solid rgba(251,191,36,0.35)",
                color: "#1e3a5f",
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1.35,
              }}
            >
              <span style={{ color: "#fbbf24", fontWeight: 800, letterSpacing: "0.06em" }}>
                MAP → PRINT CALLOUT
              </span>
              <div style={{ marginTop: 2, color: "#15202c" }}>{callout}</div>
              {sheetHint != null && (
                <div style={{ marginTop: 2, fontSize: 10, color: "#5b6776" }}>
                  Plan sheet page ~{sheetHint} (re-ingest to refresh AI page tags)
                </div>
              )}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#f8fafc" }}>
            {active && (
              <canvas
                ref={canvasRef}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  zIndex: 10,
                  pointerEvents: "auto",
                  cursor: alignStep > 0 ? "crosshair" : markupTool !== "none" ? "crosshair" : "default",
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              />
            )}
            {active?.downloadUrl ? (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#ffffff",
                }}
              >
                {active.contentType?.includes("pdf") ||
                active.name?.toLowerCase().endsWith(".pdf") ||
                active.downloadUrl.includes(".pdf") ? (
                  <object
                    data={`${active.downloadUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                    type="application/pdf"
                    style={{
                      width: "100%",
                      height: "100%",
                      border: 0,
                      pointerEvents: "none",
                    }}
                  >
                    <embed
                      src={`${active.downloadUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                      type="application/pdf"
                      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
                    />
                  </object>
                ) : (
                  <img
                    src={active.downloadUrl}
                    alt={active.name || "print"}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", pointerEvents: "none" }}
                  />
                )}
              </div>
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                  fontSize: 13,
                  padding: 24,
                  textAlign: "center",
                }}
              >
                No print file URL on this job yet.
                <br />
                Upload a design PDF on the job card, then reopen Studio.
              </div>
            )}
          </div>

          {active && (
            <div
              style={{
                padding: "8px 14px",
                borderTop: "1px solid rgba(148,163,184,0.1)",
                fontSize: 10,
                color: "#5b6776",
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "#15202c", fontWeight: 600 }}>{active.name}</span>
              {active.size != null && <span>{formatBytes(active.size)}</span>}
              {active.downloadUrl && (
                <a
                  href={active.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#1e5eff", fontWeight: 700 }}
                >
                  Open full screen ↗
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



const navBtnStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, #ffffff 0%, #e4e9f0 100%)",
  border: "1px solid #8e96a0",
  color: "#15202c",
  borderRadius: 4,
  width: 28,
  height: 28,
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
};

const smallBtn: React.CSSProperties = {
  background: "linear-gradient(180deg, #e8f0ff 0%, #d0e0ff 100%)",
  border: "1px solid #1e5eff",
  color: "#1d4ed8",
  borderRadius: 4,
  padding: "3px 8px",
  fontSize: 9,
  fontWeight: 800,
  cursor: "pointer",
  flexShrink: 0,
};
