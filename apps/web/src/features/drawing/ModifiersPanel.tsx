// ModifiersPanel — contextual style controls for the active drawing tool
// or the selected objects. Mounted inside LeftRail.
import { useDrawing } from "./drawingContext.js";
import type { DrawingStyle } from "@nsc/types";

export default function ModifiersPanel() {
  const { state, setStyle, updateObject } = useDrawing();
  const { style, selectedIds, objects } = state;

  // Get first selected object's style as the "current" style for the panel
  const selectedObj = selectedIds.size === 1
    ? objects.find((o) => selectedIds.has(o.id))
    : null;

  const current: DrawingStyle = selectedObj ? selectedObj.style : style;

  function patch(p: Partial<DrawingStyle>) {
    setStyle(p);
    // Also update selected objects
    if (selectedObj) {
      updateObject({ ...selectedObj, style: { ...selectedObj.style, ...p } });
    }
  }

  const isPoint =
    selectedObj && "position" in selectedObj && !("text" in selectedObj) && !("bounds" in selectedObj);

  return (
    <div className="modifiers-panel">
      {/* Stroke color */}
      <div className="mod-row">
        <span className="mod-label">Color</span>
        <input
          type="color"
          value={current.strokeColor.slice(0, 7)}
          onChange={(e) => patch({ strokeColor: e.target.value })}
          className="mod-color"
        />
      </div>

      {/* Stroke width */}
      <div className="mod-row">
        <span className="mod-label">Width</span>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={current.strokeWidth}
          onChange={(e) => patch({ strokeWidth: Number(e.target.value) })}
          className="mod-slider"
        />
        <span className="mod-val">{current.strokeWidth}px</span>
      </div>

      {/* Stroke style */}
      <div className="mod-row">
        <span className="mod-label">Style</span>
        <div className="mod-toggle">
          <button
            type="button"
            className={`mod-toggle-btn${current.strokeStyle === "solid" ? " active" : ""}`}
            onClick={() => patch({ strokeStyle: "solid" })}
          >
            ─
          </button>
          <button
            type="button"
            className={`mod-toggle-btn${current.strokeStyle === "dashed" ? " active" : ""}`}
            onClick={() => patch({ strokeStyle: "dashed" })}
          >
            - -
          </button>
        </div>
      </div>

      {/* Fill */}
      <div className="mod-row">
        <span className="mod-label">Fill</span>
        <div className="mod-toggle">
          <button
            type="button"
            className={`mod-toggle-btn${current.fill.kind === "none" ? " active" : ""}`}
            onClick={() => patch({ fill: { kind: "none" } })}
          >
            None
          </button>
          <button
            type="button"
            className={`mod-toggle-btn${current.fill.kind === "solid" ? " active" : ""}`}
            onClick={() =>
              patch({
                fill: {
                  kind: "solid",
                  color: current.fill.kind === "solid" ? current.fill.color : current.strokeColor,
                },
              })
            }
          >
            Solid
          </button>
          <button
            type="button"
            className={`mod-toggle-btn${current.fill.kind === "hash" ? " active" : ""}`}
            onClick={() =>
              patch({
                fill: {
                  kind: "hash",
                  pattern: "diagonal",
                  color: current.fill.kind === "hash" ? current.fill.color : current.strokeColor,
                  density: 6,
                },
              })
            }
          >
            Hash
          </button>
        </div>
      </div>

      {/* Fill color (when solid or hash) */}
      {current.fill.kind !== "none" && (
        <div className="mod-row mod-row--indent">
          <span className="mod-label">Fill clr</span>
          <input
            type="color"
            value={(current.fill.kind === "solid" || current.fill.kind === "hash"
              ? current.fill.color
              : current.strokeColor
            ).slice(0, 7)}
            onChange={(e) => {
              if (current.fill.kind === "solid") {
                patch({ fill: { kind: "solid", color: e.target.value } });
              } else if (current.fill.kind === "hash") {
                patch({
                  fill: { ...current.fill, color: e.target.value },
                });
              }
            }}
            className="mod-color"
          />
        </div>
      )}

      {/* Hash pattern picker */}
      {current.fill.kind === "hash" && (
        <>
          <div className="mod-row mod-row--indent">
            <span className="mod-label">Pattern</span>
            <div className="mod-toggle">
              {(["diagonal", "cross", "dots"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`mod-toggle-btn${
                    current.fill.kind === "hash" && current.fill.pattern === p ? " active" : ""
                  }`}
                  onClick={() =>
                    current.fill.kind === "hash" &&
                    patch({ fill: { ...current.fill, pattern: p } })
                  }
                >
                  {p === "diagonal" ? "///" : p === "cross" ? "##" : "···"}
                </button>
              ))}
            </div>
          </div>
          <div className="mod-row mod-row--indent">
            <span className="mod-label">Density</span>
            <input
              type="range"
              min={2}
              max={12}
              step={1}
              value={current.fill.kind === "hash" ? current.fill.density : 6}
              onChange={(e) =>
                current.fill.kind === "hash" &&
                patch({ fill: { ...current.fill, density: Number(e.target.value) } })
              }
              className="mod-slider"
            />
          </div>
        </>
      )}

      {/* Opacity */}
      <div className="mod-row">
        <span className="mod-label">Opacity</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={current.opacity}
          onChange={(e) => patch({ opacity: Number(e.target.value) })}
          className="mod-slider"
        />
        <span className="mod-val">{Math.round(current.opacity * 100)}%</span>
      </div>

      {/* Label input for point tools */}
      {isPoint && selectedObj && "position" in selectedObj && !("text" in selectedObj) && (
        <div className="mod-row">
          <span className="mod-label">Label</span>
          <input
            type="text"
            className="mod-text-input"
            value={selectedObj.label ?? ""}
            placeholder="Label…"
            onChange={(e) => updateObject({ ...selectedObj, label: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
