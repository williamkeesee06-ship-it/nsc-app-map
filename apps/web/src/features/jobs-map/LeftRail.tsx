// Left rail — Phase 4.2: resizable drag handle + adaptive 1/2-col grid + localStorage persistence
// Phase 4.1: 2-col grid, standard tools first, TELECOM divider, telecom below.
// Undo/Redo/Save moved to topbar. Screenshot/fit/recenter removed.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "@nsc/types";
import type { MutableRefObject } from "react";
import FilterRail from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import { isJobCompleted } from "./markerStyle.js";
import { useDrawing } from "../drawing/drawingContext.js";
import type { DrawingTool } from "@nsc/types";
import { railSvgForTool } from "../drawing/icons/telecomIcons.js";
import { queuePrefWrite } from "../../lib/prefsSync.js";

const DEFAULT_WIDTH = 130;
const MIN_WIDTH = 95;
const MAX_WIDTH = 320;
const LS_KEY = "nsc.leftRailWidth";

interface Props {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  onResync: () => Promise<void> | void;
  mapRef: MutableRefObject<google.maps.Map | null>;
  /** Phase 5: when true, hide the FilterRail section (workspace mode) */
  hideFilters?: boolean;
  /** Phase 9.7: manager-mode forwards to FilterRail. */
  managerMode?: boolean;
  availableSupervisors?: string[];
}

export default function LeftRail({
  jobs,
  filters,
  setFilters,
  hideFilters,
  managerMode,
  availableSupervisors,
}: Props) {
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);
  const handleRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage on mount + listen for cross-device sync.
  const loadFromLS = useCallback(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored !== null) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) {
          setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed)));
        }
      }
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    loadFromLS();
    function onHydrated() { loadFromLS(); }
    window.addEventListener("nsc:prefs-hydrated", onHydrated as EventListener);
    return () => window.removeEventListener("nsc:prefs-hydrated", onHydrated as EventListener);
  }, [loadFromLS]);

  // Drag handlers
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    handleRef.current?.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  const onDoubleClick = useCallback(() => {
    setWidth(DEFAULT_WIDTH);
    try {
      localStorage.setItem(LS_KEY, String(DEFAULT_WIDTH));
      queuePrefWrite(LS_KEY, DEFAULT_WIDTH);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      setWidth(next);
    }

    function onMouseUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      handleRef.current?.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist on drag end
      setWidth((w) => {
        try {
          localStorage.setItem(LS_KEY, String(w));
          queuePrefWrite(LS_KEY, w);
        } catch {
          // ignore
        }
        return w;
      });
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Always 2 columns — tiles shrink to fit

  return (
    <aside
      className="left-rail"
      style={{ width, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH, position: "relative", flexShrink: 0 }}
    >
      <div className="left-rail__scroll">
        <ToolsSection />
        {!hideFilters && (
          <>
            <div className="rail-section__divider" />
            <FilterRail
              jobs={jobs}
              filters={filters}
              setFilters={setFilters}
              managerMode={managerMode}
              availableSupervisors={availableSupervisors}
            />
          </>
        )}
      </div>

      {/* Resize handle */}
      <div
        ref={handleRef}
        className="rail-resize-handle"
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        title="Drag to resize · Double-click to reset"
      />
    </aside>
  );
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

interface ToolDef {
  tool: DrawingTool;
  label: string;
  // Returns inline SVG string for the icon
  iconSvg: (active: boolean) => string;
}

const CABLE_PLACED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="26" viewBox="0 0 32 26">
  <line x1="2" y1="13" x2="30" y2="13" stroke="#39ff7a" stroke-width="3" stroke-linecap="round"/>
</svg>`;

const CABLE_REMOVED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="26" viewBox="0 0 32 26">
  <line x1="2" y1="13" x2="30" y2="13" stroke="#ff2d4a" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 3"/>
  <text x="7" y="11" font-size="8" fill="#ff2d4a" font-family="monospace" font-weight="bold">×</text>
  <text x="16" y="11" font-size="8" fill="#ff2d4a" font-family="monospace" font-weight="bold">×</text>
  <text x="25" y="11" font-size="8" fill="#ff2d4a" font-family="monospace" font-weight="bold">×</text>
</svg>`;

function blackOrActive(active: boolean): string {
  return active ? "#1565C0" : "#000000";
}

function basicSvg(path: string): (active: boolean) => string {
  return (active) => {
    const c = blackOrActive(active);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="26" viewBox="0 0 32 26">
  ${path.replace(/STROKE/g, c)}
</svg>`;
  };
}

// ── Standard drawing tools (shown first) ──
const STANDARD_TOOL_DEFS: ToolDef[] = [
  {
    tool: "text",
    label: "TEXT",
    iconSvg: basicSvg(`<text x="3" y="20" font-size="18" font-weight="bold" fill="STROKE" font-family="serif">T</text>
      <line x1="3" y1="22" x2="16" y2="22" stroke="STROKE" stroke-width="1.5"/>`),
  },
  {
    tool: "line",
    label: "LINE",
    iconSvg: basicSvg(`<line x1="4" y1="22" x2="28" y2="4" stroke="STROKE" stroke-width="2" stroke-linecap="round"/>`),
  },
  {
    // Arrow drawing tool — horizontal line with arrowhead at right (→)
    tool: "arrow",
    label: "ARROW",
    iconSvg: basicSvg(`<line x1="3" y1="13" x2="24" y2="13" stroke="STROKE" stroke-width="2" stroke-linecap="round"/>
      <polygon points="29,13 21,9 21,17" fill="STROKE"/>`),
  },
  {
    tool: "rectangle",
    label: "RECT",
    iconSvg: basicSvg(`<rect x="4" y="5" width="24" height="16" rx="2" stroke="STROKE" stroke-width="2" fill="none"/>`),
  },
  {
    tool: "circle",
    label: "CIRCLE",
    iconSvg: basicSvg(`<ellipse cx="16" cy="13" rx="12" ry="9" stroke="STROKE" stroke-width="2" fill="none"/>`),
  },
  {
    tool: "polygon",
    label: "POLYGON",
    iconSvg: basicSvg(`<polygon points="16,3 28,18 22,23 10,23 4,18" stroke="STROKE" stroke-width="2" fill="none"/>`),
  },
  {
    tool: "freehand",
    label: "FREEHAND",
    iconSvg: basicSvg(`<path d="M4,22 Q8,8 14,14 Q20,20 28,4" stroke="STROKE" stroke-width="2" fill="none" stroke-linecap="round"/>`),
  },
  {
    tool: "measure",
    label: "MEASURE",
    iconSvg: basicSvg(`<line x1="4" y1="18" x2="28" y2="18" stroke="STROKE" stroke-width="2"/>
      <line x1="4" y1="14" x2="4" y2="22" stroke="STROKE" stroke-width="2"/>
      <line x1="28" y1="14" x2="28" y2="22" stroke="STROKE" stroke-width="2"/>
      <line x1="16" y1="12" x2="16" y2="18" stroke="STROKE" stroke-width="1.5" stroke-dasharray="2 2"/>`),
  },
  {
    tool: "select",
    label: "SELECT",
    iconSvg: basicSvg(`<path d="M6,4 L6,22 L13,17 L16,24 L18,23 L15,16 L22,16 Z" stroke="STROKE" stroke-width="1.5" fill="none" stroke-linejoin="round"/>`),
  },
];

// ── Telecom tools (shown after TELECOM divider) ──
const TELECOM_TOOL_DEFS: ToolDef[] = [
  {
    tool: "placed_cable",
    label: "PLACED",
    iconSvg: () => CABLE_PLACED_SVG,
  },
  {
    tool: "removed_cable",
    label: "REMOVED",
    iconSvg: () => CABLE_REMOVED_SVG,
  },
  {
    tool: "mh_new",
    label: "MH",
    iconSvg: (active) => railSvgForTool("mh", blackOrActive(active)),
  },
  {
    tool: "hh_new",
    label: "HH",
    iconSvg: (active) => railSvgForTool("hh", blackOrActive(active)),
  },
  {
    tool: "ped_new",
    label: "PED",
    iconSvg: (active) => railSvgForTool("ped", blackOrActive(active)),
  },
  {
    tool: "pole_new",
    label: "POLE",
    iconSvg: (active) => railSvgForTool("pole", blackOrActive(active)),
  },
  {
    tool: "cabinet_new",
    label: "CABINET",
    iconSvg: (active) => railSvgForTool("cabinet", blackOrActive(active)),
  },
  {
    tool: "anchor_new",
    label: "ANCHOR",
    iconSvg: (active) => railSvgForTool("anchor", blackOrActive(active)),
  },
];

// ─── Tools Section ────────────────────────────────────────────────────────────

function ToolsSection() {
  const {
    state,
    setTool,
    deleteSelected,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useDrawing();

  const { activeTool } = state;
  const hasSelection = state.selectedIds.size > 0;
  // Billy 5/20: tools are ALWAYS usable. Drawing without a target job
  // is allowed — at save time, SaveDrawingDialog prompts to attach to
  // an existing job or create a new one.

  function toggleTool(tool: DrawingTool) {
    setTool(activeTool === tool ? null : tool);
  }

  function renderTile({ tool, label, iconSvg }: ToolDef) {
    const isActive = activeTool === tool;
    return (
      <button
        key={tool}
        type="button"
        className={`tool-tile${isActive ? " tool-tile--active" : ""}`}
        onClick={() => toggleTool(tool)}
        title={label}
      >
        <span
          className="tool-tile__icon"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: iconSvg(isActive) }}
        />
        <span className="tool-tile__label">{label}</span>
      </button>
    );
  }

  return (
    <section className="rail-section rail-section--tools">
      {/* Undo / Redo row — lives at the top of the toolbox */}
      <div className="undo-redo-row">
        <button
          type="button"
          className="undo-redo-btn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
          aria-label="Undo"
        >
          <span className="undo-redo-btn__glyph">↶</span>
          <span className="undo-redo-btn__label">UNDO</span>
        </button>
        <button
          type="button"
          className="undo-redo-btn"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
          aria-label="Redo"
        >
          <span className="undo-redo-btn__glyph">↷</span>
          <span className="undo-redo-btn__label">REDO</span>
        </button>
      </div>

      <div
        className="tool-grid"
      >
        {/* Standard drawing tools */}
        {STANDARD_TOOL_DEFS.map(renderTile)}

        {/* TELECOM category divider */}
        <div className="telecom-divider">TELECOM</div>

        {/* Telecom tools */}
        {TELECOM_TOOL_DEFS.map(renderTile)}
      </div>

      {/* Delete selected */}
      {hasSelection && (
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            className="tool-btn tool-btn--danger"
            style={{ width: "100%", fontSize: 11 }}
            onClick={deleteSelected}
            title="Delete selected objects (Del)"
          >
            🗑 Delete ({state.selectedIds.size})
          </button>
        </div>
      )}
    </section>
  );
}

// Convenience export
export { isJobCompleted };
