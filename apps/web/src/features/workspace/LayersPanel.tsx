// LayersPanel — Phase 5: Right-side collapsible panel showing drawing objects.
// Grouped object list with visibility/lock toggles, inline rename, and totals.
import { useState, useRef, useCallback } from "react";
import type { DrawingObject } from "@nsc/types";
import { useDrawing } from "../drawing/drawingContext.js";
import ObjectDetailsCard from "../drawing/ObjectDetailsCard.js";
import IconPicker from "../drawing/IconPicker.js";
import { getIconByKey, type IconKey } from "../drawing/icons/iconRegistry.js";


const FEET_PER_METER = 3.28084;

// ── Distance calculation ─────────────────────────────────────────────────────

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
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

function fmtFt(ft: number): string {
  if (ft >= 1000) return `${(ft / 1000).toFixed(1)}k ft`;
  return `${Math.round(ft).toLocaleString()} ft`;
}

// ── Object categorisation ────────────────────────────────────────────────────

type Category =
  | "cable_placed"
  | "cable_removed"
  | "points"
  | "shapes"
  | "annotations"
  | "measurements";

function getCategory(obj: DrawingObject): Category {
  const t = obj.tool as string;
  if (t === "placed_cable") return "cable_placed";
  if (t === "removed_cable") return "cable_removed";
  if (
    t === "mh_new" || t === "mh_removed" ||
    t === "hh_new" || t === "hh_removed" ||
    t === "ped_new" || t === "ped_removed" ||
    t === "pole_new" || t === "pole_removed" ||
    t === "cabinet_new" || t === "cabinet_removed" ||
    t === "anchor_new" || t === "anchor_removed" ||
    t === "ziply_flower_pot" || t === "flower_pot_new" || t === "flower_pot_removed"
  ) return "points";
  if (t === "rectangle" || t === "circle" || t === "polygon") return "shapes";
  if (t === "measure") return "measurements";
  // text, line, arrow, freehand → annotations
  return "annotations";
}

// Default display label for an object (before user renames)
function defaultLabel(obj: DrawingObject, idx: number): string {
  const map: Record<string, string> = {
    placed_cable: "Cable",
    removed_cable: "Removed Cable",
    mh_new: "MH", mh_removed: "MH (Removed)",
    hh_new: "HH", hh_removed: "HH (Removed)",
    ped_new: "PED", ped_removed: "PED (Removed)",
    pole_new: "POLE", pole_removed: "POLE (Removed)",
    cabinet_new: "CABINET", cabinet_removed: "CABINET (Removed)",
    anchor_new: "ANCHOR", anchor_removed: "ANCHOR (Removed)",
    ziply_flower_pot: "Flower Pot",
    flower_pot_new: "Flower Pot",
    flower_pot_removed: "Flower Pot (Removed)",
    text: "Text",
    line: "Line",
    arrow: "Arrow",
    rectangle: "Rectangle",
    circle: "Circle",
    polygon: "Polygon",
    freehand: "Freehand",
    measure: "Measure",
  };
  const base = map[obj.tool] ?? obj.tool;
  // For point objects, use their existing label if set
  if ("position" in obj && "label" in obj && obj.label) return obj.label;
  return `${base} ${idx}`;
}

// ── Totals strip ─────────────────────────────────────────────────────────────

function computeTotals(objects: DrawingObject[]) {
  let placedFt = 0;
  let removedFt = 0;
  const pointCounts: Record<string, number> = {
    MH: 0, HH: 0, PED: 0, POLE: 0, CABINET: 0, ANCHOR: 0,
  };

  for (const obj of objects) {
    if (obj.style.hidden) continue;
    const toolStr = obj.tool as string;
    if (obj.tool === "placed_cable" && "vertices" in obj) {
      placedFt += polylineLengthFt(obj.vertices);
    } else if (obj.tool === "removed_cable" && "vertices" in obj) {
      removedFt += polylineLengthFt(obj.vertices);
    } else if (toolStr === "mh_new" || toolStr === "mh_removed") pointCounts["MH"]!++;
    else if (toolStr === "hh_new" || toolStr === "hh_removed") pointCounts["HH"]!++;
    else if (toolStr === "ped_new" || toolStr === "ped_removed") pointCounts["PED"]!++;
    else if (toolStr === "pole_new" || toolStr === "pole_removed") pointCounts["POLE"]!++;
    else if (toolStr === "cabinet_new" || toolStr === "cabinet_removed") pointCounts["CABINET"]!++;
    else if (toolStr === "anchor_new" || toolStr === "anchor_removed") pointCounts["ANCHOR"]!++;
    else if (toolStr === "ziply_flower_pot" || toolStr === "flower_pot_new" || toolStr === "flower_pot_removed") {
      pointCounts["FP"] = (pointCounts["FP"] ?? 0) + 1;
    }
  }

  return { placedFt, removedFt, pointCounts };
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CategoryIcon({ category }: { category: Category }) {
  switch (category) {
    case "cable_placed": return <span style={{ color: "#39ff7a", fontWeight: 700, fontSize: 10 }}>━</span>;
    case "cable_removed": return <span style={{ color: "#ff2d4a", fontWeight: 700, fontSize: 10 }}>╌</span>;
    case "points": return <span>📍</span>;
    case "shapes": return <span>⬜</span>;
    case "annotations": return <span>✏️</span>;
    case "measurements": return <span>📏</span>;
    default: return null;
  }
}

function ToolIcon({ tool }: { tool: string }) {
  switch (tool) {
    case "placed_cable": return <span style={{ color: "#39ff7a", fontWeight: 700, fontSize: 10 }}>━</span>;
    case "removed_cable": return <span style={{ color: "#ff2d4a", fontWeight: 700, fontSize: 10 }}>╌</span>;
    case "mh_new": case "mh_removed": return <span title="MH" style={{ fontSize: 11 }}>🔵</span>;
    case "hh_new": case "hh_removed": return <span title="HH" style={{ fontSize: 11 }}>⚫</span>;
    case "ped_new": case "ped_removed": return <span title="PED" style={{ fontSize: 11 }}>🟦</span>;
    case "pole_new": case "pole_removed": return <span title="POLE" style={{ fontSize: 11 }}>⬛</span>;
    case "cabinet_new": case "cabinet_removed": return <span title="CABINET" style={{ fontSize: 11 }}>🟫</span>;
    case "anchor_new": case "anchor_removed": return <span title="ANCHOR" style={{ fontSize: 11 }}>⚓</span>;
    case "ziply_flower_pot": case "flower_pot_new": case "flower_pot_removed": return <span title="Flower Pot" style={{ fontSize: 11 }}>🌸</span>;
    case "text": return <span style={{ fontWeight: 700, fontFamily: "serif", fontSize: 13 }}>T</span>;
    case "line": return <span style={{ fontSize: 10 }}>╱</span>;
    case "arrow": return <span style={{ fontSize: 11 }}>→</span>;
    case "rectangle": return <span style={{ fontSize: 10 }}>▭</span>;
    case "circle": return <span style={{ fontSize: 10 }}>○</span>;
    case "polygon": return <span style={{ fontSize: 10 }}>⬡</span>;
    case "freehand": return <span style={{ fontSize: 10 }}>〰</span>;
    case "measure": return <span style={{ fontSize: 10 }}>📏</span>;
    default: return <span>·</span>;
  }
}

// ── Object row ────────────────────────────────────────────────────────────────

interface ObjectRowProps {
  obj: DrawingObject;
  displayIndex: number;
  onPanTo: (obj: DrawingObject) => void;
}

function ObjectRow({ obj, displayIndex, onPanTo }: ObjectRowProps) {
  const { patchObjectStyle, updateObject, state, select, dispatch } = useDrawing();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [infoAnchor, setInfoAnchor] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const inputRef = useRef<HTMLInputElement>(null);

  const label = obj.style.userLabel ?? defaultLabel(obj, displayIndex);
  const hidden = obj.style.hidden ?? false;
  const locked = obj.style.locked ?? false;
  const isSelected = state.selectedIds.has(obj.id);

  const lengthFt =
    "vertices" in obj &&
    (obj.tool === "placed_cable" || obj.tool === "removed_cable" || obj.tool === "measure")
      ? polylineLengthFt(obj.vertices)
      : null;

  function startEdit() {
    setEditValue(label);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commitEdit() {
    const newLabel = editValue.trim();
    if (newLabel && newLabel !== defaultLabel(obj, displayIndex)) {
      patchObjectStyle(obj.id, { userLabel: newLabel });
    }
    setEditing(false);
  }

  function handleDuplicate() {
    const newId = crypto.randomUUID();
    const clone = { ...obj, id: newId, style: { ...obj.style } };
    dispatch({ type: "ADD_OBJECT", obj: clone as DrawingObject });
    setMenuOpen(false);
  }

  function handleDelete() {
    // Select then delete
    select([obj.id]);
    dispatch({ type: "DELETE_SELECTED" });
    setMenuOpen(false);
  }

  return (
    <div
      className={`layers-row${isSelected ? " layers-row--selected" : ""}${hidden ? " layers-row--hidden" : ""}`}
      title={obj.style.description ?? ""}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".layers-row__actions")) return;
        if (!editing) {
          select([obj.id]);
          onPanTo(obj);
        }
      }}
    >
      {/* Details card (info button click) — live edit, no save/cancel */}
      {showInfo && (
        <ObjectDetailsCard
          obj={obj}
          anchorPos={infoAnchor}
          onClose={() => setShowInfo(false)}
        />
      )}
      {/* Icon */}
      <span className="layers-row__icon">
        <ToolIcon tool={obj.tool} />
      </span>

      {/* Label (editable on double-click) */}
      <span
        className="layers-row__label"
        onDoubleClick={(e) => { e.stopPropagation(); startEdit(); }}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="layers-row__label-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditing(false);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          label
        )}
      </span>

      {/* Length (cables / measure) */}
      {lengthFt !== null && (
        <span className="layers-row__length">{fmtFt(lengthFt)}</span>
      )}

      {/* Actions */}
      <span className="layers-row__actions">
        {/* Eye toggle */}
        <button
          type="button"
          className={`layers-row__icon-btn${hidden ? " layers-row__icon-btn--off" : ""}`}
          title={hidden ? "Show" : "Hide"}
          onClick={(e) => { e.stopPropagation(); patchObjectStyle(obj.id, { hidden: !hidden }); }}
        >
          {hidden ? "🙈" : "👁"}
        </button>

        {/* Lock toggle */}
        <button
          type="button"
          className={`layers-row__icon-btn${locked ? " layers-row__icon-btn--active" : ""}`}
          title={locked ? "Unlock" : "Lock"}
          onClick={(e) => { e.stopPropagation(); patchObjectStyle(obj.id, { locked: !locked }); }}
        >
          {locked ? "🔒" : "🔓"}
        </button>

        {/* Info / edit details */}
        <button
          type="button"
          className="layers-row__icon-btn"
          title="Edit details"
          onClick={(e) => {
            e.stopPropagation();
            setInfoAnchor({ x: e.clientX, y: e.clientY });
            setShowInfo(true);
          }}
        >
          ℹ
        </button>

        {/* Kebab menu */}
        <div className="layers-row__kebab-wrap" style={{ position: "relative" }}>
          <button
            type="button"
            className="layers-row__icon-btn"
            title="More options"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="layers-row__menu">
              <button type="button" onClick={handleDuplicate}>Duplicate</button>
              <button type="button" className="danger" onClick={handleDelete}>Delete</button>
            </div>
          )}
        </div>
      </span>
    </div>
  );
}

// ── Group header ──────────────────────────────────────────────────────────────

interface GroupSectionProps {
  category: Category;
  label: string;
  objects: DrawingObject[];
  onPanTo: (obj: DrawingObject) => void;
}

function GroupSection({ category, label, objects, onPanTo }: GroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (objects.length === 0) return null;

  // Compute group total length for cable groups
  const totalFt =
    (category === "cable_placed" || category === "cable_removed")
      ? objects.reduce((sum, o) => ("vertices" in o ? sum + polylineLengthFt(o.vertices) : sum), 0)
      : null;

  // Per-category counters for indices
  const indexedObjects = objects.map((obj, i) => ({ obj, idx: i + 1 }));

  return (
    <div className="layers-group">
      <div
        className="layers-group__header"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="layers-group__chevron">{collapsed ? "▶" : "▼"}</span>
        <span className="layers-group__icon"><CategoryIcon category={category} /></span>
        <span className="layers-group__name">{label}</span>
        <span className="layers-group__count">{objects.length}</span>
        {totalFt !== null && (
          <span className="layers-group__total">{fmtFt(totalFt)}</span>
        )}
      </div>
      {!collapsed && (
        <div className="layers-group__body">
          {indexedObjects.map(({ obj, idx }) => (
            <ObjectRow key={obj.id} obj={obj} displayIndex={idx} onPanTo={onPanTo} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function LayersPanel() {
  const { state, mapRef } = useDrawing();
  const [collapsed, setCollapsed] = useState(false);

  const objects = state.objects;

  const { placedFt, removedFt, pointCounts } = computeTotals(objects);

  // Group objects by category
  const grouped = {
    cable_placed: [] as DrawingObject[],
    cable_removed: [] as DrawingObject[],
    points: [] as DrawingObject[],
    shapes: [] as DrawingObject[],
    annotations: [] as DrawingObject[],
    measurements: [] as DrawingObject[],
  };
  for (const obj of objects) {
    grouped[getCategory(obj)].push(obj);
  }

  const panToObject = useCallback((obj: DrawingObject) => {
    const map = mapRef.current;
    if (!map) return;

    if ("vertices" in obj && obj.vertices.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      obj.vertices.forEach((v) => bounds.extend(v));
      map.fitBounds(bounds, 80);
    } else if ("bounds" in obj) {
      const b = obj.bounds;
      map.fitBounds({ north: b.n, south: b.s, east: b.e, west: b.w }, 80);
    } else if ("position" in obj) {
      map.panTo(obj.position);
      if ((map.getZoom() ?? 0) < 17) map.setZoom(17);
    }
  }, [mapRef]);

  if (collapsed) {
    return (
      <div className="layers-panel layers-panel--collapsed">
        <button
          type="button"
          className="layers-panel__expand-btn"
          title="Expand layers"
          onClick={() => setCollapsed(false)}
        >
          <span className="layers-panel__stack-icon">≡</span>
        </button>
      </div>
    );
  }

  return (
    <div className="layers-panel">
      {/* Collapse chevron on left edge */}
      <button
        type="button"
        className="layers-panel__collapse-btn"
        title="Collapse layers"
        onClick={() => setCollapsed(true)}
      >
        ›
      </button>

      {/* Header */}
      <div className="layers-panel__header">
        <span className="layers-panel__title">LAYERS</span>
        <span className="layers-panel__obj-count">{objects.length} objects</span>
      </div>

      {/* Totals strip */}
      <div className="layers-totals">
        <div className="layers-totals__cables">
          <span className="layers-totals__placed">
            <span className="layers-totals__dot layers-totals__dot--green" />
            Placed {fmtFt(placedFt)}
          </span>
          <span className="layers-totals__removed">
            <span className="layers-totals__dot layers-totals__dot--red" />
            Removed {fmtFt(removedFt)}
          </span>
        </div>
        <div className="layers-totals__points">
          {Object.entries(pointCounts).map(([key, count]) => (
            count > 0 ? (
              <span key={key} className="layers-totals__pt">
                <strong>{key}</strong>: {count}
              </span>
            ) : null
          ))}
        </div>
      </div>

      {/* Phase 9: MyMaps-style layer list */}
      <MyMapsLayers onPanTo={panToObject} />

      {/* Object groups */}
      <div className="layers-panel__body">
        <GroupSection category="cable_placed" label="Cable – Placed" objects={grouped.cable_placed} onPanTo={panToObject} />
        <GroupSection category="cable_removed" label="Cable – Removed" objects={grouped.cable_removed} onPanTo={panToObject} />
        <GroupSection category="points" label="Points" objects={grouped.points} onPanTo={panToObject} />
        <GroupSection category="shapes" label="Shapes" objects={grouped.shapes} onPanTo={panToObject} />
        <GroupSection category="annotations" label="Annotations" objects={grouped.annotations} onPanTo={panToObject} />
        <GroupSection category="measurements" label="Measurements" objects={grouped.measurements} onPanTo={panToObject} />

        {objects.length === 0 && (
          <div className="layers-empty">
            No objects yet. Select a tool and start drawing.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Phase 9: MyMaps-style per-job layers ─────────────────────────────────────

function MyMapsLayers({ onPanTo: _onPanTo }: { onPanTo: (obj: DrawingObject) => void }) {
  const {
    state,
    addLayer,
    renameLayer,
    deleteLayer,
    toggleLayerVisibility,
    setActiveLayer,
    moveObjectsToLayer,
    updateLayer,
    reorderLayers,
  } = useDrawing();

  const layers = state.layers;
  const activeId = state.activeLayerId;
  const today = new Date();
  const dateStr = `${today.getMonth() + 1}-${today.getDate()}-${String(today.getFullYear()).slice(-2)}`;

  function handleAdd() {
    const label = window.prompt("Layer name (e.g. 'East Side - Placed 2025' or 'Field Findings - Damage')", "");
    if (label === null) return;
    const id = addLayer(label.trim() || `Layer ${dateStr}`);
    // Auto-open icon picker feel by setting a sensible default icon
    setTimeout(() => updateLayer(id, { icon: "pin" }), 0);
  }

  function handleRename(id: string, current: string) {
    const next = window.prompt("Rename layer:", current);
    if (next === null) return;
    renameLayer(id, next);
  }

  function handleDelete(id: string, label: string) {
    if (!window.confirm(`Delete layer "${label}"? Objects on it become unsorted.`)) return;
    deleteLayer(id);
  }

  // Selected object count — for "move to layer" action
  const selectedIds = state.selectedIds;

  // Icon picker popover state (My Maps style)
  const [iconPickerForLayer, setIconPickerForLayer] = useState<string | null>(null);

  // Drag reorder state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  return (
    <div style={{
      padding: "8px 10px",
      borderBottom: "1px solid rgba(200,208,218,0.1)",
      fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
        color: "#8a96a3", textTransform: "uppercase", marginBottom: 6,
      }}>
        <span>Layers ({layers.length})</span>
        <button
          type="button"
          onClick={handleAdd}
          title="Add layer (FOREMAN // M-D-YY)"
          style={{
            background: "rgba(58,167,255,0.12)",
            border: "1px solid rgba(58,167,255,0.45)",
            color: "#3aa7ff",
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 10,
            fontFamily: "inherit",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + Add layer
        </button>
      </div>

      {layers.length === 0 && (
        <div style={{ fontSize: 10, color: "#6a7580", padding: "4px 0" }}>
          No layers yet. Click "+ Add layer" to start grouping objects.
        </div>
      )}

      {layers.map((l, index) => {
        const isActive = l.id === activeId;
        const objCount = state.objects.filter((o) => o.style.layerId === l.id).length;
        const iconDef = getIconByKey(l.icon);
        const layerColor = l.color || "#3aa7ff";

        const handleDragStart = (e: React.DragEvent) => {
          setDraggedIndex(index);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", index.toString());
        };

        const handleDragOver = (e: React.DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        };

        const handleDrop = (e: React.DragEvent) => {
          e.preventDefault();
          const from = draggedIndex;
          if (from !== null && from !== index) {
            reorderLayers(from, index);
          }
          setDraggedIndex(null);
        };

        const handleDragEnd = () => {
          setDraggedIndex(null);
        };

        return (
          <div
            key={l.id}
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 6px",
              borderRadius: 6,
              background: isActive ? "rgba(58,167,255,0.12)" : "rgba(255,255,255,0.02)",
              border: draggedIndex === index 
                ? "2px dashed #39ff7a" 
                : (isActive ? "1.5px solid #3aa7ff" : "1px solid rgba(200,208,218,0.15)"),
              cursor: "grab",
              marginBottom: 4,
              opacity: draggedIndex === index ? 0.6 : 1,
            }}
            onClick={() => setActiveLayer(l.id)}
            title={l.description || "Click to make this the active layer for new drawings. Drag to reorder (My Maps style)."}
          >
            {/* Drag handle + Visibility toggle */}
            <span 
              style={{ 
                cursor: "grab", 
                color: "#6a7580", 
                fontSize: 12, 
                userSelect: "none",
                paddingRight: 2 
              }}
              title="Drag to reorder layers"
            >
              ≡
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(l.id); }}
              title={l.hidden ? "Show layer (like My Maps)" : "Hide layer"}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14, padding: 0 }}
            >
              {l.hidden ? "👁️‍🗨️" : "👁️"}
            </button>

            {/* Icon + Color (My Maps style customization) */}
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "rgba(0,0,0,0.25)",
                padding: "1px 5px",
                borderRadius: 4,
                fontSize: 13,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <span style={{ color: layerColor }}>{iconDef.emoji}</span>

              {/* Icon picker button (My Maps style) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIconPickerForLayer(iconPickerForLayer === l.id ? null : l.id);
                }}
                title="Change layer icon (like Google My Maps)"
                style={{ 
                  background: "transparent", 
                  border: "1px solid rgba(200,208,218,0.3)", 
                  borderRadius: 3, 
                  padding: "0 4px", 
                  fontSize: 12, 
                  cursor: "pointer",
                  color: "#f4f8ff"
                }}
              >
                {iconDef.emoji}
              </button>

              {/* Icon Picker Popover */}
              {iconPickerForLayer === l.id && (
                <div
                  style={{
                    position: "absolute",
                    zIndex: 100,
                    marginTop: "28px",
                    background: "var(--surface, #1f2836)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 8,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ fontSize: 9, color: "#8a96a3", marginBottom: 4, textTransform: "uppercase" }}>
                    Choose icon for this layer
                  </div>
                  <IconPicker
                    value={l.icon}
                    onChange={(newIcon: IconKey) => {
                      updateLayer(l.id, { icon: newIcon });
                      setIconPickerForLayer(null);
                    }}
                    compact
                  />
                  <button
                    onClick={() => setIconPickerForLayer(null)}
                    style={{ 
                      marginTop: 6, 
                      fontSize: 10, 
                      color: "#8a96a3", 
                      background: "transparent", 
                      border: "none", 
                      cursor: "pointer" 
                    }}
                  >
                    Done
                  </button>
                </div>
              )}

              <input
                type="color"
                value={layerColor}
                onChange={(e) => updateLayer(l.id, { color: e.target.value })}
                style={{ width: 18, height: 18, border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
                title="Layer color"
              />
            </div>

            <span
              style={{
                flex: 1,
                fontSize: 11,
                fontWeight: 700,
                color: l.hidden ? "#6a7580" : "#f4f8ff",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {l.label}
            </span>

            <span style={{ fontSize: 9, color: "#6a7580", minWidth: 18, textAlign: "right" }}>{objCount}</span>

            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); moveObjectsToLayer(Array.from(selectedIds), l.id); }}
                title={`Move ${selectedIds.size} selected to this layer`}
                style={{ background: "transparent", border: "1px solid rgba(200,208,218,0.25)", color: "#c8d0da", borderRadius: 3, padding: "0 4px", fontSize: 9, cursor: "pointer" }}
              >
                move
              </button>
            )}

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleRename(l.id, l.label); }}
              title="Rename layer"
              style={{ background: "transparent", border: "none", color: "#8a96a3", cursor: "pointer", fontSize: 11, padding: 0 }}
            >
              ✎
            </button>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDelete(l.id, l.label); }}
              title="Delete layer"
              style={{
                background: "transparent", border: "none", color: "#ff6b6b",
                cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1,
              }}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}
