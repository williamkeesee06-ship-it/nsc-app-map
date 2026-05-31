// SaveDrawingDialog — Phase 5.2
// Modal that appears when the user hits Save with no targetJobId.
// Two tabs: "Attach to existing job" and "Create new job".
import { useEffect, useRef, useState } from "react";
import type { Job } from "@nsc/types";
import { api } from "../../lib/api.js";
import { useDrawing } from "./drawingContext.js";
import { useAuth } from "../auth/authContext.js";

interface Props {
  jobs: Job[];
  onClose: () => void;
  onJobsRefresh: () => void;
}

type Tab = "attach" | "create" | "field";

// Sentinel jobId for field findings — markups not attached to any work order.
// Each supervisor gets one bucket doc keyed by their slug.
function fieldFindingJobId(username: string | null | undefined): string {
  const slug = (username ?? "unknown").trim().toLowerCase().replace(/\s+/g, "-") || "unknown";
  return `__ff__${slug}`;
}

export default function SaveDrawingDialog({ jobs, onClose, onJobsRefresh }: Props) {
  const { state, dispatch, setTarget, save, clearDraft } = useDrawing();
  const { username } = useAuth();
  const [tab, setTab] = useState<Tab>("attach");

  // ── Attach to existing ──────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const filteredJobs = searchQuery.trim()
    ? jobs
        .filter((j) => {
          const q = searchQuery.toLowerCase();
          return (
            j.workOrder.toLowerCase().includes(q) ||
            (j.address ?? "").toLowerCase().includes(q) ||
            (j.nscProjectNotes ?? "").toLowerCase().includes(q)
          );
        })
        .slice(0, 8)
    : [];

  // ── Create new ──────────────────────────────────────────────────────────
  const [woInput, setWoInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [addrInput, setAddrInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Field finding (no job attached) ────────────────────────────────────
  const [findingNote, setFindingNote] = useState("");

  // ── Shared ──────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);

  // Keep a ref to the current objects/state for manual saving
  const objectsRef = useRef(state.objects);
  objectsRef.current = state.objects;

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Close on backdrop click
  function onBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  // Save directly by calling the API with a specific jobId (bypasses context.save()
  // which needs a re-render cycle to pick up the new target).
  async function saveToJob(jobId: string) {
    const objects = objectsRef.current;
    const payload = {
      jobId,
      objects,
      updatedAt: Date.now(),
      schemaVersion: 2 as const,
    };
    await api.putDrawing(jobId, payload as Parameters<typeof api.putDrawing>[1], username ?? undefined);
    // Also update context state to reflect saved
    dispatch({ type: "MARK_SAVED" });
  }

  async function handleAttach() {
    if (!selectedJob) return;
    setSubmitting(true);
    try {
      setTarget(selectedJob.jobId, selectedJob.workOrder);
      await saveToJob(selectedJob.jobId);
      clearDraft();
      onClose();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFieldFinding() {
    setCreateError(null);
    if (!username) {
      setCreateError("Sign in required to save a field finding.");
      return;
    }
    setSubmitting(true);
    try {
      const ffJobId = fieldFindingJobId(username);

      // Optionally apply the note as userLabel/description on any objects
      // that don't already have a label, so the bucket markups read nicely.
      const note = findingNote.trim();
      const objects = objectsRef.current.map((o) => {
        if (!note) return o;
        const obj = o as unknown as Record<string, unknown>;
        const style = (obj.style ?? {}) as Record<string, unknown>;
        const hasLabel =
          (typeof style.userLabel === "string" && style.userLabel.trim()) ||
          (typeof obj.description === "string" && (obj.description as string).trim()) ||
          (typeof obj.text === "string" && (obj.text as string).trim());
        if (hasLabel) return o;
        // Attach as userLabel for points, description otherwise.
        if ("position" in obj && !("text" in obj)) {
          return { ...obj, style: { ...style, userLabel: note } } as unknown as typeof o;
        }
        return { ...obj, description: note } as unknown as typeof o;
      });

      const payload = {
        jobId: ffJobId,
        objects,
        updatedAt: Date.now(),
        schemaVersion: 2 as const,
      };
      await api.putDrawing(
        ffJobId,
        payload as Parameters<typeof api.putDrawing>[1],
        username
      );
      dispatch({ type: "MARK_SAVED" });
      clearDraft();
      onClose();

      // Notify global markups overlay so the new field finding appears immediately
      window.dispatchEvent(new CustomEvent("nsc:markups-saved", {
        detail: { jobId: ffJobId }
      }));
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreate() {
    setCreateError(null);
    const wo = woInput.trim();
    const name = nameInput.trim();
    const addr = addrInput.trim() || undefined;
    if (!wo) {
      setCreateError("Work Order # is required");
      return;
    }
    if (!name) {
      setCreateError("Job Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.createJob({ workOrder: wo, jobName: name, address: addr });
      setTarget(result.jobId, result.workOrder);
      await saveToJob(result.jobId);
      clearDraft();
      // Refresh jobs list so new pin appears on map
      onJobsRefresh();
      onClose();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onBackdrop}
    >
      <div
        style={{
          width: 460,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--chrome-bg, #1a1f2e)",
          border: "1px solid var(--chrome-border, rgba(255,255,255,0.12))",
          borderRadius: 14,
          padding: "24px 28px 20px",
          color: "var(--text-primary, #e8eaf0)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <h2
            style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: 0.2 }}
          >
            Save drawing
          </h2>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: "var(--text-muted, #8a9bb0)",
            }}
          >
            Your drawing isn't attached to a job yet. Choose where to save it.
          </p>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 20,
            borderBottom:
              "1px solid var(--chrome-border, rgba(255,255,255,0.1))",
          }}
        >
          {(["attach", "create", "field"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setCreateError(null);
              }}
              style={{
                background: "none",
                border: "none",
                padding: "8px 14px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: tab === t ? 700 : 400,
                color:
                  tab === t
                    ? "var(--neon-cyan, #3aa7ff)"
                    : "var(--text-muted, #8a9bb0)",
                borderBottom:
                  tab === t
                    ? "2px solid var(--neon-cyan, #3aa7ff)"
                    : "2px solid transparent",
                marginBottom: -1,
                transition: "color 0.15s",
              }}
            >
              {t === "attach"
                ? "Attach to existing"
                : t === "create"
                  ? "Create new job"
                  : "Field finding"}
            </button>
          ))}
        </div>

        {/* Tab: Attach to existing */}
        {tab === "attach" && (
          <div>
            <label style={labelStyle}>Search by WO# or address</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedJob(null);
              }}
              placeholder="e.g. 12345 or Main St"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              style={inputStyle}
            />
            {filteredJobs.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  borderRadius: 8,
                  border:
                    "1px solid var(--chrome-border, rgba(255,255,255,0.1))",
                  overflow: "hidden",
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                {filteredJobs.map((j) => (
                  <button
                    key={j.jobId}
                    type="button"
                    onClick={() => setSelectedJob(j)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      border: "none",
                      background:
                        selectedJob?.jobId === j.jobId
                          ? "rgba(58,167,255,0.15)"
                          : "rgba(255,255,255,0.03)",
                      borderLeft:
                        selectedJob?.jobId === j.jobId
                          ? "3px solid var(--neon-cyan, #3aa7ff)"
                          : "3px solid transparent",
                      color: "var(--text-primary, #e8eaf0)",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        color: "var(--neon-cyan, #3aa7ff)",
                      }}
                    >
                      {j.workOrder}
                    </span>
                    {j.address && (
                      <span
                        style={{
                          marginLeft: 10,
                          color: "var(--text-muted, #8a9bb0)",
                          fontSize: 12,
                        }}
                      >
                        {j.address}
                      </span>
                    )}
                    {j.secondaryJobStatus && (
                      <span
                        style={{
                          marginLeft: 10,
                          fontSize: 11,
                          opacity: 0.6,
                        }}
                      >
                        {j.secondaryJobStatus}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {searchQuery.trim() && filteredJobs.length === 0 && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-muted, #8a9bb0)",
                  marginTop: 8,
                }}
              >
                No jobs match &ldquo;{searchQuery}&rdquo;
              </p>
            )}
            {selectedJob && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "rgba(58,167,255,0.1)",
                  border: "1px solid rgba(58,167,255,0.25)",
                  fontSize: 13,
                }}
              >
                <strong>{selectedJob.workOrder}</strong>
                {selectedJob.address && <> · {selectedJob.address}</>}
                {selectedJob.secondaryJobStatus && (
                  <>
                    {" "}
                    ·{" "}
                    <em style={{ opacity: 0.7 }}>{selectedJob.secondaryJobStatus}</em>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab: Create new */}
        {tab === "create" && (
          <div>
            <label style={labelStyle}>
              Work Order #{" "}
              <span style={{ color: "var(--danger, #ff4466)" }}>*</span>
            </label>
            <input
              type="text"
              value={woInput}
              onChange={(e) => setWoInput(e.target.value)}
              placeholder="e.g. TEST-123"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              style={inputStyle}
            />
            <label style={{ ...labelStyle, marginTop: 14 }}>
              Job Name{" "}
              <span style={{ color: "var(--danger, #ff4466)" }}>*</span>
            </label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Field test – Oak St"
              style={inputStyle}
            />
            <label style={{ ...labelStyle, marginTop: 14 }}>
              Address{" "}
              <span style={{ opacity: 0.5, fontSize: 11 }}>
                (optional — for map pin)
              </span>
            </label>
            <input
              type="text"
              value={addrInput}
              onChange={(e) => setAddrInput(e.target.value)}
              placeholder="e.g. 123 Main St, Seattle WA"
              style={inputStyle}
            />
            <p
              style={{
                fontSize: 11,
                color: "var(--text-muted, #8a9bb0)",
                marginTop: 10,
                marginBottom: 0,
              }}
            >
              Drawing will be linked to this new job and saved to Firestore.
            </p>
          </div>
        )}

        {/* Tab: Field finding */}
        {tab === "field" && (
          <div>
            <label style={labelStyle}>
              Note{" "}
              <span style={{ opacity: 0.5, fontSize: 11 }}>
                (optional — fills in any unlabeled markups)
              </span>
            </label>
            <input
              type="text"
              value={findingNote}
              onChange={(e) => setFindingNote(e.target.value)}
              placeholder="e.g. Buried HH at edge of pavement"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              style={inputStyle}
            />
            <p
              style={{
                fontSize: 12,
                color: "var(--text-muted, #8a9bb0)",
                marginTop: 12,
                marginBottom: 0,
                lineHeight: 1.5,
              }}
            >
              <strong>This is the best way to document things you find in the field</strong> (cut cables, damaged pedestals, unmarked vaults, etc.) that are not part of a specific work order.
              These will appear as persistent overlays on the main Jobs Map under your name.
            </p>
          </div>
        )}

        {/* Error */}
        {createError && (
          <div
            style={{
              marginTop: 14,
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(255,46,74,0.12)",
              border: "1px solid rgba(255,46,74,0.3)",
              color: "#ff6b80",
              fontSize: 13,
            }}
          >
            {createError}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 24,
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={cancelBtnStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              submitting ||
              (tab === "attach"
                ? !selectedJob
                : tab === "create"
                  ? !woInput.trim() || !nameInput.trim()
                  : false)
            }
            onClick={
              tab === "attach"
                ? handleAttach
                : tab === "create"
                  ? handleCreate
                  : handleFieldFinding
            }
            style={{
              ...submitBtnStyle,
              opacity:
                submitting ||
                (tab === "attach"
                  ? !selectedJob
                  : tab === "create"
                    ? !woInput.trim() || !nameInput.trim()
                    : false)
                  ? 0.5
                  : 1,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting
              ? "Saving…"
              : tab === "attach"
                ? "Attach & Save"
                : tab === "create"
                  ? "Create & Save"
                  : "Save finding"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-muted, #8a9bb0)",
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8,
  padding: "9px 12px",
  color: "var(--text-primary, #e8eaf0)",
  fontSize: 14,
  outline: "none",
};

const cancelBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "9px 18px",
  color: "var(--text-muted, #8a9bb0)",
  fontSize: 13,
  cursor: "pointer",
};

const submitBtnStyle: React.CSSProperties = {
  background: "var(--neon-cyan, #3aa7ff)",
  border: "none",
  borderRadius: 8,
  padding: "9px 22px",
  color: "#000",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  transition: "opacity 0.15s",
};
