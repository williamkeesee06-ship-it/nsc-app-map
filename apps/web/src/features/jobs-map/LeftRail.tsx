// Left rail for the Jobs Map — Phase 3.
// Contains: drawing toolbar (telecom + basic tools), modifiers panel,
// map utilities, and filter rail.
import type { Job } from "@nsc/types";
import { useState, type MutableRefObject } from "react";
import FilterRail from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import { isJobCompleted } from "./markerStyle.js";
import { useDrawing } from "../drawing/drawingContext.js";
import ModifiersPanel from "../drawing/ModifiersPanel.js";
import type { DrawingTool } from "@nsc/types";
import { downloadScreenshot } from "../drawing/screenshot.js";

interface Props {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  onResync: () => Promise<void> | void;
  mapRef: MutableRefObject<google.maps.Map | null>;
}

export default function LeftRail({ jobs, filters, setFilters, onResync, mapRef }: Props) {
  return (
    <aside className="left-rail">
      <div className="left-rail__scroll">
        <ToolsSection onResync={onResync} jobs={jobs} mapRef={mapRef} />
        <FilterRail
          jobs={jobs}
          filters={filters}
          setFilters={setFilters}
        />
      </div>
    </aside>
  );
}

// ─── TOOLS SECTION ───────────────────────────────────────────────────────────

function ToolsSection({
  onResync,
  jobs,
  mapRef,
}: {
  onResync: () => Promise<void> | void;
  jobs: Job[];
  mapRef: MutableRefObject<google.maps.Map | null>;
}) {
  const [resyncing, setResyncing] = useState(false);
  const {
    state,
    setTool,
    undo,
    redo,
    canUndo,
    canRedo,
    deleteSelected,
    save,
  } = useDrawing();

  const { activeTool, dirty, saving, saveError, targetJobId, targetWorkOrder } = state;
  const hasSelection = state.selectedIds.size > 0;
  const noTarget = !targetJobId;

  function fitAll() {
    const map = mapRef.current;
    if (!map) return;
    const mapped = jobs.filter(
      (j) => j.geocode?.status === "OK" && j.geocode.lat !== 0
    );
    if (mapped.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    mapped.forEach((j) =>
      bounds.extend({ lat: j.geocode!.lat, lng: j.geocode!.lng })
    );
    map.fitBounds(bounds, 60);
  }

  function recenter() {
    const map = mapRef.current;
    if (!map) return;
    map.panTo({ lat: 47.5, lng: -122.1 });
    map.setZoom(9);
  }

  async function doResync() {
    if (resyncing) return;
    setResyncing(true);
    try {
      await onResync();
    } finally {
      setResyncing(false);
    }
  }

  async function doScreenshot() {
    const map = mapRef.current;
    if (!map) return;
    await downloadScreenshot(map, state.objects);
  }

  function toggleTool(tool: DrawingTool) {
    setTool(activeTool === tool ? null : tool);
  }

  return (
    <section className="rail-section rail-section--tools">

      {/* ── Save target indicator ─────────────────────── */}
      <div className="draw-target-bar">
        {noTarget ? (
          <span className="draw-target-bar__hint">Click a job marker to start drawing</span>
        ) : (
          <>
            <span className="draw-target-bar__label">Saving to:</span>
            <span className="draw-target-bar__wo">{targetWorkOrder ?? targetJobId}</span>
          </>
        )}
      </div>

      {/* ── Top utilities ─────────────────────────────── */}
      <div className="tool-row tool-row--utilities">
        <button
          type="button"
          className="tool-btn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
          aria-label="Undo"
        >
          ↶
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
          aria-label="Redo"
        >
          ↷
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={doScreenshot}
          title="Screenshot"
          aria-label="Screenshot"
        >
          ⎙
        </button>
        <button
          type="button"
          className={`tool-btn${dirty ? " tool-btn--dirty" : ""}`}
          onClick={save}
          disabled={!dirty || saving || noTarget}
          title={noTarget ? "Select a job first" : dirty ? "Save drawings to Firestore" : "No unsaved changes"}
          aria-label="Save"
        >
          {saving ? "…" : "💾"}
        </button>
        {dirty && !saving && (
          <span className="unsaved-dot" title="Unsaved changes">● Unsaved</span>
        )}
        {saveError && (
          <span className="save-error" title={saveError}>⚠ Save failed</span>
        )}
      </div>

      {/* ── Map utilities ─────────────────────────────── */}
      <h4 className="rail-h4">Map tools</h4>
      <div className="tool-row">
        <button type="button" className="tool-btn tool-btn--text" onClick={fitAll}>Fit all</button>
        <button type="button" className="tool-btn tool-btn--text" onClick={recenter}>Recenter</button>
        <button
          type="button"
          className="tool-btn tool-btn--text"
          onClick={doResync}
          disabled={resyncing}
          title="Pull latest from Smartsheet"
        >
          {resyncing ? "Syncing…" : "Resync"}
        </button>
      </div>

      {/* ── Telecom tools ─────────────────────────────── */}
      <h4 className="rail-h4">Cable</h4>
      <div className="tool-row">
        <ToolBtn tool="placed_cable" label="Placed" active={activeTool} onToggle={toggleTool} disabled={noTarget} color="var(--neon-green)" />
        <ToolBtn tool="removed_cable" label="Removed" active={activeTool} onToggle={toggleTool} disabled={noTarget} color="var(--neon-red)" />
      </div>

      <h4 className="rail-h4">Points · NEW</h4>
      <div className="tool-row tool-row--wrap">
        {(["mh_new", "hh_new", "ped_new", "pole_new", "cabinet_new", "anchor_new"] as DrawingTool[]).map((t) => (
          <ToolBtn key={t} tool={t} label={t.split("_")[0]!.toUpperCase()} active={activeTool} onToggle={toggleTool} disabled={noTarget} color="var(--neon-green)" />
        ))}
      </div>

      <h4 className="rail-h4">Points · REMOVED</h4>
      <div className="tool-row tool-row--wrap">
        {(["mh_removed", "hh_removed", "ped_removed", "pole_removed", "cabinet_removed", "anchor_removed"] as DrawingTool[]).map((t) => (
          <ToolBtn key={t} tool={t} label={t.split("_")[0]!.toUpperCase()} active={activeTool} onToggle={toggleTool} disabled={noTarget} color="var(--neon-red)" />
        ))}
      </div>

      <h4 className="rail-h4">Text &amp; Basic</h4>
      <div className="tool-row tool-row--wrap">
        <ToolBtn tool="text" label="Text" active={activeTool} onToggle={toggleTool} disabled={noTarget} />
        <ToolBtn tool="line" label="Line" active={activeTool} onToggle={toggleTool} disabled={noTarget} />
        <ToolBtn tool="arrow" label="Arrow" active={activeTool} onToggle={toggleTool} disabled={noTarget} />
        <ToolBtn tool="rectangle" label="Rect" active={activeTool} onToggle={toggleTool} disabled={noTarget} />
        <ToolBtn tool="circle" label="Circle" active={activeTool} onToggle={toggleTool} disabled={noTarget} />
        <ToolBtn tool="polygon" label="Poly" active={activeTool} onToggle={toggleTool} disabled={noTarget} />
        <ToolBtn tool="freehand" label="Free" active={activeTool} onToggle={toggleTool} disabled={noTarget} />
        <ToolBtn tool="measure" label="Measure" active={activeTool} onToggle={toggleTool} disabled={noTarget} />
        <ToolBtn tool="select" label="Select" active={activeTool} onToggle={toggleTool} disabled={noTarget} />
      </div>

      {/* Delete selected */}
      {hasSelection && (
        <div className="tool-row">
          <button
            type="button"
            className="tool-btn tool-btn--danger"
            onClick={deleteSelected}
            title="Delete selected objects (Del)"
          >
            🗑 Delete ({state.selectedIds.size})
          </button>
        </div>
      )}

      {/* ── Modifiers ──────────────────────────────────── */}
      <h4 className="rail-h4">Modifiers</h4>
      <ModifiersPanel />

      <div className="rail-section__divider" />
    </section>
  );
}

// ─── ToolBtn helper ───────────────────────────────────────────────────────────

function ToolBtn({
  tool,
  label,
  active,
  onToggle,
  disabled,
  color,
}: {
  tool: DrawingTool;
  label: string;
  active: DrawingTool | null;
  onToggle: (t: DrawingTool) => void;
  disabled?: boolean;
  color?: string;
}) {
  const isActive = active === tool;
  return (
    <button
      type="button"
      className={`tool-btn tool-btn--draw${isActive ? " tool-btn--active" : ""}`}
      onClick={() => onToggle(tool)}
      disabled={disabled && !isActive}
      title={disabled ? "Click a job marker to start drawing" : label}
      style={isActive ? { borderColor: color ?? "var(--accent)", color: color ?? "var(--accent)" } : color ? { color } : undefined}
    >
      {label}
    </button>
  );
}

// Convenience export
export { isJobCompleted };
