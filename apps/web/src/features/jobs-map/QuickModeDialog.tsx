// QuickModeDialog — Phase 7: lightweight backfill for older jobs without a
// full as-built. Prompts: Status → Medium → Cable family → optional label →
// Draw on map (click to add vertices, double-click to finish). Posts to
// /api/jobs/:jobId/quickref/quick and updates the gist.
//
// Visual rendering rules MUST match As-Built mode and live QuickRef Layer:
//   - Aerial cable → solid line
//   - Underground cable → dashed line
//   - NEW → red #FF0000
//   - REMOVED → green #00AA00
import { useEffect, useRef, useState } from "react";
import type { LatLng, QuickReferenceGist } from "@nsc/types";
import { api } from "../../lib/api.js";
import { useJobsMapRef } from "./jobsContext.js";

const NEW_COLOR = "#FF0000";
const REMOVED_COLOR = "#00AA00";

interface Props {
  jobId: string;
  onClose: () => void;
  onSaved: (gist: QuickReferenceGist) => void;
}

export default function QuickModeDialog({ jobId, onClose, onSaved }: Props) {
  const mapRef = useJobsMapRef();
  const [step, setStep] = useState<"status" | "medium" | "family" | "label" | "draw">("status");
  const [status, setStatus] = useState<"NEW" | "REMOVED">("NEW");
  const [medium, setMedium] = useState<"AERIAL" | "UNDERGROUND">("AERIAL");
  const [family, setFamily] = useState<"FIBER" | "COPPER" | "ASW" | "BSW" | "">("");
  const [label, setLabel] = useState("");
  const [path, setPath] = useState<LatLng[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const dblListenerRef = useRef<google.maps.MapsEventListener | null>(null);

  // Wire up click-to-add-vertex when entering draw step
  useEffect(() => {
    if (step !== "draw") return;
    const map = mapRef?.current;
    if (!map) return;

    const color = status === "NEW" ? NEW_COLOR : REMOVED_COLOR;
    const aerial = medium === "AERIAL";
    const pl = new google.maps.Polyline({
      map,
      path: [],
      strokeColor: color,
      strokeOpacity: aerial ? 1 : 0,
      strokeWeight: 3,
      clickable: false,
      icons: aerial
        ? undefined
        : [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 2.5 }, offset: "0", repeat: "10px" }],
    });
    polylineRef.current = pl;

    clickListenerRef.current = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const pt = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      setPath((prev) => {
        const next = [...prev, pt];
        polylineRef.current?.setPath(next);
        return next;
      });
    });
    dblListenerRef.current = map.addListener("dblclick", () => {
      // Finish drawing — preserve last click
    });

    return () => {
      if (clickListenerRef.current) google.maps.event.removeListener(clickListenerRef.current);
      if (dblListenerRef.current) google.maps.event.removeListener(dblListenerRef.current);
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function save() {
    if (path.length < 2) {
      setErr("Add at least two points by clicking on the map.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const { gist } = await api.appendQuickEntry(jobId, {
        status,
        medium,
        family: family || undefined,
        label: label || undefined,
        path,
      });
      onSaved(gist);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: 380,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <strong style={{ flex: 1 }}>⚡ Quick Mode</strong>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 18, color: "var(--text-muted)" }}
          >×</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
          Lightweight backfill — adds to the Quick Reference Layer only. Does not touch as-built data.
        </div>

        {err && (
          <div style={{ background: "rgba(255,45,74,0.12)", color: "#ff2d4a", padding: 6, borderRadius: 6, fontSize: 11, marginBottom: 10 }}>
            {err}
          </div>
        )}

        {step === "status" && (
          <StepWrap title="Status">
            <Choices
              options={[
                { value: "NEW", label: "NEW", color: NEW_COLOR },
                { value: "REMOVED", label: "REMOVED", color: REMOVED_COLOR },
              ]}
              value={status}
              onChange={(v) => { setStatus(v as "NEW" | "REMOVED"); setStep("medium"); }}
            />
          </StepWrap>
        )}

        {step === "medium" && (
          <StepWrap title="Cable medium">
            <Choices
              options={[
                { value: "AERIAL", label: "Aerial (solid)" },
                { value: "UNDERGROUND", label: "Underground (dashed)" },
              ]}
              value={medium}
              onChange={(v) => { setMedium(v as "AERIAL" | "UNDERGROUND"); setStep("family"); }}
            />
            <BackBtn onClick={() => setStep("status")} />
          </StepWrap>
        )}

        {step === "family" && (
          <StepWrap title="Cable family">
            <Choices
              options={[
                { value: "FIBER", label: "Fiber" },
                { value: "COPPER", label: "Copper" },
                { value: "ASW", label: "ASW" },
                { value: "BSW", label: "BSW" },
              ]}
              value={family}
              onChange={(v) => { setFamily(v as typeof family); setStep("label"); }}
            />
            <BackBtn onClick={() => setStep("medium")} />
          </StepWrap>
        )}

        {step === "label" && (
          <StepWrap title="Label (optional)">
            <input
              autoFocus
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. North feeder"
              style={{ width: "100%", padding: 6 }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <BackBtn onClick={() => setStep("family")} />
              <button type="button" style={{ flex: 1, padding: 6 }} onClick={() => setStep("draw")}>
                Draw on map →
              </button>
            </div>
          </StepWrap>
        )}

        {step === "draw" && (
          <StepWrap title="Draw on map">
            <div style={{ fontSize: 11, marginBottom: 8 }}>
              Click on the map to add points. {path.length > 0 && <span><strong>{path.length}</strong> point(s) so far.</span>}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 10 }}>
              Status: <strong>{status}</strong> · Medium: <strong>{medium}</strong>{family && <> · Family: <strong>{family}</strong></>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <BackBtn onClick={() => setStep("label")} />
              <button
                type="button"
                disabled={saving || path.length < 2}
                onClick={save}
                style={{ flex: 1, padding: 6, background: "#39ff7a22", border: "1px solid #39ff7a", color: "#39ff7a" }}
              >
                {saving ? "Saving…" : "Save entry"}
              </button>
            </div>
          </StepWrap>
        )}
      </div>
    </div>
  );
}

function StepWrap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Choices<T extends string>({
  options, value, onChange,
}: {
  options: Array<{ value: T; label: string; color?: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            padding: "8px 10px",
            border: "1px solid var(--border)",
            background: value === o.value ? "var(--surface-2)" : "transparent",
            color: o.color ?? "var(--text)",
            cursor: "pointer",
            textAlign: "left",
            borderRadius: 6,
            fontWeight: 600,
          }}
        >
          {o.color && <span style={{ display: "inline-block", width: 10, height: 10, background: o.color, marginRight: 6, borderRadius: 2 }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ padding: "6px 10px", background: "transparent", border: "1px solid var(--border)", cursor: "pointer", borderRadius: 6, fontSize: 11 }}
    >
      ← Back
    </button>
  );
}
