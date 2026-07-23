// Left rail — tabbed. Tools tab hosts Telecom + 811 dig-shape tools plus the
// PDF-style annotation toolbox.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "@nsc/types";
import type { MutableRefObject } from "react";
import FilterRail from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import "./filtersTab.css";
import { isJobCompleted } from "./markerStyle.js";
import { useDrawing } from "../drawing/drawingContext.js";
import { useDigPolygon, type DigTool } from "../dig-polygon/digPolygonContext.js";
import type { DrawingTool } from "@nsc/types";
import { railSvgForTool } from "../drawing/icons/telecomIcons.js";
import { queuePrefWrite } from "../../lib/prefsSync.js";
import StatusFilterPills from "./StatusFilterPills.js";
import CentralOfficesPill from "./CentralOfficesPill.js";
import MapTypeFilterSection from "../map/MapTypeFilterSection.js";
// CalendarTab / Dashboard / 811 are mounted full-screen by JobsMap, not in the rail.
// Lumina is the floating orb + ChatPanel (not a rail tab).
import ZiplyDashboardTab from "../ziply/ZiplyDashboardTab.js";
import ZiplyJobsTab from "../ziply/ZiplyJobsTab.js";
import ZiplyFilterPanel from "./ZiplyFilterPanel.js";
import { ZiplyPlantInventoryTab } from "../ziply/ZiplyPlantInventoryTab.js";
import JobCard from "./JobCard.js";
import { useActiveContract } from "../workspace/contractStore.js";
import Eight11Section from "./Eight11Section.js";
import LayersPanel from "../workspace/LayersPanel.js";
import FeatureDetailSheet, { type PlatformFeature } from "../ziply/FeatureDetailSheet.js";
import { api } from "../../lib/api.js";

// Width grew slightly to accommodate the 44px AsBuilt-style tab strip on
// the left while keeping plenty of room for tool tiles to the right.
const DEFAULT_WIDTH = 180;
const MIN_WIDTH = 150;
const MAX_WIDTH = 380;
const LS_KEY = "nsc.leftRailWidth";

// Only tabs that are actually mounted in the rail or as full-screen overlays.
type TabId = "dashboard" | "jobs" | "filters" | "tools" | "calendar" | "811-tickets" | "plant";

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
  ziplyPrintLayerVisible?: boolean;
  setZiplyPrintLayerVisible?: (v: boolean) => void;
  ziply811OverlayVisible?: boolean;
  setZiply811OverlayVisible?: (v: boolean) => void;
  selectedJob?: Job | null;
  setSelectedJob?: (j: Job | null) => void;
  selectedFeature?: PlatformFeature | null;
  setSelectedFeature?: (f: PlatformFeature | null) => void;
  panelTheme?: "steel" | "cyberpunk" | "titanium" | "glass";
  setPanelTheme?: (t: "steel" | "cyberpunk" | "titanium" | "glass") => void;
}



export default function LeftRail({
  jobs,
  filters,
  setFilters,
  hideFilters,
  managerMode,
  availableSupervisors,
  ziplyPrintLayerVisible = true,
  setZiplyPrintLayerVisible = () => {},
  ziply811OverlayVisible = false,
  setZiply811OverlayVisible = () => {},
  selectedJob,
  setSelectedJob,
  selectedFeature,
  setSelectedFeature,
  panelTheme,
  setPanelTheme,
}: Props) {
  const { contract } = useActiveContract();
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  // Dashboard is the default landing tab (Billy). Like Calendar, it mounts
  // full-screen over the map via JobsMap, so the rail starts collapsed.
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  const [collapsed, setCollapsed] = useState<boolean>(true);

  // Broadcast active tab + collapse state so JobsMap can mount the Calendar
  // as a full-screen overlay over the map (instead of cramming it in the
  // side rail). The event fires on every change so JobsMap stays in sync
  // even if the rail is collapsed or the user switches tabs rapidly.
  useEffect(() => {
    try {
      window.dispatchEvent(
        new CustomEvent("nsc:active-tab", {
          detail: { tab: activeTab, collapsed },
        })
      );
    } catch {
      /* non-browser env */
    }
  }, [activeTab, collapsed]);

  // Allow other components (e.g. the Dashboard overlay) to request a tab
  // switch via a CustomEvent, mirroring the existing nsc:* event-bus pattern.
  useEffect(() => {
    function onRequestTab(e: Event) {
      const detail = (e as CustomEvent<{ tab: TabId }>).detail;
      if (!detail?.tab) return;
      setActiveTab(detail.tab);
      const shouldCollapse = detail.tab === 'calendar' ||
        detail.tab === 'dashboard' ||
        detail.tab === '811-tickets' ||
        (detail.tab === 'jobs' && contract === 'Ziply');
      setCollapsed(shouldCollapse);
    }
    window.addEventListener("nsc:request-tab", onRequestTab as EventListener);
    return () => window.removeEventListener("nsc:request-tab", onRequestTab as EventListener);
  }, [contract]);

  // Click an active tab to collapse the rail; click a different tab to switch
  // to it (and uncollapse if currently collapsed).
  // Exception: CALENDAR mounts full-screen over the map and has no rail
  // content of its own, so we collapse the rail when entering it.
  const onTabClick = useCallback((id: TabId) => {
    if (id === activeTab) {
      setCollapsed(c => !c);
    } else {
      setActiveTab(id);
      // Calendar, Dashboard, and 811 Tickets mount full-screen over the map and
      // have no rail body of their own, so collapse the rail when entering them.
      const shouldCollapse = id === 'calendar' ||
        id === 'dashboard' ||
        id === '811-tickets' ||
        (id === 'jobs' && contract === 'Ziply');
      setCollapsed(shouldCollapse);
    }
  }, [activeTab, contract]);

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
  const tabs: Array<{ id: TabId; label: string; iconSvg?: string }> = contract === 'Ziply'
    ? [
        { id: 'dashboard', label: 'DASHBOARD' },
        { id: 'jobs', label: 'JOBS' },
        { id: 'plant', label: 'PLANT' },
        { id: 'filters', label: 'MAP' },
        { id: 'tools', label: 'TOOLS' },
        { id: 'calendar', label: 'CALENDAR' },
        { id: '811-tickets', label: '811 TICKETS' },
      ]
    : [
        { id: 'dashboard', label: 'DASHBOARD' },
        { id: 'filters', label: 'MAP' },
        { id: 'tools', label: 'TOOLS' },
        { id: 'calendar', label: 'CALENDAR' },
        { id: '811-tickets', label: '811 TICKETS' },
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
            className={`left-rail-tab ${tab.id === 'dashboard' ? 'left-rail-tab--dashboard' : ''} ${activeTab === tab.id && (!collapsed || tab.id === 'dashboard') ? 'active' : ''}`}
            onClick={() => onTabClick(tab.id)}
            title={`${tab.label} — click again to ${collapsed ? 'expand' : 'collapse'}`}
            aria-label={tab.label}
          >
            {tab.iconSvg && (
              <span
                className="left-rail-tab__icon"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: tab.iconSvg }}
              />
            )}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {!collapsed && (
        <>
          <div className="left-rail__scroll">
            {selectedJob || selectedFeature ? (
              <div className="left-rail-details-pane" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px', borderBottom: '1px solid rgba(0,0,0,0.1)', background: '#F8FAFC', zIndex: 10 }}>
                   <button 
                     onClick={() => {
                       setSelectedJob?.(null);
                       setSelectedFeature?.(null);
                     }}
                     style={{
                       background: 'rgba(0,0,0,0.05)',
                       border: 'none',
                       padding: '6px 12px',
                       borderRadius: '6px',
                       cursor: 'pointer',
                       fontSize: '12px',
                       fontWeight: 600,
                       width: '100%',
                       textAlign: 'left',
                       color: '#334155',
                       transition: 'background 0.2s',
                     }}
                     onMouseOver={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.08)'}
                     onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'}
                   >
                     ← Back to {activeTab === 'filters' ? 'Map Filters' : 'Menu'}
                   </button>
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {selectedJob && (
                    <div className={`theme-${panelTheme || 'steel'}`}>
                      <div className="job-right-panel__card">
                        <JobCard
                          job={selectedJob}
                          onClose={() => {
                            setSelectedJob?.(null);
                            window.dispatchEvent(new Event("nsc:markups-saved"));
                          }}
                          variant="panel"
                          theme={panelTheme || "steel"}
                          onThemeChange={setPanelTheme || (() => {})}
                        />
                      </div>
                      <div className="job-right-panel__811">
                        <Eight11Section job={selectedJob} />
                      </div>
                      {contract !== "Ziply" && (
                        <div className="job-right-panel__layers">
                          <LayersPanel />
                        </div>
                      )}
                    </div>
                  )}

                  {selectedFeature && (
                    <FeatureDetailSheet
                      feature={selectedFeature}
                      onClose={() => setSelectedFeature?.(null)}
                      onStatusChange={async (status) => {
                        const jobId = selectedFeature.properties.jobId as string | undefined;
                        const label = selectedFeature.properties.label as string | undefined;
                        const layer = selectedFeature.properties.layer as string | undefined;

                        let kind: "hub" | "terminal" | "cable" = "cable";
                        if (layer === "hub") kind = "hub";
                        else if (layer === "terminal") kind = "terminal";

                        if (jobId && label) {
                          try {
                            await api.updateZiplyObjectStatus(jobId, {
                              kind,
                              ref: label,
                              status: status as any
                            });
                            window.dispatchEvent(new Event("nsc:jobs-reload"));
                          } catch (ex) {
                            console.error("Failed to update status", ex);
                          }
                        }

                        setSelectedFeature?.({
                           ...selectedFeature,
                           properties: { ...selectedFeature.properties, status }
                        });
                      }}
                    />
                  )}
                </div>
              </div>
            ) : (
              /* Tab Content */
              <div className="left-rail-tab-content">
                 {activeTab === 'plant' && <ZiplyPlantInventoryTab />}
                 {activeTab === 'filters' && (
                   contract === 'Ziply' ? (
                     <ZiplyFilterPanel
                       jobs={jobs}
                       filters={filters}
                       setFilters={setFilters}
                       ziplyPrintLayerVisible={ziplyPrintLayerVisible}
                       setZiplyPrintLayerVisible={setZiplyPrintLayerVisible}
                       ziply811OverlayVisible={ziply811OverlayVisible}
                       setZiply811OverlayVisible={setZiply811OverlayVisible}
                     />
                   ) : (
                     <FiltersTab
                       jobs={jobs}
                       filters={filters}
                       setFilters={setFilters}
                       hideFilters={hideFilters}
                       managerMode={managerMode}
                       availableSupervisors={availableSupervisors}
                     />
                   )
                 )}
                {activeTab === 'tools' && <AnnotateTab selectedJob={selectedJob ?? null} />}
                  {/* Calendar, Jobs (Ziply), and Dashboard (Lumen & Ziply) tabs have no rail content — 
                      they mount full-screen over the map (handled by JobsMap). The rail auto-collapses
                      on entry so there's nothing visible here. */}
                </div>
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

// ─── SLD Tab Content ──────────────────────────────────────────────────────────
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

// ── Helper to look up a standard tool def by tool key for reuse across tabs. ──
function findStandard(tool: DrawingTool): ToolDef {
  const t = STANDARD_TOOL_DEFS.find((x) => x.tool === tool);
  if (!t) throw new Error(`Missing standard tool: ${tool}`);
  return t;
}

// Select tool (used in both Telecom tab and Tools tab) — declared as a getter
// so it always resolves AFTER STANDARD_TOOL_DEFS is initialized at module load.
const SELECT_TOOL_DEF: ToolDef = {
  tool: "select",
  label: "SELECT",
  // Pointer arrow drawn inline so we don't depend on STANDARD_TOOL_DEFS init order.
  iconSvg: basicSvg(`<path d="M6,4 L6,22 L13,17 L16,24 L18,23 L15,16 L22,16 Z" stroke="STROKE" stroke-width="1.5" fill="none" stroke-linejoin="round"/>`),
};

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
  // Measure tool moved to topbar (top-of-app ruler button).
  // Select tool exposed via SELECT_TOOL_DEF above for use in both Telecom and Tools tabs.
];

// ── Telecom tools (shown after TELECOM divider) ──
// Edit 3: Splice Point reuses the existing `splice` tool key (already supported by
// the engine's needsLabelPopup() list). Rendered as a diamond + SP label.
const SPLICE_POINT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="26" viewBox="0 0 32 26">
  <polygon points="16,3 28,13 16,23 4,13" fill="#fff" stroke="#0052cc" stroke-width="2"/>
  <text x="16" y="16" font-size="8" fill="#0052cc" font-family="sans-serif" font-weight="bold" text-anchor="middle">SP</text>
</svg>`;

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
    tool: "flower_pot_new",
    label: "FLOWER POT",
    iconSvg: (active) => railSvgForTool("flower_pot", blackOrActive(active)),
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
  // Edit 3: Splice Point — diamond + SP, labeled, searchable.
  {
    tool: "splice",
    label: "SPLICE",
    iconSvg: () => SPLICE_POINT_SVG,
  },
];

const ZIPLY_TOOL_DEFS: ToolDef[] = [
  {
    tool: "ziply_feeder",
    label: "FEEDER CABLE",
    iconSvg: () => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="26" viewBox="0 0 32 26">
      <line x1="2" y1="13" x2="30" y2="13" stroke="#06B6D4" stroke-width="4" stroke-linecap="round"/>
    </svg>`,
  },
  {
    tool: "ziply_distribution",
    label: "DIST CABLE",
    iconSvg: () => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="26" viewBox="0 0 32 26">
      <line x1="2" y1="13" x2="30" y2="13" stroke="#6366F1" stroke-width="3.2" stroke-linecap="round"/>
    </svg>`,
  },
  {
    tool: "ziply_drop",
    label: "DROP CABLE",
    iconSvg: () => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="26" viewBox="0 0 32 26">
      <line x1="2" y1="13" x2="30" y2="13" stroke="#F59E0B" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
  },
  {
    tool: "ziply_bore",
    label: "BORE/TRENCH",
    iconSvg: () => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="26" viewBox="0 0 32 26">
      <line x1="2" y1="13" x2="30" y2="13" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="3 3"/>
    </svg>`,
  },
  {
    tool: "ziply_hub",
    label: "SPLITTER HUB",
    iconSvg: (active) => railSvgForTool("ziply_hub", blackOrActive(active)),
  },
  {
    tool: "ziply_terminal",
    label: "TERMINAL",
    iconSvg: (active) => railSvgForTool("ziply_terminal", blackOrActive(active)),
  },
  {
    tool: "ziply_address",
    label: "ADDRESS",
    iconSvg: (active) => railSvgForTool("ziply_address", blackOrActive(active)),
  },
  {
    tool: "ziply_pole",
    label: "POLE",
    iconSvg: (active) => railSvgForTool("ziply_pole", blackOrActive(active)),
  },
  {
    tool: "ziply_handhole",
    label: "HANDHOLE",
    iconSvg: (active) => railSvgForTool("ziply_handhole", blackOrActive(active)),
  },
  {
    tool: "ziply_flower_pot",
    label: "FLOWER POT",
    iconSvg: (active) => railSvgForTool("ziply_flower_pot", blackOrActive(active)),
  },
];

// ─── Tab Components ────────────────────────────────────────────────────────────

function FiltersTab({
  jobs,
  filters,
  setFilters,
  hideFilters,
  managerMode,
  availableSupervisors,
}: {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  hideFilters?: boolean;
  managerMode?: boolean;
  availableSupervisors?: string[];
}) {
  return (
    <section className="rail-section filters-tab premium-filters">
      <div className="filters-tab__group glass-panel">
        <div className="filters-tab__heading glow-text">STATUS</div>
        <StatusFilterPills />
      </div>

      <div className="filters-tab__group glass-panel">
        <div className="filters-tab__heading glow-text">OVERLAYS</div>
        <CentralOfficesPill />
      </div>

      <div className="glass-panel">
        <MapTypeFilterSection />
      </div>

      {!hideFilters && managerMode && availableSupervisors && availableSupervisors.length > 0 && (
        <div className="filters-tab__group glass-panel">
          <FilterRail
            jobs={jobs}
            filters={filters}
            setFilters={setFilters}
            managerMode={managerMode}
            availableSupervisors={availableSupervisors}
          />
        </div>
      )}
    </section>
  );
}

// 811 tool switcher definitions (neon-orange excavation shapes).
const DIG_TOOLS: { id: DigTool; label: string; iconSvg: string }[] = [
  {
    id: "radius",
    label: "RADIUS",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff6a00" stroke-width="2"><circle cx="12" cy="12" r="8"/><line x1="12" y1="12" x2="20" y2="12"/><circle cx="12" cy="12" r="1.5" fill="#ff6a00"/></svg>`,
  },
  {
    id: "route",
    label: "ROUTE",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff6a00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 L10 8 L16 16 L20 4"/></svg>`,
  },
  {
    id: "polygon",
    label: "POLYGON",
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff6a00" stroke-width="2" stroke-linejoin="round"><polygon points="12,3 21,9 18,20 6,20 3,9"/></svg>`,
  },
];

import EngineeringChecklistTray from "../ziply/EngineeringChecklistTray.js";

function AnnotateTab({ selectedJob }: { selectedJob: Job | null }) {
  const { contract } = useActiveContract();
  const { state, setTool, deleteSelected, undo, redo, canUndo, canRedo } = useDrawing();
  const { activeTool } = state;
  const hasSelection = state.selectedIds.size > 0;

  // 811 Phase 1.5 — dig shape tools. Enabled only when a job is selected
  // (the shape is saved to jobs/{jobId}.digPolygon).
  const {
    tool: digTool,
    setTool: setDigTool,
    jobId: digJobId,
    hasShape: hasDigShape,
    existing: digShape,
  } = useDigPolygon();

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

  // Full PDF-editor style annotation toolbox.
  // The 7 generic drawing tools (text/line/arrow/rect/circle/polygon/freehand)
  // were moved here from the Telecom tab — they reuse the proper SVG icons
  // from STANDARD_TOOL_DEFS instead of unicode glyphs. Stamp was removed.
  // Measure moved to the topbar. Eraser swapped for a construction-themed shovel icon.
  const selectionTools: ToolDef[] = [
    SELECT_TOOL_DEF,
    { tool: "lasso", label: "LASSO", iconSvg: basicSvg(`<path d="M5,14 Q5,5 16,5 Q27,5 27,14 Q27,21 18,23 L18,28 L14,24 Q5,22 5,14 Z" stroke="STROKE" stroke-width="2" fill="none" stroke-linejoin="round"/>`) },
  ];

  const drawingTools: ToolDef[] = [
    findStandard("line"),
    findStandard("freehand"),
    { tool: "highlighter", label: "HIGHLIGHT", iconSvg: basicSvg(`<path d="M4,22 L18,8 L24,14 L10,28 Z" stroke="STROKE" stroke-width="2" fill="none"/><line x1="16" y1="10" x2="22" y2="16" stroke="STROKE" stroke-width="2"/>`) },
    // Construction-themed eraser: a brick-mason trowel / shovel that "clears" markup.
    { tool: "eraser", label: "ERASER", iconSvg: basicSvg(`<path d="M20,4 L28,12 L14,26 L4,16 Z" stroke="STROKE" stroke-width="2" fill="none" stroke-linejoin="round"/><line x1="10" y1="22" x2="4" y2="28" stroke="STROKE" stroke-width="2.5" stroke-linecap="round"/>`) },
    // Edit 7: Dimension Line — line with end ticks + measurement label (blueprint-style). Reuses 'line' tool under the hood; render style differs.
    { tool: "line", label: "DIMENSION", iconSvg: basicSvg(`<line x1="4" y1="4" x2="4" y2="22" stroke="STROKE" stroke-width="2"/><line x1="28" y1="4" x2="28" y2="22" stroke="STROKE" stroke-width="2"/><line x1="4" y1="13" x2="28" y2="13" stroke="STROKE" stroke-width="2"/><text x="11" y="11" font-size="7" fill="STROKE" font-family="monospace">12'</text>`) },
    // Edit 7: Perimeter (reuses polygon — labelled differently).
    { tool: "polygon", label: "PERIMETER", iconSvg: basicSvg(`<polygon points="5,5 27,5 27,21 5,21" stroke="STROKE" stroke-width="2" fill="none" stroke-dasharray="3 2"/><text x="9" y="16" font-size="6" fill="STROKE" font-family="monospace">PERIM</text>`) },
    // Edit 7: Area (reuses polygon — fill instead of stroke).
    { tool: "polygon", label: "AREA", iconSvg: basicSvg(`<polygon points="5,5 27,5 27,21 5,21" stroke="STROKE" stroke-width="2" fill="STROKE" fill-opacity="0.25"/><text x="11" y="16" font-size="6" fill="STROKE" font-family="monospace">ft²</text>`) },
  ];

  const markupTools: ToolDef[] = [
    findStandard("text"),
    { tool: "callout", label: "CALLOUT", iconSvg: basicSvg(`<rect x="10" y="3" width="19" height="12" rx="2" stroke="STROKE" stroke-width="2" fill="none"/><path d="M14,15 L8,22 L17,18" stroke="STROKE" stroke-width="2" fill="none" stroke-linejoin="round"/><polygon points="6,24 11,22 9,20" fill="STROKE"/>`) },
    // Edit 7: Cloud+ — cloud-bumpy polygon with built-in callout-style text box.
    { tool: "callout", label: "CLOUD+", iconSvg: basicSvg(`<path d="M7,18 Q3,18 3,14 Q3,10 7,10 Q7,5 13,5 Q19,5 19,10 Q25,10 25,14 Q25,18 21,18 Z" stroke="STROKE" stroke-width="2" fill="none"/><text x="12" y="15" font-size="9" fill="STROKE" font-weight="bold">+</text>`) },
    findStandard("arrow"),
    // Edit 7: Double Arrow — reuses arrow tool, dual arrowheads (visual variant).
    { tool: "arrow", label: "D-ARROW", iconSvg: basicSvg(`<line x1="7" y1="13" x2="25" y2="13" stroke="STROKE" stroke-width="2" stroke-linecap="round"/><polygon points="3,13 9,9 9,17" fill="STROKE"/><polygon points="29,13 23,9 23,17" fill="STROKE"/>`) },
    findStandard("rectangle"),
    findStandard("circle"),
    findStandard("polygon"),
  ];

  return (
    <section className="rail-section annotate-tab">
      {/* Quick Undo/Redo */}
      <div className="undo-redo-row" style={{ marginBottom: 8 }}>
        <button className="undo-redo-btn" onClick={undo} disabled={!canUndo}>↶ UNDO</button>
        <button className="undo-redo-btn" onClick={redo} disabled={!canRedo}>↷ REDO</button>
      </div>

      {/* Render Ziply tools if Ziply contract */}
      {contract === "Ziply" && (
        <>
          <EngineeringChecklistTray job={selectedJob} />
          <div className="telecom-divider">ZIPLY CONSTRUCTION</div>
          <div className="tool-grid" style={{ marginBottom: 12 }}>
            {ZIPLY_TOOL_DEFS.map(renderTile)}
          </div>
        </>
      )}

      {/* Render standard TELECOM tools for all contracts */}
      <>
        <div className="telecom-divider">TELECOM</div>
        <div className="tool-grid" style={{ marginBottom: 12 }}>
          {TELECOM_TOOL_DEFS.map(renderTile)}
        </div>
      </>

      <div className="telecom-divider">SELECTION</div>
      <div className="tool-grid" style={{ marginBottom: 12 }}>
        {selectionTools.map(renderTile)}
      </div>

      <div className="telecom-divider">DRAWING</div>
      <div className="tool-grid" style={{ marginBottom: 12 }}>
        {drawingTools.map(renderTile)}
      </div>

      <div className="telecom-divider">MARKUP</div>
      <div className="tool-grid" style={{ marginBottom: 12 }}>
        {markupTools.map(renderTile)}
      </div>

      {hasSelection && (
        <button className="tool-btn tool-btn--danger" style={{ width: '100%', marginTop: 6 }} onClick={deleteSelected}>
          Delete ({state.selectedIds.size})
        </button>
      )}

      <div className="telecom-divider">811 DIG SHAPE</div>
      <div className="dig-tool-switcher">
        {DIG_TOOLS.map(({ id, label, iconSvg }) => {
          const isActive = digTool === id;
          return (
            <button
              key={id}
              className={`dig-tool-btn${isActive ? " dig-tool-btn--active" : ""}`}
              onClick={() => setDigTool(isActive ? null : id)}
              disabled={!digJobId}
              title={digJobId ? label : "Select a job first"}
            >
              <span
                className="dig-tool-btn__icon"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: iconSvg }}
              />
              <span className="dig-tool-btn__label">{label}</span>
            </button>
          );
        })}
      </div>
      <div
        className={`dig-polygon-status${hasDigShape ? " dig-polygon-status--saved" : ""}`}
      >
        {!digJobId
          ? "No job selected"
          : hasDigShape && digShape
            ? `${digShape.type} shape saved`
            : "No shape yet"}
      </div>

      <div style={{ fontSize: 10, fontWeight: 600, margin: '10px 0 4px', color: '#8a96a3' }}>SELECTION</div>
      <div className="tool-grid">
        {selectionTools.map(({ tool, label, iconSvg }) => {
          const isActive = activeTool === tool;
          return (
            <button key={tool} className={`tool-tile${isActive ? " tool-tile--active" : ""}`} onClick={() => setTool(isActive ? null : tool)}>
              <span className="tool-tile__icon" dangerouslySetInnerHTML={{ __html: iconSvg(isActive) }} />
              <span className="tool-tile__label">{label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 10, fontWeight: 600, margin: '10px 0 4px', color: '#8a96a3' }}>DRAWING</div>
      <div className="tool-grid">
        {drawingTools.map(({ tool, label, iconSvg }, i) => {
          const isActive = activeTool === tool;
          return (
            <button key={`${tool}-${label}-${i}`} className={`tool-tile${isActive ? " tool-tile--active" : ""}`} onClick={() => setTool(isActive ? null : tool)} title={label}>
              <span className="tool-tile__icon" dangerouslySetInnerHTML={{ __html: iconSvg(isActive) }} />
              <span className="tool-tile__label">{label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 10, fontWeight: 600, margin: '10px 0 4px', color: '#8a96a3' }}>MARKUP</div>
      <div className="tool-grid">
        {markupTools.map(({ tool, label, iconSvg }, i) => {
          const isActive = activeTool === tool;
          return (
            <button key={`${tool}-${label}-${i}`} className={`tool-tile${isActive ? " tool-tile--active" : ""}`} onClick={() => setTool(isActive ? null : tool)} title={label}>
              <span className="tool-tile__icon" dangerouslySetInnerHTML={{ __html: iconSvg(isActive) }} />
              <span className="tool-tile__label">{label}</span>
            </button>
          );
        })}
      </div>

    </section>
  );
}

// Convenience export
export { isJobCompleted };
