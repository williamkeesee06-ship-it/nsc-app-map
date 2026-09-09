import { useState } from "react";
import type { Job } from "@nsc/types";
import { CheckCircle2, ShieldCheck, FileCheck, Download, ExternalLink, AlertCircle } from "lucide-react";

interface Props {
  job: Job;
}

export default function AsBuiltStudio({ job }: Props) {
  const [checklist, setChecklist] = useState({
    locatesCleared: true,
    splicingCompleted: job.splicingStatus === "Complete",
    photosUploaded: true,
    redlinesRegistered: !!job.printOverlay,
    permitSatisfied: true,
  });

  const totalFootage = (job.completedBoreFt ?? 0) + (job.completedPlacingFt ?? 0);

  const toggleItem = (key: keyof typeof checklist) => {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const allComplete = Object.values(checklist).every(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24, background: "#0a0f1d", color: "#f8fafc", fontFamily: "ui-sans-serif, system-ui, sans-serif", minHeight: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.15em", color: "#10b981", textTransform: "uppercase" }}>
              As-Built Studio & Construction Closeout
            </span>
            <span style={{ background: "rgba(16, 185, 129, 0.15)", border: "1px solid rgba(16, 185, 129, 0.4)", color: "#34d399", fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 999 }}>
              STAGE 5 AS-BUILT
            </span>
          </div>
          <h1 style={{ margin: "4px 0 0 0", fontSize: 22, fontWeight: 900, color: "#ffffff" }}>
            {job.displayName || job.workOrder}
          </h1>
        </div>

        <button
          type="button"
          disabled={!allComplete}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: allComplete ? "linear-gradient(135deg, #059669 0%, #047857 100%)" : "rgba(255, 255, 255, 0.1)",
            border: `1px solid ${allComplete ? "#34d399" : "rgba(255, 255, 255, 0.2)"}`,
            color: allComplete ? "#ffffff" : "#94a3b8",
            fontSize: 11,
            fontWeight: 800,
            padding: "8px 16px",
            borderRadius: 8,
            cursor: allComplete ? "pointer" : "not-allowed",
            boxShadow: allComplete ? "0 2px 8px rgba(16, 185, 129, 0.4)" : "none",
          }}
        >
          <Download size={14} /> Generate Official As-Built Package
        </button>
      </div>

      {/* Overview Metric Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>Approved Total Footage</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#34d399", marginTop: 4, fontFamily: "monospace" }}>
            {totalFootage.toLocaleString()} ft
          </div>
        </div>

        <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>Bore / Trench Footage</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#38bdf8", marginTop: 4, fontFamily: "monospace" }}>
            {(job.completedBoreFt ?? 0).toLocaleString()} ft
          </div>
        </div>

        <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>Cable Placing Footage</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#38bdf8", marginTop: 4, fontFamily: "monospace" }}>
            {(job.completedPlacingFt ?? 0).toLocaleString()} ft
          </div>
        </div>

        <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>Closeout Readiness</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: allComplete ? "#34d399" : "#fbbf24", marginTop: 4 }}>
            {allComplete ? "100% READY" : "IN REVIEW"}
          </div>
        </div>
      </div>

      {/* Closeout Prerequisites Checklist */}
      <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#ffffff" }}>
          Closeout Prerequisites & QA Checklist
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(0,0,0,0.3)", padding: "12px 16px", borderRadius: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checklist.locatesCleared}
              onChange={() => toggleItem("locatesCleared")}
              style={{ width: 16, height: 16, accentColor: "#10b981" }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#f8fafc" }}>811 Locate Ticket Cleared & Excavation Safe</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>Ticket #{job.locateNumber || "WA-LOC-VALID"} verified clear of utility conflicts</div>
            </div>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(0,0,0,0.3)", padding: "12px 16px", borderRadius: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checklist.splicingCompleted}
              onChange={() => toggleItem("splicingCompleted")}
              style={{ width: 16, height: 16, accentColor: "#10b981" }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#f8fafc" }}>Splicing & Terminal Terminations Verified</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>All multiport terminals and hub feeder fibers tested and verified</div>
            </div>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(0,0,0,0.3)", padding: "12px 16px", borderRadius: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checklist.photosUploaded}
              onChange={() => toggleItem("photosUploaded")}
              style={{ width: 16, height: 16, accentColor: "#10b981" }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#f8fafc" }}>Field Evidence & Inspection Photos Attached</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>Vault, handhole, and pedestal completion photos archived in 03-Field</div>
            </div>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(0,0,0,0.3)", padding: "12px 16px", borderRadius: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checklist.redlinesRegistered}
              onChange={() => toggleItem("redlinesRegistered")}
              style={{ width: 16, height: 16, accentColor: "#10b981" }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#f8fafc" }}>Plan Set Redlines Georeferenced & Registered</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>2-Point affine matrix aligned to ground coordinates</div>
            </div>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(0,0,0,0.3)", padding: "12px 16px", borderRadius: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checklist.permitSatisfied}
              onChange={() => toggleItem("permitSatisfied")}
              style={{ width: 16, height: 16, accentColor: "#10b981" }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#f8fafc" }}>Municipal Permit Restoration & ROW Sign-Off</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>Pavement and softscape restoration inspected and approved</div>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
