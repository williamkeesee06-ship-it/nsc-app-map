/**
 * Feature detail sheet — 5 tabs (info | progress | 811 | permits | photos)
 * Royal blue · white · stainless steel · carbon accents (light modern metal).
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
  designed: "#1D4ED8",
  permitted: "#2563EB",
  ticket_active: "#CA8A04",
  in_progress: "#EA580C",
  placed: "#0D9488",
  spliced: "#1E40AF",
  tested: "#16A34A",
  complete: "#15803D",
  on_hold: "#DC2626",
  planned: "#3B82F6",
};

const LAYER_ACCENT: Record<string, string> = {
  hub: "#1D4ED8",
  feeder: "#1E40AF",
  distribution: "#2563EB",
  drop: "#3B82F6",
  bore: "#64748B",
  terminal: "#1D4ED8",
  service_point: "#0EA5E9",
  pole: "#475569",
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
  const sc = STATUS_COLOR[status] ?? "#1D4ED8";
  const layer = String(p.layer || p.type || "asset");
  const accent = LAYER_ACCENT[layer] ?? "#1D4ED8";

  return (
    <div
      style={{
        ...sheet,
        borderColor: `${accent}55`,
        boxShadow: `0 16px 40px rgba(15,23,42,0.16), 0 0 0 1px rgba(255,255,255,0.8) inset, 0 0 24px ${accent}18`,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div
          style={{
            width: 7,
            alignSelf: "stretch",
            borderRadius: 99,
            background: `linear-gradient(180deg, ${accent}, #94A3B8)`,
            boxShadow: `0 0 10px ${accent}55`,
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
              letterSpacing: "0.12em",
            }}
          >
            {layer.replace("_", " ")}
          </div>
          <div
            style={{
              fontWeight: 800,
              fontSize: 15,
              color: "#0F172A",
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
              background: `${sc}14`,
              color: sc,
              border: `1px solid ${sc}55`,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
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
                  ? `linear-gradient(180deg, #3B82F6, #1D4ED8)`
                  : "linear-gradient(180deg, #FFFFFF, #F1F5F9)",
              color: tab === t ? "#FFFFFF" : "#475569",
              borderColor: tab === t ? "#1E40AF" : "#CBD5E1",
              boxShadow:
                tab === t
                  ? "0 3px 10px rgba(29,78,216,0.28)"
                  : "inset 0 1px 0 #FFFFFF",
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
          <span style={{ ...rowK, color: accent }}>{k}</span>
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
      <div style={{ fontSize: 11, color: "#64748B", marginBottom: 10 }}>
        Progress pipeline ·{" "}
        <strong style={{ color: "#0F172A" }}>{pct}%</strong>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 99,
          background: "#E2E8F0",
          border: "1px solid #CBD5E1",
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: `${Math.max(pct, 4)}%`,
            height: "100%",
            borderRadius: 99,
            background: "linear-gradient(90deg, #1D4ED8, #60A5FA)",
          }}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {statuses.map((s) => {
          const c = STATUS_COLOR[s] ?? "#64748B";
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
                border: `1px solid ${on ? c : "#CBD5E1"}`,
                background: on ? c : "#FFFFFF",
                color: on ? "#FFFFFF" : "#334155",
                cursor: "pointer",
                boxShadow: on ? `0 2px 8px ${c}44` : "inset 0 1px 0 #FFFFFF",
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
    <div style={{ fontSize: 11, color: "#334155", lineHeight: 1.5 }}>
      <strong style={{ color: "#1D4ED8" }}>
        Washington 811 — Utility Notification Center (UNC)
      </strong>
      <br />
      Portal:{" "}
      <a
        href="https://www.utn.com"
        target="_blank"
        rel="noreferrer"
        style={{ color: "#1D4ED8", fontWeight: 600 }}
      >
        utn.com
      </a>
      <br />
      <br />
      Pre-fill for this asset:
      <ul style={{ margin: "8px 0", paddingLeft: 18, color: "#64748B" }}>
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
          color: "#0F172A",
          letterSpacing: "0.04em",
        }}
      >
        Cover-sheet permit matrix (H3024)
      </div>
      {rows.map(([a, r, t]) => (
        <div key={a} style={row}>
          <span style={rowK}>{a}</span>
          <span style={rowV}>
            <strong style={{ color: r === "YES" ? "#15803D" : "#94A3B8" }}>{r}</strong>
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
  borderRadius: 14,
  background: "linear-gradient(165deg, #FFFFFF 0%, #F8FAFC 45%, #E8EEF5 100%)",
  border: "1px solid #94A3B8",
  color: "#0F172A",
};
const xBtn: CSSProperties = {
  border: "1px solid #CBD5E1",
  background: "linear-gradient(180deg, #FFFFFF, #F1F5F9)",
  color: "#334155",
  borderRadius: 8,
  width: 30,
  height: 30,
  cursor: "pointer",
  fontWeight: 700,
  flexShrink: 0,
  boxShadow: "inset 0 1px 0 #FFFFFF",
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
  borderBottom: "1px solid #E2E8F0",
};
const rowK: CSSProperties = {
  color: "#64748B",
  fontWeight: 600,
  textTransform: "lowercase",
};
const rowV: CSSProperties = {
  color: "#0F172A",
  wordBreak: "break-word",
  fontWeight: 500,
};
const muted: CSSProperties = {
  fontSize: 11,
  color: "#64748B",
  lineHeight: 1.5,
};
