import { useEffect, useState } from "react";
import type { DigTicket, Job, ZiplyObjectStatus, ZiplySectionScope } from "@nsc/types";
import { InfoWindow, Marker, useMap } from "@vis.gl/react-google-maps";
import { api } from "../../lib/api.js";

// ── CAD-blueprint color system (spec §3) ────────────────────────────────────
const INK = "#111827";
const STATUS_COLOR: Record<ZiplyObjectStatus, string> = {
  complete: "#15803D", // green
  in_progress: "#0891B2", // cyan
  planned: "#9CA3AF", // gray
};
// Terminal dot fill: planned reads as a hollow (white) pin.
const TERM_FILL: Record<ZiplyObjectStatus, string> = {
  complete: "#15803D",
  in_progress: "#0891B2",
  planned: "#FFFFFF",
};
// Build-method colors override the status hue for cable segments when known.
const BUILD_COLOR: Record<string, string> = {
  bore: "#B91C1C", // red
  trench: "#C2410C", // orange
  aerial: "#6D28D9", // purple
};

// Zoom thresholds for progressive reveal (spec §3).
const TERMINAL_MIN_ZOOM = 13; // neighborhood level reveals terminals/handholes

type StatusKind = "hub" | "terminal" | "cable";

interface Selected {
  job: Job;
  kind: StatusKind;
  ref: string; // label ("hub" for the FDH)
  scope: ZiplySectionScope;
  title: string;
  position: google.maps.LatLngLiteral;
  status: ZiplyObjectStatus;
  locateCleared: boolean;
  crewName: string | null;
  rows: Array<{ label: string; value: string }>;
}

// Draw a CAD fiber segment. Complete = solid; planned/in-progress = dashed.
function CadFiberLine({
  path,
  status,
  buildType,
  locateCleared,
  show811Clearance,
}: {
  path: google.maps.LatLngLiteral[];
  status: ZiplyObjectStatus;
  buildType?: string | null;
  locateCleared?: boolean;
  show811Clearance?: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || path.length < 2) return;
    const color = show811Clearance
      ? locateCleared
        ? "#16A34A"
        : "#DC2626"
      : (buildType && BUILD_COLOR[buildType]) || STATUS_COLOR[status];
    const solid = show811Clearance ? locateCleared : status === "complete";
    const line = new google.maps.Polyline({
      path,
      map,
      strokeColor: color,
      strokeWeight: 3,
      strokeOpacity: solid ? 0.95 : 0,
      zIndex: 10,
      icons: solid
        ? undefined
        : [
            {
              icon: {
                path: "M 0,-1 0,1",
                strokeOpacity: 0.9,
                strokeColor: color,
                scale: 3,
              },
              offset: "0",
              repeat: "12px",
            },
          ],
    });
    return () => line.setMap(null);
  }, [map, path, status, buildType, locateCleared, show811Clearance]);
  return null;
}

interface Props {
  jobs: Job[];
  visible: boolean;
  show811Clearance?: boolean;
}

export default function ZiplyPrintOverlay({ jobs, visible, show811Clearance = false }: Props) {
  const map = useMap();
  const [zoom, setZoom] = useState<number>(map?.getZoom() ?? 12);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [saving, setSaving] = useState(false);
  const [crewDraft, setCrewDraft] = useState("");
  const [tickets, setTickets] = useState<DigTicket[]>([]);
  // Optimistic status overrides keyed by `${jobId}:${kind}:${ref}` so the UI
  // reflects a change immediately without waiting for a full jobs reload.
  const [overrides, setOverrides] = useState<Record<string, ZiplyObjectStatus>>({});

  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("zoom_changed", () => {
      setZoom(map.getZoom() ?? 12);
    });
    return () => listener.remove();
  }, [map]);

  useEffect(() => {
    setCrewDraft(selected?.crewName ?? "");
  }, [selected]);

  useEffect(() => {
    if (!visible || !show811Clearance) return;
    let cancelled = false;
    api.listDigTickets("*")
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
      /* keep optimistic value; a reload will reconcile */
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
    const live = (t.status === "Filed" || t.status === "Active" || t.status === "Expiring") && (!expires || expires > now);
    if (live) activeScopedTickets.set(scopeKey(t.jobId, t.scope.kind, t.scope.ref), t);
  });

  const locateCleared = (job: Job, kind: StatusKind, ref: string, fallbackExpires?: number | null) => {
    const scoped = activeScopedTickets.get(scopeKey(job.jobId, kind, ref));
    if (scoped) return true;
    return fallbackExpires != null && fallbackExpires > now;
  };

  const openSection811 = (sel: Selected) => {
    try {
      sessionStorage.setItem("nsc.map.openDigTicketForJob", JSON.stringify({ jobId: sel.job.jobId, scope: sel.scope }));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("nsc:map:openDigTicketForJob", { detail: { jobId: sel.job.jobId, scope: sel.scope } }));
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

  const printJobs = jobs.filter(
    (j) => j.customerProject === "Ziply" && j.ziplyPrintLayer?.mapObjects && j.geocode
  );

  const showTerminals = zoom >= TERMINAL_MIN_ZOOM;

  return (
    <>
      {printJobs.map((job) => {
        const layer = job.ziplyPrintLayer!;
        const mo = layer.mapObjects!;
        const hub = mo.hub ?? null;
        const hubPos = {
          lat: hub?.lat ?? job.geocode!.lat,
          lng: hub?.lng ?? job.geocode!.lng,
        };
        const hubStatus = statusOf(job.jobId, "hub", "hub", hub?.status);
        const terminals = mo.terminals ?? [];

        // Resolve each terminal position: georeferenced coords if present,
        // else a ring around the hub so it's still visible/clickable.
        const termPositions = terminals.map((t, idx) => {
          if (t.lat != null && t.lng != null) return { lat: t.lat, lng: t.lng };
          const angle = (idx * 2 * Math.PI) / Math.max(terminals.length, 1);
          const r = 0.00035;
          return {
            lat: hubPos.lat + r * Math.sin(angle),
            lng: hubPos.lng + r * Math.cos(angle),
          };
        });

        return (
          <div key={job.jobId}>
            {/* Fiber spokes hub → terminal (paths shown at all zooms per §3). */}
	            {terminals.map((t, idx) => {
	              const st = statusOf(job.jobId, "terminal", t.label, t.status);
	              const cleared = locateCleared(job, "terminal", t.label, t.locateExpires ?? null);
	              return (
	                <CadFiberLine
	                  key={`${job.jobId}-cable-${idx}`}
	                  path={[hubPos, termPositions[idx]!]}
	                  status={st}
	                  locateCleared={cleared}
	                  show811Clearance={show811Clearance}
	                />
	              );
	            })}

            {/* Hub / FDH beacon — cyan-accented, white fill, ink stroke. */}
            <Marker
              position={hubPos}
              title={`FDH ${layer.hubId || ""}`}
              onClick={() =>
                setSelected({
                  job,
	                  kind: "hub",
	                  ref: "hub",
	                  scope: { kind: "hub", ref: "hub", hubId: layer.hubId, label: `Hub ${layer.hubId || job.workOrder}` },
	                  title: `FDH Cabinet ${layer.hubId || ""}`,
	                  position: hubPos,
	                  status: hubStatus,
	                  locateCleared: locateCleared(job, "hub", "hub", job.locateExpires ?? null),
	                  crewName: job.crewName ?? null,
                  rows: [
                    { label: "Hub Type", value: layer.hubTypeSize || "N/A" },
                    { label: "Port Count", value: String(layer.terminalCount ?? "N/A") },
                    { label: "Homes Passed", value: String(layer.drops?.total ?? "N/A") },
                    { label: "Address", value: job.address || "N/A" },
                  ],
                })
              }
              icon={{
                path: "M 0,-11 L 11,0 L 0,11 L -11,0 Z",
                fillColor: hubStatus === "planned" ? "#FFFFFF" : STATUS_COLOR[hubStatus],
                fillOpacity: 1,
                strokeColor: INK,
                strokeWeight: 2.5,
                scale: 1.2,
              }}
            />

            {/* Terminals — revealed at neighborhood zoom and closer (§3). */}
            {showTerminals &&
	              terminals.map((t, idx) => {
	                const st = statusOf(job.jobId, "terminal", t.label, t.status);
	                const pos = termPositions[idx]!;
	                const cleared = locateCleared(job, "terminal", t.label, t.locateExpires ?? null);
	                return (
                  <Marker
                    key={`${job.jobId}-term-${idx}`}
                    position={pos}
                    title={`${t.label} (${t.type})`}
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
                          { label: "Port Count", value: t.portCount != null ? String(t.portCount) : "N/A" },
                          { label: "Footage", value: t.footageLabel || (t.footageFt != null ? `${t.footageFt}'` : "N/A") },
                          { label: "DVFTP Range", value: t.dvftpRange || "N/A" },
                          { label: "Code", value: t.code || "N/A" },
                          { label: "Fiber Spec", value: t.fiberSpec || "N/A" },
                          { label: "Addresses", value: (t.addressesServed || []).join(", ") || "N/A" },
                        ],
                      })
                    }
	                    icon={{
	                      path: google.maps.SymbolPath.CIRCLE,
	                      fillColor: show811Clearance ? (cleared ? "#16A34A" : "#FFFFFF") : TERM_FILL[st],
	                      fillOpacity: 1,
	                      strokeColor: show811Clearance ? (cleared ? "#166534" : "#DC2626") : INK,
	                      strokeWeight: show811Clearance ? 2.5 : 1.5,
	                      scale: 6,
                    }}
                  />
                );
              })}
          </div>
        );
      })}

      {selected && (
        <InfoWindow position={selected.position} onCloseClick={() => setSelected(null)}>
          <div style={{ color: "#111", fontFamily: "sans-serif", fontSize: 12, minWidth: 230, padding: 4 }}>
            <h4
              style={{
                margin: "0 0 6px 0",
                fontSize: 13,
                borderBottom: "1px solid #ddd",
                paddingBottom: 4,
                color: STATUS_COLOR[selected.status],
              }}
            >
              {selected.title}
            </h4>
            <p style={{ margin: "2px 0", color: "#555" }}>
              <strong>WO:</strong> {selected.job.workOrder}
            </p>
	            {selected.rows.map((r) => (
	              <p key={r.label} style={{ margin: "2px 0" }}>
	                <strong>{r.label}:</strong> {r.value}
	              </p>
	            ))}

	            <div style={{ marginTop: 8, padding: 7, border: "1px solid #e5e7eb", borderRadius: 6, background: "#f9fafb" }}>
	              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
	                <strong style={{ color: "#374151" }}>811 section</strong>
	                <span
	                  style={{
	                    padding: "2px 7px",
	                    borderRadius: 999,
	                    fontSize: 10,
	                    fontWeight: 800,
	                    color: selected.locateCleared ? "#14532d" : "#7f1d1d",
	                    background: selected.locateCleared ? "#dcfce7" : "#fee2e2",
	                  }}
	                >
	                  {selected.locateCleared ? "CLEARED" : "NOT CLEARED"}
	                </span>
	              </div>
	              <button
	                type="button"
	                onClick={() => openSection811(selected)}
	                style={{ marginTop: 6, width: "100%", padding: "6px 0", border: "1px solid #f59e0b", borderRadius: 4, background: "#fffbeb", color: "#92400e", fontWeight: 800, cursor: "pointer" }}
	              >
	                File / open 811 for this section
	              </button>
	            </div>

	            <div style={{ marginTop: 8 }}>
	              <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#666", marginBottom: 4 }}>
	                CREW ASSIGNED TO SECTION
	              </label>
	              <div style={{ display: "flex", gap: 4 }}>
	                <input
	                  value={crewDraft}
	                  onChange={(e) => setCrewDraft(e.target.value)}
	                  placeholder="Crew name"
	                  style={{ flex: 1, minWidth: 0, padding: "5px 6px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 11 }}
	                />
	                <button
	                  type="button"
	                  disabled={saving}
	                  onClick={() => void saveCrew(selected)}
	                  style={{ padding: "5px 8px", border: "1px solid #0891b2", borderRadius: 4, background: "#ecfeff", color: "#155e75", fontSize: 10, fontWeight: 800, cursor: saving ? "wait" : "pointer" }}
	                >
	                  Save
	                </button>
	              </div>
	            </div>

	            <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: "#666" }}>STATUS</div>
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              {(["planned", "in_progress", "complete"] as ZiplyObjectStatus[]).map((st) => (
                <button
                  key={st}
                  disabled={saving}
                  onClick={() => applyStatus(selected, st)}
                  style={{
                    flex: 1,
                    padding: "5px 0",
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "capitalize",
                    border: `1px solid ${STATUS_COLOR[st]}`,
                    borderRadius: 4,
                    cursor: saving ? "wait" : "pointer",
                    background: selected.status === st ? STATUS_COLOR[st] : "#fff",
                    color: selected.status === st ? "#fff" : STATUS_COLOR[st],
                  }}
                >
                  {st.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}
