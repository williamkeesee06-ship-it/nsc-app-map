import { useEffect, useState, useMemo } from "react";
import type { Job, Gig } from "@nsc/types";
import { api } from "../../../lib/api.js";
import { bucketForJob } from "../../jobs-map/markerStyle.js";
import Bezel from "../components/Bezel.js";
import { Check, Trash2, Plus } from "lucide-react";

export interface GigWorkCardProps {
  ziplyJobs: Job[];
  onOpenJob: (jobId: string) => void;
}

export default function GigWorkCard({ ziplyJobs, onOpenJob }: GigWorkCardProps) {
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [taskText, setTaskText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGigs = () => {
    api.listGigs()
      .then(({ gigs }) => {
        setGigs(gigs);
      })
      .catch((err) => {
        console.error("Failed to load gigs", err);
      });
  };

  useEffect(() => {
    fetchGigs();
    window.addEventListener("nsc:gigs-reload", fetchGigs);
    return () => window.removeEventListener("nsc:gigs-reload", fetchGigs);
  }, []);

  const openGigs = useMemo(() => gigs.filter(g => g.status === "open"), [gigs]);

  // Per Billy 8/6: tie the Gig Work + Go-Backs picker to the "Gigs" status
  // bucket on the tracker so the dropdown only shows jobs currently in
  // "08_Complete - Pending Gigs" (the punch-list phase). Falls back to the
  // full Ziply list if nothing is in that bucket yet, so the picker never
  // ends up empty when the sync hasn't populated statuses.
  const gigEligibleJobs = useMemo(() => {
    const inGigs = ziplyJobs.filter((j) => bucketForJob(j) === "gigs");
    return inGigs.length > 0 ? inGigs : ziplyJobs;
  }, [ziplyJobs]);

  const handleAddGig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJobId || !taskText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.addGig(selectedJobId, taskText.trim());
      setTaskText("");
      fetchGigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add gig");
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteGig = async (gigId: string) => {
    try {
      await api.completeGig(gigId);
      fetchGigs();
    } catch (err) {
      console.error("Failed to complete gig", err);
    }
  };

  const handleDeleteGig = async (gigId: string) => {
    if (!confirm("Are you sure you want to remove this gig?")) return;
    try {
      await api.deleteGig(gigId);
      fetchGigs();
    } catch (err) {
      console.error("Failed to delete gig", err);
    }
  };

  return (
    <Bezel className="card atrisk-card" accent="#00d45a">
      <div className="card__header" style={{ marginBottom: 12 }}>
        <h2 className="card__title atrisk-card__title">Gig Work & Go-backs</h2>
        <span className="atrisk-card__count" style={{ backgroundColor: "#00843d" }}>{openGigs.length}</span>
      </div>

      {/* Inline Form to add Gig */}
      <form onSubmit={handleAddGig} style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        <select
          value={selectedJobId}
          onChange={(e) => setSelectedJobId(e.target.value)}
          required
          style={{
            flex: "1 1 150px",
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#fff",
            borderRadius: 4,
            padding: "5px 8px",
            fontSize: 11
          }}
        >
          <option value="">Select Ziply Job...</option>
          {gigEligibleJobs.map((j) => (
            <option key={j.jobId} value={j.jobId}>
              {j.workOrder || j.jobId} - {j.city || "Unknown City"}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Task (cleanup, fixing irrigation...)"
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          required
          style={{
            flex: "2 1 200px",
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#fff",
            borderRadius: 4,
            padding: "5px 8px",
            fontSize: 11
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            background: "linear-gradient(135deg, #00843d 0%, #00d45a 100%)",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "5px 12px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 700
          }}
        >
          <Plus size={12} /> Add
        </button>
      </form>
      {error && <div style={{ color: "#ff3b5c", fontSize: 10, marginBottom: 10 }}>{error}</div>}

      {openGigs.length === 0 ? (
        <p className="atrisk-card__empty">No open gigs or go-backs. All clear.</p>
      ) : (
        <div className="atrisk-card__scroll" style={{ maxHeight: 220, overflowY: "auto" }}>
          <table className="atrisk-card__table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: "25%" }}>Job</th>
                <th style={{ width: "50%" }}>Task Description</th>
                <th style={{ width: "25%", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {openGigs.map((g) => (
                <tr key={g.id} className="atrisk-card__row" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td
                    className="atrisk-card__id"
                    style={{ cursor: "pointer", color: "var(--accent, #38bdf8)" }}
                    onClick={() => onOpenJob(g.jobId)}
                    title="View Job on Map"
                  >
                    {g.workOrder}
                  </td>
                  <td style={{ color: "#e2e8f0", fontSize: 11 }}>{g.task}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <button
                        onClick={() => handleCompleteGig(g.id)}
                        title="Mark Completed"
                        style={{
                          background: "rgba(0, 212, 90, 0.15)",
                          border: "1px solid rgba(0, 212, 90, 0.3)",
                          borderRadius: 4,
                          padding: 4,
                          cursor: "pointer",
                          color: "#00d45a",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                      >
                        <Check size={12} />
                      </button>
                      <button
                        onClick={() => handleDeleteGig(g.id)}
                        title="Remove Gig"
                        style={{
                          background: "rgba(255, 59, 92, 0.15)",
                          border: "1px solid rgba(255, 59, 92, 0.3)",
                          borderRadius: 4,
                          padding: 4,
                          cursor: "pointer",
                          color: "#ff3b5c",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Bezel>
  );
}
