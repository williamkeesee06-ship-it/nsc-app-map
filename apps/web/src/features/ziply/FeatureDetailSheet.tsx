/**
 * As-Built Vector Tracker Panel
 *
 * Premium Dark Neon Theme with Glassmorphism for the interactive As-Built engine.
 */
import { useState, type CSSProperties } from "react";

export type PlatformFeature = {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown>;
  geometry?: {
    type: string;
    coordinates: unknown;
  } | null;
};

const TABS = ["info", "build status", "811", "photos"] as const;
type Tab = (typeof TABS)[number];

const STATUS_COLOR: Record<string, string> = {
  designed: "#64748B",
  permitted: "#2563EB",
  conduit_placed: "#0EA5E9",
  fiber_placed: "#F59E0B",
  spliced: "#A855F7",
  live: "#39FF14", // Neon Green!
  tested: "#16A34A",
  complete: "#15803D",
  on_hold: "#DC2626",
  planned: "#3B82F6",
};

const LAYER_ACCENT: Record<string, string> = {
  hub: "#1D4ED8",
  feeder: "#39FF14",
  distribution: "#0EA5E9",
  drop: "#F59E0B",
  bore: "#64748B",
  terminal: "#A855F7",
  service_point: "#0EA5E9",
  pole: "#94A3B8",
  handhole: "#334155",
};

function titleOf(p: Record<string, unknown>): string {
  if (p.type === "terminal" || p.layer === "terminal")
    return `Terminal ${p.terminalId ?? ""} — ${p.fiberRange ?? ""}`.trim();
  if (p.type === "feeder" || p.layer === "feeder")
    return `Feeder ${p.cableId ?? p.label ?? ""} (${p.fiberCount ?? "?"}ct)`;
  if (p.type === "distribution" || p.layer === "distribution")
    return `Dist. ${p.cableId ?? p.label ?? ""}`;
  if (p.type === "pole" || p.layer === "pole")
    return `Pole ${p.poleId ?? ""} / ${p.owner ?? ""}`;
  if (p.type === "handhole" || p.layer === "handhole")
    return `Handhole ${p.hhId ?? ""} — ${p.hhSize ?? ""}`;
  if (p.type === "service_point" || p.layer === "service_point")
    return String(p.address ?? "Service point");
  if (p.type === "hub" || p.layer === "hub") return String(p.label ?? "Hub");
  if (p.type === "bore" || p.layer === "bore")
    return `Bore ${p.footage ?? ""}' — ${p.installMethod ?? ""}`;
  if (p.type === "drop" || p.layer === "drop")
    return String(p.label ?? p.address ?? "Drop");
  return String(p.label ?? "Network element");
}

interface Props {
  feature: PlatformFeature;
  onClose: () => void;
  onStatusChange?: (status: string) => void;
}

export default function FeatureDetailSheet({ feature, onClose, onStatusChange }: Props) {
  const [tab, setTab] = useState<Tab>("info");
  const p = feature.properties ?? {};
  const status = String(p.status ?? "designed");
  const sc = STATUS_COLOR[status] ?? "#39FF14";
  const layer = String(p.layer || p.type || "asset");
  const accent = LAYER_ACCENT[layer] ?? "#39FF14";

  return (
    <div
      style={{
        ...sheet,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div
          style={{
            width: 8,
            alignSelf: "stretch",
            borderRadius: 99,
            background: `linear-gradient(180deg, ${sc}, #E2E8F0)`,
            boxShadow: `0 0 15px ${sc}44`,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: accent,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
            }}
          >
            {layer.replace("_", " ")}
          </div>
          <div
            style={{
              fontWeight: 800,
              fontSize: 16,
              color: "#0F172A",
              marginTop: 4,
              lineHeight: 1.3,
            }}
          >
            {titleOf(p)}
          </div>
          <span
            style={{
              display: "inline-block",
              marginTop: 10,
              fontSize: 10,
              fontWeight: 800,
              padding: "4px 12px",
              borderRadius: 999,
              background: `${sc}11`,
              color: sc,
              border: `1px solid ${sc}44`,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {status.replace("_", " ")}
          </span>
        </div>
      </div>

      <div style={tabsRow}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              ...tabBtn,
              background:
                tab === t
                  ? `#F1F5F9`
                  : "transparent",
              color: tab === t ? "#0F172A" : "#64748B",
              borderColor: tab === t ? "#E2E8F0" : "transparent",
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16, maxHeight: 300, overflow: "auto" }}>
        {tab === "info" && <InfoTab p={p} geometry={feature.geometry} accent={accent} />}
        {tab === "build status" && (
          <ProgressTab status={status} onStatusChange={onStatusChange} />
        )}
        {tab === "811" && <div style={muted}>811 Locate Ticket data links here.</div>}
        {tab === "photos" && <div style={muted}>Field photo capture gallery.</div>}
      </div>
    </div>
  );
}

function InfoTab({
  p,
  geometry,
  accent,
}: {
  p: Record<string, unknown>;
  geometry?: PlatformFeature["geometry"];
  accent: string;
}) {
  const rows: Array<[string, string]> = [];
  const skip = new Set(["label", "type", "layer", "status"]);
  for (const [k, v] of Object.entries(p)) {
    if (skip.has(k) || v == null || v === "") continue;
    if (Array.isArray(v)) rows.push([k, v.join(", ")]);
    else if (typeof v !== "object") rows.push([k, String(v)]);
  }
  if (geometry?.type === "Point" && Array.isArray(geometry.coordinates)) {
    const [lng, lat] = geometry.coordinates as [number, number];
    rows.push(["lat", Number(lat).toFixed(6)]);
    rows.push(["lng", Number(lng).toFixed(6)]);
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={row}>
          <span style={{ ...rowK, color: "#94A3B8" }}>{k}</span>
          <span style={rowV}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressTab({
  status,
  onStatusChange,
}: {
  status: string;
  onStatusChange?: (s: string) => void;
}) {
  const stages = [
    { key: "designed", label: "Designed & Engineered" },
    { key: "conduit_placed", label: "Conduit Placed" },
    { key: "fiber_placed", label: "Fiber Placed" },
    { key: "spliced", label: "Spliced" },
    { key: "live", label: "Live Network" },
  ];

  const currentIndex = stages.findIndex((s) => s.key === status);
  
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        Construction Phases
      </div>
      {stages.map((stage, i) => {
        const isPast = i <= currentIndex;
        const isCurrent = i === currentIndex;
        const c = STATUS_COLOR[stage.key] ?? "#39FF14";
        
        return (
          <button
            key={stage.key}
            type="button"
            onClick={() => onStatusChange?.(stage.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 12,
              border: `1px solid ${isCurrent ? c : isPast ? "#E2E8F0" : "#F1F5F9"}`,
              background: isCurrent ? `${c}11` : isPast ? "#F8FAFC" : "transparent",
              cursor: "pointer",
              transition: "all 0.2s",
              textAlign: "left",
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: `2px solid ${isPast ? c : "#CBD5E1"}`,
                background: isPast ? c : "transparent",
                display: "grid",
                placeItems: "center",
                boxShadow: isCurrent ? `0 0 10px ${c}44` : "none",
              }}
            >
              {isPast && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              )}
            </div>
            <div style={{
              flex: 1,
              fontSize: 13,
              fontWeight: 700,
              color: isCurrent ? "#0F172A" : isPast ? "#475569" : "#94A3B8",
            }}>
              {stage.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

const sheet: CSSProperties = {
  width: "100%",
  padding: "20px 16px",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  display: "flex",
  flexDirection: "column",
};

const tabsRow: CSSProperties = {
  display: "flex",
  gap: 6,
  marginTop: 20,
  borderBottom: "1px solid #E2E8F0",
  paddingBottom: 10,
};

const tabBtn: CSSProperties = {
  flex: 1,
  padding: "8px 4px",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.08em",
  borderRadius: 8,
  border: "1px solid transparent",
  cursor: "pointer",
  transition: "all 0.2s",
};

const row: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "100px 1fr",
  gap: 12,
  padding: "8px 12px",
  background: "#F8FAFC",
  borderRadius: 8,
  border: "1px solid #E2E8F0",
  alignItems: "center",
};

const rowK: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const rowV: CSSProperties = {
  fontSize: 13,
  color: "#334155",
  fontWeight: 500,
  wordBreak: "break-all",
};

const xBtn: CSSProperties = {
  display: "none",
};

const muted: CSSProperties = {
  fontSize: 12,
  color: "#64748B",
  lineHeight: 1.5,
  padding: 16,
  textAlign: "center",
  background: "#F8FAFC",
  borderRadius: 12,
  border: "1px dashed #E2E8F0",
};
