// Create a dig ticket from a job that already has a saved dig shape. On submit
// the server snapshots the shape and generates marking instructions via Gemini.
import { useState } from "react";
import type { DigTicket, Job } from "@nsc/types";
import { api } from "../../lib/api.js";
import { normalizeDigShape } from "@nsc/types";

interface Props {
  jobs: Job[];
  username: string | null;
  onCreated: (ticket: DigTicket) => void;
  onCancel: () => void;
}

const EQUIPMENT_OPTIONS = ["Backhoe", "Trencher", "Boring Rig", "Excavator", "Hand Tools", "Vac Truck"];

export default function CreateTicketForm({ jobs, username, onCreated, onCancel }: Props) {
  const [jobId, setJobId] = useState(jobs[0]?.jobId ?? "");
  const [workType, setWorkType] = useState("");
  const [markAround, setMarkAround] = useState("");
  const [handDigOnly, setHandDigOnly] = useState(false);
  const [directionalBoring, setDirectionalBoring] = useState(false);
  const [whiteLined, setWhiteLined] = useState(false);
  const [explosives, setExplosives] = useState(false);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const job = jobs.find((j) => j.jobId === jobId) ?? null;
  const shape = normalizeDigShape(job?.digPolygon ?? null);

  const toggleEquip = (e: string) =>
    setEquipment((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));

  const submit = async () => {
    if (!jobId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { ticket } = await api.createDigTicket({
        jobId,
        specs: {
          handDigOnly,
          directionalBoring,
          whiteLined,
          explosives,
          workType: workType.trim(),
          equipment,
          markAround,
          duration: 45,
        },
      });
      onCreated(ticket);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  };

  if (jobs.length === 0) {
    return (
      <div className="dt-form">
        <h2 className="dt-form__title">Request 811</h2>
        <p className="dt-placeholder__hint">
          No jobs have a dig shape yet. Open a job, switch to the Telecom tab, and
          draw a radius/route/polygon shape first.
        </p>
        <button className="dt-btn" onClick={onCancel}>Close</button>
      </div>
    );
  }

  return (
    <div className="dt-form">
      <h2 className="dt-form__title">Request 811</h2>

      <label className="dt-field">
        <span>Job</span>
        <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
          {jobs.map((j) => (
            <option key={j.jobId} value={j.jobId}>
              {j.workOrder} — {j.address ?? j.city ?? "no address"}
            </option>
          ))}
        </select>
      </label>

      {shape && (
        <div className="dt-shape-summary">
          <span className="dt-chip">{shape.type}</span>
          <span>{Math.round(shape.areaSqFt).toLocaleString()} ft²</span>
          <span>{Math.round(shape.perimeterFt).toLocaleString()} ft perimeter</span>
        </div>
      )}

      <label className="dt-field">
        <span>Work type</span>
        <input
          value={workType}
          onChange={(e) => setWorkType(e.target.value)}
          placeholder="e.g. POLE TRANSFER, SPLICE PIT"
        />
      </label>

      <label className="dt-field">
        <span>Mark around</span>
        <input
          value={markAround}
          onChange={(e) => setMarkAround(e.target.value)}
          placeholder="e.g. the full excavation boundary"
        />
      </label>

      <div className="dt-checks">
        <label><input type="checkbox" checked={handDigOnly} onChange={(e) => setHandDigOnly(e.target.checked)} /> Hand dig only</label>
        <label><input type="checkbox" checked={directionalBoring} onChange={(e) => setDirectionalBoring(e.target.checked)} /> Directional boring</label>
        <label><input type="checkbox" checked={whiteLined} onChange={(e) => setWhiteLined(e.target.checked)} /> White-lined</label>
        <label><input type="checkbox" checked={explosives} onChange={(e) => setExplosives(e.target.checked)} /> Explosives</label>
      </div>

      <div className="dt-field">
        <span>Equipment</span>
        <div className="dt-equip">
          {EQUIPMENT_OPTIONS.map((e) => (
            <button
              key={e}
              type="button"
              className={`dt-equip__btn${equipment.includes(e) ? " dt-equip__btn--on" : ""}`}
              onClick={() => toggleEquip(e)}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <label className="dt-field">
        <span>Duration (days)</span>
        <input type="number" value={45} readOnly disabled />
        <span className="dt-field__hint">WA state dig tickets are valid for 45 days</span>
      </label>

      {error && <div className="dt-error">{error}</div>}

      <div className="dt-form__actions">
        <button className="dt-btn" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button
          className="dt-btn dt-btn--primary"
          onClick={submit}
          disabled={submitting || !shape}
          title={shape ? undefined : "Selected job has no dig shape"}
        >
          {submitting ? "Generating…" : "Create + Generate"}
        </button>
      </div>
      <p className="dt-form__note">
        Filed by {username ?? "William"}. Marking instructions are generated by
        Gemini and can be edited before filing.
      </p>
    </div>
  );
}
