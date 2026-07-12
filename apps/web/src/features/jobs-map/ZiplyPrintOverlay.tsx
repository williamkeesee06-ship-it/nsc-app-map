import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { DigTicket, Job, ZiplyObjectStatus, ZiplySectionScope } from "@nsc/types";
import { InfoWindow, Marker, useMap } from "@vis.gl/react-google-maps";
import { api } from "../../lib/api.js";
import {
  buildConstructionSequence,
  computePlantProgress,
  emitZiplyPlantSelect,
  getZiplyPrintAnchor,
  isZiplyPrintMapReady,
  type ZiplyPlantSelection,
} from "../ziply/ziplyUtils.js";
import {
  buildCablePath,
  pathMidpoint,
  placeTerminalAroundHub,
  type LatLng,
} from "../ziply/ziplyMapGeometry.js";
import {
  insertVertex,
  moveVertex,
  nearestSegmentIndex,
  pathControlPoints,
  removeVertex,
} from "../ziply/ziplyPlantEdit.js";
import "./ziplyPrintCad.css";

// ── Neon CAD palette ────────────────────────────────────────────────────────
const INK = "#0f172a";
const STATUS_COLOR: Record<ZiplyObjectStatus, string> = {
  complete: "#00E676",
  in_progress: "#22D3EE",
  planned: "#64748b",
};
const STATUS_GLOW: Record<ZiplyObjectStatus, string> = {
  complete: "#00E676",
  in_progress: "#22D3EE",
  planned: "#475569",
};
const TERM_FILL: Record<ZiplyObjectStatus, string> = {
  complete: "#00E676",
  in_progress: "#22D3EE",
  planned: "#f8fafc",
};
const BUILD_ACCENT: Record<string, string> = {
  aerial: "#a78bfa",
  bore: "#fb923c",
  trench: "#facc15",
};

type StatusKind = "hub" | "terminal" | "cable";

interface Selected {
  job: Job;
  kind: StatusKind;
  ref: string;
  scope: ZiplySectionScope;
  title: string;
  position: google.maps.LatLngLiteral;
  status: ZiplyObjectStatus;
  locateCleared: boolean;
  crewName: string | null;
  rows: Array<{ label: string; value: string }>;
}

function lineColor(
  status: ZiplyObjectStatus,
  buildType: string | null | undefined,
  locateCleared: boolean | undefined,
  show811Clearance: boolean,
  role?: string | null
): string {
  if (show811Clearance) return locateCleared ? "#16A34A" : "#DC2626";
  if (role === "mainline" || role === "feeder") {
    if (status === "complete") return "#00E676";
    if (status === "in_progress") return "#22D3EE";
    return "#38BDF8";
  }
  if (status === "planned" && buildType && BUILD_ACCENT[buildType]) {
    return BUILD_ACCENT[buildType];
  }
  return STATUS_COLOR[status];
}

/**
 * Neon multi-layer fiber path with optional animated flow pulses.
 * complete → solid neon green glow
 * in_progress → cyan neon + flowing particles from hub
 * planned → soft dashed construction line
 */
function CadFiberLine({
  path,
  status,
  buildType,
  role,
  locateCleared,
  show811Clearance,
  label,
  selected,
  animateFlow,
  neonGlow,
  onClick,
}: {
  path: LatLng[];
  status: ZiplyObjectStatus;
  buildType?: string | null;
  role?: "mainline" | "lateral" | "feeder" | null;
  locateCleared?: boolean;
  show811Clearance?: boolean;
  label?: string;
  selected?: boolean;
  animateFlow?: boolean;
  neonGlow?: boolean;
  onClick?: (mid: LatLng) => void;
}) {
  const map = useMap();
  const pathKey = path.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("|");

  useEffect(() => {
    if (!map || path.length < 2) return;
    const isMain = role === "mainline" || role === "feeder";
    const color = lineColor(status, buildType, locateCleared, !!show811Clearance, role);
    const glow = STATUS_GLOW[status];
    const solid =
      show811Clearance
        ? !!locateCleared
        : status === "complete" || (isMain && status !== "planned");
    const isAerial = buildType === "aerial";
    const isBore = buildType === "bore";
    const weightBoost = selected ? 2.5 : 0;
    const mainW = isMain ? 7.5 : isBore ? 5 : isAerial ? 3.5 : 4.5;
    const layers: google.maps.Polyline[] = [];

    // Outer neon bloom (progress / complete only)
    if (neonGlow && (status === "complete" || status === "in_progress" || selected)) {
      const bloom = new google.maps.Polyline({
        path,
        map,
        strokeColor: selected ? "#fbbf24" : glow,
        strokeOpacity: status === "complete" ? 0.35 : 0.28,
        strokeWeight: (isMain ? 22 : 16) + weightBoost,
        zIndex: selected ? 12 : isMain ? 6 : 5,
        clickable: false,
      });
      layers.push(bloom);
      const midBloom = new google.maps.Polyline({
        path,
        map,
        strokeColor: selected ? "#fde68a" : glow,
        strokeOpacity: status === "complete" ? 0.45 : 0.38,
        strokeWeight: (isMain ? 14 : 10) + weightBoost,
        zIndex: selected ? 13 : isMain ? 7 : 6,
        clickable: false,
      });
      layers.push(midBloom);
    } else {
      const halo = new google.maps.Polyline({
        path,
        map,
        strokeColor: selected ? "#fbbf24" : isMain ? "#e0f2fe" : "#ffffff",
        strokeOpacity: selected ? 0.95 : 0.75,
        strokeWeight: (isMain ? 12 : isBore ? 9 : 7) + weightBoost,
        zIndex: selected ? 12 : 7,
        clickable: false,
      });
      layers.push(halo);
    }

    const hit = new google.maps.Polyline({
      path,
      map,
      strokeColor: "#000000",
      strokeOpacity: 0.01,
      strokeWeight: 20,
      zIndex: selected ? 20 : 14,
      clickable: true,
    });
    layers.push(hit);

    // Core fiber stroke
    const coreIcons: google.maps.IconSequence[] | undefined = solid
      ? undefined
      : [
          {
            icon: {
              path: "M 0,-1 0,1",
              strokeOpacity: 1,
              strokeColor: color,
              strokeWeight: isAerial ? 2.5 : 3.5,
              scale: isAerial ? 3 : 4,
            },
            offset: "0",
            repeat: isAerial ? "9px" : "12px",
          },
        ];

    const main = new google.maps.Polyline({
      path,
      map,
      strokeColor: color,
      strokeWeight: mainW + weightBoost,
      strokeOpacity: solid ? 0.98 : 0,
      zIndex: selected ? 16 : isMain ? 11 : 10,
      clickable: false,
      icons: coreIcons,
    });
    layers.push(main);

    // Animated energy flow along the line (hub → terminal direction)
    let flow: google.maps.Polyline | null = null;
    let animId: number | null = null;
    // Flow only on active/complete/selected — never on every planned lateral (label chaos + lag)
    const shouldFlow =
      animateFlow &&
      (status === "in_progress" || status === "complete" || selected);

    if (shouldFlow) {
      const flowColor =
        status === "complete" ? "#bbf7d0" : status === "in_progress" ? "#a5f3fc" : "#7dd3fc";
      flow = new google.maps.Polyline({
        path,
        map,
        strokeOpacity: 0,
        zIndex: selected ? 18 : 13,
        clickable: false,
        icons: [
          {
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: isMain ? 4.5 : 3.2,
              fillColor: flowColor,
              fillOpacity: 1,
              strokeColor: "#fff",
              strokeWeight: 1.2,
              strokeOpacity: 0.9,
            },
            offset: "0%",
          },
          {
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: isMain ? 3.2 : 2.4,
              strokeColor: flowColor,
              strokeWeight: 2,
              fillColor: flowColor,
              fillOpacity: 0.95,
            },
            offset: "0%",
            repeat: isMain ? "48px" : "64px",
          },
        ],
      });
      layers.push(flow);

      let t = 0;
      const speed = status === "complete" ? 1.1 : status === "in_progress" ? 1.6 : 0.9;
      const tick = () => {
        t = (t + speed) % 100;
        const icons = flow!.get("icons") as google.maps.IconSequence[];
        if (icons[0]) icons[0].offset = `${t}%`;
        if (icons[1]) icons[1].offset = `${(t + 12) % 100}%`;
        flow!.set("icons", icons);
        animId = window.requestAnimationFrame(tick);
      };
      animId = window.requestAnimationFrame(tick);
    }

    const clickListener = hit.addListener("click", () => onClick?.(pathMidpoint(path)));

    return () => {
      google.maps.event.removeListener(clickListener);
      if (animId != null) window.cancelAnimationFrame(animId);
      layers.forEach((l) => l.setMap(null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    map,
    pathKey,
    status,
    buildType,
    role,
    locateCleared,
    show811Clearance,
    selected,
    animateFlow,
    neonGlow,
    onClick,
  ]);

  const mid = pathMidpoint(path);
  if (!label) return null;
  return (
    <Marker
      position={mid}
      clickable={!!onClick}
      zIndex={17}
      onClick={() => onClick?.(mid)}
      icon={{
        url: makeLabelDataUrl(
          label,
          lineColor(status, buildType, locateCleared, !!show811Clearance, role)
        ),
        scaledSize: new google.maps.Size(Math.min(150, 28 + label.length * 6), 18),
        anchor: new google.maps.Point(Math.min(75, 14 + label.length * 3), 9),
      }}
    />
  );
}

/** Pulsing neon beacon around the FDH hub. */
function HubNeonBeacon({
  position,
  active,
  status,
}: {
  position: LatLng;
  active: boolean;
  status: ZiplyObjectStatus;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || !active) return;
    const color = STATUS_GLOW[status];
    // Tight beacon only (~12–22 m) — never city-scale rings
    const rings: google.maps.Circle[] = [0, 1].map((i) =>
      new google.maps.Circle({
        map,
        center: position,
        radius: 10 + i * 8,
        fillColor: color,
        fillOpacity: 0.1 - i * 0.04,
        strokeColor: color,
        strokeOpacity: 0.45 - i * 0.15,
        strokeWeight: 1.2,
        zIndex: 4,
        clickable: false,
      })
    );
    let frame = 0;
    let id = 0;
    const animate = () => {
      frame += 1;
      const phase = (Math.sin(frame / 28) + 1) / 2;
      rings.forEach((c, i) => {
        c.setRadius(9 + i * 7 + phase * (4 + i * 3));
        c.setOptions({
          fillOpacity: 0.05 + phase * 0.08 - i * 0.02,
          strokeOpacity: 0.2 + phase * 0.3 - i * 0.08,
        });
      });
      id = window.requestAnimationFrame(animate);
    };
    id = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(id);
      rings.forEach((c) => c.setMap(null));
    };
  }, [map, position.lat, position.lng, active, status]);
  return null;
}

function dropIconDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">
    <rect x="3" y="5" width="8" height="7" rx="1" fill="#0ea5e9" stroke="#0f172a" stroke-width="1"/>
    <polygon points="7,1 11,5 3,5" fill="#38bdf8" stroke="#0f172a" stroke-width="1"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function PrintCadHud({
  zoom,
  stats,
  flowOn,
  setFlowOn,
  glowOn,
  setGlowOn,
  hubPulseOn,
  setHubPulseOn,
  showPlanned,
  setShowPlanned,
  showAllPlants,
  setShowAllPlants,
  playOn,
  setPlayOn,
  playLabel,
  networkMode,
  setNetworkMode,
}: {
  zoom: number;
  stats: {
    cables: number;
    terminals: number;
    drops: number;
    enhanced: boolean;
    complete: number;
    inProgress: number;
    planned: number;
    progressPct: number;
    footageNote?: string | null;
    focusLabel?: string;
    otherPlants?: number;
    showAllPlants?: boolean;
  };
  flowOn: boolean;
  setFlowOn: (v: boolean) => void;
  glowOn: boolean;
  setGlowOn: (v: boolean) => void;
  hubPulseOn: boolean;
  setHubPulseOn: (v: boolean) => void;
  showPlanned: boolean;
  setShowPlanned: (v: boolean) => void;
  showAllPlants: boolean;
  setShowAllPlants: (v: boolean) => void;
  playOn: boolean;
  setPlayOn: (v: boolean) => void;
  playLabel: string | null;
  networkMode: boolean;
  setNetworkMode: (v: boolean) => void;
}) {
  return (
    <div className="ziply-cad-hud">
      <div className="ziply-cad-hud__beam" />
      <div className="ziply-cad-hud__head">
        <span className="ziply-cad-hud__title">Print CAD Live</span>
        <span className="ziply-cad-hud__live">
          <span className="ziply-cad-hud__live-dot" />
          Live
        </span>
      </div>
      <div className="ziply-cad-hud__body">
        <div
          style={{
            fontSize: 10,
            color: "#67e8f9",
            fontFamily: "var(--font-mono, monospace)",
            fontWeight: 700,
          }}
        >
          Focus: {stats.focusLabel ?? "—"}
          {(stats.otherPlants ?? 0) > 0 && !stats.showAllPlants
            ? ` · +${stats.otherPlants} hubs dimmed`
            : ""}
        </div>
        <div className="ziply-cad-hud__progress">
          <div className="ziply-cad-hud__progress-meta">
            <span>Plant complete</span>
            <span className="ziply-cad-hud__progress-pct">{stats.progressPct}%</span>
          </div>
          <div className="ziply-cad-hud__bar">
            <div
              className="ziply-cad-hud__bar-fill"
              style={{ width: `${Math.max(2, stats.progressPct)}%` }}
            />
          </div>
          {"footageNote" in stats && stats.footageNote ? (
            <div style={{ fontSize: 9, color: "#64748b", fontFamily: "monospace" }}>
              Footage: {String(stats.footageNote)}
            </div>
          ) : null}
        </div>

        <div className="ziply-cad-hud__stats">
          <div className="ziply-cad-hud__stat">
            <span className="ziply-cad-hud__stat-n" style={{ color: "#00E676" }}>
              {stats.complete}
            </span>
            <span className="ziply-cad-hud__stat-l">Done</span>
          </div>
          <div className="ziply-cad-hud__stat">
            <span className="ziply-cad-hud__stat-n" style={{ color: "#22D3EE" }}>
              {stats.inProgress}
            </span>
            <span className="ziply-cad-hud__stat-l">Active</span>
          </div>
          <div className="ziply-cad-hud__stat">
            <span className="ziply-cad-hud__stat-n" style={{ color: "#94a3b8" }}>
              {stats.planned}
            </span>
            <span className="ziply-cad-hud__stat-l">Planned</span>
          </div>
        </div>

        <div className="ziply-cad-hud__toggles">
          <label className={`ziply-cad-hud__toggle ${flowOn ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={flowOn}
              onChange={(e) => setFlowOn(e.target.checked)}
            />
            Fiber flow animation
          </label>
          <label className={`ziply-cad-hud__toggle ${glowOn ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={glowOn}
              onChange={(e) => setGlowOn(e.target.checked)}
            />
            Neon progress glow
          </label>
          <label className={`ziply-cad-hud__toggle ${hubPulseOn ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={hubPulseOn}
              onChange={(e) => setHubPulseOn(e.target.checked)}
            />
            Hub beacon pulse
          </label>
          <label className={`ziply-cad-hud__toggle ${showPlanned ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={showPlanned}
              onChange={(e) => setShowPlanned(e.target.checked)}
            />
            Show planned paths
          </label>
          <label className={`ziply-cad-hud__toggle ${showAllPlants ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={showAllPlants}
              onChange={(e) => {
                setShowAllPlants(e.target.checked);
                if (e.target.checked) setNetworkMode(false);
              }}
            />
            Show all plants (noisy)
          </label>
          <label className={`ziply-cad-hud__toggle ${networkMode ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={networkMode}
              onChange={(e) => {
                setNetworkMode(e.target.checked);
                if (e.target.checked) setShowAllPlants(false);
              }}
            />
            Network: city mainlines
          </label>
          <label className={`ziply-cad-hud__toggle ${playOn ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={playOn}
              onChange={(e) => setPlayOn(e.target.checked)}
            />
            Play construction sequence
          </label>
          {playOn && playLabel && (
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "#fbbf24",
                textShadow: "0 0 10px rgba(251,191,36,0.5)",
                fontFamily: "monospace",
              }}
            >
              ▶ {playLabel}
            </div>
          )}
        </div>

        <div className="ziply-cad-hud__legend">
          <span>
            <span className="neon-main">━━</span> mainline spine
          </span>
          <span>
            <span className="neon-planned">- -</span> planned ·{" "}
            <span className="neon-progress">━━</span> in progress ·{" "}
            <span className="neon-done">━━</span> complete
          </span>
          <span>
            {stats.cables} cables · {stats.terminals} MST · {stats.drops} drops · z
            {zoom.toFixed(0)}
            {stats.enhanced ? " · enhanced" : ""}
          </span>
        </div>
        <p className="ziply-cad-hud__hint">
          One plant at a time — open a Ziply job with a print to focus it. Labels appear
          at higher zoom. Click a cable for Live / Neon Done.
        </p>
      </div>
    </div>
  );
}

function makeLabelDataUrl(text: string, color: string): string {
  const safe = text.replace(/[<>&]/g, "");
  const w = Math.min(140, 24 + safe.length * 6.5);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="18">
    <rect x="0.5" y="0.5" width="${w - 1}" height="17" rx="4" fill="rgba(255,255,255,0.92)" stroke="${color}" stroke-width="1.2"/>
    <text x="${w / 2}" y="12.5" text-anchor="middle" font-size="9" font-weight="700"
      font-family="ui-monospace,Consolas,monospace" fill="#0f172a">${safe}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function hubIconDataUrl(label: string, fill: string): string {
  const safe = (label || "FDH").slice(0, 10);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
    <circle cx="28" cy="28" r="26" fill="rgba(15,23,42,0.12)"/>
    <rect x="12" y="14" width="32" height="28" rx="3" fill="${fill}" stroke="#0f172a" stroke-width="2"/>
    <rect x="16" y="18" width="10" height="8" rx="1" fill="#fff" opacity="0.9"/>
    <rect x="30" y="18" width="10" height="8" rx="1" fill="#fff" opacity="0.9"/>
    <rect x="16" y="30" width="24" height="3" fill="#0f172a" opacity="0.35"/>
    <rect x="16" y="35" width="24" height="3" fill="#0f172a" opacity="0.35"/>
    <text x="28" y="52" text-anchor="middle" font-size="8" font-weight="800"
      font-family="ui-monospace,Consolas,monospace" fill="#0f172a">${safe}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function termIconDataUrl(label: string, fill: string, stroke: string): string {
  const safe = label.slice(0, 8);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="36" viewBox="0 0 44 36">
    <circle cx="22" cy="12" r="9" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <circle cx="22" cy="12" r="3" fill="${stroke}" opacity="0.35"/>
    <text x="22" y="32" text-anchor="middle" font-size="8" font-weight="700"
      font-family="ui-monospace,Consolas,monospace" fill="#0f172a">${safe}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface Props {
  jobs: Job[];
  /** When set, only this job's full plant is drawn (others = hub pin only). */
  focusJobId?: string | null;
  visible: boolean;
  show811Clearance?: boolean;
}

export default function ZiplyPrintOverlay({
  jobs,
  focusJobId = null,
  visible,
  show811Clearance = false,
}: Props) {
  const map = useMap();
  const [selected, setSelected] = useState<Selected | null>(null);
  const [saving, setSaving] = useState(false);
  const [crewDraft, setCrewDraft] = useState("");
  const [tickets, setTickets] = useState<DigTicket[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ZiplyObjectStatus>>({});
  const [didFitPrints, setDidFitPrints] = useState(false);
  const [zoom, setZoom] = useState(14);
  // Defaults calmer: less visual noise until user opts in
  const [flowOn, setFlowOn] = useState(true);
  const [glowOn, setGlowOn] = useState(true);
  const [hubPulseOn, setHubPulseOn] = useState(false);
  const [showPlanned, setShowPlanned] = useState(true);
  /** When true, draw every ready plant (legacy). Default: focus one job. */
  const [showAllPlants, setShowAllPlants] = useState(false);
  /** Path edit session — vertices draggable; map click inserts */
  const [pathEdit, setPathEdit] = useState<{
    jobId: string;
    label: string;
    role?: "mainline" | "lateral" | "feeder" | null;
    path: LatLng[];
  } | null>(null);
  const [pathEditBusy, setPathEditBusy] = useState(false);
  const [pathEditMsg, setPathEditMsg] = useState<string | null>(null);
  const [studioHighlight, setStudioHighlight] = useState<ZiplyPlantSelection | null>(
    null
  );
  /** Construction sequence play mode */
  const [playOn, setPlayOn] = useState(false);
  const [playIdx, setPlayIdx] = useState(0);
  /** Network mode: mainlines of all ready plants (no laterals) */
  const [networkMode, setNetworkMode] = useState(false);

  const allReady = useMemo(() => jobs.filter((j) => isZiplyPrintMapReady(j)), [jobs]);

  // Primary plant: selected job if it has a print; else first ready job only.
  // Network mode draws all mainlines (handled separately) but focus plant still full.
  const printJobs = useMemo(() => {
    if (showAllPlants && !networkMode) return allReady;
    if (focusJobId) {
      const focused = allReady.find((j) => j.jobId === focusJobId);
      if (focused) return [focused];
    }
    if (allReady.length === 0) return [];
    return [allReady[0]!];
  }, [allReady, focusJobId, showAllPlants, networkMode]);

  const otherHubJobs = useMemo(() => {
    if (showAllPlants && !networkMode) return [];
    const focusId = printJobs[0]?.jobId;
    return allReady.filter((j) => j.jobId !== focusId);
  }, [allReady, printJobs, showAllPlants, networkMode]);

  const sequence = useMemo(() => {
    const j = printJobs[0];
    return j ? buildConstructionSequence(j) : [];
  }, [printJobs]);

  // Construction play: advance highlight along sequence
  useEffect(() => {
    if (!playOn || sequence.length === 0) return;
    const id = window.setInterval(() => {
      setPlayIdx((i) => (i + 1) % sequence.length);
    }, 1400);
    return () => window.clearInterval(id);
  }, [playOn, sequence.length]);

  const playHighlight = playOn && sequence[playIdx] ? sequence[playIdx]! : null;

  useEffect(() => {
    setCrewDraft(selected?.crewName ?? "");
  }, [selected]);

  // Broadcast map selection → Print Studio
  useEffect(() => {
    if (!selected) {
      emitZiplyPlantSelect(null);
      return;
    }
    emitZiplyPlantSelect({
      jobId: selected.job.jobId,
      kind: selected.kind,
      ref: selected.ref,
      label: selected.title,
    });
  }, [selected]);

  // Studio → map selection / path edit
  useEffect(() => {
    const onSelect = (e: Event) => {
      const d = (e as CustomEvent<ZiplyPlantSelection | null>).detail;
      setStudioHighlight(d);
    };
    const onPathEdit = (e: Event) => {
      const d = (e as CustomEvent<{ jobId: string; cableLabel: string; path?: LatLng[] }>)
        .detail;
      if (!d?.jobId || !d.cableLabel) return;
      const job = jobs.find((j) => j.jobId === d.jobId);
      const cable = job?.ziplyPrintLayer?.mapObjects?.cables?.find(
        (c) => c.label === d.cableLabel || c.toTerminal === d.cableLabel
      );
      const raw =
        d.path ??
        (cable?.path && cable.path.length >= 2
          ? cable.path
          : null);
      if (!raw || raw.length < 2) {
        setPathEditMsg("No path points to edit — rebuild plant CAD first.");
        return;
      }
      setPathEdit({
        jobId: d.jobId,
        label: cable?.label ?? d.cableLabel,
        role: cable?.role ?? "lateral",
        path: pathControlPoints(
          raw.filter(
            (p): p is LatLng =>
              typeof p.lat === "number" && typeof p.lng === "number"
          )
        ),
      });
      setPathEditMsg("Path edit: drag points · click map to insert · Save when done");
    };
    window.addEventListener("nsc:ziply-plant-select", onSelect as EventListener);
    window.addEventListener("nsc:ziply-path-edit", onPathEdit as EventListener);
    return () => {
      window.removeEventListener("nsc:ziply-plant-select", onSelect as EventListener);
      window.removeEventListener("nsc:ziply-path-edit", onPathEdit as EventListener);
    };
  }, [jobs]);

  useEffect(() => {
    if (!map) return;
    const sync = () => setZoom(map.getZoom() ?? 14);
    sync();
    const listener = map.addListener("zoom_changed", sync);
    return () => google.maps.event.removeListener(listener);
  }, [map]);

  // Map click while path editing → insert vertex on nearest segment
  useEffect(() => {
    if (!map || !pathEdit) return;
    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      const ll = e.latLng;
      if (!ll) return;
      const pt = { lat: ll.lat(), lng: ll.lng() };
      setPathEdit((cur) => {
        if (!cur) return cur;
        const seg = nearestSegmentIndex(cur.path, pt);
        return { ...cur, path: insertVertex(cur.path, seg, pt) };
      });
    });
    return () => google.maps.event.removeListener(listener);
  }, [map, pathEdit?.jobId, pathEdit?.label]);

  const savePathEdit = useCallback(async () => {
    if (!pathEdit || pathEdit.path.length < 2) return;
    setPathEditBusy(true);
    setPathEditMsg(null);
    try {
      await api.updateZiplyCablePath(pathEdit.jobId, {
        label: pathEdit.label,
        path: pathEdit.path,
        role: pathEdit.role,
      });
      setPathEditMsg("Path saved.");
      setPathEdit(null);
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch (e) {
      setPathEditMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setPathEditBusy(false);
    }
  }, [pathEdit]);

  useEffect(() => {
    if (!visible || !show811Clearance) return;
    let cancelled = false;
    api
      .listDigTickets("*")
      .then(({ tickets }) => {
        if (!cancelled) setTickets(tickets);
      })
      .catch(() => {
        if (!cancelled) setTickets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, show811Clearance]);

  // Fit when focus plant changes (not every multi-plant dump)
  useEffect(() => {
    if (!visible) {
      setDidFitPrints(false);
      return;
    }
    if (!map || printJobs.length === 0) return;
    const j = printJobs[0]!;
    const a = getZiplyPrintAnchor(j);
    if (!a) return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: a.lat, lng: a.lng });
    const mo = j.ziplyPrintLayer?.mapObjects;
    for (const t of mo?.terminals ?? []) {
      if (typeof t.lat === "number" && typeof t.lng === "number" && t.lat && t.lng) {
        bounds.extend({ lat: t.lat, lng: t.lng });
      }
    }
    for (const p of mo?.backbonePath ?? []) {
      if (typeof p.lat === "number" && typeof p.lng === "number") {
        bounds.extend({ lat: p.lat, lng: p.lng });
      }
    }
    map.fitBounds(bounds, 80);
    // Prefer street-level over city dump
    const z = map.getZoom() ?? 16;
    if (z < 15) map.setZoom(16);
    if (z > 19) map.setZoom(18);
    setDidFitPrints(true);
  }, [map, visible, printJobs[0]?.jobId]);

  const plantStats = useMemo(() => {
    let cables = 0;
    let terminals = 0;
    let drops = 0;
    let enhanced = false;
    let complete = 0;
    let inProgress = 0;
    let planned = 0;
    let progressPct = 0;
    let footageNote: string | null = null;
    // Real progress from focused plant only (object + footage when known)
    for (const j of printJobs) {
      const mo = j.ziplyPrintLayer?.mapObjects;
      cables += mo?.cables?.length ?? 0;
      terminals += mo?.terminals?.length ?? 0;
      drops += mo?.dropSites?.length ?? 0;
      if (j.ziplyPrintLayer?.printGeometryEnhancedAt) enhanced = true;
      const p = computePlantProgress(j, overrides);
      complete += p.complete;
      inProgress += p.inProgress;
      planned += p.planned;
      progressPct = p.progressPct;
      if (p.footagePct != null && p.totalFt > 0) {
        footageNote = `${Math.round(p.completeFt)}' / ${Math.round(p.totalFt)}'`;
      }
    }
    return {
      cables,
      terminals,
      drops,
      enhanced,
      complete,
      inProgress,
      planned,
      progressPct,
      footageNote,
      focusLabel: printJobs[0]
        ? printJobs[0]!.workOrder || printJobs[0]!.jobId.slice(0, 8)
        : "—",
      otherPlants: otherHubJobs.length,
      showAllPlants,
    };
  }, [printJobs, overrides, otherHubJobs.length, showAllPlants]);

  if (!visible) return null;

  const statusOf = (
    jobId: string,
    kind: StatusKind,
    ref: string,
    stored: ZiplyObjectStatus | undefined
  ): ZiplyObjectStatus => overrides[`${jobId}:${kind}:${ref}`] ?? stored ?? "planned";

  const applyStatus = async (sel: Selected, status: ZiplyObjectStatus) => {
    const key = `${sel.job.jobId}:${sel.kind}:${sel.ref}`;
    setOverrides((o) => ({ ...o, [key]: status }));
    setSelected((s) => (s ? { ...s, status } : s));
    setSaving(true);
    try {
      await api.updateZiplyObjectStatus(sel.job.jobId, {
        kind: sel.kind,
        ref: sel.ref,
        status,
      });
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch {
      /* keep optimistic */
    } finally {
      setSaving(false);
    }
  };

  const scopeKey = (jobId: string, kind: StatusKind, ref: string) => `${jobId}:${kind}:${ref}`;
  const activeScopedTickets = new Map<string, DigTicket>();
  const now = Date.now();
  tickets.forEach((t) => {
    if (!t.scope) return;
    const expires = t.dates?.expiresAt ?? null;
    const live =
      (t.status === "Filed" || t.status === "Active" || t.status === "Expiring") &&
      (!expires || expires > now);
    if (live) activeScopedTickets.set(scopeKey(t.jobId, t.scope.kind, t.scope.ref), t);
  });

  const locateCleared = (
    job: Job,
    kind: StatusKind,
    ref: string,
    fallbackExpires?: number | null
  ) => {
    if (activeScopedTickets.get(scopeKey(job.jobId, kind, ref))) return true;
    return fallbackExpires != null && fallbackExpires > now;
  };

  const openSection811 = (sel: Selected) => {
    try {
      sessionStorage.setItem(
        "nsc.map.openDigTicketForJob",
        JSON.stringify({ jobId: sel.job.jobId, scope: sel.scope })
      );
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent("nsc:map:openDigTicketForJob", {
        detail: { jobId: sel.job.jobId, scope: sel.scope },
      })
    );
    window.dispatchEvent(new CustomEvent("nsc:request-tab", { detail: { tab: "811-tickets" } }));
  };

  const saveCrew = async (sel: Selected) => {
    setSaving(true);
    try {
      await api.updateZiplySectionCrew(sel.job.jobId, {
        kind: sel.kind,
        ref: sel.ref,
        crewName: crewDraft.trim() || null,
      });
      setSelected((s) => (s ? { ...s, crewName: crewDraft.trim() || null } : s));
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } finally {
      setSaving(false);
    }
  };

  // Label LOD — city zoom stays clean; detail only when close
  const showMainlineLabels = zoom >= 15;
  const showCableLabels = zoom >= 17;
  const showTermLabels = zoom >= 16;
  const showDrops = zoom >= 17;
  const showDropLabels = zoom >= 19;
  const legendHost =
    typeof document !== "undefined"
      ? document.querySelector(".map-host")
      : null;

  return (
    <>
      {legendHost &&
        createPortal(
          <>
            <PrintCadHud
              zoom={zoom}
              stats={plantStats}
              flowOn={flowOn}
              setFlowOn={setFlowOn}
              glowOn={glowOn}
              setGlowOn={setGlowOn}
              hubPulseOn={hubPulseOn}
              setHubPulseOn={setHubPulseOn}
              showPlanned={showPlanned}
              setShowPlanned={setShowPlanned}
              showAllPlants={showAllPlants}
              setShowAllPlants={setShowAllPlants}
              playOn={playOn}
              setPlayOn={setPlayOn}
              playLabel={
                playHighlight
                  ? `${playIdx + 1}/${sequence.length} · ${playHighlight.label}`
                  : null
              }
              networkMode={networkMode}
              setNetworkMode={setNetworkMode}
            />
            {pathEdit && (
              <div
                style={{
                  position: "absolute",
                  left: 12,
                  bottom: 300,
                  zIndex: 9,
                  width: "min(280px, calc(100% - 24px))",
                  maxWidth: 300,
                  background: "rgba(8,15,28,0.96)",
                  border: "1px solid rgba(251,191,36,0.55)",
                  borderRadius: 12,
                  padding: 12,
                  color: "#fde68a",
                  fontSize: 11,
                  boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
                }}
              >
                <div style={{ fontWeight: 800, letterSpacing: "0.08em", marginBottom: 6 }}>
                  PATH EDIT · {pathEdit.label}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 10, marginBottom: 8, lineHeight: 1.35 }}>
                  Drag yellow handles · click map to insert · − Last pt removes ·{" "}
                  {pathEdit.path.length} points
                </div>
                {pathEditMsg && (
                  <div style={{ color: "#a5f3fc", fontSize: 10, marginBottom: 8 }}>{pathEditMsg}</div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={pathEditBusy}
                    onClick={() => void savePathEdit()}
                    style={{
                      flex: 1,
                      minWidth: 90,
                      background: "linear-gradient(180deg,#fbbf24,#d97706)",
                      color: "#1c1000",
                      border: "none",
                      borderRadius: 6,
                      padding: "8px",
                      fontWeight: 800,
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    {pathEditBusy ? "Saving…" : "Save path"}
                  </button>
                  <button
                    type="button"
                    disabled={pathEditBusy || (pathEdit?.path.length ?? 0) <= 2}
                    onClick={() =>
                      setPathEdit((cur) =>
                        cur && cur.path.length > 2
                          ? {
                              ...cur,
                              path: removeVertex(cur.path, cur.path.length - 1),
                            }
                          : cur
                      )
                    }
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      color: "#e2e8f0",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    − Last pt
                  </button>
                  <button
                    type="button"
                    disabled={pathEditBusy}
                    onClick={() => {
                      setPathEdit(null);
                      setPathEditMsg(null);
                    }}
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      color: "#e2e8f0",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>,
          legendHost
        )}

      {/* Path edit preview line + handles */}
      {pathEdit && pathEdit.path.length >= 2 && (
        <>
          <CadFiberLine
            path={pathEdit.path}
            status="in_progress"
            buildType="trench"
            role={pathEdit.role}
            selected
            animateFlow={false}
            neonGlow
            label="EDITING"
          />
          {pathEdit.path.map((pt, vi) => (
            <Marker
              key={`edit-v-${vi}`}
              position={pt}
              zIndex={50}
              draggable
              title={`Vertex ${vi + 1} — drag to move`}
              onDragEnd={(e) => {
                const ll = e.latLng;
                if (!ll) return;
                setPathEdit((cur) =>
                  cur
                    ? {
                        ...cur,
                        path: moveVertex(cur.path, vi, {
                          lat: ll.lat(),
                          lng: ll.lng(),
                        }),
                      }
                    : cur
                );
              }}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: "#fbbf24",
                fillOpacity: 1,
                strokeColor: "#fff",
                strokeWeight: 2,
              }}
            />
          ))}
        </>
      )}

      {/* Network mode: thin mainlines for every ready plant */}
      {networkMode &&
        allReady.map((j) => {
          const mo = j.ziplyPrintLayer?.mapObjects;
          const bb = mo?.backbonePath;
          const mainCable = mo?.cables?.find(
            (c) => c.role === "mainline" || c.role === "feeder"
          );
          const path =
            bb && bb.length >= 2
              ? bb
              : mainCable?.path && mainCable.path.length >= 2
                ? mainCable.path
                : null;
          if (!path || path.length < 2) {
            const a = getZiplyPrintAnchor(j);
            if (!a) return null;
            return (
              <Marker
                key={`net-hub-${j.jobId}`}
                position={{ lat: a.lat, lng: a.lng }}
                title={j.workOrder || j.jobId}
                zIndex={4}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 5,
                  fillColor: "#38bdf8",
                  fillOpacity: 0.7,
                  strokeColor: "#0ea5e9",
                  strokeWeight: 1,
                }}
              />
            );
          }
          const isFocus = j.jobId === printJobs[0]?.jobId;
          return (
            <CadFiberLine
              key={`net-ml-${j.jobId}`}
              path={path.filter(
                (p): p is LatLng =>
                  typeof p.lat === "number" && typeof p.lng === "number"
              )}
              status={isFocus ? "in_progress" : "planned"}
              role="mainline"
              buildType="trench"
              animateFlow={isFocus && flowOn}
              neonGlow={isFocus && glowOn}
              label={
                showMainlineLabels && zoom >= 14
                  ? j.workOrder || mo?.mainlineStreet || "MAIN"
                  : undefined
              }
            />
          );
        })}

      {/* Dim hub-only markers for non-focused plants (when not network/all) */}
      {!networkMode &&
        otherHubJobs.map((j) => {
          const a = getZiplyPrintAnchor(j);
          if (!a) return null;
          return (
            <Marker
              key={`dim-hub-${j.jobId}`}
              position={{ lat: a.lat, lng: a.lng }}
              title={`${j.workOrder || j.jobId} (select job to open plant)`}
              zIndex={3}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 6,
                fillColor: "#64748b",
                fillOpacity: 0.45,
                strokeColor: "#94a3b8",
                strokeWeight: 1,
                strokeOpacity: 0.6,
              }}
            />
          );
        })}

      {printJobs.map((job) => {
        const layer = job.ziplyPrintLayer!;
        const mo = layer.mapObjects!;
        const hub = mo.hub ?? null;
        const anchor = getZiplyPrintAnchor(job)!;
        const hubPos = { lat: anchor.lat, lng: anchor.lng };
        const hubStatus = statusOf(job.jobId, "hub", "hub", hub?.status);
        const terminals = mo.terminals ?? [];
        const cables = mo.cables ?? [];
        const dropSites = mo.dropSites ?? [];
        const isEnhanced = !!layer.printGeometryEnhancedAt;
        const backbonePath =
          mo.backbonePath && mo.backbonePath.length >= 2
            ? mo.backbonePath.filter(
                (p): p is LatLng =>
                  typeof p.lat === "number" &&
                  typeof p.lng === "number" &&
                  !(p.lat === 0 && p.lng === 0)
              )
            : null;
        const mainlineStreet = mo.mainlineStreet ?? null;

        const termPositions = terminals.map((t, idx) =>
          placeTerminalAroundHub(
            hubPos,
            idx,
            terminals.length,
            t.footageFt,
            t.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : null
          )
        );
        const termPosByLabel = new Map<string, LatLng>();
        terminals.forEach((t, idx) => termPosByLabel.set(t.label, termPositions[idx]!));

        const resolveTermForCable = (
          cableLabel: string,
          toTerminal: string | null | undefined,
          idx: number
        ): LatLng | null => {
          if (toTerminal && termPosByLabel.has(toTerminal)) {
            return termPosByLabel.get(toTerminal)!;
          }
          const direct = termPosByLabel.get(cableLabel);
          if (direct) return direct;
          const num = (toTerminal || cableLabel).replace(/\D/g, "");
          if (num) {
            for (const [lab, pos] of termPosByLabel) {
              if (lab.replace(/\D/g, "") === num) return pos;
            }
          }
          return termPositions[idx % Math.max(termPositions.length, 1)] ?? null;
        };

        const openCable = (
          c: (typeof cables)[number],
          path: LatLng[],
          st: ZiplyObjectStatus,
          cleared: boolean,
          mid: LatLng
        ) => {
          setSelected({
            job,
            kind: "cable",
            ref: c.label,
            scope: {
              kind: "cable",
              ref: c.label,
              hubId: layer.hubId,
              label: c.label,
            },
            title: `Cable ${c.label}`,
            position: mid,
            status: st,
            locateCleared: cleared,
            crewName: c.crewName ?? null,
            rows: [
              { label: "Fiber", value: c.fiberCount || "N/A" },
              {
                label: "Length",
                value: c.lengthFt != null ? `${c.lengthFt}'` : "N/A",
              },
              { label: "Build", value: c.buildType || "N/A" },
              { label: "Role", value: c.role || "lateral" },
              { label: "To terminal", value: c.toTerminal || "N/A" },
              {
                label: "Route streets",
                value: (c.routeStreets || []).join(" → ") || mainlineStreet || "N/A",
              },
              {
                label: "Print sheet",
                value: c.sheetPage != null ? `Page ${c.sheetPage}` : "—",
              },
              {
                label: "Sequence",
                value: c.sequenceOrder != null ? String(c.sequenceOrder) : "—",
              },
              {
                label: "Side of mainline",
                value: c.side || "—",
              },
              {
                label: "Path points",
                value: String(path.length),
              },
              {
                label: "Geometry",
                value: isEnhanced
                  ? c.role === "mainline"
                    ? "arterial backbone"
                    : c.path && c.path.length >= 3
                      ? "parcel lateral"
                      : "synthetic lateral"
                  : "schematic — run ENHANCE CAD / re-ingest print",
              },
            ],
          });
          // Notify Studio to jump to sheet page when known
          if (c.sheetPage != null) {
            try {
              window.dispatchEvent(
                new CustomEvent("nsc:ziply-print-page", {
                  detail: { jobId: job.jobId, sheetPage: c.sheetPage, label: c.label },
                })
              );
            } catch {
              /* ignore */
            }
          }
        };

        return (
          <Fragment key={job.jobId}>
            {/* Tight design footprint (pixel scale, not city-scale) */}
            <Marker
              position={hubPos}
              clickable={false}
              zIndex={5}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 16,
                fillColor: "#0891B2",
                fillOpacity: 0.08,
                strokeColor: "#0891B2",
                strokeOpacity: 0.3,
                strokeWeight: 1,
              }}
            />

            <HubNeonBeacon
              position={hubPos}
              active={hubPulseOn}
              status={hubStatus}
            />

            {/* Explicit backbone from enhance (Metron Rd style spine) */}
            {backbonePath && backbonePath.length >= 2 && (
              <CadFiberLine
                key={`${job.jobId}-backbone`}
                path={backbonePath}
                status={hubStatus === "complete" ? "complete" : "in_progress"}
                buildType="trench"
                role="mainline"
                animateFlow={flowOn && hubStatus !== "planned"}
                neonGlow={glowOn && hubStatus !== "planned"}
                label={
                  showMainlineLabels
                    ? mainlineStreet
                      ? `MAINLINE · ${mainlineStreet}`
                      : "MAINLINE"
                    : undefined
                }
              />
            )}

            {cables.length > 0
              ? cables.map((c, idx) => {
                  const st = statusOf(job.jobId, "cable", c.label, c.status);
                  if (!showPlanned && st === "planned") return null;
                  // Network mode: only mainlines (drawn above for all jobs) — skip laterals here
                  if (networkMode && c.role !== "mainline" && c.role !== "feeder") {
                    return null;
                  }
                  const cleared = locateCleared(job, "cable", c.label, c.locateExpires ?? null);
                  const termPos = resolveTermForCable(c.label, c.toTerminal, idx);
                  const isMain = c.role === "mainline" || c.role === "feeder";
                  // Skip drawing duplicate mainline if backbone already rendered
                  if (isMain && backbonePath && backbonePath.length >= 2) return null;
                  if (!termPos && !(c.path && c.path.length >= 2) && !isMain) return null;
                  const path =
                    c.path && c.path.length >= 3
                      ? c.path.filter(
                          (p): p is LatLng =>
                            typeof p.lat === "number" &&
                            typeof p.lng === "number" &&
                            !(p.lat === 0 && p.lng === 0)
                        )
                      : buildCablePath(
                          hubPos,
                          termPos ?? hubPos,
                          idx,
                          null,
                          null,
                          c.lengthFt
                        );
                  if (path.length < 2) return null;
                  const isMainRole = c.role === "mainline" || c.role === "feeder";
                  // Cap lateral labels: only first 12 laterals + all mainlines when zoomed
                  const allowLabel =
                    (isMainRole && showMainlineLabels) ||
                    (showCableLabels && (st !== "planned" || idx < 12));
                  const labelParts = [
                    c.label,
                    c.fiberCount || null,
                    c.lengthFt != null ? `${c.lengthFt}'` : null,
                    c.buildType || null,
                  ].filter(Boolean);
                  const playHit =
                    playHighlight?.kind === "cable" &&
                    (playHighlight.ref === c.label || playHighlight.ref === c.toTerminal);
                  const isSel =
                    playHit ||
                    (selected?.job.jobId === job.jobId &&
                      selected.kind === "cable" &&
                      selected.ref === c.label) ||
                    (studioHighlight?.jobId === job.jobId &&
                      studioHighlight.kind === "cable" &&
                      (studioHighlight.ref === c.label ||
                        studioHighlight.ref === c.toTerminal));
                  // While editing this cable, hide stored path (preview drawn separately)
                  if (pathEdit?.jobId === job.jobId && pathEdit.label === c.label) {
                    return null;
                  }
                  const pageHint =
                    c.sheetPage != null ? `p${c.sheetPage}` : null;
                  return (
                    <CadFiberLine
                      key={`${job.jobId}-cable-${c.label}-${idx}`}
                      path={path}
                      status={playHit ? "in_progress" : st}
                      buildType={c.buildType}
                      role={c.role}
                      locateCleared={cleared}
                      show811Clearance={show811Clearance}
                      label={
                        allowLabel
                          ? [...labelParts, pageHint].filter(Boolean).join(" · ")
                          : undefined
                      }
                      selected={isSel}
                      animateFlow={
                        flowOn &&
                        (playHit || st === "in_progress" || st === "complete" || isSel)
                      }
                      neonGlow={glowOn && (playHit || st !== "planned" || isSel)}
                      onClick={(mid) => openCable(c, path, st, cleared, mid)}
                    />
                  );
                })
              : terminals.map((t, idx) => {
                  const st = statusOf(job.jobId, "terminal", t.label, t.status);
                  if (!showPlanned && st === "planned") return null;
                  const cleared = locateCleared(job, "terminal", t.label, t.locateExpires ?? null);
                  const path = buildCablePath(
                    hubPos,
                    termPositions[idx]!,
                    idx,
                    null,
                    null,
                    t.footageFt
                  );
                  return (
                    <CadFiberLine
                      key={`${job.jobId}-spoke-${idx}`}
                      path={path}
                      status={st}
                      buildType="bore"
                      role="lateral"
                      animateFlow={flowOn}
                      neonGlow={glowOn}
                      locateCleared={cleared}
                      show811Clearance={show811Clearance}
                      label={
                        showCableLabels
                          ? [t.label, t.footageLabel || (t.footageFt != null ? `${t.footageFt}'` : null)]
                              .filter(Boolean)
                              .join(" · ")
                          : undefined
                      }
                    />
                  );
                })}

            {/* Drop / home-pass sites (lot-level) */}
            {showDrops &&
              dropSites.map((d, di) => {
                if (typeof d.lat !== "number" || typeof d.lng !== "number") return null;
                const pos = { lat: d.lat, lng: d.lng };
                return (
                  <Marker
                    key={`${job.jobId}-drop-${di}`}
                    position={pos}
                    zIndex={14}
                    title={d.address}
                    onClick={() =>
                      setSelected({
                        job,
                        kind: "terminal",
                        ref: d.terminalLabel || d.address,
                        scope: {
                          kind: "terminal",
                          ref: d.terminalLabel || d.address,
                          hubId: layer.hubId,
                          label: d.address,
                        },
                        title: `Drop — ${d.address}`,
                        position: pos,
                        status: "planned",
                        locateCleared: false,
                        crewName: null,
                        rows: [
                          { label: "Address", value: d.address },
                          { label: "Terminal", value: d.terminalLabel || "N/A" },
                          { label: "Kind", value: d.kind || "unknown" },
                        ],
                      })
                    }
                    icon={
                      showDropLabels
                        ? {
                            url: makeLabelDataUrl(
                              (d.address.split(",")[0] || d.address).slice(0, 18),
                              "#0ea5e9"
                            ),
                            scaledSize: new google.maps.Size(110, 18),
                            anchor: new google.maps.Point(55, 20),
                          }
                        : {
                            url: dropIconDataUrl(),
                            scaledSize: new google.maps.Size(14, 14),
                            anchor: new google.maps.Point(7, 7),
                          }
                    }
                  />
                );
              })}

            {/* Hub / FDH */}
            <Marker
              position={hubPos}
              title={`FDH ${layer.hubId || job.workOrder || ""}`}
              zIndex={20}
              onClick={() =>
                setSelected({
                  job,
                  kind: "hub",
                  ref: "hub",
                  scope: {
                    kind: "hub",
                    ref: "hub",
                    hubId: layer.hubId,
                    label: `Hub ${layer.hubId || job.workOrder}`,
                  },
                  title: `FDH Cabinet ${layer.hubId || ""}`,
                  position: hubPos,
                  status: hubStatus,
                  locateCleared: locateCleared(job, "hub", "hub", job.locateExpires ?? null),
                  crewName: job.crewName ?? null,
                  rows: [
                    { label: "Hub Type", value: layer.hubTypeSize || "N/A" },
                    { label: "Terminals", value: String(terminals.length || layer.terminalCount || "N/A") },
                    { label: "Homes Passed", value: String(layer.drops?.total ?? "N/A") },
                    { label: "Address", value: job.address || "N/A" },
                    { label: "Cables", value: String(cables.length) },
                    { label: "Drops on map", value: String(dropSites.length) },
                    {
                      label: "CAD detail",
                      value: isEnhanced
                        ? `Enhanced ${new Date(layer.printGeometryEnhancedAt!).toLocaleString()}`
                        : "Not enhanced — use ENHANCE CAD DETAIL on job card",
                    },
                    {
                      label: "Excavation",
                      value: (layer.permittedExcavationMethods || []).join(", ") || "N/A",
                    },
                    { label: "Conduit", value: layer.conduitSize || "N/A" },
                    { label: "Strand", value: layer.strandType || "N/A" },
                  ],
                })
              }
              icon={{
                url: hubIconDataUrl(
                  layer.hubId || "FDH",
                  hubStatus === "planned" ? "#e2e8f0" : STATUS_COLOR[hubStatus]
                ),
                scaledSize: new google.maps.Size(56, 56),
                anchor: new google.maps.Point(28, 28),
              }}
            />

            {terminals.map((t, idx) => {
              const st = statusOf(job.jobId, "terminal", t.label, t.status);
              const pos = termPositions[idx]!;
              const cleared = locateCleared(job, "terminal", t.label, t.locateExpires ?? null);
              const fill = show811Clearance
                ? cleared
                  ? "#16A34A"
                  : "#FFFFFF"
                : TERM_FILL[st];
              const stroke = show811Clearance
                ? cleared
                  ? "#166534"
                  : "#DC2626"
                : INK;
              return (
                <Marker
                  key={`${job.jobId}-term-${idx}`}
                  position={pos}
                  title={`${t.label} (${t.type})`}
                  zIndex={18}
                  onClick={() =>
                    setSelected({
                      job,
                      kind: "terminal",
                      ref: t.label,
                      scope: {
                        kind: "terminal",
                        ref: t.label,
                        hubId: layer.hubId,
                        label: `${t.label}${t.dvftpRange ? ` · ${t.dvftpRange}` : ""}`,
                        terminalRange: t.dvftpRange ?? null,
                      },
                      title: `${t.label} — ${t.type}`,
                      position: pos,
                      status: st,
                      locateCleared: cleared,
                      crewName: t.crewName ?? null,
                      rows: [
                        {
                          label: "Port Count",
                          value: t.portCount != null ? String(t.portCount) : "N/A",
                        },
                        {
                          label: "Footage",
                          value:
                            t.footageLabel ||
                            (t.footageFt != null ? `${t.footageFt}'` : "N/A"),
                        },
                        { label: "DVFTP Range", value: t.dvftpRange || "N/A" },
                        { label: "Code", value: t.code || "N/A" },
                        { label: "Fiber Spec", value: t.fiberSpec || "N/A" },
                        {
                          label: "Addresses",
                          value: (t.addressesServed || []).join(", ") || "N/A",
                        },
                        {
                          label: "Coords",
                          value: `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`,
                        },
                      ],
                    })
                  }
                  icon={
                    showTermLabels
                      ? {
                          url: termIconDataUrl(t.label, fill, stroke),
                          scaledSize: new google.maps.Size(44, 36),
                          anchor: new google.maps.Point(22, 12),
                        }
                      : {
                          path: google.maps.SymbolPath.CIRCLE,
                          fillColor: fill,
                          fillOpacity: 1,
                          strokeColor: stroke,
                          strokeWeight: 2,
                          scale: 7,
                        }
                  }
                />
              );
            })}
          </Fragment>
        );
      })}

      {selected && (
        <InfoWindow position={selected.position} onCloseClick={() => setSelected(null)}>
          <div className="ziply-cad-popup" style={{ color: "#111", fontSize: 12, padding: 4 }}>
            <div
              className="ziply-cad-popup__glow-bar"
              style={{
                background:
                  selected.status === "complete"
                    ? "linear-gradient(90deg,#00E676,#a3e635)"
                    : selected.status === "in_progress"
                      ? "linear-gradient(90deg,#22D3EE,#38bdf8)"
                      : "linear-gradient(90deg,#64748b,#94a3b8)",
              }}
            />
            <h4 style={{ color: STATUS_COLOR[selected.status] }}>{selected.title}</h4>
            <p style={{ margin: "2px 0", color: "#555" }}>
              <strong>WO:</strong> {selected.job.workOrder}
            </p>
            <p style={{ margin: "2px 0", color: "#555" }}>
              <strong>Status:</strong> {selected.status}
              {show811Clearance && (
                <>
                  {" "}
                  · 811 {selected.locateCleared ? "cleared" : "not cleared"}
                </>
              )}
            </p>
            {selected.rows.map((r) => (
              <p key={r.label} style={{ margin: "2px 0", color: "#333" }}>
                <strong>{r.label}:</strong> {r.value}
              </p>
            ))}
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(
                [
                  { st: "planned" as const, label: "○ Planned" },
                  { st: "in_progress" as const, label: "◈ Live" },
                  { st: "complete" as const, label: "● Neon Done" },
                ] as const
              ).map(({ st, label }) => {
                const on = selected.status === st;
                return (
                  <button
                    key={st}
                    type="button"
                    disabled={saving}
                    onClick={() => void applyStatus(selected, st)}
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "5px 8px",
                      borderRadius: 6,
                      border: `1.5px solid ${STATUS_COLOR[st]}`,
                      background: on ? STATUS_COLOR[st] : "#0f172a",
                      color: on ? "#04120a" : STATUS_COLOR[st],
                      cursor: "pointer",
                      boxShadow: on ? `0 0 12px ${STATUS_COLOR[st]}88` : "none",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {selected.kind === "cable" && (
              <button
                type="button"
                onClick={() => {
                  const mo = selected.job.ziplyPrintLayer?.mapObjects;
                  const cable = mo?.cables?.find((c) => c.label === selected.ref);
                  const raw =
                    cable?.path && cable.path.length >= 2
                      ? cable.path
                      : null;
                  if (!raw) {
                    setPathEditMsg("Rebuild plant CAD first so this cable has a path.");
                    return;
                  }
                  setPathEdit({
                    jobId: selected.job.jobId,
                    label: selected.ref,
                    role: cable?.role ?? "lateral",
                    path: pathControlPoints(
                      raw.filter(
                        (p): p is LatLng =>
                          typeof p.lat === "number" && typeof p.lng === "number"
                      )
                    ),
                  });
                  setSelected(null);
                  setPathEditMsg("Drag handles · map-click inserts · Save when matched to print");
                }}
                style={{
                  marginTop: 8,
                  width: "100%",
                  fontSize: 11,
                  fontWeight: 800,
                  padding: 8,
                  background: "linear-gradient(180deg,#fbbf24,#d97706)",
                  color: "#1c1000",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                ✎ Edit path on map
              </button>
            )}
            <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
              <input
                value={crewDraft}
                onChange={(e) => setCrewDraft(e.target.value)}
                placeholder="Crew"
                style={{ flex: 1, fontSize: 11, padding: 4 }}
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveCrew(selected)}
                style={{ fontSize: 10, fontWeight: 700, padding: "4px 8px" }}
              >
                Save crew
              </button>
            </div>
            <button
              type="button"
              onClick={() => openSection811(selected)}
              style={{
                marginTop: 8,
                width: "100%",
                fontSize: 11,
                fontWeight: 700,
                padding: 6,
                background: "#1d4ed8",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              File 811 for section
            </button>
          </div>
        </InfoWindow>
      )}
    </>
  );
}
