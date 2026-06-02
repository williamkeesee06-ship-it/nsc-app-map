// Left rail — now tabbed: Layers | Telecom | Annotate (PDF-style tools)
import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "@nsc/types";
import type { MutableRefObject } from "react";
import FilterRail from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import { isJobCompleted } from "./markerStyle.js";
import { useDrawing } from "../drawing/drawingContext.js";
import type { DrawingTool, JobLayer } from "@nsc/types";
import { railSvgForTool } from "../drawing/icons/telecomIcons.js";
import { queuePrefWrite } from "../../lib/prefsSync.js";
import { getIconByKey } from "../drawing/icons/iconRegistry.js";

// Width grew slightly to accommodate the 44px AsBuilt-style tab strip on
// the left while keeping plenty of room for tool tiles to the right.
const DEFAULT_WIDTH = 180;
const MIN_WIDTH = 150;
const MAX_WIDTH = 380;
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

type TabId = 'layers' | 'telecom' | 'annotate';

export default function LeftRail({
  jobs,
  filters,
  setFilters,
  hideFilters,
  managerMode,
  availableSupervisors,
}: Props) {
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [activeTab, setActiveTab] = useState<TabId>('telecom'); // Default to tools
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Click an active tab to collapse the rail; click a different tab to switch
  // to it (and uncollapse if currently collapsed).
  const onTabClick = useCallback((id: TabId) => {
    if (id === activeTab) {
      setCollapsed(c => !c);
    } else {
      setActiveTab(id);
      setCollapsed(false);
    }
  }, [activeTab]);
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

  const tabs: { id: TabId; label: string }[] = [
    { id: 'layers', label: 'LAYERS' },
    { id: 'telecom', label: 'TELECOM' },
    { id: 'annotate', label: 'ANNOTATE' },
  ];

  // When collapsed, only the 52px tab strip is visible (no content panel,
  // no resize handle). Click the same tab again to expand back.
  const effectiveWidth = collapsed ? 52 : width;

  return (
    <aside
      className={`left-rail ${collapsed ? 'left-rail--collapsed' : ''}`}
      style={{ width: effectiveWidth, minWidth: collapsed ? 52 : MIN_WIDTH, maxWidth: collapsed ? 52 : MAX_WIDTH, position: "relative", flexShrink: 0 }}
    >
      {/* Vertical tab strip (sideways labels) — AsBuilt-style. Tabs fill the
          full height of the rail so each label is large and readable. */}
      <div className="left-rail-tabstrip">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`left-rail-tab ${activeTab === tab.id && !collapsed ? 'active' : ''}`}
            onClick={() => onTabClick(tab.id)}
            title={`${tab.label} — click again to ${collapsed ? 'expand' : 'collapse'}`}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {!collapsed && (
        <>
          <div className="left-rail__scroll">
            {/* Tab Content */}
            <div className="left-rail-tab-content">
              {activeTab === 'layers' && <LayersTab />}
              {activeTab === 'telecom' && <TelecomTab />}
              {activeTab === 'annotate' && <AnnotateTab />}
            </div>

            {!hideFilters && activeTab !== 'layers' && (
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
        </>
      )}
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

// ─── Tab Components ────────────────────────────────────────────────────────────

function LayersTab() {
  const { state, addLayer, updateLayer, reorderLayers, setActiveLayer } = useDrawing();
  const layers = state.layers || [];
  const activeLayerId = state.activeLayerId;

  const handleAddLayer = () => {
    const name = prompt("Layer name:", "New Layer") || "New Layer";
    const id = addLayer(name);
    setActiveLayer(id);
  };

  return (
    <section className="rail-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 11 }}>Job Layers</strong>
        <button onClick={handleAddLayer} className="tool-btn" style={{ fontSize: 11, padding: '2px 8px' }}>+ Add</button>
      </div>

      {layers.length === 0 && (
        <div style={{ fontSize: 11, color: '#8a96a3', padding: '8px 0' }}>
          No layers yet. Add one to organize your markups.
        </div>
      )}

      {layers.map((layer, index) => {
        const isActive = layer.id === activeLayerId;
        const icon = getIconByKey(layer.icon);
        return (
          <div
            key={layer.id}
            className={`layer-row ${isActive ? 'active' : ''}`}
            onClick={() => setActiveLayer(layer.id)}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', index.toString())}
            onDrop={(e) => {
              const from = parseInt(e.dataTransfer.getData('text/plain'));
              if (from !== index) reorderLayers(from, index);
            }}
            onDragOver={(e) => e.preventDefault()}
          >
            <span style={{ color: layer.color || '#3aa7ff' }}>{icon.emoji}</span>
            <span style={{ flex: 1, fontSize: 11 }}>{layer.label}</span>
            <button
              onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { hidden: !layer.hidden }); }}
              style={{ background: 'none', border: 'none', fontSize: 12, opacity: layer.hidden ? 0.4 : 1 }}
            >
              {layer.hidden ? '🙈' : '👁️'}
            </button>
          </div>
        );
      })}
    </section>
  );
}

function TelecomTab() {
  const { state, setTool, deleteSelected, undo, redo, canUndo, canRedo } = useDrawing();
  const { activeTool } = state;
  const hasSelection = state.selectedIds.size > 0;

  const toggleTool = (tool: DrawingTool) => {
    setTool(activeTool === tool ? null : tool);
  };

  const renderTile = ({ tool, label, iconSvg }: ToolDef) => {
    const isActive = activeTool === tool;
    return (
      <button
        key={tool}
        className={`tool-tile${isActive ? " tool-tile--active" : ""}`}
        onClick={() => toggleTool(tool)}
        title={label}
      >
        <span className="tool-tile__icon" dangerouslySetInnerHTML={{ __html: iconSvg(isActive) }} />
        <span className="tool-tile__label">{label}</span>
      </button>
    );
  };

  return (
    <section className="rail-section rail-section--tools">
      <div className="undo-redo-row">
        <button className="undo-redo-btn" onClick={undo} disabled={!canUndo}>↶ UNDO</button>
        <button className="undo-redo-btn" onClick={redo} disabled={!canRedo}>↷ REDO</button>
      </div>

      <div className="tool-grid">
        {STANDARD_TOOL_DEFS.map(renderTile)}
        <div className="telecom-divider">TELECOM</div>
        {TELECOM_TOOL_DEFS.map(renderTile)}
      </div>

      {hasSelection && (
        <button className="tool-btn tool-btn--danger" style={{ width: '100%', marginTop: 6 }} onClick={deleteSelected}>
          Delete ({state.selectedIds.size})
        </button>
      )}
    </section>
  );
}

function AnnotateTab() {
  const { state, setTool, undo, redo, canUndo, canRedo } = useDrawing();
  const { activeTool } = state;

  // Full PDF-editor style annotation toolbox
  const selectionTools: ToolDef[] = [
    { tool: "select", label: "SELECT", iconSvg: () => "➤" },
    { tool: "lasso", label: "LASSO", iconSvg: () => "⌒" },
  ];

  const drawingTools: ToolDef[] = [
    { tool: "freehand", label: "FREEHAND", iconSvg: () => "〰" },
    { tool: "highlighter", label: "HIGHLIGHT", iconSvg: () => "🖍" },
    { tool: "eraser", label: "ERASER", iconSvg: () => "🧽" },
  ];

  const markupTools: ToolDef[] = [
    { tool: "text", label: "TEXT", iconSvg: () => "T" },
    { tool: "callout", label: "CALLOUT", iconSvg: () => "💬" },
    { tool: "arrow", label: "ARROW", iconSvg: () => "→" },
    { tool: "rectangle", label: "RECT", iconSvg: () => "▭" },
    { tool: "circle", label: "CIRCLE", iconSvg: () => "○" },
    { tool: "polygon", label: "POLYGON", iconSvg: () => "⬡" },
    { tool: "stamp", label: "STAMP", iconSvg: () => "📌" },
  ];

  const transformTools = [
    { action: "rotate", label: "ROTATE", icon: "↻" },
    { action: "group", label: "GROUP", icon: "📦" },
    { action: "ungroup", label: "UNGROUP", icon: "📦" },
    { action: "bring-front", label: "FRONT", icon: "↑" },
    { action: "send-back", label: "BACK", icon: "↓" },
    { action: "align-left", label: "ALIGN L", icon: "⫷" },
    { action: "align-center", label: "CENTER", icon: "⫸" },
    { action: "distribute", label: "DISTRIB", icon: "⟷" },
  ];

  const {
    bringToFront,
    sendToBack,
    rotateSelected,
    groupSelected,
    ungroupSelected,
    alignSelected,
  } = useDrawing();

  const handleAction = (action: string) => {
    switch (action) {
      case 'bring-front': bringToFront(); break;
      case 'send-back': sendToBack(); break;
      case 'rotate': rotateSelected(90); break;
      case 'group': groupSelected(); break;
      case 'ungroup': ungroupSelected(); break;
      case 'align-left': alignSelected('left'); break;
      case 'align-center': alignSelected('center'); break;
      case 'distribute': alignSelected('distribute-h'); break;
      default: console.log('Action:', action);
    }
  };

  return (
    <section className="rail-section annotate-tab">
      {/* Quick Undo/Redo */}
      <div className="undo-redo-row" style={{ marginBottom: 8 }}>
        <button className="undo-redo-btn" onClick={undo} disabled={!canUndo}>↶ UNDO</button>
        <button className="undo-redo-btn" onClick={redo} disabled={!canRedo}>↷ REDO</button>
      </div>

      <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4, color: '#8a96a3' }}>SELECTION</div>
      <div className="tool-grid">
        {selectionTools.map(({ tool, label, iconSvg }) => {
          const isActive = activeTool === tool;
          return (
            <button key={tool} className={`tool-tile${isActive ? " tool-tile--active" : ""}`} onClick={() => setTool(isActive ? null : tool)}>
              <span className="tool-tile__icon">{iconSvg(isActive)}</span>
              <span className="tool-tile__label">{label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 10, fontWeight: 600, margin: '10px 0 4px', color: '#8a96a3' }}>DRAWING</div>
      <div className="tool-grid">
        {drawingTools.map(({ tool, label, iconSvg }) => {
          const isActive = activeTool === tool;
          return (
            <button key={tool} className={`tool-tile${isActive ? " tool-tile--active" : ""}`} onClick={() => setTool(isActive ? null : tool)}>
              <span className="tool-tile__icon">{iconSvg(isActive)}</span>
              <span className="tool-tile__label">{label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 10, fontWeight: 600, margin: '10px 0 4px', color: '#8a96a3' }}>MARKUP</div>
      <div className="tool-grid">
        {markupTools.map(({ tool, label, iconSvg }) => {
          const isActive = activeTool === tool;
          return (
            <button key={tool} className={`tool-tile${isActive ? " tool-tile--active" : ""}`} onClick={() => setTool(isActive ? null : tool)}>
              <span className="tool-tile__icon">{iconSvg(isActive)}</span>
              <span className="tool-tile__label">{label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 10, fontWeight: 600, margin: '10px 0 4px', color: '#8a96a3' }}>TRANSFORM &amp; ORDER</div>
      <div className="tool-grid">
        {transformTools.map((t) => (
          <button
            key={t.action}
            className="tool-tile"
            onClick={() => handleAction(t.action)}
            title={t.label}
          >
            <span className="tool-tile__icon">{t.icon}</span>
            <span className="tool-tile__label">{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{ fontSize: 9, color: '#6a7580', marginTop: 12, lineHeight: 1.3 }}>
        Full implementations (real eraser, callouts, rotate, grouping, align, lasso, stamps) coming in the next updates.
      </div>
    </section>
  );
}

// Convenience export
export { isJobCompleted };
