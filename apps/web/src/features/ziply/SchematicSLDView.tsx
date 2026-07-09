import { useState, useEffect, useRef, useCallback } from "react";
import type { DrawingObject } from "@nsc/types";
import { api } from "../../lib/api.js";
import { useAuth } from "../auth/authContext.js";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LatLng { lat: number; lng: number; }

type NodeType = "fdh" | "fosc" | "mst" | "drop" | "cable";

interface SLDNode {
  id: string;
  type: NodeType;
  label: string;
  subLabel?: string;
  status?: string; // "complete" | "pending" | undefined
  children: SLDNode[];
  depth: number; // column index
  x: number;
  y: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const SNAP_THRESHOLD_DEG = 0.0001; // ~10m in degrees
const NODE_W = 120;
const NODE_H = 56;
const COL_GAP = 90;
const ROW_GAP = 72;

// ─── Geometry helpers ─────────────────────────────────────────────────────────
function latLngDist(a: LatLng, b: LatLng) {
  return Math.sqrt((a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2);
}

function polylineEndpoints(vertices: LatLng[]): [LatLng, LatLng] | null {
  if (vertices.length < 2) return null;
  return [vertices[0], vertices[vertices.length - 1]];
}

// ─── Topology Parser ──────────────────────────────────────────────────────────
function buildTopology(objects: DrawingObject[]): SLDNode[] {
  // Classify objects
  const cabinets = objects.filter(
    (o) =>
      (o.tool === "cabinet_new" || o.tool === "cabinet_removed") &&
      "position" in o
  );
  const splices = objects.filter(
    (o) => o.tool === "splice" && "position" in o
  );
  const pedsAndHHs = objects.filter(
    (o) =>
      (o.tool === "ped_new" ||
        o.tool === "ped_removed" ||
        o.tool === "hh_new" ||
        o.tool === "hh_removed") &&
      "position" in o
  );
  const cables = objects.filter(
    (o) =>
      (o.tool === "placed_cable" || o.tool === "line") &&
      "vertices" in o
  );

  // Build raw tree
  const roots: SLDNode[] = [];

  // If no cabinets, try to create synthetic root from cables
  const sourcePoints = cabinets.length > 0 ? cabinets : [];

  if (sourcePoints.length === 0 && cables.length > 0) {
    // No cabinet — create a synthetic FDH root node
    const firstCable = cables.find((c) => "vertices" in c && (c as any).vertices?.length >= 2);
    const startPt = firstCable && "vertices" in firstCable
      ? (firstCable as any).vertices[0] as LatLng
      : { lat: 0, lng: 0 };

    const fdhNode: SLDNode = {
      id: "fdh-synthetic",
      type: "fdh",
      label: "FDH Cabinet",
      subLabel: "Source Hub",
      children: [],
      depth: 0,
      x: 0,
      y: 0,
    };
    roots.push(fdhNode);
    buildChildren(fdhNode, startPt, cables, splices, pedsAndHHs, new Set(), 1);
  } else {
    sourcePoints.forEach((cab, i) => {
      if (!("position" in cab)) return;
      const cabPos = (cab as any).position as LatLng;
      const status = (cab.style as any)?.ziplyStatus;
      const fdhNode: SLDNode = {
        id: cab.id,
        type: "fdh",
        label: cab.style.userLabel || `FDH Cabinet ${i + 1}`,
        subLabel: "Distribution Hub",
        status,
        children: [],
        depth: 0,
        x: 0,
        y: 0,
      };
      roots.push(fdhNode);
      buildChildren(fdhNode, cabPos, cables, splices, pedsAndHHs, new Set([cab.id]), 1);
    });
  }

  // Layout positions
  layoutNodes(roots);

  return roots;
}

function buildChildren(
  parent: SLDNode,
  parentPos: LatLng,
  cables: DrawingObject[],
  splices: DrawingObject[],
  pedsAndHHs: DrawingObject[],
  visited: Set<string>,
  depth: number
) {
  if (depth > 5) return; // max depth safety

  // Find cables near parent position
  for (const cable of cables) {
    if (!("vertices" in cable) || visited.has(cable.id)) continue;
    const endpoints = polylineEndpoints((cable as any).vertices as LatLng[]);
    if (!endpoints) continue;
    const [start, end] = endpoints;

    // Check which end snaps to parent
    const startSnaps = latLngDist(start, parentPos) < SNAP_THRESHOLD_DEG;
    const endSnaps = latLngDist(end, parentPos) < SNAP_THRESHOLD_DEG;
    if (!startSnaps && !endSnaps) continue;

    visited.add(cable.id);
    const farEnd = startSnaps ? end : start;
    const status = (cable.style as any)?.ziplyStatus;

    // Calculate approximate length in feet
    const verts = (cable as any).vertices as LatLng[];
    let totalDistDeg = 0;
    for (let i = 0; i < verts.length - 1; i++) {
      totalDistDeg += latLngDist(verts[i], verts[i + 1]);
    }
    const approxFt = Math.round(totalDistDeg * 364_000);

    // Find what's at the far end: splice, ped/hh, or drop
    const nearSplice = splices.find(
      (s) => "position" in s && latLngDist((s as any).position as LatLng, farEnd) < SNAP_THRESHOLD_DEG * 3
    );
    const nearPed = pedsAndHHs.find(
      (p) => "position" in p && latLngDist((p as any).position as LatLng, farEnd) < SNAP_THRESHOLD_DEG * 3
    );

    let childNode: SLDNode;
    if (nearSplice && !visited.has(nearSplice.id)) {
      visited.add(nearSplice.id);
      childNode = {
        id: nearSplice.id,
        type: "fosc",
        label: nearSplice.style.userLabel || "Splice Closure",
        subLabel: `~${approxFt} ft`,
        status: (nearSplice.style as any)?.ziplyStatus,
        children: [],
        depth,
        x: 0,
        y: 0,
      };
      buildChildren(childNode, farEnd, cables, splices, pedsAndHHs, visited, depth + 1);
    } else if (nearPed && !visited.has(nearPed.id)) {
      visited.add(nearPed.id);
      childNode = {
        id: nearPed.id,
        type: "mst",
        label: nearPed.style.userLabel || (nearPed.tool.startsWith("ped") ? "Terminal" : "Hand Hole"),
        subLabel: `~${approxFt} ft`,
        status: (nearPed.style as any)?.ziplyStatus,
        children: [],
        depth,
        x: 0,
        y: 0,
      };
      buildChildren(childNode, farEnd, cables, splices, pedsAndHHs, visited, depth + 1);
    } else {
      // End-point drop
      childNode = {
        id: cable.id + "-drop",
        type: "drop",
        label: cable.style.userLabel || "Service Drop",
        subLabel: `~${approxFt} ft`,
        status,
        children: [],
        depth,
        x: 0,
        y: 0,
      };
    }

    parent.children.push(childNode);
  }
}

function layoutNodes(roots: SLDNode[]) {
  // Flatten by depth for vertical centering
  const byDepth: SLDNode[][] = [];
  function traverse(node: SLDNode) {
    if (!byDepth[node.depth]) byDepth[node.depth] = [];
    byDepth[node.depth].push(node);
    node.children.forEach(traverse);
  }
  roots.forEach(traverse);

  // Assign y positions per depth column
  byDepth.forEach((nodesAtDepth) => {
    const totalH = nodesAtDepth.length * (NODE_H + ROW_GAP) - ROW_GAP;
    nodesAtDepth.forEach((node, i) => {
      node.x = node.depth * (NODE_W + COL_GAP);
      node.y = i * (NODE_H + ROW_GAP);
      // Center vertically
      node.y += Math.max(0, (roots.length * (NODE_H + ROW_GAP) - totalH) / 2);
    });
  });
}

function collectAllNodes(roots: SLDNode[]): SLDNode[] {
  const all: SLDNode[] = [];
  function traverse(n: SLDNode) {
    all.push(n);
    n.children.forEach(traverse);
  }
  roots.forEach(traverse);
  return all;
}

function collectEdges(roots: SLDNode[]): Array<{ from: SLDNode; to: SLDNode }> {
  const edges: Array<{ from: SLDNode; to: SLDNode }> = [];
  function traverse(n: SLDNode) {
    n.children.forEach((child) => {
      edges.push({ from: n, to: child });
      traverse(child);
    });
  }
  roots.forEach(traverse);
  return edges;
}

// ─── Node style maps ──────────────────────────────────────────────────────────
const NODE_CONFIG: Record<NodeType, { icon: string; color: string; glow: string; bg: string; label: string }> = {
  fdh: {
    icon: "⬡",
    color: "#00d4ff",
    glow: "rgba(0,212,255,0.6)",
    bg: "rgba(0,212,255,0.08)",
    label: "FDH",
  },
  fosc: {
    icon: "◈",
    color: "#a855f7",
    glow: "rgba(168,85,247,0.6)",
    bg: "rgba(168,85,247,0.08)",
    label: "FOSC",
  },
  mst: {
    icon: "▣",
    color: "#22c55e",
    glow: "rgba(34,197,94,0.6)",
    bg: "rgba(34,197,94,0.08)",
    label: "MST",
  },
  drop: {
    icon: "⌂",
    color: "#f59e0b",
    glow: "rgba(245,158,11,0.6)",
    bg: "rgba(245,158,11,0.08)",
    label: "DROP",
  },
  cable: {
    icon: "—",
    color: "#6b7280",
    glow: "rgba(107,114,128,0.4)",
    bg: "rgba(107,114,128,0.05)",
    label: "CABLE",
  },
};

const STATUS_COLOR: Record<string, { color: string; glow: string }> = {
  Complete: { color: "#22c55e", glow: "rgba(34,197,94,0.5)" },
  complete: { color: "#22c55e", glow: "rgba(34,197,94,0.5)" },
  placed: { color: "#00d4ff", glow: "rgba(0,212,255,0.5)" },
  pending: { color: "#f59e0b", glow: "rgba(245,158,11,0.5)" },
  planned: { color: "#6b7280", glow: "rgba(107,114,128,0.3)" },
};

// ─── Main Component ───────────────────────────────────────────────────────────
interface SchematicSLDViewProps {
  jobId: string;
}

export default function SchematicSLDView({ jobId }: SchematicSLDViewProps) {
  const { username, isManager } = useAuth();
  const [nodes, setNodes] = useState<SLDNode[]>([]);
  const [edges, setEdges] = useState<Array<{ from: SLDNode; to: SLDNode }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 40, y: 30 });
  const [scale, setScale] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [svgSize, setSvgSize] = useState({ w: 800, h: 500 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Load drawing objects
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const owner = isManager ? "*" : (username ?? undefined);
    api
      .getDrawing(jobId, owner)
      .then((doc) => {
        if (cancelled) return;
        const objects: DrawingObject[] = (doc as any).objects ?? [];
        const roots = buildTopology(objects);
        const allNodes = collectAllNodes(roots);
        const allEdges = collectEdges(roots);

        setNodes(allNodes);
        setEdges(allEdges);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Failed to load drawings");
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [jobId, username, isManager]);

  // Observe container size
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSvgSize({ w: width, h: height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Pan handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!panStart.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setPan({ x: panStart.current.px + dx, y: panStart.current.py + dy });
  }, []);

  const onMouseUp = useCallback(() => { panStart.current = null; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.min(2, Math.max(0.3, s - e.deltaY * 0.001)));
  }, []);

  if (loading) {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <div style={{ color: "#00d4ff", fontSize: 11, letterSpacing: "0.1em", marginTop: 12 }}>
          ANALYZING FIBER TOPOLOGY...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.center}>
        <div style={{ color: "#ff2d4a", fontSize: 11 }}>⚠ {error}</div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div style={styles.center}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📡</div>
        <div style={{ color: "#6b7280", fontSize: 11, textAlign: "center", lineHeight: 1.6 }}>
          No fiber topology detected.<br />
          <span style={{ color: "#374151" }}>Draw cables, splice closures, and terminals<br />on the map to generate the SLD.</span>
        </div>
      </div>
    );
  }

  // Compute SVG viewBox based on node extents
  const maxX = Math.max(...nodes.map((n) => n.x + NODE_W)) + 40;
  const maxY = Math.max(...nodes.map((n) => n.y + NODE_H)) + 40;

  return (
    <div
      ref={containerRef}
      style={styles.container}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      {/* Legend */}
      <div style={styles.legend}>
        {Object.entries(NODE_CONFIG).filter(([k]) => k !== "cable").map(([type, cfg]) => (
          <div key={type} style={styles.legendItem}>
            <span style={{ color: cfg.color, textShadow: `0 0 6px ${cfg.glow}`, fontSize: 12 }}>{cfg.icon}</span>
            <span style={{ color: "#9ca3af", fontSize: 9, letterSpacing: "0.06em" }}>{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* Zoom controls */}
      <div style={styles.zoomControls}>
        <button style={styles.zoomBtn} onClick={() => setScale((s) => Math.min(2, s + 0.15))}>+</button>
        <span style={{ color: "#4b5563", fontSize: 9 }}>{Math.round(scale * 100)}%</span>
        <button style={styles.zoomBtn} onClick={() => setScale((s) => Math.max(0.3, s - 0.15))}>−</button>
        <button style={{ ...styles.zoomBtn, fontSize: 8 }} onClick={() => { setScale(1); setPan({ x: 40, y: 30 }); }}>⌂</button>
      </div>

      <svg
        ref={svgRef}
        width={svgSize.w}
        height={svgSize.h}
        style={{ cursor: panStart.current ? "grabbing" : "grab", userSelect: "none" }}
      >
        <defs>
          {/* Glow filters for each node type */}
          {Object.entries(NODE_CONFIG).map(([type, cfg]) => (
            <filter key={type} id={`glow-${type}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
              <feColorMatrix in="blur" type="matrix" values={`0 0 0 0 ${hexToRGBComponents(cfg.color)} 0 0 0 0.7 0`} result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
          <filter id="glow-edge" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="rgba(0,212,255,0.5)" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
          {/* Grid background */}
          <GridBackground width={maxX + 200} height={maxY + 200} />

          {/* Edges */}
          {edges.map((edge, i) => {
            const fromX = edge.from.x + NODE_W;
            const fromY = edge.from.y + NODE_H / 2;
            const toX = edge.to.x;
            const toY = edge.to.y + NODE_H / 2;
            const midX = (fromX + toX) / 2;
            const isHovered = hoveredId === edge.from.id || hoveredId === edge.to.id;
            const toStatus = edge.to.status;
            const edgeColor = toStatus
              ? (STATUS_COLOR[toStatus]?.color ?? "rgba(0,212,255,0.3)")
              : "rgba(0,212,255,0.25)";
            const edgeGlow = toStatus
              ? (STATUS_COLOR[toStatus]?.glow ?? "rgba(0,212,255,0.2)")
              : "rgba(0,212,255,0.1)";

            return (
              <g key={i}>
                {/* Glow path */}
                <path
                  d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
                  fill="none"
                  stroke={edgeColor}
                  strokeWidth={isHovered ? 6 : 4}
                  strokeOpacity={0.25}
                  filter="url(#glow-edge)"
                />
                {/* Main path */}
                <path
                  d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
                  fill="none"
                  stroke={edgeColor}
                  strokeWidth={isHovered ? 2 : 1.5}
                  strokeDasharray={toStatus === "pending" || toStatus === "planned" ? "6 4" : undefined}
                  markerEnd="url(#arrowhead)"
                />
                {/* Distance label on edge */}
                {edge.to.subLabel && (
                  <text
                    x={midX}
                    y={(fromY + toY) / 2 - 6}
                    textAnchor="middle"
                    fill="#4b5563"
                    fontSize={8}
                    fontFamily="monospace"
                    letterSpacing="0.05em"
                  >
                    {edge.to.subLabel}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const cfg = NODE_CONFIG[node.type];
            const isHovered = hoveredId === node.id;
            const statusStyle = node.status ? STATUS_COLOR[node.status] : null;
            const borderColor = statusStyle ? statusStyle.color : cfg.color;
            const glowColor = statusStyle ? statusStyle.glow : cfg.glow;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{ cursor: "pointer" }}
              >
                {/* Glow rect */}
                <rect
                  x={-3} y={-3}
                  width={NODE_W + 6} height={NODE_H + 6}
                  rx={10}
                  fill="none"
                  stroke={glowColor}
                  strokeWidth={isHovered ? 4 : 2}
                  opacity={isHovered ? 0.9 : 0.4}
                  filter={`url(#glow-${node.type})`}
                />
                {/* Background */}
                <rect
                  x={0} y={0}
                  width={NODE_W} height={NODE_H}
                  rx={8}
                  fill={isHovered ? `${cfg.bg.replace("0.08", "0.18")}` : cfg.bg}
                  stroke={borderColor}
                  strokeWidth={1.5}
                />

                {/* Type badge */}
                <rect x={0} y={0} width={NODE_W} height={16} rx={8} fill={borderColor} opacity={0.15} />
                <rect x={0} y={8} width={NODE_W} height={8} fill={borderColor} opacity={0.15} />
                <text
                  x={NODE_W / 2} y={12}
                  textAnchor="middle"
                  fill={borderColor}
                  fontSize={8}
                  fontWeight={700}
                  fontFamily="monospace"
                  letterSpacing="0.1em"
                >
                  {cfg.label}
                </text>

                {/* Icon */}
                <text
                  x={14} y={36}
                  fill={borderColor}
                  fontSize={14}
                  fontFamily="monospace"
                  style={{ textShadow: `0 0 8px ${glowColor}` }}
                >
                  {cfg.icon}
                </text>

                {/* Label */}
                <text
                  x={32} y={30}
                  fill="#e5e7eb"
                  fontSize={9}
                  fontWeight={700}
                  fontFamily="'Inter', system-ui, sans-serif"
                  letterSpacing="0.02em"
                >
                  {truncate(node.label, 13)}
                </text>

                {/* Status pill */}
                {node.status && (
                  <g>
                    <rect
                      x={32} y={34}
                      width={Math.min(node.status.length * 5.5 + 8, NODE_W - 36)}
                      height={12}
                      rx={6}
                      fill={borderColor}
                      opacity={0.2}
                    />
                    <text
                      x={36} y={43}
                      fill={borderColor}
                      fontSize={7}
                      fontWeight={700}
                      fontFamily="monospace"
                      letterSpacing="0.06em"
                    >
                      {node.status.toUpperCase()}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// ─── Grid background ──────────────────────────────────────────────────────────
function GridBackground({ width, height }: { width: number; height: number }) {
  return (
    <g opacity={0.06}>
      {Array.from({ length: Math.ceil(height / 40) }).map((_, i) => (
        <line
          key={`h${i}`}
          x1={-20} y1={i * 40}
          x2={width} y2={i * 40}
          stroke="#00d4ff" strokeWidth={0.5}
        />
      ))}
      {Array.from({ length: Math.ceil(width / 40) }).map((_, i) => (
        <line
          key={`v${i}`}
          x1={i * 40} y1={-20}
          x2={i * 40} y2={height}
          stroke="#00d4ff" strokeWidth={0.5}
        />
      ))}
    </g>
  );
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function truncate(str: string, maxLen: number) {
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

function hexToRGBComponents(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return `${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  container: {
    position: "relative" as const,
    width: "100%",
    height: "100%",
    background: "linear-gradient(135deg, #0a0e1a 0%, #0d1524 50%, #0a1020 100%)",
    overflow: "hidden",
    borderRadius: 4,
  },
  center: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    gap: 8,
    background: "linear-gradient(135deg, #0a0e1a 0%, #0d1524 100%)",
  },
  spinner: {
    width: 24,
    height: 24,
    border: "2px solid rgba(0,212,255,0.15)",
    borderTop: "2px solid #00d4ff",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  legend: {
    position: "absolute" as const,
    top: 10,
    left: 10,
    display: "flex",
    flexDirection: "column" as const,
    gap: 5,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(6px)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: "8px 10px",
    zIndex: 10,
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  zoomControls: {
    position: "absolute" as const,
    bottom: 14,
    right: 14,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 4,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(6px)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: "6px",
    zIndex: 10,
  },
  zoomBtn: {
    background: "rgba(0,212,255,0.08)",
    border: "1px solid rgba(0,212,255,0.25)",
    color: "#00d4ff",
    borderRadius: 4,
    width: 24,
    height: 24,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
  },
} as const;
