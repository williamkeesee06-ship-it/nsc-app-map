// Left rail — Phase 4.1: 2-col grid, standard tools first, TELECOM divider, telecom below.
// Undo/Redo/Save moved to topbar. Screenshot/fit/recenter removed.
import type { Job } from "@nsc/types";
import type { MutableRefObject } from "react";
import FilterRail from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import { isJobCompleted } from "./markerStyle.js";
import { useDrawing } from "../drawing/drawingContext.js";
import type { DrawingTool } from "@nsc/types";
import { railSvgForTool } from "../drawing/icons/telecomIcons.js";

interface Props {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  onResync: () => Promise<void> | void;
  mapRef: MutableRefObject<google.maps.Map | null>;
}

export default function LeftRail({ jobs, filters, setFilters }: Props) {
  return (
    <aside className="left-rail">
      <div className="left-rail__scroll">
        <ToolsSection />
        <div className="rail-section__divider" />
        <FilterRail
          jobs={jobs}
          filters={filters}
          setFilters={setFilters}
        />
      </div>
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
  } = useDrawing();

  const { activeTool } = state;
  const hasSelection = state.selectedIds.size > 0;
  const noTarget = !state.targetJobId;

  function toggleTool(tool: DrawingTool) {
    setTool(activeTool === tool ? null : tool);
  }

  function renderTile({ tool, label, iconSvg }: ToolDef) {
    const isActive = activeTool === tool;
    const isDisabled = noTarget && !isActive;
    return (
      <button
        key={tool}
        type="button"
        className={`tool-tile${isActive ? " tool-tile--active" : ""}`}
        onClick={() => toggleTool(tool)}
        disabled={isDisabled}
        title={isDisabled ? "Click a job marker to start drawing" : label}
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
      <div className="tool-grid">
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
