// ObjectDetailsCard.tsx — Phase 5.3
// Google My-Maps-style floating card for inspecting/editing ANY placed object.
// Appears when SELECT tool is active and user clicks an object (or ℹ in layers panel).
// All edits are LIVE (no Save/Cancel) — card auto-closes on deselect/Esc.
//
// Different from ObjectDetailsPopup.tsx:
//   Popup = draft placement prompt (Save/Cancel, commits or discards)
//   Card  = live editor for existing objects (Close only, every change is instant)

import { useEffect, useRef, useState, useCallback } from "react";
import type { DrawingObject, DrawingStyle } from "@nsc/types";
import { useDrawing } from "./drawingContext.js";
import { railSvgForTool } from "./icons/telecomIcons.js";

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
    tool === "measure"
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
  const { patchObjectStyle, updateObject, deleteSelected, select, dispatch, addObject } = useDrawing();

  const [label, setLabel] = useState(obj.style.userLabel ?? "");
  const [description, setDescription] = useState(obj.style.description ?? "");
  const labelRef = useRef<HTMLInputElement>(null);

  // Sync local state when object changes externally (e.g. geometry drag)
  useEffect(() => {
    setLabel(obj.style.userLabel ?? "");
    setDescription(obj.style.description ?? "");
  }, [obj.id, obj.style.userLabel, obj.style.description]);

  // Commit label change to context (debounced 300ms)
  const labelDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleLabelChange(v: string) {
    setLabel(v);
    if (labelDebounce.current) clearTimeout(labelDebounce.current);
    labelDebounce.current = setTimeout(() => {
      patchObjectStyle(obj.id, { userLabel: v.trim() || undefined });
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

  // Clamp position to viewport
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const OFFSET = 18;
  let left = anchorPos.x + OFFSET;
  let top = anchorPos.y - CARD_H_APPROX / 2;
  if (left + CARD_W > vw - 12) left = anchorPos.x - CARD_W - OFFSET;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  if (top + CARD_H_APPROX > vh - 8) top = vh - CARD_H_APPROX - 8;

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
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px 8px",
        borderBottom: "1px solid rgba(200,208,218,0.1)",
      }}>
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
          <textarea
            value={description}
            onChange={(e) => handleDescChange(e.target.value)}
            placeholder="Add notes or details…"
            rows={3}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(200,208,218,0.14)",
              borderRadius: 5,
              color: "#c8d0da",
              fontFamily: "inherit",
              fontSize: 11,
              padding: "6px 8px",
              outline: "none",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
        </div>

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

          {/* Point size — telecom symbols only */}
          {isPoint && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase", width: 52, flexShrink: 0 }}>Size</span>
              <div style={{ display: "flex", gap: 4 }}>
                {(["S", "M", "L"] as PointSize[]).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => patchStyle({ pointSize: SIZE_MAP[sz] })}
                    style={{
                      padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                      background: curSizeKey === sz ? "#1565C0" : "rgba(255,255,255,0.06)",
                      border: curSizeKey === sz ? "1px solid #3aa7ff" : "1px solid rgba(200,208,218,0.18)",
                      color: curSizeKey === sz ? "#fff" : "#c8d0da",
                      fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                    }}
                  >{sz}</button>
                ))}
              </div>
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
