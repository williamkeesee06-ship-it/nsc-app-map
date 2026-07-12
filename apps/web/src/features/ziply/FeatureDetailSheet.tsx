/**
 * Feature detail sheet — 5 tabs (info | progress | 811 | permits | photos)
 * Dark metal / neon glass aesthetic matching DesignPrintMapOverlay.
 * WA 811 = Utility Notification Center (UNC / utn.com).
 */
import { useState, type CSSProperties } from "react";

export type PlatformFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry?: {
    type: string;
    coordinates: unknown;
  } | null;
};

const TABS = ["info", "progress", "811", "permits", "photos"] as const;
type Tab = (typeof TABS)[number];

const STATUS_COLOR: Record<string, string> = {
  designed: "#38BDF8",
  permitted: "#60A5FA",
  ticket_active: "#FACC15",
  in_progress: "#FB923C",
  placed: "#2DD4BF",
  spliced: "#C084FC",
  tested: "#4ADE80",
  complete: "#22C55E",
  on_hold: "#F87171",
  planned: "#7DD3FC",
};

const LAYER_ACCENT: Record<string, string> = {
  hub: "#3B82F6",
  feeder: "#FF6B2C",
  distribution: "#22D3EE",
  drop: "#A78BFA",
  bore: "#FBBF24",
  terminal: "#C084FC",
  service_point: "#38BDF8",
  pole: "#F87171",
  handhole: "#2DD4BF",
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
  if (p.type === "hub" || p.layer === "hub") return String(p.label ?? "FDH H3024");
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
  const sc = STATUS_COLOR[status] ?? "#38BDF8";
  const layer = String(p.layer || p.type || "asset");
  const accent = LAYER_ACCENT[layer] ?? "#3B82F6";

  return (
    <div
      style={{
        ...sheet,
        borderColor: `${accent}66`,
        boxShadow: `0 20px 60px rgba(0,0,0,0.55), 0 0 40px ${accent}33, inset 0 1px 0 rgba(255,255,255,0.08)`,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div
          style={{
            width: 8,
            alignSelf: "stretch",
            borderRadius: 99,
            background: `linear-gradient(180deg, ${accent}, ${sc})`,
            boxShadow: `0 0 14px ${accent}`,
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
              letterSpacing: "0.14em",
              textShadow: `0 0 12px ${accent}88`,
            }}
          >
            {layer.replace("_", " ")}
          </div>
          <div
            style={{
              fontWeight: 800,
              fontSize: 15,
              color: "#F1F5F9",
              marginTop: 3,
              lineHeight: 1.25,
            }}
          >
            {titleOf(p)}
          </div>
          <span
            style={{
              display: "inline-block",
              marginTop: 8,
              fontSize: 10,
              fontWeight: 800,
              padding: "3px 10px",
              borderRadius: 999,
              background: `${sc}22`,
              color: sc,
              border: `1px solid ${sc}99`,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              boxShadow: `0 0 12px ${sc}33`,
            }}
          >
            {status}
          </span>
        </div>
        <button type="button" onClick={onClose} style={xBtn} aria-label="Close">
          ✕
        </button>
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
                  ? `linear-gradient(135deg, ${accent}, #1E3A8A)`
                  : "rgba(15,23,42,0.8)",
              color: tab === t ? "#F8FAFC" : "#94A3B8",
              borderColor: tab === t ? `${accent}AA` : "rgba(51,65,85,0.8)",
              boxShadow: tab === t ? `0 0 16px ${accent}44` : "none",
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 12, maxHeight: 280, overflow: "auto" }}>
        {tab === "info" && <InfoTab p={p} geometry={feature.geometry} accent={accent} />}
        {tab === "progress" && (
          <ProgressTab
            status={status}
            progressPct={Number(p.progressPct ?? 0)}
            onStatusChange={onStatusChange}
          />
        )}
        {tab === "811" && <Locate811Tab p={p} geometry={feature.geometry} />}
        {tab === "permits" && <PermitsTab />}
        {tab === "photos" && (
          <div style={muted}>
            Field photo capture attaches to this feature ID. GPS-tagged device
            camera will wire to Storage in a later phase.
          </div>
        )}
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
  const skip = new Set(["label", "type", "layer"]);
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
    <div>
      {rows.map(([k, v]) => (
        <div key={k} style={row}>
          <span style={{ ...rowK, color: `${accent}CC` }}>{k}</span>
          <span style={rowV}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressTab({
  status,
  progressPct,
  onStatusChange,
}: {
  status: string;
  progressPct: number;
  onStatusChange?: (s: string) => void;
}) {
  const statuses = [
    "designed",
    "permitted",
    "ticket_active",
    "in_progress",
    "placed",
    "spliced",
    "tested",
    "complete",
    "on_hold",
  ];
  const pct = Math.max(0, Math.min(100, Math.round(progressPct * 100)));
  return (
    <div>
      <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 10 }}>
        Progress pipeline ·{" "}
        <strong style={{ color: "#E2E8F0" }}>{pct}%</strong>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 99,
          background: "#0F172A",
          border: "1px solid #1E293B",
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: `${Math.max(pct, 4)}%`,
            height: "100%",
            borderRadius: 99,
            background: "linear-gradient(90deg, #1D4ED8, #22D3EE)",
            boxShadow: "0 0 12px rgba(34,211,238,0.55)",
          }}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {statuses.map((s) => {
          const c = STATUS_COLOR[s] ?? "#94a3b8";
          const on = status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onStatusChange?.(s)}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "5px 9px",
                borderRadius: 8,
                border: `1px solid ${c}${on ? "" : "66"}`,
                background: on ? c : "rgba(15,23,42,0.9)",
                color: on ? "#0B1220" : "#CBD5E1",
                cursor: "pointer",
                boxShadow: on ? `0 0 14px ${c}66` : "none",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Locate811Tab({
  p,
  geometry,
}: {
  p: Record<string, unknown>;
  geometry?: PlatformFeature["geometry"];
}) {
  return (
    <div style={{ fontSize: 11, color: "#CBD5E1", lineHeight: 1.5 }}>
      <strong style={{ color: "#FACC15" }}>
        Washington 811 — Utility Notification Center (UNC)
      </strong>
      <br />
      Portal:{" "}
      <a
        href="https://www.utn.com"
        target="_blank"
        rel="noreferrer"
        style={{ color: "#38BDF8" }}
      >
        utn.com
      </a>
      <br />
      <br />
      Pre-fill for this asset:
      <ul style={{ margin: "8px 0", paddingLeft: 18, color: "#94A3B8" }}>
        <li>County: Snohomish</li>
        <li>Project: H3024 Lake Stevens</li>
        <li>Asset: {String(p.label || p.cableId || p.terminalId || "—")}</li>
        <li>Print ref: {String(p.printRef || "—")}</li>
        <li>
          Geometry: {geometry?.type ?? "—"}
          {geometry?.type === "Point"
            ? ` (${(geometry.coordinates as number[])[1]?.toFixed(5)}, ${(geometry.coordinates as number[])[0]?.toFixed(5)})`
            : ""}
        </li>
      </ul>
      Automated ticket submit targets UNC (not 811Assist). Until wired, use Dig
      Tickets for section-scoped 811.
    </div>
  );
}

function PermitsTab() {
  const rows = [
    ["City of Lake Stevens", "YES", "ROW"],
    ["WSDOT", "YES", "ROW"],
    ["Snohomish County", "NO", "—"],
    ["Railroad", "NO", "—"],
    ["Pacific Power JPN", "YES", "JPA"],
    ["TCP", "NO", "—"],
    ["Snohomish PUD", "YES", "attachment"],
  ];
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          marginBottom: 8,
          color: "#E2E8F0",
          letterSpacing: "0.04em",
        }}
      >
        Cover-sheet permit matrix (H3024)
      </div>
      {rows.map(([a, r, t]) => (
        <div key={a} style={row}>
          <span style={rowK}>{a}</span>
          <span style={rowV}>
            <strong style={{ color: r === "YES" ? "#4ADE80" : "#64748B" }}>{r}</strong>
            {t !== "—" ? ` · ${t}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

const sheet: CSSProperties = {
  position: "absolute",
  left: 12,
  bottom: 24,
  zIndex: 12,
  width: "min(420px, calc(100% - 24px))",
  padding: 16,
  borderRadius: 16,
  background:
    "linear-gradient(155deg, rgba(15,23,42,0.96) 0%, rgba(8,12,24,0.97) 100%)",
  border: "1px solid rgba(96,165,250,0.35)",
  backdropFilter: "blur(16px)",
  color: "#E2E8F0",
};
const xBtn: CSSProperties = {
  border: "1px solid rgba(71,85,105,0.9)",
  background: "rgba(15,23,42,0.9)",
  color: "#E2E8F0",
  borderRadius: 8,
  width: 30,
  height: 30,
  cursor: "pointer",
  fontWeight: 700,
  flexShrink: 0,
};
const tabsRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 5,
  marginTop: 14,
};
const tabBtn: CSSProperties = {
  fontSize: 9,
  fontWeight: 800,
  padding: "6px 9px",
  borderRadius: 8,
  border: "1px solid",
  cursor: "pointer",
  letterSpacing: "0.06em",
};
const row: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "120px 1fr",
  gap: 8,
  fontSize: 11,
  padding: "5px 0",
  borderBottom: "1px solid rgba(30,41,59,0.9)",
};
const rowK: CSSProperties = {
  color: "#64748B",
  fontWeight: 600,
  textTransform: "lowercase",
};
const rowV: CSSProperties = {
  color: "#E2E8F0",
  wordBreak: "break-word",
  fontWeight: 500,
};
const muted: CSSProperties = {
  fontSize: 11,
  color: "#64748B",
  lineHeight: 1.5,
};
