// ObjectDetailsCard.tsx — Phase 5.3
// Google My-Maps-style floating card for inspecting/editing ANY placed object.
// Appears when SELECT tool is active and user clicks an object (or ℹ in layers panel).
// All edits are LIVE (no Save/Cancel) — card auto-closes on deselect/Esc.
//
// Different from ObjectDetailsPopup.tsx:
//   Popup = draft placement prompt (Save/Cancel, commits or discards)
//   Card  = live editor for existing objects (Close only, every change is instant)

import { useEffect, useRef, useState } from "react";
import type { DrawingObject, DrawingStyle } from "@nsc/types";
import { useDrawing, defaultStyleForTool } from "./drawingContext.js";
import { railSvgForTool } from "./icons/telecomIcons.js";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { api } from "../../lib/api.js";
import { findMatchingTerminal, findMatchingCable } from "../ziply/SpatialMatcher.js";
import { useActiveContract } from "../workspace/contractStore.js";
import { useJobsContext } from "../jobs-map/jobsContext.js";

function parseLineProps(label: string, desc: string) {
  const footageMatch = label.match(/^(\d+)/);
  const footage = footageMatch ? footageMatch[1] : "";
  
  let method = "";
  if (/BORE/i.test(label) || /BORE/i.test(desc)) method = "BORE";
  else if (/TRENCH/i.test(label) || /TRENCH/i.test(desc)) method = "TRENCH";
  else if (/AERIAL|OH/i.test(label) || /AERIAL|OH/i.test(desc)) method = "AERIAL";
  
  let size = "";
  if (/1-2"\s*DUCT/i.test(desc)) size = "1-2\" DUCT";
  else if (/10MStrand/i.test(desc)) size = "10MStrand";
  else if (/144F/i.test(desc)) size = "144F";
  else if (/72F/i.test(desc)) size = "72F";
  else if (/24F/i.test(desc)) size = "24F";
  
  return { footage, method, size };
}
// IconPicker / IconKey imports removed — Billy 6/10: no per-object icon swap.
// Icons are still bound to each object's style at draw time; we just don't
// expose a way to change them after the fact.

// ── Geometry helpers ──────────────────────────────────────────────────────────

const FEET_PER_METER = 3.28084;
const SQ_FEET_PER_SQ_METER = 10.7639;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polylineLengthFt(vertices: Array<{ lat: number; lng: number }>): number {
  if (vertices.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!;
    const b = vertices[i]!;
    d += haversineMeters(a.lat, a.lng, b.lat, b.lng);
  }
  return d * FEET_PER_METER;
}

function shoelaceAreaSqFt(vertices: Array<{ lat: number; lng: number }>): number {
  if (vertices.length < 3) return 0;
  // Use Google Maps spherical area if available
  if (typeof google !== "undefined" && google.maps?.geometry?.spherical) {
    const path = vertices.map((v) => new google.maps.LatLng(v.lat, v.lng));
    const areaM2 = Math.abs(google.maps.geometry.spherical.computeArea(path));
    return areaM2 * SQ_FEET_PER_SQ_METER;
  }
  return 0;
}

// ── Type helpers ──────────────────────────────────────────────────────────────

const POINT_TOOLS = new Set([
  "mh_new", "mh_removed",
  "hh_new", "hh_removed",
  "ped_new", "ped_removed",
  "pole_new", "pole_removed",
  "cabinet_new", "cabinet_removed",
  "anchor_new", "anchor_removed",
  "ziply_hub",
  "ziply_terminal",
  "ziply_address",
  "ziply_pole",
  "ziply_handhole",
  "ziply_flower_pot",
  "ziply_splitter",
  "ziply_riser",
  "ziply_slack_loop",
  "flower_pot_new",
  "flower_pot_removed",
]);

function isPointTool(tool: string): boolean {
  return POINT_TOOLS.has(tool);
}

function isClosed(tool: string): boolean {
  return tool === "polygon" || tool === "rectangle" || tool === "circle" || tool === "freehand";
}

function isLine(tool: string): boolean {
  return (
    tool === "placed_cable" ||
    tool === "removed_cable" ||
    tool === "line" ||
    tool === "arrow" ||
    tool === "freehand" ||
    tool === "measure" ||
    tool === "ziply_feeder" ||
    tool === "ziply_distribution" ||
    tool === "ziply_drop" ||
    tool === "ziply_bore"
  );
}

const SWATCH_COLORS = [
  "#1565C0",
  "#2e7d32",
  "#e65100",
  "#6a1b9a",
  "#c62828",
  "#757575",
];

type PointSize = "S" | "M" | "L";
const SIZE_MAP: Record<PointSize, number> = { S: 0.7, M: 1.0, L: 1.5 };

function sizeKey(pointSize: number): PointSize {
  if (pointSize <= 0.85) return "S";
  if (pointSize >= 1.3) return "L";
  return "M";
}

// ── Geometry info ─────────────────────────────────────────────────────────────

function GeometryInfo({ obj }: { obj: DrawingObject }) {
  if ("vertices" in obj && isLine(obj.tool)) {
    const ft = polylineLengthFt(obj.vertices);
    return (
      <div className="odc-geo">
        <span className="odc-geo__label">Length</span>
        <span className="odc-geo__val">{ft >= 1000 ? `${(ft / 1000).toFixed(1)}k` : Math.round(ft).toLocaleString()} ft</span>
      </div>
    );
  }
  if ("vertices" in obj && isClosed(obj.tool)) {
    const sq = shoelaceAreaSqFt(obj.vertices);
    return (
      <div className="odc-geo">
        <span className="odc-geo__label">Area</span>
        <span className="odc-geo__val">{sq >= 1000 ? `${(sq / 1000).toFixed(1)}k` : Math.round(sq).toLocaleString()} sq ft</span>
      </div>
    );
  }
  if ("bounds" in obj) {
    // rect / circle stored as bounds
    const vertices = [
      { lat: obj.bounds.n, lng: obj.bounds.w },
      { lat: obj.bounds.n, lng: obj.bounds.e },
      { lat: obj.bounds.s, lng: obj.bounds.e },
      { lat: obj.bounds.s, lng: obj.bounds.w },
    ];
    const sq = shoelaceAreaSqFt(vertices);
    return (
      <div className="odc-geo">
        <span className="odc-geo__label">Area</span>
        <span className="odc-geo__val">{sq >= 1000 ? `${(sq / 1000).toFixed(1)}k` : Math.round(sq).toLocaleString()} sq ft</span>
      </div>
    );
  }
  if ("position" in obj) {
    const pos = obj.position;
    return (
      <div className="odc-geo">
        <span className="odc-geo__label">Position</span>
        <span className="odc-geo__val" style={{ fontFamily: "ui-monospace, monospace", fontSize: 9 }}>
          {pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}
        </span>
      </div>
    );
  }
  return null;
}

// ── Photos section ────────────────────────────────────────────────────────────

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function PhotosSection({ obj }: { obj: DrawingObject }) {
  const { patchObjectStyle } = useDrawing();
  const photos = obj.style.photos ?? [];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function addFiles(files: FileList | File[]) {
    setError(null);
    const accepted: Array<{ id: string; dataUrl: string; name?: string }> = [];
    for (const f of Array.from(files)) {
      if (!/^image\/(jpe?g|png)$/i.test(f.type)) {
        setError(`Skipped ${f.name}: only JPG/PNG allowed.`);
        continue;
      }
      if (f.size > MAX_PHOTO_BYTES) {
        setError(`Skipped ${f.name}: exceeds 5MB.`);
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(f);
        accepted.push({
          id: `ph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          dataUrl,
          name: f.name,
        });
      } catch {
        setError(`Failed to read ${f.name}.`);
      }
    }
    if (accepted.length > 0) {
      patchObjectStyle(obj.id, { photos: [...photos, ...accepted] });
    }
  }

  function removePhoto(id: string) {
    patchObjectStyle(obj.id, { photos: photos.filter((p) => p.id !== id) });
  }

  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase", marginBottom: 6 }}>
        Photos {photos.length > 0 && <span style={{ opacity: 0.6 }}>({photos.length})</span>}
      </div>

      {/* Thumbnail strip */}
      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {photos.map((p) => (
            <div
              key={p.id}
              style={{
                position: "relative",
                width: 58,
                height: 58,
                borderRadius: 4,
                overflow: "hidden",
                border: "1px solid rgba(200,208,218,0.18)",
                background: "rgba(0,0,0,0.4)",
                cursor: "pointer",
              }}
              onClick={() => setLightbox(p.dataUrl)}
            >
              <img
                src={p.dataUrl}
                alt={p.name ?? "photo"}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removePhoto(p.id);
                }}
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  width: 16,
                  height: 16,
                  background: "rgba(0,0,0,0.65)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "50%",
                  cursor: "pointer",
                  fontSize: 10,
                  lineHeight: "16px",
                  padding: 0,
                }}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone / file input */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: "8px 10px",
          border: `1px dashed ${dragOver ? "#3aa7ff" : "rgba(200,208,218,0.22)"}`,
          background: dragOver ? "rgba(58,167,255,0.08)" : "rgba(255,255,255,0.03)",
          borderRadius: 5,
          fontSize: 10,
          color: "#8a96a3",
          textAlign: "center",
          cursor: "pointer",
        }}
      >
        Click or drop JPG/PNG (5MB max)
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) void addFiles(e.target.files);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />

      {error && (
        <div style={{ marginTop: 6, color: "#ff6b6b", fontSize: 10 }}>{error}</div>
      )}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "grid",
            placeItems: "center",
            zIndex: 20000,
            cursor: "zoom-out",
            padding: 24,
          }}
        >
          <img
            src={lightbox}
            alt="photo"
            style={{ maxWidth: "92vw", maxHeight: "92vh", boxShadow: "0 6px 32px rgba(0,0,0,0.7)" }}
          />
        </div>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ── Main card component ───────────────────────────────────────────────────────

export interface ObjectDetailsCardProps {
  obj: DrawingObject;
  /** Pixel position to anchor the card near (viewport-relative) */
  anchorPos: { x: number; y: number };
  onClose: () => void;
}

const CARD_W = 300;
const CARD_H_APPROX = 360;

export default function ObjectDetailsCard({ obj, anchorPos, onClose }: ObjectDetailsCardProps) {
  const { 
    state: drawState, 
    patchObjectStyle, 
    updateObject, 
    deleteSelected, 
    select, 
    dispatch, 
    addObject,
    // rotateSelected removed — Billy 6/10: rotate buttons aren't useful.
  } = useDrawing();
  const isSelectTool = drawState.activeTool === "select";

  const { jobs } = useJobsContext();
  const job = jobs.find((j) => j.jobId === drawState.targetJobId);

  const handleAutoFill = () => {
    if (!job || !job.ziplyPrintLayer?.mapObjects) return;
    const mapObjects = job.ziplyPrintLayer.mapObjects;

    if (isPointTool(obj.tool) && "position" in obj) {
        const match = findMatchingTerminal(
          { lat: obj.position.lat, lng: obj.position.lng },
          mapObjects,
          label || obj.style.userLabel
        );
        if (match) {
          patchObjectStyle(obj.id, {
            userLabel: match.label || match.name || label,
            ziplyPrintPage: match.pageRef ?? obj.style.ziplyPrintPage,
            ziplyPortCount: match.portCount ?? obj.style.ziplyPortCount,
            ziplyTailLengthFt: match.footageFt ?? match.tailLengthFt ?? obj.style.ziplyTailLengthFt,
            ziplyLashedOrConduitFt: match.lashedFt ?? match.conduitFt ?? obj.style.ziplyLashedOrConduitFt,
            ziplyAddressesServed: Array.isArray(match.addressesServed)
              ? match.addressesServed.join(", ")
              : (match.addressesServed ?? obj.style.ziplyAddressesServed),
          });
        } else {
          window.alert("No matching AI terminal found by name/label or spatial radius.");
        }
    } else if (isLine(obj.tool) && "vertices" in obj) {
        const match = findMatchingCable(obj.vertices, mapObjects);
        if (match) {
          const methodRaw = (match.buildType || "").toLowerCase();
          const normMethod = methodRaw === "bore" || methodRaw === "trench" ? methodRaw : (methodRaw === "aerial" || methodRaw === "oh" ? "aerial" : obj.style.ziplyInstallMethod);
          patchObjectStyle(obj.id, {
            ziplyCableType: match.cableType ?? obj.style.ziplyCableType,
            ziplyFiberCount: match.fiberCount ?? match.size ?? (parseInt(match.cableType || "0", 10) || obj.style.ziplyFiberCount),
            ziplyInstallMethod: normMethod,
            ziplyFootage: Math.round(match.lengthFeet || match.lengthFt || 0) || obj.style.ziplyFootage,
            ziplyConduitOrStrand: match.conduitOrStrand ?? match.strandType ?? match.conduitSize ?? obj.style.ziplyConduitOrStrand,
          });
        } else {
          window.alert("No matching AI cable path found nearby.");
        }
    }
  };

  const { contract } = useActiveContract();

  const cleanLabel = (lbl: string) => {
    const isPoleOrEquipment = obj.tool.includes("pole") || obj.tool.includes("hub") || obj.tool.includes("terminal");
    if (contract === "Ziply" && isPoleOrEquipment && /^a-/i.test(lbl)) {
      return lbl.slice(2);
    }
    return lbl;
  };

  const isLineObj = isLine(obj.tool);
  const lineProps = isLineObj ? parseLineProps(obj.style.userLabel ?? "", obj.style.description ?? "") : null;
  const [footage, setFootage] = useState(lineProps?.footage ?? "");
  const [method, setMethod] = useState(lineProps?.method ?? "");
  const [size, setSize] = useState(lineProps?.size ?? "");
  const [sizeOption, setSizeOption] = useState(() => {
    if (!lineProps?.size) return "";
    const common = ["1-2\" DUCT", "10MStrand", "144F", "72F", "24F"];
    return common.includes(lineProps.size) ? lineProps.size : "custom";
  });

  const [label, setLabel] = useState(cleanLabel(obj.style.userLabel ?? ""));
  const [description, setDescription] = useState(obj.style.description ?? "");
  const labelRef = useRef<HTMLInputElement>(null);

  // Sync local state when object changes externally (e.g. geometry drag)
  useEffect(() => {
    setLabel(cleanLabel(obj.style.userLabel ?? ""));
    setDescription(obj.style.description ?? "");

    if (isLineObj) {
      const p = parseLineProps(obj.style.userLabel ?? "", obj.style.description ?? "");
      setFootage(p.footage);
      setMethod(p.method);
      setSize(p.size);
      const common = ["1-2\" DUCT", "10MStrand", "144F", "72F", "24F"];
      setSizeOption(!p.size ? "" : (common.includes(p.size) ? p.size : "custom"));
    }
  }, [obj.id, obj.style.userLabel, obj.style.description, contract, isLineObj]);

  const commitLineChanges = (f: string, m: string, s: string) => {
    const cleanFootage = f.replace(/['\s]/g, "").trim();
    const resolvedLabel = cleanFootage ? `${cleanFootage}' ${m}`.trim() : "";
    const resolvedDesc = [s, m].filter(Boolean).join(" ");
    
    let nextTool = obj.tool;
    if (m === "BORE" || m === "TRENCH") {
      nextTool = "ziply_bore";
    } else if (m === "AERIAL") {
      nextTool = "ziply_distribution";
    }
    
    updateObject({
      ...obj,
      tool: nextTool,
      style: {
        ...defaultStyleForTool(nextTool),
        ...obj.style,
        userLabel: resolvedLabel || undefined,
        description: resolvedDesc || undefined,
        ziplyInstallMethod: m ? m.toLowerCase() : obj.style.ziplyInstallMethod,
        ziplyConduitOrStrand: s || obj.style.ziplyConduitOrStrand,
        ziplyFootage: cleanFootage ? Number(cleanFootage) : obj.style.ziplyFootage,
      }
    } as DrawingObject);
  };

  // Commit label change to context (debounced 300ms)
  const labelDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleLabelChange(v: string) {
    setLabel(v);
    if (labelDebounce.current) clearTimeout(labelDebounce.current);
    labelDebounce.current = setTimeout(() => {
      let finalLabel = v.trim();
      // Phase 9: Pole labels auto-prefix with "A-" when missing (except on Ziply contract)
      if (
        finalLabel &&
        contract !== "Ziply" &&
        (obj.tool === "pole_new" || obj.tool === "pole_removed" || obj.tool === "ziply_pole" || obj.tool.includes("pole")) &&
        !/^a-/i.test(finalLabel)
      ) {
        finalLabel = `A-${finalLabel}`;
      } else if (contract === "Ziply" && /^a-/i.test(finalLabel)) {
        finalLabel = finalLabel.slice(2);
      }
      patchObjectStyle(obj.id, { userLabel: finalLabel || undefined });
    }, 300);
  }

  // Commit description change
  const descDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleDescChange(v: string) {
    setDescription(v);
    if (descDebounce.current) clearTimeout(descDebounce.current);
    descDebounce.current = setTimeout(() => {
      patchObjectStyle(obj.id, { description: v.trim() || undefined });
    }, 300);
  }

  function patchStyle(p: Partial<DrawingStyle>) {
    patchObjectStyle(obj.id, p);
  }

  function handleDelete() {
    select([obj.id]);
    deleteSelected();
    onClose();
  }

  function handleDuplicate() {
    const newId = crypto.randomUUID();
    const clone = { ...obj, id: newId, style: { ...obj.style } } as DrawingObject;
    // Offset slightly if it's a point
    if ("position" in clone) {
      (clone as typeof clone & { position: { lat: number; lng: number } }).position = {
        lat: (clone as { position: { lat: number; lng: number } }).position.lat + 0.00005,
        lng: (clone as { position: { lat: number; lng: number } }).position.lng + 0.00005,
      };
    }
    dispatch({ type: "ADD_OBJECT", obj: clone });
    onClose();
  }

  // Close on Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Initial position derived from anchor; user can drag from there.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const OFFSET = 18;
  const initialLeft = (() => {
    let l = anchorPos.x + OFFSET;
    if (l + CARD_W > vw - 12) l = anchorPos.x - CARD_W - OFFSET;
    if (l < 8) l = 8;
    return l;
  })();
  const initialTop = (() => {
    let t = anchorPos.y - CARD_H_APPROX / 2;
    if (t < 8) t = 8;
    if (t + CARD_H_APPROX > vh - 8) t = vh - CARD_H_APPROX - 8;
    return t;
  })();

  // Drag-to-reposition state. Once the user drags, `pos` overrides anchor.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);

  // Reset drag position when switching to a different object
  useEffect(() => {
    setPos(null);
  }, [obj.id]);

  const left = pos?.left ?? initialLeft;
  const top = pos?.top ?? initialTop;

  function onHeaderMouseDown(e: React.MouseEvent) {
    // Don't drag when clicking the close button
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: left,
      origTop: top,
    };
    function onMove(ev: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const newLeft = d.origLeft + (ev.clientX - d.startX);
      const newTop = d.origTop + (ev.clientY - d.startY);
      // Clamp to viewport with small margin so it can't be lost off-screen
      const vw2 = window.innerWidth;
      const vh2 = window.innerHeight;
      const clampedLeft = Math.max(-CARD_W + 60, Math.min(vw2 - 60, newLeft));
      const clampedTop = Math.max(0, Math.min(vh2 - 40, newTop));
      setPos({ left: clampedLeft, top: clampedTop });
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const isPoint = isPointTool(obj.tool);
  const isCableOrLine = isLine(obj.tool);
  const isClosedShape = isClosed(obj.tool) || "bounds" in obj;
  const isText = obj.tool === "text";

  // Display name for the object type
  const TYPE_NAMES: Record<string, string> = {
    placed_cable: "Placed Cable",
    removed_cable: "Removed Cable",
    mh_new: "Manhole (New)", mh_removed: "Manhole (Removed)",
    hh_new: "Handhole (New)", hh_removed: "Handhole (Removed)",
    ped_new: "Pedestal (New)", ped_removed: "Pedestal (Removed)",
    pole_new: "Pole (New)", pole_removed: "Pole (Removed)",
    cabinet_new: "Cabinet (New)", cabinet_removed: "Cabinet (Removed)",
    anchor_new: "Anchor (New)", anchor_removed: "Anchor (Removed)",
    text: "Text", line: "Line", arrow: "Arrow",
    rectangle: "Rectangle", circle: "Circle", polygon: "Polygon",
    freehand: "Freehand", measure: "Measure",
    ziply_hub: "Ziply Splitter Hub (FDH)",
    ziply_terminal: "Ziply Terminal (MST)",
    ziply_splitter: "Ziply Splitter",
    ziply_riser: "Ziply Riser",
    ziply_slack_loop: "Ziply Slack Loop",
    ziply_address: "Ziply Service Address",
    ziply_pole: "Ziply Pole",
    ziply_handhole: "Ziply Handhole",
    ziply_flower_pot: "Ziply Flower Pot",
    flower_pot_new: "Flower Pot (New)",
    flower_pot_removed: "Flower Pot (Removed)",
    ziply_feeder: "F1 Cable (Feeder)",
    ziply_distribution: "F2 Cable (Distribution)",
    ziply_drop: "Drop Cable",
    ziply_bore: "Ziply Bore / Trench",
  };
  const typeName = TYPE_NAMES[obj.tool] ?? obj.tool;

  const currentPointSize = obj.style.pointSize ?? 1.0;
  const curSizeKey = sizeKey(currentPointSize);

  // CSS variables for the chrome/glass theme
  const cardStyle: React.CSSProperties = {
    position: "fixed",
    left,
    top,
    width: CARD_W,
    zIndex: 10000,
    background: "rgba(18, 26, 40, 0.97)",
    border: "1px solid rgba(200, 208, 218, 0.22)",
    borderRadius: 10,
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    boxShadow: "0 6px 32px rgba(0,0,0,0.65), 0 1px 0 rgba(255,255,255,0.05) inset",
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
    fontSize: 11,
    color: "#c8d0da",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    userSelect: "none",
  };

  return (
    <div
      style={cardStyle}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ── Header (drag handle) ────────────────────────────────────── */}
      <div
        onMouseDown={onHeaderMouseDown}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 12px 8px",
          borderBottom: "1px solid rgba(200,208,218,0.1)",
          cursor: "move",
          userSelect: "none",
        }}
        title="Drag to move"
      >
        {/* Type icon */}
        <span
          style={{ width: 22, height: 22, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          dangerouslySetInnerHTML={{ __html: isPoint ? railSvgForTool(obj.tool) : "" }}
        />
        {!isPoint && (
          <span style={{ fontSize: 14, opacity: 0.7, flexShrink: 0 }}>
            {obj.tool === "placed_cable" ? "━" :
             obj.tool === "removed_cable" ? "╌" :
             obj.tool === "arrow" ? "→" :
             obj.tool === "line" ? "╱" :
             obj.tool === "rectangle" ? "▭" :
             obj.tool === "circle" ? "○" :
             obj.tool === "polygon" ? "⬡" :
             obj.tool === "freehand" ? "〰" :
             obj.tool === "measure" ? "📏" :
             obj.tool === "text" ? "T" : "·"}
          </span>
        )}
        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: "#f4f8ff", letterSpacing: "0.05em", textTransform: "uppercase" }}>
          {typeName}
        </span>
        {isSelectTool && (
          <span style={{ fontSize: 9, color: "#39ff7a", opacity: 0.8 }}>• Drag handles to resize</span>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent", border: "none", color: "#8a96a3",
            cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px",
            display: "flex", alignItems: "center",
          }}
          title="Close (Esc)"
        >×</button>
      </div>

      {/* ── Body (scrollable) ──────────────────────────────────────── */}
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", maxHeight: "70vh" }}>

        {isLineObj ? (
          <>
            {/* Footage Field */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase" }}>
                Footage
              </label>
              <input
                type="text"
                value={footage}
                onChange={(e) => {
                  setFootage(e.target.value);
                  commitLineChanges(e.target.value, method, size);
                }}
                placeholder="e.g. 275"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(200,208,218,0.18)",
                  borderRadius: 5,
                  color: "#f4f8ff",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "6px 8px",
                  outline: "none",
                  letterSpacing: "0.04em",
                }}
              />
            </div>

            {/* Placement Method Field */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase" }}>
                Placement Method
              </label>
              <select
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  commitLineChanges(footage, e.target.value, size);
                }}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(200,208,218,0.18)",
                  borderRadius: 5,
                  color: "#f4f8ff",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "6px 8px",
                  outline: "none",
                  letterSpacing: "0.04em",
                }}
              >
                <option value="">-- Select Method --</option>
                <option value="BORE">BORE (Underground)</option>
                <option value="TRENCH">TRENCH (Underground)</option>
                <option value="AERIAL">AERIAL (Overhead)</option>
              </select>
            </div>

            {/* Size Selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase" }}>
                Size / Spec
              </label>
              <select
                value={sizeOption}
                onChange={(e) => {
                  setSizeOption(e.target.value);
                  if (e.target.value !== "custom") {
                    setSize(e.target.value);
                    commitLineChanges(footage, method, e.target.value);
                  }
                }}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(200,208,218,0.18)",
                  borderRadius: 5,
                  color: "#f4f8ff",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "6px 8px",
                  outline: "none",
                  letterSpacing: "0.04em",
                }}
              >
                <option value="">-- Select Size --</option>
                <option value="1-2&quot; DUCT">1-2&quot; DUCT</option>
                <option value="10MStrand">10MStrand</option>
                <option value="144F">144F</option>
                <option value="72F">72F</option>
                <option value="24F">24F</option>
                <option value="custom">Other / Custom...</option>
              </select>
              {sizeOption === "custom" && (
                <input
                  type="text"
                  value={size}
                  onChange={(e) => {
                    setSize(e.target.value);
                    commitLineChanges(footage, method, e.target.value);
                  }}
                  placeholder="Enter custom size..."
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(200,208,218,0.18)",
                    borderRadius: 5,
                    color: "#f4f8ff",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "6px 8px",
                    outline: "none",
                    letterSpacing: "0.04em",
                    marginTop: 4,
                  }}
                />
              )}
            </div>
          </>
        ) : (
          <>
            {/* Title field */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase" }}>
                {isPoint ? "A-TAG #" : "Title"}
              </label>
              <input
                ref={labelRef}
                type="text"
                value={label}
                onChange={(e) => handleLabelChange(e.target.value)}
                placeholder={isPoint ? "A-TAG # (optional)" : "Name this object…"}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(200,208,218,0.18)",
                  borderRadius: 5,
                  color: "#f4f8ff",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "6px 8px",
                  outline: "none",
                  letterSpacing: "0.04em",
                }}
              />
            </div>

            {/* Description */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase" }}>
                Description / Notes
              </label>
              <RichTextEditor
                content={description}
                onChange={handleDescChange}
              />
            </div>
          </>
        )}

        {/* ── Style controls ──────────────────────────── */}
        <div style={{ borderTop: "1px solid rgba(200,208,218,0.1)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>

          {/* Opacity */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase", width: 52, flexShrink: 0 }}>Opacity</span>
            <input
              type="range" min={0.1} max={1} step={0.05}
              value={obj.style.opacity}
              onChange={(e) => patchStyle({ opacity: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 10, color: "#8a96a3", width: 28, textAlign: "right" }}>{Math.round(obj.style.opacity * 100)}%</span>
          </div>

          {/* Stroke color — not for telecom points (always black) */}
          {!isPoint && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase", width: 52, flexShrink: 0 }}>Color</span>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {SWATCH_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => patchStyle({ strokeColor: c })}
                    style={{
                      width: 18, height: 18, borderRadius: "50%",
                      background: c, border: obj.style.strokeColor === c ? "2px solid #fff" : "1.5px solid rgba(255,255,255,0.2)",
                      cursor: "pointer", padding: 0,
                    }}
                    title={c}
                  />
                ))}
                <input
                  type="color"
                  value={obj.style.strokeColor.slice(0, 7)}
                  onChange={(e) => patchStyle({ strokeColor: e.target.value })}
                  title="Custom color"
                  style={{ width: 18, height: 18, padding: 0, border: "1.5px solid rgba(200,208,218,0.3)", borderRadius: "50%", cursor: "pointer", background: "transparent" }}
                />
              </div>
            </div>
          )}

          {/* Stroke width — for lines and shapes */}
          {(isCableOrLine || isClosedShape) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase", width: 52, flexShrink: 0 }}>Width</span>
              <input
                type="range" min={1} max={10} step={1}
                value={obj.style.strokeWidth}
                onChange={(e) => patchStyle({ strokeWidth: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 10, color: "#8a96a3", width: 28, textAlign: "right" }}>{obj.style.strokeWidth}px</span>
            </div>
          )}

          {/* Cable Flow Animation Toggle */}
          {isCableOrLine && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase", width: 52, flexShrink: 0 }}>Flow</span>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 10, color: "#c8d0da" }}>
                <input
                  type="checkbox"
                  checked={!!obj.style.animateFlow}
                  onChange={(e) => patchStyle({ animateFlow: e.target.checked })}
                  style={{
                    cursor: "pointer",
                    accentColor: "#1ea7ff"
                  }}
                />
                Animate Cable Flow
              </label>
            </div>
          )}

          {/* Point size */}
          {isPoint && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase", width: 52, flexShrink: 0 }}>Size</span>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={currentPointSize}
                onChange={(e) => patchStyle({ pointSize: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 10, color: "#8a96a3", width: 32, textAlign: "right" }}>{currentPointSize.toFixed(1)}x</span>
            </div>
          )}

          {/* Fill — closed shapes only */}
          {isClosedShape && !isPoint && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase", width: 52, flexShrink: 0 }}>Fill</span>
              <div style={{ display: "flex", gap: 4 }}>
                {(["none", "solid", "hash"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      if (kind === "none") patchStyle({ fill: { kind: "none" } });
                      else if (kind === "solid") patchStyle({ fill: { kind: "solid", color: obj.style.strokeColor } });
                      else patchStyle({ fill: { kind: "hash", pattern: "diagonal", color: obj.style.strokeColor, density: 6 } });
                    }}
                    style={{
                      padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10,
                      background: obj.style.fill.kind === kind ? "#1565C0" : "rgba(255,255,255,0.06)",
                      border: obj.style.fill.kind === kind ? "1px solid #3aa7ff" : "1px solid rgba(200,208,218,0.18)",
                      color: obj.style.fill.kind === kind ? "#fff" : "#c8d0da",
                      fontFamily: "inherit", fontWeight: 600, textTransform: "capitalize",
                    }}
                  >{kind}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── ZIPLY INDUSTRIAL LIVE PLANT CARD ──────────────────────────────────────── */}
        {(obj.tool.startsWith("ziply_") || obj.tool === "placed_cable" || obj.tool === "removed_cable") && (
          <div
            style={{
              borderTop: "1.5px solid rgba(0, 119, 255, 0.35)",
              paddingTop: 12,
              marginTop: 4,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              background: "linear-gradient(180deg, rgba(0, 82, 204, 0.08) 0%, rgba(13, 21, 32, 0.4) 100%)",
              borderRadius: 8,
              padding: 10,
              border: "1px solid rgba(0, 119, 255, 0.25)",
              boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            {/* Header & AI Badge */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    background: "linear-gradient(135deg, #0052cc 0%, #0077ff 100%)",
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: 900,
                    padding: "3px 7px",
                    borderRadius: 4,
                    letterSpacing: "0.08em",
                    boxShadow: "0 0 10px rgba(0,119,255,0.5)",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  LIVE PLANT CARD
                </span>
                {obj.style.ziplyAiSuggested && (
                  <span
                    style={{
                      background: "rgba(168, 85, 247, 0.2)",
                      border: "1px solid rgba(168, 85, 247, 0.5)",
                      color: "#c084fc",
                      fontSize: 8,
                      fontWeight: 800,
                      padding: "2px 6px",
                      borderRadius: 3,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    ✨ AI Suggested
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleAutoFill}
                style={{
                  background: "rgba(0, 119, 255, 0.15)",
                  border: "1px solid rgba(0, 119, 255, 0.4)",
                  borderRadius: 4,
                  color: "#38bdf8",
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "4px 8px",
                  cursor: "pointer",
                  boxShadow: "0 0 8px rgba(0, 119, 255, 0.2)",
                  transition: "all 0.2s ease",
                }}
              >
                ⚡ Match AI Print
              </button>
            </div>

            {/* ── STATUS TOGGLE & FLOW ANIMATION BUTTON ── */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* Instant Status Switch */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                  Status (Auto-Glow)
                </label>
                <div style={{ display: "flex", background: "rgba(0,0,0,0.5)", borderRadius: 5, padding: 2, border: "1px solid rgba(255,255,255,0.08)" }}>
                  <button
                    type="button"
                    onClick={() => patchStyle({ ziplyStatus: "planned" })}
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      fontSize: 9,
                      fontWeight: 800,
                      borderRadius: 3,
                      border: "none",
                      cursor: "pointer",
                      background: (obj.style.ziplyStatus ?? "planned") === "planned" ? "#334155" : "transparent",
                      color: (obj.style.ziplyStatus ?? "planned") === "planned" ? "#cbd5e1" : "#64748b",
                      transition: "all 0.2s ease",
                    }}
                  >
                    PLANNED
                  </button>
                  <button
                    type="button"
                    onClick={() => patchStyle({ ziplyStatus: "placed", ziplyTimestamp: Date.now() })}
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      fontSize: 9,
                      fontWeight: 900,
                      borderRadius: 3,
                      border: "none",
                      cursor: "pointer",
                      background: obj.style.ziplyStatus === "placed" ? "linear-gradient(135deg, #059669 0%, #10b981 100%)" : "transparent",
                      color: obj.style.ziplyStatus === "placed" ? "#fff" : "#64748b",
                      boxShadow: obj.style.ziplyStatus === "placed" ? "0 0 12px rgba(16,185,129,0.6)" : "none",
                      transition: "all 0.2s ease",
                    }}
                  >
                    CONDUIT
                  </button>
                  <button
                    type="button"
                    onClick={() => patchStyle({ ziplyStatus: "Complete", ziplyTimestamp: Date.now() })}
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      fontSize: 9,
                      fontWeight: 900,
                      borderRadius: 3,
                      border: "none",
                      cursor: "pointer",
                      background: obj.style.ziplyStatus === "Complete" ? "linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)" : "transparent",
                      color: obj.style.ziplyStatus === "Complete" ? "#fff" : "#64748b",
                      boxShadow: obj.style.ziplyStatus === "Complete" ? "0 0 12px rgba(6,182,212,0.6)" : "none",
                      transition: "all 0.2s ease",
                    }}
                  >
                    FIBER
                  </button>
                </div>
              </div>

              {/* Independent Flow Pulse Button (for cables & terminals) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 }}>
                <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                  Flow Beam
                </label>
                <button
                  type="button"
                  onClick={() => patchStyle({ animateFlow: !obj.style.animateFlow })}
                  style={{
                    padding: "5px 10px",
                    fontSize: 9,
                    fontWeight: 800,
                    borderRadius: 4,
                    border: obj.style.animateFlow ? "1px solid #38bdf8" : "1px solid rgba(255,255,255,0.12)",
                    background: obj.style.animateFlow ? "rgba(56, 189, 248, 0.2)" : "rgba(0,0,0,0.4)",
                    color: obj.style.animateFlow ? "#38bdf8" : "#64748b",
                    boxShadow: obj.style.animateFlow ? "0 0 10px rgba(56,189,248,0.4)" : "none",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  title="Toggle slow light-beam animation down the cable path"
                >
                  {obj.style.animateFlow ? "🌊 BEAMS ON" : "OFF"}
                </button>
              </div>
            </div>

            {/* ── TERMINAL SPECIFIC CARD LAYOUT ── */}
            {(obj.tool === "ziply_terminal" || obj.tool.includes("terminal")) && (
              <>
                {/* Port Count Selection Pills */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                    Port Count
                  </label>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[4, 6, 8, 12, 16].map((ports) => {
                      const active = obj.style.ziplyPortCount === ports;
                      return (
                        <button
                          key={ports}
                          type="button"
                          onClick={() => patchStyle({ ziplyPortCount: ports })}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            fontSize: 10,
                            fontWeight: 800,
                            borderRadius: 4,
                            border: active ? "1px solid #0077ff" : "1px solid rgba(255,255,255,0.12)",
                            background: active ? "rgba(0, 119, 255, 0.25)" : "rgba(0,0,0,0.4)",
                            color: active ? "#60a5fa" : "#94a3b8",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                          }}
                        >
                          {ports}P
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Tail Length & Lashed Footage */}
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                    <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                      MST Tail (ft)
                    </label>
                    <input
                      type="number"
                      value={obj.style.ziplyTailLengthFt ?? ""}
                      onChange={(e) => patchStyle({ ziplyTailLengthFt: Number(e.target.value) || undefined })}
                      placeholder="e.g. 1000"
                      style={{
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 4,
                        color: "#f8fafc",
                        fontSize: 11,
                        padding: "5px 8px",
                        outline: "none",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                    <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                      Lashed / Conduit (ft)
                    </label>
                    <input
                      type="number"
                      value={obj.style.ziplyLashedOrConduitFt ?? ""}
                      onChange={(e) => patchStyle({ ziplyLashedOrConduitFt: Number(e.target.value) || undefined })}
                      placeholder="e.g. 578"
                      style={{
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 4,
                        color: "#f8fafc",
                        fontSize: 11,
                        padding: "5px 8px",
                        outline: "none",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    />
                  </div>
                </div>

                {/* Served House Addresses Pills ([✓ 14201] [✓ 14205] [+ Add]) */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                    Served House Addresses
                  </label>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                    {(obj.style.ziplyServedAddressesList ?? (obj.style.ziplyAddressesServed ? obj.style.ziplyAddressesServed.split(",").map(s => s.trim()).filter(Boolean) : [])).map((addr, idx) => (
                      <span
                        key={idx}
                        onClick={() => {
                          const current = (obj.style.ziplyServedAddressesList ?? (obj.style.ziplyAddressesServed ? obj.style.ziplyAddressesServed.split(",").map(s => s.trim()).filter(Boolean) : []));
                          const updated = current.filter((_, i) => i !== idx);
                          patchStyle({ ziplyServedAddressesList: updated, ziplyAddressesServed: updated.join(", ") });
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          background: "rgba(16, 185, 129, 0.15)",
                          border: "1px solid rgba(16, 185, 129, 0.4)",
                          color: "#34d399",
                          fontSize: 9,
                          fontWeight: 800,
                          padding: "3px 7px",
                          borderRadius: 999,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        title="Click to uncheck/remove address"
                      >
                        ✓ {addr} <span style={{ opacity: 0.6, fontSize: 8 }}>✕</span>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const val = window.prompt("Enter house address number:");
                        if (val && val.trim()) {
                          const current = (obj.style.ziplyServedAddressesList ?? (obj.style.ziplyAddressesServed ? obj.style.ziplyAddressesServed.split(",").map(s => s.trim()).filter(Boolean) : []));
                          const updated = [...current, val.trim()];
                          patchStyle({ ziplyServedAddressesList: updated, ziplyAddressesServed: updated.join(", ") });
                        }
                      }}
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: "1px dashed rgba(255,255,255,0.2)",
                        color: "#94a3b8",
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: 999,
                        cursor: "pointer",
                      }}
                    >
                      + Add Address
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ── POLE SPECIFIC CARD LAYOUT ── */}
            {(obj.tool === "ziply_pole" || obj.tool.includes("pole")) && (
              <>
                {/* PSE Pole ID */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                    PSE Pole ID
                  </label>
                  <input
                    type="text"
                    value={obj.style.ziplyPoleId ?? ""}
                    onChange={(e) => patchStyle({ ziplyPoleId: e.target.value || undefined })}
                    placeholder="e.g. 226988-169290"
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 4,
                      color: "#f8fafc",
                      fontSize: 11,
                      padding: "5px 8px",
                      outline: "none",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  />
                </div>

                {/* Guy Wire / Make Ready Notes */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                    Guy Wire / Make Ready Notes
                  </label>
                  <input
                    type="text"
                    value={obj.style.ziplyGuyWireNotes ?? ""}
                    onChange={(e) => patchStyle({ ziplyGuyWireNotes: e.target.value || undefined })}
                    placeholder="e.g. OH GUY"
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 4,
                      color: "#f8fafc",
                      fontSize: 11,
                      padding: "5px 8px",
                      outline: "none",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  />
                </div>

                {/* Grid Coordinates */}
                {"position" in obj && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                      Grid Coordinates
                    </label>
                    <div style={{
                      background: "rgba(0,0,0,0.2)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 4,
                      color: "#94a3b8",
                      fontSize: 9,
                      padding: "5px 8px",
                      fontFamily: "var(--font-mono, monospace)",
                    }}>
                      Lat: {obj.position.lat.toFixed(6)}, Lng: {obj.position.lng.toFixed(6)}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── HANDHOLE / VAULT / PEDESTAL SPECIFIC CARD LAYOUT ── */}
            {(obj.tool.includes("handhole") || obj.tool.includes("hh") || obj.tool.includes("ped") || obj.tool.includes("flower") || obj.tool === "ziply_handhole" || obj.tool === "ziply_flower_pot") && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                    Structure / Handhole ID
                  </label>
                  <input
                    type="text"
                    value={obj.style.ziplyStructureId ?? obj.style.ziplyPoleId ?? ""}
                    onChange={(e) => patchStyle({ ziplyStructureId: e.target.value || undefined })}
                    placeholder="e.g. HH-102 or VAULT 2436"
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 4,
                      color: "#f8fafc",
                      fontSize: 11,
                      padding: "5px 8px",
                      outline: "none",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                    Size / Spec (e.g. 24x36 Tier 22)
                  </label>
                  <input
                    type="text"
                    value={obj.style.ziplyConduitOrStrand ?? obj.style.ziplyHandholeSize ?? ""}
                    onChange={(e) => patchStyle({ ziplyConduitOrStrand: e.target.value || undefined, ziplyHandholeSize: e.target.value || undefined })}
                    placeholder="e.g. 24x36x24 Tier 22"
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 4,
                      color: "#f8fafc",
                      fontSize: 11,
                      padding: "5px 8px",
                      outline: "none",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  />
                </div>
              </>
            )}

            {/* ── CABLE SPECIFIC CARD LAYOUT ── */}
            {isCableOrLine && (
              <>
                {/* Fiber Count (Required) & Footage */}
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                    <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                      Fiber Count *
                    </label>
                    <input
                      type="number"
                      value={obj.style.ziplyFiberCount ?? (parseInt(obj.style.ziplyCableType || "0", 10) || "")}
                      onChange={(e) => {
                        const count = Number(e.target.value);
                        patchStyle({ ziplyFiberCount: count || undefined, ziplyCableType: count ? `${count}F` : undefined });
                      }}
                      placeholder="e.g. 144"
                      style={{
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 4,
                        color: "#f8fafc",
                        fontSize: 11,
                        padding: "5px 8px",
                        outline: "none",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                    <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                      Footage (ft)
                    </label>
                    <input
                      type="number"
                      value={obj.style.ziplyFootage ?? ""}
                      onChange={(e) => patchStyle({ ziplyFootage: Number(e.target.value) || undefined })}
                      placeholder="e.g. 275"
                      style={{
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 4,
                        color: "#f8fafc",
                        fontSize: 11,
                        padding: "5px 8px",
                        outline: "none",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    />
                  </div>
                </div>

                {/* Installation Method */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                    Install Method
                  </label>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["bore", "trench", "aerial", "overlash"] as const).map((method) => {
                      const active = (obj.style.ziplyInstallMethod || "").toLowerCase() === method;
                      return (
                        <button
                          key={method}
                          type="button"
                          onClick={() => patchStyle({ ziplyInstallMethod: method })}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            fontSize: 9,
                            fontWeight: 800,
                            borderRadius: 4,
                            border: active ? "1px solid #38bdf8" : "1px solid rgba(255,255,255,0.12)",
                            background: active ? "rgba(56, 189, 248, 0.2)" : "rgba(0,0,0,0.4)",
                            color: active ? "#38bdf8" : "#94a3b8",
                            cursor: "pointer",
                            textTransform: "capitalize",
                            transition: "all 0.2s ease",
                          }}
                        >
                          {method}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Conduit Size / Strand Type */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                    Conduit Size / Strand Type
                  </label>
                  <input
                    type="text"
                    value={obj.style.ziplyConduitOrStrand ?? ""}
                    onChange={(e) => patchStyle({ ziplyConduitOrStrand: e.target.value || undefined })}
                    placeholder="e.g. 1-2&quot; DUCT or 10MStrand"
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 4,
                      color: "#f8fafc",
                      fontSize: 11,
                      padding: "5px 8px",
                      outline: "none",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  />
                </div>
              </>
            )}

            {/* Crew & Page Ref */}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                  Print Sheet
                </label>
                <input
                  type="text"
                  value={obj.style.ziplyPrintPage ?? ""}
                  onChange={(e) => patchStyle({ ziplyPrintPage: e.target.value })}
                  placeholder="e.g. Sheet 4"
                  style={{
                    background: "rgba(0,0,0,0.4)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 4,
                    color: "#f8fafc",
                    fontSize: 10,
                    padding: "4px 6px",
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                <label style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase" }}>
                  Crew ID
                </label>
                <input
                  type="text"
                  value={obj.style.ziplyCrewId ?? ""}
                  onChange={(e) => patchStyle({ ziplyCrewId: e.target.value })}
                  placeholder="e.g. Crew A"
                  style={{
                    background: "rgba(0,0,0,0.4)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 4,
                    color: "#f8fafc",
                    fontSize: 10,
                    padding: "4px 6px",
                    outline: "none",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Photos ─────────────────────────────────── */}
        <div style={{ borderTop: "1px solid rgba(200,208,218,0.1)", paddingTop: 8 }}>
          <PhotosSection obj={obj} />
        </div>

        {/* ── Geometry info ──────────────────────────── */}
        <div style={{ borderTop: "1px solid rgba(200,208,218,0.1)", paddingTop: 8 }}>
          <GeometryInfo obj={obj} />
        </div>

      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 8, padding: "8px 12px 10px",
        borderTop: "1px solid rgba(200,208,218,0.1)",
      }}>
        <button
          type="button"
          onClick={handleDuplicate}
          style={{
            flex: 1, padding: "5px 0", borderRadius: 5,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(200,208,218,0.2)",
            color: "#c8d0da", fontFamily: "inherit", fontSize: 10,
            fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em",
          }}
        >Duplicate</button>
        <button
          type="button"
          onClick={handleDelete}
          style={{
            flex: 1, padding: "5px 0", borderRadius: 5,
            background: "rgba(198,40,40,0.12)",
            border: "1px solid rgba(198,40,40,0.4)",
            color: "#ff6b6b", fontFamily: "inherit", fontSize: 10,
            fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em",
          }}
        >Delete</button>
      </div>
    </div>
  );
}

// ── RichTextEditor component using Tiptap (#10) ─────────────────────────────
interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
}

function RichTextEditor({ content, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "tiptap-editor-content focus:outline-none",
        style: "min-height: 80px; max-height: 150px; overflow-y: auto; font-size: 11px; line-height: 1.4; color: #c8d0da; outline: none; padding: 6px 8px; border-radius: 5px; background: rgba(255,255,255,0.04); border: 1px solid rgba(200,208,218,0.14);",
      }
    }
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Mini toolbar */}
      <div 
        style={{ 
          display: "flex", 
          gap: 4, 
          padding: "2px 4px", 
          background: "rgba(255,255,255,0.03)", 
          border: "1px solid rgba(200,208,218,0.1)", 
          borderRadius: 4,
          alignItems: "center"
        }}
      >
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          style={{
            background: editor.isActive("bold") ? "rgba(30, 167, 255, 0.25)" : "transparent",
            color: editor.isActive("bold") ? "#1ea7ff" : "#8a96a3",
            border: "none",
            borderRadius: 3,
            padding: "2px 6px",
            fontSize: 9,
            fontWeight: 700,
            cursor: "pointer",
            outline: "none",
          }}
          title="Bold"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          style={{
            background: editor.isActive("italic") ? "rgba(30, 167, 255, 0.25)" : "transparent",
            color: editor.isActive("italic") ? "#1ea7ff" : "#8a96a3",
            border: "none",
            borderRadius: 3,
            padding: "2px 6px",
            fontSize: 9,
            fontStyle: "italic",
            cursor: "pointer",
            outline: "none",
          }}
          title="Italic"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          style={{
            background: editor.isActive("underline") ? "rgba(30, 167, 255, 0.25)" : "transparent",
            color: editor.isActive("underline") ? "#1ea7ff" : "#8a96a3",
            border: "none",
            borderRadius: 3,
            padding: "2px 6px",
            fontSize: 9,
            textDecoration: "underline",
            cursor: "pointer",
            outline: "none",
          }}
          title="Underline"
        >
          U
        </button>
        <div style={{ width: 1, height: 10, background: "rgba(200,208,218,0.15)" }} />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          style={{
            background: editor.isActive("bulletList") ? "rgba(30, 167, 255, 0.25)" : "transparent",
            color: editor.isActive("bulletList") ? "#1ea7ff" : "#8a96a3",
            border: "none",
            borderRadius: 3,
            padding: "2px 4px",
            fontSize: 9,
            cursor: "pointer",
            outline: "none",
          }}
          title="Bullet List"
        >
          • List
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          style={{
            background: editor.isActive("orderedList") ? "rgba(30, 167, 255, 0.25)" : "transparent",
            color: editor.isActive("orderedList") ? "#1ea7ff" : "#8a96a3",
            border: "none",
            borderRadius: 3,
            padding: "2px 4px",
            fontSize: 9,
            cursor: "pointer",
            outline: "none",
          }}
          title="Numbered List"
        >
          1. List
        </button>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
