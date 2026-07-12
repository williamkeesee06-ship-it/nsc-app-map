/**
 * Feature detail sheet — 5 tabs from Digital Field Operations Platform:
 * info | progress | 811 | permits | photos
 *
 * WA 811 = Utility Notification Center (UNC / utn.com), not 811Assist.
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
  designed: "#94a3b8",
  permitted: "#3498DB",
  ticket_active: "#F1C40F",
  in_progress: "#F39C12",
  placed: "#1ABC9C",
  spliced: "#9B59B6",
  tested: "#2ECC71",
  complete: "#27AE60",
  on_hold: "#E74C3C",
  planned: "#94a3b8",
};

function titleOf(p: Record<string, unknown>): string {
  if (p.type === "terminal") return `Terminal ${p.terminalId ?? ""} — ${p.fiberRange ?? ""}`.trim();
  if (p.type === "feeder" || p.layer === "feeder")
    return `Feeder ${p.cableId ?? p.label ?? ""} (${p.fiberCount ?? "?"}ct)`;
  if (p.type === "distribution") return `Dist. ${p.cableId ?? p.label ?? ""}`;
  if (p.type === "pole") return `Pole ${p.poleId ?? ""} / ${p.owner ?? ""}`;
  if (p.type === "handhole") return `Handhole ${p.hhId ?? ""} — ${p.hhSize ?? ""}`;
  if (p.type === "service_point") return String(p.address ?? "Service point");
  if (p.type === "hub") return String(p.label ?? "FDH H3024");
  if (p.type === "bore") return `Bore ${p.footage ?? ""}' — ${p.installMethod ?? ""}`;
  if (p.type === "drop") return String(p.label ?? p.address ?? "Drop");
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
  const sc = STATUS_COLOR[status] ?? "#64748b";

  return (
    <div style={sheet}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
            {String(p.layer || p.type || "asset")}
          </div>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#15202c", marginTop: 2 }}>
            {titleOf(p)}
          </div>
          <span
            style={{
              display: "inline-block",
              marginTop: 6,
              fontSize: 10,
              fontWeight: 800,
              padding: "2px 8px",
              borderRadius: 999,
              background: sc + "22",
              color: sc,
              border: `1px solid ${sc}`,
            }}
          >
            {status}
          </span>
        </div>
        <button type="button" onClick={onClose} style={xBtn}>
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
              background: tab === t ? "#1d4ed8" : "#f1f5f9",
              color: tab === t ? "#fff" : "#334155",
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 10, maxHeight: 260, overflow: "auto" }}>
        {tab === "info" && <InfoTab p={p} geometry={feature.geometry} />}
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
            Field photo capture attaches to this feature ID. GPS-tag on device
            camera will wire to Storage in Phase 4.
          </div>
        )}
      </div>
    </div>
  );
}

function InfoTab({
  p,
  geometry,
}: {
  p: Record<string, unknown>;
  geometry?: PlatformFeature["geometry"];
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
          <span style={rowK}>{k}</span>
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
  return (
    <div>
      <div style={{ fontSize: 11, color: "#334155", marginBottom: 8 }}>
        Progress: <strong>{Math.round(progressPct * 100)}%</strong> · status editable
        for field / Smartsheet sync later.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {statuses.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onStatusChange?.(s)}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "4px 8px",
              borderRadius: 6,
              border: `1px solid ${STATUS_COLOR[s] ?? "#94a3b8"}`,
              background: status === s ? STATUS_COLOR[s] : "#fff",
              color: status === s ? "#fff" : "#15202c",
              cursor: "pointer",
            }}
          >
            {s}
          </button>
        ))}
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
    <div style={{ fontSize: 11, color: "#334155", lineHeight: 1.45 }}>
      <strong>Washington 811 — Utility Notification Center (UNC)</strong>
      <br />
      Portal:{" "}
      <a href="https://www.utn.com" target="_blank" rel="noreferrer" style={{ color: "#1d4ed8" }}>
        utn.com
      </a>
      <br />
      <br />
      Pre-fill for this asset:
      <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
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
      Automated ticket submit will target UNC APIs (not 811Assist). Until wired, use
      the existing Dig Tickets tab for section-scoped 811.
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
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#15202c" }}>
        Cover-sheet permit matrix (H3024)
      </div>
      {rows.map(([a, r, t]) => (
        <div key={a} style={row}>
          <span style={rowK}>{a}</span>
          <span style={rowV}>
            <strong style={{ color: r === "YES" ? "#15803d" : "#64748b" }}>{r}</strong>
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
  width: "min(400px, calc(100% - 24px))",
  padding: 14,
  borderRadius: 12,
  background: "#fff",
  border: "1px solid #94a3b8",
  boxShadow: "0 12px 36px rgba(0,0,0,0.28)",
};
const xBtn: CSSProperties = {
  border: "1px solid #cbd5e1",
  background: "#f1f5f9",
  borderRadius: 6,
  width: 28,
  height: 28,
  cursor: "pointer",
  fontWeight: 700,
};
const tabsRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  marginTop: 10,
};
const tabBtn: CSSProperties = {
  fontSize: 9,
  fontWeight: 800,
  padding: "5px 8px",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  letterSpacing: "0.04em",
};
const row: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "120px 1fr",
  gap: 8,
  fontSize: 11,
  padding: "4px 0",
  borderBottom: "1px solid #e2e8f0",
};
const rowK: CSSProperties = { color: "#64748b", fontWeight: 600 };
const rowV: CSSProperties = { color: "#15202c", wordBreak: "break-word" };
const muted: CSSProperties = { fontSize: 11, color: "#64748b", lineHeight: 1.45 };
