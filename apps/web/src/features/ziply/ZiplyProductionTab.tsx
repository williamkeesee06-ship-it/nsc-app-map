import { useState } from "react";
import type { Job } from "@nsc/types";

export default function ZiplyProductionTab({ jobs }: { jobs: Job[] }) {
  const [selectedJobId, setSelectedJobId] = useState("");
  const [bore, setBore] = useState("");
  const [placing, setPlacing] = useState("");
  const [aerial, setAerial] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const selectedJob = jobs.find((j) => j.jobId === selectedJobId);
  const ziplyJobs = jobs.filter((j) => j.customerProject === "Ziply");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJobId) {
      setErrorMsg("Please select a job.");
      return;
    }

    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch(`/api/jobs/${selectedJobId}/ziply-production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completedBoreFt: bore ? parseFloat(bore) : 0,
          completedPlacingFt: placing ? parseFloat(placing) : 0,
          completedAerialFt: aerial ? parseFloat(aerial) : 0,
          notes,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      setStatus("success");
      setBore("");
      setPlacing("");
      setAerial("");
      setNotes("");
      // Notify map/data list to reload
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to submit log.");
      setStatus("error");
    }
  };

  return (
    <div style={{ padding: 12, color: "#fff" }}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: 13, letterSpacing: "0.05em", color: "var(--accent)" }}>
        DAILY PRODUCTION TRACKER
      </h3>
      <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 16px 0", lineHeight: "1.4" }}>
        Log daily footages completed by subcontractor crews. Submissions update the Smartsheet tracker automatically.
      </p>

      <form onSubmit={handleSubmit}>
        {/* Select Job */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", color: "#9ca3af" }}>
            Job Site
          </label>
          <select
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value)}
            style={{ width: "100%", background: "#0b1118", color: "#fff", border: "1px solid #374151", borderRadius: 4, padding: "6px 8px", fontSize: 11 }}
          >
            <option value="">-- Choose a Ziply Job --</option>
            {ziplyJobs.map((j) => (
              <option key={j.jobId} value={j.jobId}>
                {j.workOrder} · {j.address || j.city || "No Address"}
              </option>
            ))}
          </select>
        </div>

        {selectedJob && (
          <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: 8, marginBottom: 12, border: "1px solid #1f2937" }}>
            <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, marginBottom: 4 }}>CURRENT TOTAL PROGRESS:</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, fontSize: 10, textAlign: "center" }}>
              <div style={{ background: "rgba(255,255,255,0.03)", padding: 4, borderRadius: 4 }}>
                <div style={{ color: "#9ca3af" }}>Bore/Trench</div>
                <div style={{ fontWeight: 700 }}>{selectedJob.completedBoreFt ?? 0} ft</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", padding: 4, borderRadius: 4 }}>
                <div style={{ color: "#9ca3af" }}>Placing</div>
                <div style={{ fontWeight: 700 }}>{selectedJob.completedPlacingFt ?? 0} ft</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", padding: 4, borderRadius: 4 }}>
                <div style={{ color: "#9ca3af" }}>Aerial</div>
                <div style={{ fontWeight: 700 }}>{selectedJob.completedAerialFt ?? 0} ft</div>
              </div>
            </div>
          </div>
        )}

        {/* Inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 9, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", color: "#9ca3af" }}>
              Bore (ft)
            </label>
            <input
              type="number"
              placeholder="0"
              value={bore}
              onChange={(e) => setBore(e.target.value)}
              style={{ width: "100%", background: "#0b1118", color: "#fff", border: "1px solid #374151", borderRadius: 4, padding: "6px 8px", fontSize: 11 }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 9, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", color: "#9ca3af" }}>
              Placing (ft)
            </label>
            <input
              type="number"
              placeholder="0"
              value={placing}
              onChange={(e) => setPlacing(e.target.value)}
              style={{ width: "100%", background: "#0b1118", color: "#fff", border: "1px solid #374151", borderRadius: 4, padding: "6px 8px", fontSize: 11 }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 9, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", color: "#9ca3af" }}>
              Aerial (ft)
            </label>
            <input
              type="number"
              placeholder="0"
              value={aerial}
              onChange={(e) => setAerial(e.target.value)}
              style={{ width: "100%", background: "#0b1118", color: "#fff", border: "1px solid #374151", borderRadius: 4, padding: "6px 8px", fontSize: 11 }}
            />
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", color: "#9ca3af" }}>
            NSC Project Notes / Comments
          </label>
          <textarea
            placeholder="Log obstacles, crew goals, or material updates..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: "100%", background: "#0b1118", color: "#fff", border: "1px solid #374151", borderRadius: 4, padding: "6px 8px", fontSize: 11, minHeight: 60, resize: "vertical" }}
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={status === "submitting" || !selectedJobId}
          style={{
            width: "100%",
            background: status === "submitting" ? "#374151" : "var(--accent, #00E676)",
            color: "#000",
            fontWeight: 700,
            border: "none",
            borderRadius: 4,
            padding: "8px 12px",
            fontSize: 11,
            cursor: (status === "submitting" || !selectedJobId) ? "not-allowed" : "pointer",
            textAlign: "center",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {status === "submitting" ? "Submitting Log..." : "Log Production"}
        </button>
      </form>

      {status === "success" && (
        <div style={{ marginTop: 12, color: "var(--accent)", fontSize: 11, background: "rgba(0,230,118,0.1)", padding: 8, borderRadius: 4, border: "1px solid rgba(0,230,118,0.2)" }}>
          🎉 Production log submitted successfully!
        </div>
      )}

      {status === "error" && (
        <div style={{ marginTop: 12, color: "#ff2d4a", fontSize: 11, background: "rgba(255,45,74,0.1)", padding: 8, borderRadius: 4, border: "1px solid rgba(255,45,74,0.2)" }}>
          ⚠️ {errorMsg}
        </div>
      )}
    </div>
  );
}
