// LayersPanel — Phase 8: Right-side panel.
// Top: Active Layer Totals + Job Totals (both billable units, both visible).
// Middle: layer list (foreman+date, newest first) with explicit unlock control.
// Bottom: grouped objects per layer (Cable, Removed Cable, Poles, MH, HH, PED, Notes).
import { useState, useRef, useCallback, useMemo } from "react";
import type { AsBuiltLayer, DrawingObject } from "@nsc/types";
import { useDrawing } from "../drawing/drawingContext.js";
import ObjectDetailsCard from "../drawing/ObjectDetailsCard.js";
import { aggregateUnits, type BillingEntry } from "../asbuilt/billing.js";


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
  const t = obj.tool;
  if (t === "placed_cable") return "cable_placed";
  if (t === "removed_cable") return "cable_removed";
  if (
    t === "mh_new" || t === "mh_removed" ||
    t === "hh_new" || t === "hh_removed" ||
    t === "ped_new" || t === "ped_removed" ||
    t === "pole_new" || t === "pole_removed" ||
    t === "cabinet_new" || t === "cabinet_removed" ||
    t === "anchor_new" || t === "anchor_removed"
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
    if (obj.tool === "placed_cable" && "vertices" in obj) {
      placedFt += polylineLengthFt(obj.vertices);
    } else if (obj.tool === "removed_cable" && "vertices" in obj) {
      removedFt += polylineLengthFt(obj.vertices);
    } else if (obj.tool === "mh_new" || obj.tool === "mh_removed") pointCounts["MH"]!++;
    else if (obj.tool === "hh_new" || obj.tool === "hh_removed") pointCounts["HH"]!++;
    else if (obj.tool === "ped_new" || obj.tool === "ped_removed") pointCounts["PED"]!++;
    else if (obj.tool === "pole_new" || obj.tool === "pole_removed") pointCounts["POLE"]!++;
    else if (obj.tool === "cabinet_new" || obj.tool === "cabinet_removed") pointCounts["CABINET"]!++;
    else if (obj.tool === "anchor_new" || obj.tool === "anchor_removed") pointCounts["ANCHOR"]!++;
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

// ── Phase 7: Layers section ──────────────────────────────────────────────────

interface LayerSubgroups {
  cable: DrawingObject[];
  removedCable: DrawingObject[];
  poles: DrawingObject[];
  mh: DrawingObject[];
  hh: DrawingObject[];
  ped: DrawingObject[];
  notes: DrawingObject[];
}

function subgroupForLayer(objects: DrawingObject[], layerId: string): LayerSubgroups {
  const out: LayerSubgroups = {
    cable: [], removedCable: [], poles: [], mh: [], hh: [], ped: [], notes: [],
  };
  for (const o of objects) {
    if (o.style.layerId !== layerId) continue;
    if (o.tool === "placed_cable") out.cable.push(o);
    else if (o.tool === "removed_cable") out.removedCable.push(o);
    else if (o.tool === "pole_new" || o.tool === "pole_removed") out.poles.push(o);
    else if (o.tool === "mh_new" || o.tool === "mh_removed") out.mh.push(o);
    else if (o.tool === "hh_new" || o.tool === "hh_removed") out.hh.push(o);
    else if (o.tool === "ped_new" || o.tool === "ped_removed") out.ped.push(o);
    else out.notes.push(o);
  }
  return out;
}

function cableFootage(objects: DrawingObject[]): number {
  let ft = 0;
  for (const o of objects) if ("vertices" in o) ft += polylineLengthFt(o.vertices);
  return ft;
}

function LayerRow({
  layer,
  isActive,
  objects,
}: {
  layer: AsBuiltLayer;
  isActive: boolean;
  objects: DrawingObject[];
}) {
  const { setActiveLayer, toggleLayerHidden, toggleLayerLocked, renameLayerDate } = useDrawing();
  const [expanded, setExpanded] = useState(isActive);
  const [editingDate, setEditingDate] = useState(false);
  const [dateValue, setDateValue] = useState(layer.workDate);

  const sub = subgroupForLayer(objects, layer.layerId);
  const totalCount =
    sub.cable.length + sub.removedCable.length + sub.poles.length +
    sub.mh.length + sub.hh.length + sub.ped.length + sub.notes.length;

  return (
    <div
      className={`phase7-layer-row${isActive ? " phase7-layer-row--active" : ""}${layer.hidden ? " phase7-layer-row--hidden" : ""}`}
      style={{
        borderTop: "1px solid var(--border)",
        padding: "6px 8px",
        opacity: layer.hidden ? 0.5 : 1,
        background: isActive ? "rgba(57,255,122,0.06)" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="icon-btn"
          title={expanded ? "Collapse" : "Expand"}
          style={{ fontSize: 10 }}
        >
          {expanded ? "▼" : "▶"}
        </button>
        <span style={{ fontWeight: 600, fontSize: 11 }}>{layer.createdBy}</span>
        {editingDate ? (
          <input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            onBlur={() => {
              if (dateValue !== layer.workDate) renameLayerDate(layer.layerId, dateValue);
              setEditingDate(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (dateValue !== layer.workDate) renameLayerDate(layer.layerId, dateValue);
                setEditingDate(false);
              }
              if (e.key === "Escape") {
                setDateValue(layer.workDate);
                setEditingDate(false);
              }
            }}
            autoFocus
            style={{ fontSize: 10 }}
          />
        ) : (
          <span
            style={{ fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}
            onDoubleClick={() => setEditingDate(true)}
            title="Double-click to edit date"
          >
            {layer.workDate}
          </span>
        )}
        <span style={{ fontSize: 9, color: "var(--text-muted)" }}>· {totalCount} obj</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
          <button
            type="button"
            className="icon-btn"
            title={layer.hidden ? "Show" : "Hide"}
            onClick={() => toggleLayerHidden(layer.layerId)}
          >
            {layer.hidden ? "🙈" : "👁"}
          </button>
          <button
            type="button"
            className="icon-btn"
            title={layer.locked ? "Unlock for editing" : "Lock"}
            onClick={() => toggleLayerLocked(layer.layerId)}
          >
            {layer.locked ? "🔒" : "🔓"}
          </button>
          {!isActive && (
            <button
              type="button"
              className="icon-btn"
              title="Make active (new objects land here)"
              onClick={() => setActiveLayer(layer.layerId)}
              style={{ fontWeight: 700, color: "#39ff7a" }}
            >
              ★
            </button>
          )}
        </span>
      </div>

      {expanded && (
        <div style={{ paddingLeft: 22, marginTop: 4, fontSize: 10, lineHeight: 1.7 }}>
          {sub.cable.length > 0 && (
            <div>Cable <strong>{sub.cable.length}</strong> · {fmtFt(cableFootage(sub.cable))}</div>
          )}
          {sub.removedCable.length > 0 && (
            <div>Removed Cable <strong>{sub.removedCable.length}</strong> · {fmtFt(cableFootage(sub.removedCable))}</div>
          )}
          {sub.poles.length > 0 && <div>Poles <strong>{sub.poles.length}</strong></div>}
          {sub.mh.length > 0 && <div>MH <strong>{sub.mh.length}</strong></div>}
          {sub.hh.length > 0 && <div>HH <strong>{sub.hh.length}</strong></div>}
          {sub.ped.length > 0 && <div>PED <strong>{sub.ped.length}</strong></div>}
          {sub.notes.length > 0 && <div>Notes <strong>{sub.notes.length}</strong></div>}
          {totalCount === 0 && (
            <div style={{ color: "var(--text-muted)" }}>Empty layer</div>
          )}
        </div>
      )}
    </div>
  );
}

function LayersSection() {
  const { state } = useDrawing();
  const { layers, activeLayerId, objects } = state;
  const [collapsed, setCollapsed] = useState(false);
  if (layers.length === 0) return null;

  return (
    <div className="phase7-layers-section" style={{ borderTop: "1px solid var(--border)" }}>
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          padding: "6px 8px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "var(--surface-2)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        <span>{collapsed ? "▶" : "▼"}</span>
        <span>Daily Layers</span>
        <span style={{ marginLeft: "auto" }}>{layers.length}</span>
      </div>
      {!collapsed && (
        <div>
          {layers.map((l) => (
            <LayerRow
              key={l.layerId}
              layer={l}
              isActive={l.layerId === activeLayerId}
              objects={objects}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Phase 8: Billable units totals ──────────────────────────────────────────

function fmtQty(qty: number, unit: string): string {
  // Preserve decimals — contract rule: SELECT BACKFILL 0.5 CY etc. (no rounding).
  if (unit === "FT") return `${Math.round(qty).toLocaleString()} ft`;
  if (qty === Math.floor(qty)) return `${qty.toLocaleString()} ${unit}`;
  return `${qty.toFixed(2)} ${unit}`;
}

function BillingTable({ entries, label, empty }: { entries: BillingEntry[]; label: string; empty: string }) {
  return (
    <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
        {label}
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)", padding: "2px 0" }}>{empty}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 8px", fontSize: 10 }}>
          {entries.map((e) => (
            <span key={`${e.unit_code}::${e.unit}`} style={{ display: "contents" }}>
              <span style={{ color: "var(--text)" }} title={e.desc}>{e.unit_code}</span>
              <span style={{ color: "#39ff7a", fontWeight: 600, textAlign: "right" }}>{fmtQty(e.qty, e.unit)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function BillingTotalsSection() {
  const { state } = useDrawing();
  const activeLayerId = state.activeLayerId;

  const activeEntries = useMemo<BillingEntry[]>(() => {
    if (!activeLayerId) return [];
    const objs = state.objects.filter((o) => o.style.layerId === activeLayerId);
    return aggregateUnits(objs);
  }, [state.objects, activeLayerId]);

  const jobEntries = useMemo<BillingEntry[]>(
    () => aggregateUnits(state.objects),
    [state.objects],
  );

  return (
    <>
      <BillingTable
        entries={activeEntries}
        label="Active Layer Totals"
        empty={activeLayerId ? "No billable units on active layer yet." : "Select or create an active layer."}
      />
      <BillingTable
        entries={jobEntries}
        label="Job Totals"
        empty="No billable units yet."
      />
    </>
  );
}

function ActiveLayerBanner() {
  const { state } = useDrawing();
  const { layers, activeLayerId, activeForeman, activeWorkDate } = state;
  const active = layers.find((l) => l.layerId === activeLayerId);
  if (!active && !activeForeman) return null;
  const createdBy = active?.createdBy ?? activeForeman ?? "—";
  const workDate = active?.workDate ?? activeWorkDate;
  return (
    <div
      style={{
        padding: "4px 10px",
        background: "linear-gradient(90deg, rgba(57,255,122,0.18), rgba(57,255,122,0.04))",
        borderBottom: "1px solid var(--border)",
        fontSize: 10,
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: "var(--text)",
      }}
      title="New drawings land on this layer"
    >
      <span style={{ color: "#39ff7a", fontWeight: 700 }}>● ACTIVE</span>
      <span style={{ fontWeight: 600 }}>{createdBy}</span>
      <span style={{ color: "var(--text-muted)" }}>· {workDate}</span>
      {active?.locked && <span style={{ marginLeft: "auto", color: "#ff2d4a" }}>READ-ONLY</span>}
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

      {/* Phase 7: active-layer banner */}
      <ActiveLayerBanner />

      {/* Phase 8: billable units — Active Layer + Job totals, both visible */}
      <BillingTotalsSection />

      {/* Phase 7: daily layer list */}
      <LayersSection />

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
