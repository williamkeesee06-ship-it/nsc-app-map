import { useState, useEffect, useCallback } from "react";
import type { Job, GeoFeatureRevision } from "@nsc/types";
import { api } from "../../lib/api.js";
import RevisionReviewConsole from "./RevisionReviewConsole.js";
import {
  ExternalLink,
  Copy,
  Check,
  UploadCloud,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
  RefreshCw,
} from "lucide-react";

interface Props {
  job: Job;
  onGeometryUpdated?: () => void;
}

export default function EarthDesignPanel({ job, onGeometryUpdated }: Props) {
  const [copied, setCopied] = useState(false);
  const [revisions, setRevisions] = useState<GeoFeatureRevision[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<GeoFeatureRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [kmlInput, setKmlInput] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const networkLinkUrl = `${window.location.origin}/api/earth/network-link/${encodeURIComponent(job.jobId)}.kml`;

  const loadRevisions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listEarthRevisions(job.jobId);
      if (res.ok && Array.isArray(res.revisions)) {
        setRevisions(res.revisions);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [job.jobId]);

  useEffect(() => {
    loadRevisions();
  }, [loadRevisions]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(networkLinkUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenEarth = () => {
    window.open("https://earth.google.com/web", "_blank", "noopener,noreferrer");
  };

  const handleUploadKml = async () => {
    if (!kmlInput.trim()) return;
    setUploading(true);
    try {
      await api.submitEarthKml(job.jobId, kmlInput.trim());
      setKmlInput("");
      setShowUploadModal(false);
      setActionMessage("✓ Candidate KML submitted for review");
      loadRevisions();
    } catch (err: any) {
      setActionMessage(`Upload failed: ${err?.message || "Error"}`);
    } finally {
      setUploading(false);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  const handleApproveRevision = async (revisionId: string) => {
    try {
      await api.approveEarthRevision(job.jobId, revisionId);
      setActionMessage("✓ Revision approved and promoted to canonical geometry");
      loadRevisions();
      onGeometryUpdated?.();
    } catch (err: any) {
      setActionMessage(`Approval failed: ${err?.message || "Error"}`);
    } finally {
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16, background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 12, color: "#f8fafc", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", color: "#38bdf8", textTransform: "uppercase" }}>
            Google Earth Companion Bridge
          </span>
          <h3 style={{ margin: "2px 0 0 0", fontSize: 15, fontWeight: 800, color: "#ffffff" }}>
            {job.displayName || job.workOrder}
          </h3>
        </div>

        <button
          type="button"
          onClick={handleOpenEarth}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
            border: "1px solid #38bdf8",
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 800,
            padding: "6px 12px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <ExternalLink size={13} /> Launch Google Earth
        </button>
      </div>

      {actionMessage && (
        <div style={{ background: "rgba(6, 182, 212, 0.15)", border: "1px solid rgba(6, 182, 212, 0.4)", color: "#22d3ee", padding: "8px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
          {actionMessage}
        </div>
      )}

      {/* Network Link Feed Box */}
      <div style={{ background: "rgba(0, 0, 0, 0.3)", border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>
          Dynamic KML Network Link Feed (60s Auto-Refresh)
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            readOnly
            value={networkLinkUrl}
            style={{ flex: 1, background: "rgba(0, 0, 0, 0.5)", border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: 6, padding: "6px 8px", color: "#38bdf8", fontSize: 11, fontFamily: "monospace" }}
          />
          <button
            type="button"
            onClick={handleCopyLink}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: copied ? "#10b981" : "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              color: "#ffffff",
              fontSize: 11,
              fontWeight: 800,
              padding: "6px 10px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* Action Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => setShowUploadModal(!showUploadModal)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            color: "#e2e8f0",
            fontSize: 11,
            fontWeight: 800,
            padding: "6px 12px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <UploadCloud size={13} /> Upload Earth KML/KMZ Candidate
        </button>

        <button
          type="button"
          onClick={loadRevisions}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} /> Refresh Revisions
        </button>
      </div>

      {/* Upload Modal Drawer */}
      {showUploadModal && (
        <div style={{ background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(56, 189, 248, 0.3)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#38bdf8" }}>Paste Raw KML Payload:</div>
          <textarea
            value={kmlInput}
            onChange={(e) => setKmlInput(e.target.value)}
            rows={5}
            placeholder="<kml xmlns=...>...</kml>"
            style={{ width: "100%", background: "rgba(0, 0, 0, 0.6)", border: "1px solid rgba(255, 255, 255, 0.15)", borderRadius: 6, padding: 8, color: "#f8fafc", fontSize: 10, fontFamily: "monospace", resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              onClick={() => setShowUploadModal(false)}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "#94a3b8", fontSize: 11, padding: "4px 10px", borderRadius: 4, cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUploadKml}
              disabled={uploading || !kmlInput.trim()}
              style={{ background: "#0284c7", border: "none", color: "#ffffff", fontSize: 11, fontWeight: 800, padding: "4px 12px", borderRadius: 4, cursor: "pointer" }}
            >
              {uploading ? "Submitting..." : "Submit Candidate"}
            </button>
          </div>
        </div>
      )}

      {/* Revisions & Approvals Ledger */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#cbd5e1", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Revisions & Approval Queue ({revisions.length})
        </div>

        {revisions.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "#64748b", fontSize: 11, background: "rgba(0,0,0,0.2)", borderRadius: 8 }}>
            No pending revisions. Earth designs publish directly to the live Network Link.
          </div>
        ) : (
          revisions.map((rev) => {
            const isPending = rev.lifecycle === "pending_review";
            const isApproved = rev.lifecycle === "approved";

            return (
              <div
                key={rev.id}
                style={{
                  background: isPending ? "rgba(245, 158, 11, 0.08)" : "rgba(0, 0, 0, 0.25)",
                  border: `1px solid ${isPending ? "rgba(245, 158, 11, 0.3)" : "rgba(255, 255, 255, 0.08)"}`,
                  borderRadius: 8,
                  padding: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      fontSize: 9,
                      fontWeight: 900,
                      padding: "2px 6px",
                      borderRadius: 4,
                      textTransform: "uppercase",
                      background: isApproved ? "rgba(16, 185, 129, 0.2)" : isPending ? "rgba(245, 158, 11, 0.2)" : "rgba(255,255,255,0.1)",
                      color: isApproved ? "#34d399" : isPending ? "#fbbf24" : "#94a3b8",
                    }}>
                      {rev.lifecycle}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#ffffff" }}>
                      {rev.id}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                    Submitted by {rev.submittedBy} · {new Date(rev.submittedAt).toLocaleString()}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setSelectedRevision(rev)}
                    style={{
                      background: "rgba(255, 255, 255, 0.06)",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      color: "#e2e8f0",
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "5px 10px",
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    Compare Diff
                  </button>

                  {isPending && (
                    <button
                      type="button"
                      onClick={() => handleApproveRevision(rev.id)}
                      style={{
                        background: "#10b981",
                        border: "none",
                        color: "#ffffff",
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "5px 10px",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      Approve
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Revision Review Console Modal */}
      {selectedRevision && (
        <RevisionReviewConsole
          job={job}
          revision={selectedRevision}
          onClose={() => setSelectedRevision(null)}
          onApproved={() => {
            setSelectedRevision(null);
            loadRevisions();
            onGeometryUpdated?.();
          }}
        />
      )}
    </div>
  );
}
