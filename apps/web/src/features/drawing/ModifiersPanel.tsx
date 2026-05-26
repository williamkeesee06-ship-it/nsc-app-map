// ModifiersPanel — horizontal "modifier strip" rendered as a slim bar
// directly below the topbar (positioned absolute at top of the map area).
//
// Billy 5/21: stays VISIBLE AT ALL TIMES — even with no tool active and no
// selection. Adjusting Width/Opacity/Color/Style/Fill/Size while no tool is
// active updates the default style; the next tool selected starts with
// those values.

import { useDrawing } from "./drawingContext.js";
import type { DrawingStyle } from "@nsc/types";

// Preset color palette for quick swatches
const SWATCH_COLORS = [
  "#1565C0", // cobalt blue
  "#2e7d32", // green
  "#e65100", // orange
  "#6a1b9a", // purple
  "#c62828", // red
  "#757575", // gray
];

type PointSize = "S" | "M" | "L";
const SIZE_MAP: Record<PointSize, number> = { S: 0.7, M: 1.0, L: 1.5 };

export default function ModifiersPanel() {
  const { state, setStyle, updateObject } = useDrawing();
  const { style, selectedIds, objects, activeTool } = state;

  // Phase 9.6 (Billy 5/26): collapse style toolbar when no drawing tool is active
  // (and nothing selected). This reclaims vertical space for the map during pure
  // review/viewing. The bar slides back in the moment a tool is selected.
  const noToolNoSelection = activeTool === null && selectedIds.size === 0;
  if (noToolNoSelection) return null;

  const selectedObj = selectedIds.size === 1
    ? objects.find((o) => selectedIds.has(o.id))
    : null;

  const current: DrawingStyle = selectedObj ? selectedObj.style : style;

  // Is a point tool active or selected?
  const isPointTool = activeTool != null &&
    (activeTool.endsWith("_new") || activeTool.endsWith("_removed"));
  const isSelectedPoint = selectedObj && "position" in selectedObj && !("text" in selectedObj);

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

  // SELECT tool: show selection info only
  if (activeTool === "select") {
    return (
      <div className="modifier-strip">
        <span className="mod-strip-select-info">
          {selectedIds.size > 0
            ? `${selectedIds.size} object${selectedIds.size !== 1 ? "s" : ""} selected`
            : "Click objects to select · Shift+click to multi-select"}
        </span>
      </div>
    );
  }

  // Cables: show width + opacity only (colors hardcoded)
  const isCable = activeTool === "placed_cable" || activeTool === "removed_cable";

  return (
    <div className="modifier-strip">

      {/* ── Stroke width ──────────────────────────────────── */}
      <div className="mod-strip-item">
        <span className="mod-strip-label">Width</span>
        <input
          type="range"
          className="mod-strip-slider"
          min={1} max={10} step={1}
          value={current.strokeWidth}
          onChange={(e) => patch({ strokeWidth: Number(e.target.value) })}
        />
        <span className="mod-strip-val">{current.strokeWidth}px</span>
      </div>

      <div className="mod-strip-div" />

      {/* ── Opacity ───────────────────────────────────────── */}
      <div className="mod-strip-item">
        <span className="mod-strip-label">Opacity</span>
        <input
          type="range"
          className="mod-strip-slider"
          min={0.1} max={1} step={0.05}
          value={current.opacity}
          onChange={(e) => patch({ opacity: Number(e.target.value) })}
        />
        <span className="mod-strip-val">{Math.round(current.opacity * 100)}%</span>
      </div>

      {/* Non-cable tools get color + line style + fill ───── */}
      {!isCable && (
        <>
          <div className="mod-strip-div" />

          {/* ── Color swatches ──────────────────────────── */}
          <div className="mod-strip-item">
            <span className="mod-strip-label">Color</span>
            <div className="mod-strip-swatches">
              {SWATCH_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`mod-strip-swatch${current.strokeColor === c ? " mod-strip-swatch--active" : ""}`}
                  style={{ background: c }}
                  onClick={() => patch({ strokeColor: c })}
                  title={c}
                  aria-label={c}
                />
              ))}
              {/* Custom color picker */}
              <input
                type="color"
                value={current.strokeColor.slice(0, 7)}
                onChange={(e) => patch({ strokeColor: e.target.value })}
                title="Custom color"
                style={{
                  width: 20, height: 20, padding: 0,
                  border: "1.5px solid var(--border)", borderRadius: "50%",
                  cursor: "pointer", background: "transparent",
                }}
              />
            </div>
          </div>

          <div className="mod-strip-div" />

          {/* ── Line style ──────────────────────────────── */}
          <div className="mod-strip-item">
            <span className="mod-strip-label">Style</span>
            <div className="mod-strip-toggle">
              <button
                type="button"
                className={`mod-strip-toggle-btn${current.strokeStyle === "solid" ? " active" : ""}`}
                onClick={() => patch({ strokeStyle: "solid" })}
              >─</button>
              <button
                type="button"
                className={`mod-strip-toggle-btn${current.strokeStyle === "dashed" ? " active" : ""}`}
                onClick={() => patch({ strokeStyle: "dashed" })}
              >- -</button>
            </div>
          </div>

          <div className="mod-strip-div" />

          {/* ── Fill ────────────────────────────────────── */}
          <div className="mod-strip-item">
            <span className="mod-strip-label">Fill</span>
            <div className="mod-strip-toggle">
              <button
                type="button"
                className={`mod-strip-toggle-btn${current.fill.kind === "none" ? " active" : ""}`}
                onClick={() => patch({ fill: { kind: "none" } })}
              >None</button>
              <button
                type="button"
                className={`mod-strip-toggle-btn${current.fill.kind === "solid" ? " active" : ""}`}
                onClick={() => patch({ fill: { kind: "solid", color: current.strokeColor } })}
              >Solid</button>
              <button
                type="button"
                className={`mod-strip-toggle-btn${current.fill.kind === "hash" ? " active" : ""}`}
                onClick={() => patch({ fill: { kind: "hash", pattern: "diagonal", color: current.strokeColor, density: 6 } })}
              >Hash</button>
            </div>
          </div>
        </>
      )}

      {/* ── Point size (point tools only) ───────────────── */}
      {(isPointTool || isSelectedPoint) && (
        <>
          <div className="mod-strip-div" />
          <div className="mod-strip-item">
            <span className="mod-strip-label">Size</span>
            <div className="mod-strip-size">
              {(["S", "M", "L"] as PointSize[]).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className={`mod-strip-size-btn${currentSizeKey() === sz ? " active" : ""}`}
                  onClick={() => patchSize(sz)}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Label input for point objects with text ─────── */}
      {isSelectedPoint && selectedObj && "position" in selectedObj && !("text" in selectedObj) && (
        <>
          <div className="mod-strip-div" />
          <div className="mod-strip-item">
            <span className="mod-strip-label">Label</span>
            <input
              type="text"
              className="mod-strip-label-input"
              value={selectedObj.label ?? ""}
              placeholder="Label…"
              onChange={(e) => updateObject({ ...selectedObj, label: e.target.value })}
            />
          </div>
        </>
      )}
    </div>
  );
}
