import { useEffect, useState } from "react";
import type { Job, ZiplyObjectStatus } from "@nsc/types";
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
  title: string;
  position: google.maps.LatLngLiteral;
  status: ZiplyObjectStatus;
  rows: Array<{ label: string; value: string }>;
}

// Draw a CAD fiber segment. Complete = solid; planned/in-progress = dashed.
function CadFiberLine({
  path,
  status,
  buildType,
}: {
  path: google.maps.LatLngLiteral[];
  status: ZiplyObjectStatus;
  buildType?: string | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || path.length < 2) return;
    const color = (buildType && BUILD_COLOR[buildType]) || STATUS_COLOR[status];
    const solid = status === "complete";
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
  }, [map, path, status, buildType]);
  return null;
}

interface Props {
  jobs: Job[];
  visible: boolean;
}

export default function ZiplyPrintOverlay({ jobs, visible }: Props) {
  const map = useMap();
  const [zoom, setZoom] = useState<number>(map?.getZoom() ?? 12);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [saving, setSaving] = useState(false);
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
              return (
                <CadFiberLine
                  key={`${job.jobId}-cable-${idx}`}
                  path={[hubPos, termPositions[idx]!]}
                  status={st}
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
                  title: `FDH Cabinet ${layer.hubId || ""}`,
                  position: hubPos,
                  status: hubStatus,
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
                        title: `${t.label} — ${t.type}`,
                        position: pos,
                        status: st,
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
                      fillColor: TERM_FILL[st],
                      fillOpacity: 1,
                      strokeColor: INK,
                      strokeWeight: 1.5,
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
