// ModifiersPanel — light + cyan-neon editor toolbar (Phase 2 redesign).
//
// Billy 6/2/26: replaces the old slim mod-strip. Same position (below topbar),
// same "stays visible while a tool is active or something is selected" rule,
// but with a richer toolset and a luxury light/cyan visual style.
//
// Adaptive sections:
//   - Text + callout tools: font family, size, B/I/U, text color, alignment
//   - Shape/line tools: width, color, style (solid/dashed/dotted), fill
//   - Point tools: size S/M/L, label
//   - Always: opacity, delete-selected

import { useDrawing } from "./drawingContext.js";
import type { DrawingStyle } from "@nsc/types";

// 12 swatches — keep the original 6 + 6 more for richer picks.
const SWATCH_COLORS = [
  "#1565C0", // cobalt blue
  "#0288D1", // sky blue
  "#00ACC1", // cyan
  "#2e7d32", // green
  "#FFC107", // amber
  "#e65100", // orange
  "#c62828", // red
  "#AD1457", // magenta
  "#6a1b9a", // purple
  "#37474F", // slate
  "#000000", // black
  "#FFFFFF", // white
];

const FONT_FAMILIES = [
  "Inter",
  "Roboto",
  "Helvetica",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
];

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

type PointSize = "S" | "M" | "L";
const SIZE_MAP: Record<PointSize, number> = { S: 0.7, M: 1.0, L: 1.5 };

export default function ModifiersPanel() {
  const { state, setStyle, updateObject, deleteSelected } = useDrawing();
  const { style, selectedIds, objects, activeTool } = state;

  // Collapse when no tool active AND nothing selected — same rule as before.
  const noToolNoSelection = activeTool === null && selectedIds.size === 0;
  if (noToolNoSelection) return null;

  const selectedObj = selectedIds.size === 1
    ? objects.find((o) => selectedIds.has(o.id))
    : null;

  const current: DrawingStyle = selectedObj ? selectedObj.style : style;

  // Tool categorization
  const isPointTool = activeTool != null &&
    (activeTool.endsWith("_new") || activeTool.endsWith("_removed"));
  const isSelectedPoint =
    selectedObj && "position" in selectedObj && !("text" in selectedObj);

  const isTextTool =
    activeTool === "text" || activeTool === "callout" ||
    (selectedObj?.tool === "text" || selectedObj?.tool === "callout");

  const isCableTool =
    activeTool === "placed_cable" || activeTool === "removed_cable";

  const isShapeOrLineTool =
    !isPointTool && !isTextTool && !isCableTool && activeTool !== "select" && activeTool !== null;

  const currentPointSize = (selectedObj?.style ?? style).pointSize ?? 1.0;
  function currentSizeKey(): PointSize {
    if (currentPointSize <= 0.85) return "S";
    if (currentPointSize >= 1.3) return "L";
    return "M";
  }

  function patch(p: Partial<DrawingStyle>) {
    setStyle(p);
    if (selectedObj) {
      updateObject({ ...selectedObj, style: { ...selectedObj.style, ...p } });
    }
  }

  function patchSize(sz: PointSize) {
    const pointSize = SIZE_MAP[sz];
    setStyle({ pointSize });
    if (selectedObj && isSelectedPoint) {
      updateObject({ ...selectedObj, style: { ...selectedObj.style, pointSize } });
    }
  }

  // SELECT tool with nothing selected → hide
  if (activeTool === "select" && selectedIds.size === 0) return null;

  // SELECT tool with multi-select → show count + delete
  if (activeTool === "select" && selectedIds.size > 1) {
    return (
      <div className="editor-toolbar">
        <span className="etb-info">
          {`${selectedIds.size} objects selected`}
        </span>
        <div className="etb-div" />
        <button
          type="button"
          className="etb-btn etb-btn--danger"
          onClick={deleteSelected}
          title="Delete selected"
        >
          <TrashIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="editor-toolbar">

      {/* ── TEXT FORMATTING (text + callout only) ────────────── */}
      {isTextTool && (
        <>
          <div className="etb-item">
            <select
              className="etb-select etb-select--font"
              value={current.fontFamily ?? "Inter"}
              onChange={(e) => patch({ fontFamily: e.target.value })}
              title="Font family"
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
          </div>

          <div className="etb-item">
            <select
              className="etb-select etb-select--size"
              value={current.fontSize ?? 14}
              onChange={(e) => patch({ fontSize: Number(e.target.value) })}
              title="Font size"
            >
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="etb-div" />

          <div className="etb-item">
            <button
              type="button"
              className={`etb-btn etb-btn--toggle${current.bold ? " etb-btn--active" : ""}`}
              onClick={() => patch({ bold: !current.bold })}
              title="Bold"
            >
              <span style={{ fontWeight: 700 }}>B</span>
            </button>
            <button
              type="button"
              className={`etb-btn etb-btn--toggle${current.italic ? " etb-btn--active" : ""}`}
              onClick={() => patch({ italic: !current.italic })}
              title="Italic"
            >
              <span style={{ fontStyle: "italic" }}>I</span>
            </button>
            <button
              type="button"
              className={`etb-btn etb-btn--toggle${current.underline ? " etb-btn--active" : ""}`}
              onClick={() => patch({ underline: !current.underline })}
              title="Underline"
            >
              <span style={{ textDecoration: "underline" }}>U</span>
            </button>
          </div>

          <div className="etb-div" />

          <div className="etb-item" title="Text color">
            <label className="etb-color-pill">
              <span className="etb-color-pill-label">A</span>
              <input
                type="color"
                className="etb-color-input"
                value={(current.textColor ?? current.strokeColor).slice(0, 7)}
                onChange={(e) => patch({ textColor: e.target.value })}
              />
              <span
                className="etb-color-pill-swatch"
                style={{ background: current.textColor ?? current.strokeColor }}
              />
            </label>
          </div>

          <div className="etb-div" />

          <div className="etb-item">
            <button
              type="button"
              className={`etb-btn etb-btn--toggle${(current.textAlign ?? "left") === "left" ? " etb-btn--active" : ""}`}
              onClick={() => patch({ textAlign: "left" })}
              title="Align left"
            ><AlignLeftIcon /></button>
            <button
              type="button"
              className={`etb-btn etb-btn--toggle${current.textAlign === "center" ? " etb-btn--active" : ""}`}
              onClick={() => patch({ textAlign: "center" })}
              title="Align center"
            ><AlignCenterIcon /></button>
            <button
              type="button"
              className={`etb-btn etb-btn--toggle${current.textAlign === "right" ? " etb-btn--active" : ""}`}
              onClick={() => patch({ textAlign: "right" })}
              title="Align right"
            ><AlignRightIcon /></button>
          </div>

          <div className="etb-div" />
        </>
      )}

      {/* ── STROKE WIDTH (all non-text) ──────────────────────── */}
      {!isTextTool && (
        <>
          <div className="etb-item">
            <span className="etb-label">Width</span>
            <input
              type="range"
              className="etb-slider"
              min={1} max={10} step={1}
              value={current.strokeWidth}
              onChange={(e) => patch({ strokeWidth: Number(e.target.value) })}
            />
            <span className="etb-val">{current.strokeWidth}px</span>
          </div>

          <div className="etb-div" />
        </>
      )}

      {/* ── OPACITY (always) ─────────────────────────────────── */}
      <div className="etb-item">
        <span className="etb-label">Opacity</span>
        <input
          type="range"
          className="etb-slider"
          min={0.1} max={1} step={0.05}
          value={current.opacity}
          onChange={(e) => patch({ opacity: Number(e.target.value) })}
        />
        <span className="etb-val">{Math.round(current.opacity * 100)}%</span>
      </div>

      {/* ── STROKE COLOR (shape/line/point, also text-as-stroke) ── */}
      {!isCableTool && (
        <>
          <div className="etb-div" />

          <div className="etb-item">
            <span className="etb-label">Color</span>
            <div className="etb-swatches">
              {SWATCH_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`etb-swatch${current.strokeColor === c ? " etb-swatch--active" : ""}`}
                  style={{ background: c }}
                  onClick={() => patch({ strokeColor: c })}
                  title={c}
                  aria-label={c}
                />
              ))}
              <label className="etb-color-pill etb-color-pill--small" title="Custom color">
                <input
                  type="color"
                  className="etb-color-input"
                  value={current.strokeColor.slice(0, 7)}
                  onChange={(e) => patch({ strokeColor: e.target.value })}
                />
                <span
                  className="etb-color-pill-swatch"
                  style={{ background: current.strokeColor }}
                />
              </label>
            </div>
          </div>
        </>
      )}

      {/* ── LINE STYLE (shape/line tools) ────────────────────── */}
      {(isShapeOrLineTool || isCableTool) && (
        <>
          <div className="etb-div" />

          <div className="etb-item">
            <span className="etb-label">Style</span>
            <div className="etb-toggle">
              <button
                type="button"
                className={`etb-toggle-btn${current.strokeStyle === "solid" ? " etb-toggle-btn--active" : ""}`}
                onClick={() => patch({ strokeStyle: "solid" })}
                title="Solid"
              >━━━</button>
              <button
                type="button"
                className={`etb-toggle-btn${current.strokeStyle === "dashed" ? " etb-toggle-btn--active" : ""}`}
                onClick={() => patch({ strokeStyle: "dashed" })}
                title="Dashed"
              >╴╴╴</button>
              <button
                type="button"
                className={`etb-toggle-btn${current.strokeStyle === "dotted" ? " etb-toggle-btn--active" : ""}`}
                onClick={() => patch({ strokeStyle: "dotted" })}
                title="Dotted"
              >• • •</button>
            </div>
          </div>
        </>
      )}

      {/* ── FILL (shape tools, no cable, no text) ────────────── */}
      {isShapeOrLineTool && !isCableTool && (
        <>
          <div className="etb-div" />

          <div className="etb-item">
            <span className="etb-label">Fill</span>
            <div className="etb-toggle">
              <button
                type="button"
                className={`etb-toggle-btn${current.fill.kind === "none" ? " etb-toggle-btn--active" : ""}`}
                onClick={() => patch({ fill: { kind: "none" } })}
              >None</button>
              <button
                type="button"
                className={`etb-toggle-btn${current.fill.kind === "solid" ? " etb-toggle-btn--active" : ""}`}
                onClick={() => patch({ fill: { kind: "solid", color: current.strokeColor } })}
              >Solid</button>
              <button
                type="button"
                className={`etb-toggle-btn${current.fill.kind === "hash" ? " etb-toggle-btn--active" : ""}`}
                onClick={() => patch({ fill: { kind: "hash", pattern: "diagonal", color: current.strokeColor, density: 6 } })}
              >Hash</button>
            </div>
          </div>
        </>
      )}

      {/* ── POINT SIZE (point tools only) ────────────────────── */}
      {(isPointTool || isSelectedPoint) && (
        <>
          <div className="etb-div" />
          <div className="etb-item">
            <span className="etb-label">Size</span>
            <div className="etb-toggle">
              {(["S", "M", "L"] as PointSize[]).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className={`etb-toggle-btn${currentSizeKey() === sz ? " etb-toggle-btn--active" : ""}`}
                  onClick={() => patchSize(sz)}
                >{sz}</button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── LABEL (selected point only) ──────────────────────── */}
      {isSelectedPoint && selectedObj && "position" in selectedObj && !("text" in selectedObj) && (
        <>
          <div className="etb-div" />
          <div className="etb-item">
            <span className="etb-label">Label</span>
            <input
              type="text"
              className="etb-text-input"
              value={selectedObj.label ?? ""}
              placeholder="Label…"
              onChange={(e) => updateObject({ ...selectedObj, label: e.target.value })}
            />
          </div>
        </>
      )}

      {/* ── DELETE (when something is selected) ──────────────── */}
      {selectedObj && (
        <>
          <div className="etb-div" />
          <button
            type="button"
            className="etb-btn etb-btn--danger"
            onClick={deleteSelected}
            title="Delete"
          ><TrashIcon /></button>
        </>
      )}
    </div>
  );
}

// ─── Inline SVG icons ─────────────────────────────────────────────
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function AlignLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="15" y2="12" />
      <line x1="3" y1="18" x2="18" y2="18" />
    </svg>
  );
}
function AlignCenterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}
function AlignRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="6" y1="18" x2="21" y2="18" />
    </svg>
  );
}
