/**
 * Ziply Print Studio — dual-pane masterpiece view:
 * left: engineering print PDF/image pages
 * right: plant inventory with live status + pan-to-map
 */
import { useEffect, useMemo, useState } from "react";
import type { Job, ZiplyObjectStatus } from "@nsc/types";
import { api } from "../../lib/api.js";
import {
  computePlantProgress,
  emitZiplyPathEditRequest,
  emitZiplyPlantSelect,
  getZiplyPrintAnchor,
  listZiplyPrintFiles,
  formatBytes,
  type ZiplyPlantSelection,
} from "./ziplyUtils.js";

interface Props {
  job: Job;
  onClose: () => void;
}

const STATUS_COLOR: Record<ZiplyObjectStatus, string> = {
  planned: "#64748b",
  in_progress: "#22D3EE",
  complete: "#00E676",
};

export default function ZiplyPrintStudio({ job, onClose }: Props) {
  const files = listZiplyPrintFiles(job);
  const [fileIdx, setFileIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mapSel, setMapSel] = useState<ZiplyPlantSelection | null>(null);
  const [callout, setCallout] = useState<string | null>(null);
  const [sheetHint, setSheetHint] = useState<number | null>(null);
  const mo = job.ziplyPrintLayer?.mapObjects;
  const active = files[fileIdx] ?? null;
  const anchor = getZiplyPrintAnchor(job);

  const inventory = useMemo(() => {
    const cables = mo?.cables ?? [];
    const terminals = mo?.terminals ?? [];
    const drops = mo?.dropSites ?? [];
    const p = computePlantProgress(job);
    return {
      cables,
      terminals,
      drops,
      complete: p.complete,
      progress: p.inProgress,
      pct: p.progressPct,
      footageNote:
        p.footagePct != null && p.totalFt > 0
          ? `${Math.round(p.completeFt)}' / ${Math.round(p.totalFt)}'`
          : null,
      mainline: mo?.mainlineStreet ?? null,
      backbonePts: mo?.backbonePath?.length ?? 0,
    };
  }, [mo, job]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onMapSel = (e: Event) => {
      const d = (e as CustomEvent<ZiplyPlantSelection | null>).detail;
      if (d && d.jobId === job.jobId) {
        setMapSel(d);
        // Resolve callout from plant objects
        const mo2 = job.ziplyPrintLayer?.mapObjects;
        if (d.kind === "cable") {
          const c = mo2?.cables?.find((x) => x.label === d.ref || x.toTerminal === d.ref);
          if (c) {
            setCallout(
              [
                c.label,
                c.role,
                c.fiberCount,
                c.buildType,
                c.lengthFt != null ? `${c.lengthFt}'` : null,
                c.sheetPage != null ? `Sheet p${c.sheetPage}` : null,
                c.side ? `side ${c.side}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            );
            if (c.sheetPage != null) setSheetHint(c.sheetPage);
          }
        } else if (d.kind === "terminal") {
          const t = mo2?.terminals?.find((x) => x.label === d.ref);
          if (t) {
            setCallout(
              [
                t.label,
                t.type,
                t.footageLabel || (t.footageFt != null ? `${t.footageFt}'` : null),
                (t.addressesServed || []).slice(0, 2).join(", "),
                t.sheetPage != null ? `Sheet p${t.sheetPage}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            );
            if (t.sheetPage != null) setSheetHint(t.sheetPage);
          }
        } else {
          setCallout(d.label || "Hub / FDH");
        }
      } else if (!d) {
        setMapSel(null);
        setCallout(null);
      }
    };
    const onPage = (e: Event) => {
      const d = (e as CustomEvent<{ jobId: string; sheetPage: number; label?: string }>).detail;
      if (d?.jobId === job.jobId && d.sheetPage != null) {
        setSheetHint(d.sheetPage);
        // Multi-file: jump file index if names include page; else keep PDF and show hint
        if (files.length > 1 && d.sheetPage - 1 < files.length) {
          setFileIdx(Math.max(0, Math.min(files.length - 1, d.sheetPage - 1)));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("nsc:ziply-plant-select", onMapSel as EventListener);
    window.addEventListener("nsc:ziply-print-page", onPage as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("nsc:ziply-plant-select", onMapSel as EventListener);
      window.removeEventListener("nsc:ziply-print-page", onPage as EventListener);
    };
  }, [onClose, job.jobId, job.ziplyPrintLayer, files.length]);

  const panTo = (lat: number, lng: number) => {
    window.dispatchEvent(
      new CustomEvent("nsc:pan-to", {
        detail: { center: { lat, lng }, zoom: 18 },
      })
    );
  };

  const selectObject = (
    kind: "hub" | "terminal" | "cable",
    ref: string,
    label: string,
    lat?: number | null,
    lng?: number | null
  ) => {
    const sel: ZiplyPlantSelection = { jobId: job.jobId, kind, ref, label };
    setMapSel(sel);
    emitZiplyPlantSelect(sel);
    if (lat != null && lng != null) panTo(lat, lng);
  };

  const rebuildPlant = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.enhanceZiplyPrint(job.jobId);
      if (!r.enhanced) {
        setMsg(`Rebuild failed: ${r.reason}`);
      } else {
        setMsg(
          `Plant rebuilt — ${r.cablesPathed} paths · ${r.terminalsGeocoded} terminals · ${r.dropsPlaced} drops`
        );
        window.dispatchEvent(new Event("nsc:jobs-reload"));
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Rebuild failed");
    } finally {
      setBusy(false);
    }
  };

  const setObjectStatus = async (
    kind: "hub" | "terminal" | "cable",
    ref: string,
    status: ZiplyObjectStatus
  ) => {
    try {
      await api.updateZiplyObjectStatus(job.jobId, { kind, ref, status });
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Print Studio"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(2, 6, 12, 0.72)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          flex: 1,
          maxWidth: 1400,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.15fr) minmax(320px, 0.85fr)",
          gap: 0,
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(0,230,118,0.35)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.65), 0 0 40px rgba(0,230,118,0.12)",
          background: "#0a1018",
          minHeight: "min(92vh, 900px)",
        }}
      >
        {/* LEFT — print document */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            borderRight: "1px solid rgba(148,163,184,0.15)",
            background: "#05080e",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderBottom: "1px solid rgba(148,163,184,0.12)",
              background: "linear-gradient(180deg,#0f1a14,#0a1210)",
            }}
          >
            <span
              style={{
                color: "#00E676",
                fontWeight: 800,
                letterSpacing: "0.12em",
                fontSize: 12,
                textShadow: "0 0 12px rgba(0,230,118,0.4)",
              }}
            >
              PRINT STUDIO
            </span>
            <span style={{ color: "#64748b", fontSize: 11 }}>
              {job.workOrder || job.jobId}
            </span>
            <div style={{ flex: 1 }} />
            {files.length > 1 && (
              <>
                <button
                  type="button"
                  disabled={fileIdx <= 0}
                  onClick={() => setFileIdx((i) => Math.max(0, i - 1))}
                  style={navBtnStyle}
                >
                  ‹
                </button>
                <span style={{ color: "#94a3b8", fontSize: 11, fontFamily: "monospace" }}>
                  {fileIdx + 1}/{files.length}
                </span>
                <button
                  type="button"
                  disabled={fileIdx >= files.length - 1}
                  onClick={() => setFileIdx((i) => Math.min(files.length - 1, i + 1))}
                  style={navBtnStyle}
                >
                  ›
                </button>
              </>
            )}
          </div>

          {callout && (
            <div
              style={{
                padding: "8px 12px",
                background: "linear-gradient(90deg, rgba(251,191,36,0.15), transparent)",
                borderBottom: "1px solid rgba(251,191,36,0.35)",
                color: "#fde68a",
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1.35,
              }}
            >
              <span style={{ color: "#fbbf24", fontWeight: 800, letterSpacing: "0.06em" }}>
                MAP → PRINT CALLOUT
              </span>
              <div style={{ marginTop: 2, color: "#e2e8f0" }}>{callout}</div>
              {sheetHint != null && (
                <div style={{ marginTop: 2, fontSize: 10, color: "#94a3b8" }}>
                  Plan sheet page ~{sheetHint} (re-ingest to refresh AI page tags)
                </div>
              )}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#111" }}>
            {active?.downloadUrl ? (
              active.contentType?.includes("pdf") ||
              active.name?.toLowerCase().endsWith(".pdf") ||
              active.downloadUrl.includes(".pdf") ? (
                <iframe
                  title={active.name || "print"}
                  src={active.downloadUrl}
                  style={{ width: "100%", height: "100%", border: 0, background: "#1a1a1a" }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    overflow: "auto",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 12,
                  }}
                >
                  <img
                    src={active.downloadUrl}
                    alt={active.name || "print"}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                  />
                </div>
              )
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                  fontSize: 13,
                  padding: 24,
                  textAlign: "center",
                }}
              >
                No print file URL on this job yet.
                <br />
                Upload a design PDF on the job card, then reopen Studio.
              </div>
            )}
          </div>

          {active && (
            <div
              style={{
                padding: "8px 14px",
                borderTop: "1px solid rgba(148,163,184,0.1)",
                fontSize: 10,
                color: "#94a3b8",
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{active.name}</span>
              {active.size != null && <span>{formatBytes(active.size)}</span>}
              {active.downloadUrl && (
                <a
                  href={active.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#38bdf8", fontWeight: 700 }}
                >
                  Open full screen ↗
                </a>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — plant twin controls */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            background: "linear-gradient(180deg,#0c121c 0%,#080c12 100%)",
            color: "#e2e8f0",
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid rgba(148,163,184,0.12)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  color: "#22d3ee",
                  textTransform: "uppercase",
                }}
              >
                Digital twin plant
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                {inventory.mainline
                  ? `Mainline · ${inventory.mainline}`
                  : "Mainline street from print"}
                {inventory.backbonePts > 0
                  ? ` · ${inventory.backbonePts} spine pts`
                  : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#e2e8f0",
                borderRadius: 6,
                padding: "6px 10px",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              Close ✕
            </button>
          </div>

          {/* Progress */}
          <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(148,163,184,0.1)" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: "#94a3b8",
                marginBottom: 4,
                fontFamily: "monospace",
              }}
            >
              <span>Plant complete (status{inventory.footageNote ? " + footage" : ""})</span>
              <span style={{ color: "#00E676", fontWeight: 800 }}>{inventory.pct}%</span>
            </div>
            {inventory.footageNote && (
              <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4, fontFamily: "monospace" }}>
                {inventory.footageNote}
              </div>
            )}
            {mapSel && (
              <div
                style={{
                  fontSize: 10,
                  color: "#fbbf24",
                  marginBottom: 6,
                  fontWeight: 700,
                }}
              >
                Map selected: {mapSel.kind} · {mapSel.ref}
              </div>
            )}
            <div
              style={{
                height: 8,
                borderRadius: 99,
                background: "rgba(255,255,255,0.06)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(3, inventory.pct)}%`,
                  height: "100%",
                  borderRadius: 99,
                  background: "linear-gradient(90deg,#0ea5e9,#00e676)",
                  boxShadow: "0 0 12px rgba(0,230,118,0.5)",
                }}
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 6,
                marginTop: 10,
              }}
            >
              <MiniStat n={inventory.cables.length} l="Cables" c="#38bdf8" />
              <MiniStat n={inventory.terminals.length} l="Terminals" c="#a78bfa" />
              <MiniStat n={inventory.drops.length} l="Drops" c="#fbbf24" />
            </div>
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
            <SectionTitle>Hub / FDH</SectionTitle>
            <Row
              title={job.ziplyPrintLayer?.hubId || "Hub"}
              sub={job.address || "No address"}
              status={(mo?.hub?.status as ZiplyObjectStatus) || "planned"}
              selected={mapSel?.kind === "hub"}
              onSelect={() =>
                selectObject(
                  "hub",
                  "hub",
                  job.ziplyPrintLayer?.hubId || "Hub",
                  anchor?.lat,
                  anchor?.lng
                )
              }
              onPan={
                anchor
                  ? () => panTo(anchor.lat, anchor.lng)
                  : undefined
              }
              onStatus={(st) => void setObjectStatus("hub", "hub", st)}
            />

            <SectionTitle>Mainline & laterals</SectionTitle>
            {inventory.cables.length === 0 && (
              <p style={{ fontSize: 11, color: "#64748b" }}>
                No cables yet — rebuild plant after print ingest.
              </p>
            )}
            {inventory.cables.map((c) => (
              <Row
                key={c.label}
                title={c.label}
                sub={[
                  c.role || "lateral",
                  c.buildType,
                  c.lengthFt != null ? `${c.lengthFt}'` : null,
                  c.path?.length ? `${c.path.length} pts` : "no path",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                status={(c.status as ZiplyObjectStatus) || "planned"}
                selected={
                  mapSel?.kind === "cable" &&
                  (mapSel.ref === c.label || mapSel.ref === c.toTerminal)
                }
                onSelect={() => {
                  const p = c.path?.[Math.floor((c.path?.length ?? 1) / 2)];
                  selectObject("cable", c.label, c.label, p?.lat, p?.lng);
                }}
                onPan={
                  c.path && c.path[0]
                    ? () => panTo(c.path![0]!.lat, c.path![0]!.lng)
                    : undefined
                }
                onEditPath={
                  c.path && c.path.length >= 2
                    ? () => {
                        emitZiplyPathEditRequest({
                          jobId: job.jobId,
                          cableLabel: c.label,
                        });
                        setMsg("Path edit mode on map — drag handles, then Save.");
                      }
                    : undefined
                }
                onStatus={(st) => void setObjectStatus("cable", c.label, st)}
                glow={c.role === "mainline"}
              />
            ))}

            <SectionTitle>Terminals / MSTs</SectionTitle>
            {inventory.terminals.map((t) => (
              <Row
                key={t.label}
                title={t.label}
                sub={[
                  t.type,
                  t.footageLabel || (t.footageFt != null ? `${t.footageFt}'` : null),
                  (t.addressesServed || []).slice(0, 2).join(", ") ||
                    (t.houseNumbers || []).join(", ") ||
                    "no address",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                status={(t.status as ZiplyObjectStatus) || "planned"}
                selected={mapSel?.kind === "terminal" && mapSel.ref === t.label}
                onSelect={() =>
                  selectObject("terminal", t.label, t.label, t.lat, t.lng)
                }
                onPan={
                  typeof t.lat === "number" && typeof t.lng === "number"
                    ? () => panTo(t.lat!, t.lng!)
                    : undefined
                }
                onStatus={(st) => void setObjectStatus("terminal", t.label, st)}
              />
            ))}
          </div>

          <div
            style={{
              padding: 12,
              borderTop: "1px solid rgba(148,163,184,0.12)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => void rebuildPlant()}
              style={{
                background: busy
                  ? "rgba(255,255,255,0.08)"
                  : "linear-gradient(180deg,#00e676,#00a854)",
                color: busy ? "#94a3b8" : "#04120a",
                border: "none",
                borderRadius: 8,
                padding: "10px 12px",
                fontWeight: 800,
                fontSize: 12,
                cursor: busy ? "wait" : "pointer",
                letterSpacing: "0.04em",
                boxShadow: busy ? "none" : "0 0 20px rgba(0,230,118,0.35)",
              }}
            >
              {busy ? "REBUILDING PLANT…" : "⚡ REBUILD PLANT CAD (MASTER)"}
            </button>
            {msg && (
              <div style={{ fontSize: 10, color: "#a5f3fc", lineHeight: 1.4 }}>{msg}</div>
            )}
            <p style={{ margin: 0, fontSize: 9, color: "#64748b", lineHeight: 1.4 }}>
              Rebuild geocodes house numbers, lays arterial mainline, laterals to parcels,
              and neon-ready multi-point paths. Use map click to set Live / Neon Done.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "#64748b",
        margin: "12px 0 6px",
      }}
    >
      {children}
    </div>
  );
}

function MiniStat({ n, l, c }: { n: number; l: string; c: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        borderRadius: 8,
        padding: "6px 4px",
        textAlign: "center",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 800, color: c, fontFamily: "monospace" }}>{n}</div>
      <div style={{ fontSize: 8, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em" }}>
        {l}
      </div>
    </div>
  );
}

function Row({
  title,
  sub,
  status,
  selected,
  onSelect,
  onPan,
  onEditPath,
  onStatus,
  glow,
}: {
  title: string;
  sub: string;
  status: ZiplyObjectStatus;
  selected?: boolean;
  onSelect?: () => void;
  onPan?: () => void;
  onEditPath?: () => void;
  onStatus: (st: ZiplyObjectStatus) => void;
  glow?: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        background: selected
          ? "rgba(251,191,36,0.12)"
          : glow
            ? "rgba(14,165,233,0.08)"
            : "rgba(255,255,255,0.03)",
        border: `1px solid ${
          selected
            ? "rgba(251,191,36,0.65)"
            : glow
              ? "rgba(56,189,248,0.35)"
              : "rgba(255,255,255,0.06)"
        }`,
        borderRadius: 8,
        padding: "8px 8px 6px",
        marginBottom: 6,
        cursor: onSelect ? "pointer" : "default",
        boxShadow: selected ? "0 0 14px rgba(251,191,36,0.25)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: STATUS_COLOR[status],
              textShadow:
                status !== "planned" ? `0 0 8px ${STATUS_COLOR[status]}66` : "none",
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 9,
              color: "#94a3b8",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={sub}
          >
            {sub}
          </div>
        </div>
        {onPan && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPan();
            }}
            style={smallBtn}
          >
            Map
          </button>
        )}
        {onEditPath && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditPath();
            }}
            style={{ ...smallBtn, color: "#fbbf24", borderColor: "rgba(251,191,36,0.5)" }}
          >
            Edit
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
        {(["planned", "in_progress", "complete"] as ZiplyObjectStatus[]).map((st) => (
          <button
            key={st}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStatus(st);
            }}
            style={{
              flex: 1,
              fontSize: 8,
              fontWeight: 800,
              padding: "4px 2px",
              borderRadius: 4,
              border: `1px solid ${STATUS_COLOR[st]}`,
              background: status === st ? STATUS_COLOR[st] : "transparent",
              color: status === st ? "#04120a" : STATUS_COLOR[st],
              cursor: "pointer",
            }}
          >
            {st === "planned" ? "Plan" : st === "in_progress" ? "Live" : "Done"}
          </button>
        ))}
      </div>
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e2e8f0",
  borderRadius: 4,
  width: 28,
  height: 28,
  cursor: "pointer",
  fontWeight: 800,
};

const smallBtn: React.CSSProperties = {
  background: "rgba(56,189,248,0.12)",
  border: "1px solid rgba(56,189,248,0.4)",
  color: "#38bdf8",
  borderRadius: 4,
  padding: "3px 8px",
  fontSize: 9,
  fontWeight: 800,
  cursor: "pointer",
  flexShrink: 0,
};
