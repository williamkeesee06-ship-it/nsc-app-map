import { useState } from "react";
import type { Job, GeoFeatureRevision } from "@nsc/types";
import { api } from "../../lib/api.js";
import { CheckCircle2, XCircle, AlertTriangle, ArrowRight, Eye, RefreshCw } from "lucide-react";

interface Props {
  job: Job;
  revision: GeoFeatureRevision;
  onClose: () => void;
  onApproved?: () => void;
}

export default function RevisionReviewConsole({
  job,
  revision,
  onClose,
  onApproved,
}: Props) {
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const features = Array.isArray((revision.geometry as any)?.coordinates)
    ? (revision.geometry as any).coordinates
    : [];

  const handleApprove = async () => {
    setProcessing(true);
    try {
      await api.approveEarthRevision(job.jobId, revision.id);
      setStatusMessage("✓ Revision approved and promoted to canonical geometry");
      onApproved?.();
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setStatusMessage(`Approval failed: ${err?.message || "Error"}`);
      setProcessing(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.8)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#0a0f1d",
          border: "1px solid rgba(56, 189, 248, 0.3)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 720,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          color: "#f8fafc",
          overflow: "hidden",
          boxShadow: "0 25px 50px rgba(0, 0, 0, 0.9)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", color: "#38bdf8", textTransform: "uppercase" }}>
              Earth Bridge Revision Review Console
            </span>
            <h2 style={{ margin: "2px 0 0 0", fontSize: 18, fontWeight: 800, color: "#ffffff" }}>
              Candidate vs. Active Geometry Diff
            </h2>
          </div>

          <span
            style={{
              fontSize: 10,
              fontWeight: 900,
              padding: "4px 10px",
              borderRadius: 6,
              textTransform: "uppercase",
              background: revision.lifecycle === "approved" ? "rgba(16, 185, 129, 0.2)" : "rgba(245, 158, 11, 0.2)",
              color: revision.lifecycle === "approved" ? "#34d399" : "#fbbf24",
              border: `1px solid ${revision.lifecycle === "approved" ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)"}`,
            }}
          >
            {revision.lifecycle}
          </span>
        </div>

        {statusMessage && (
          <div style={{ padding: "10px 24px", background: "rgba(6, 182, 212, 0.15)", borderBottom: "1px solid rgba(6, 182, 212, 0.3)", color: "#22d3ee", fontSize: 12, fontWeight: 700 }}>
            {statusMessage}
          </div>
        )}

        {/* Content Body */}
        <div style={{ padding: 24, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Metadata Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>Job Standard</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#ffffff", marginTop: 4 }}>{job.displayName || job.workOrder}</div>
            </div>

            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>Submitted By</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#ffffff", marginTop: 4 }}>{revision.submittedBy}</div>
            </div>

            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>Submitted At</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#ffffff", marginTop: 4 }}>{new Date(revision.submittedAt).toLocaleTimeString()}</div>
            </div>
          </div>

          {/* Delta Statistics */}
          <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#cbd5e1", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
              Spatial & Footprint Deltas
            </div>

            <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>Parsed Candidate Features</span>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#38bdf8", marginTop: 2 }}>{features.length}</div>
              </div>

              <div>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>Added Linear Footage</span>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#34d399", marginTop: 2 }}>
                  +{revision.delta?.addedFootage || 0} ft
                </div>
              </div>

              <div>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>Removed Linear Footage</span>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#f87171", marginTop: 2 }}>
                  -{revision.delta?.removedFootage || 0} ft
                </div>
              </div>
            </div>
          </div>

          {/* Candidate Feature List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#cbd5e1", textTransform: "uppercase" }}>
              Candidate Placemarks ({features.length})
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              {features.map((feat: any, idx: number) => (
                <div
                  key={feat.id || idx}
                  style={{
                    background: "rgba(0, 0, 0, 0.3)",
                    border: "1px solid rgba(255, 255, 255, 0.04)",
                    borderRadius: 6,
                    padding: "8px 12px",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                  }}
                >
                  <span style={{ fontWeight: 800, color: "#f8fafc" }}>{feat.name || `Feature #${idx + 1}`}</span>
                  <span style={{ color: "#94a3b8", fontFamily: "monospace" }}>{feat.geometry?.type || "Geometry"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Rejection Form */}
          {showRejectForm && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#f87171" }}>Reason for Rejection / Changes Requested:</div>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Explain what needs adjustment before approval..."
                style={{ width: "100%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: 8, color: "#ffffff", fontSize: 11 }}
              />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", background: "rgba(0, 0, 0, 0.3)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "1px solid rgba(255, 255, 255, 0.2)", color: "#94a3b8", fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 6, cursor: "pointer" }}
          >
            Close
          </button>

          {revision.lifecycle === "pending_review" && (
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowRejectForm(!showRejectForm)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  color: "#fca5a5",
                  fontSize: 11,
                  fontWeight: 800,
                  padding: "6px 14px",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                <XCircle size={13} /> Reject Submission
              </button>

              <button
                type="button"
                onClick={handleApprove}
                disabled={processing}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#10b981",
                  border: "none",
                  color: "#ffffff",
                  fontSize: 11,
                  fontWeight: 800,
                  padding: "6px 18px",
                  borderRadius: 6,
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(16, 185, 129, 0.4)",
                }}
              >
                <CheckCircle2 size={14} /> {processing ? "Promoting..." : "Approve & Promote Geometry"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
