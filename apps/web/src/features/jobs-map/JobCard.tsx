// Compact job card. Shows exactly the fields the user picked:
//   Work Order (job #), Address, City, Secondary Job Status,
//   Construction Crew/Foreman, Schedule Date, Traffic Control,
//   NSC Project Notes, Actual Completion Date.
// Plus Job Status as a pill (used for marker color too).
// Phase 4.2: minimizable — collapses to a slim bottom-right pill.
// Phase 5.3: secondary-status pill moved to header row alongside WO number.
import { useEffect, useState } from "react";
import type { EngineeringPrint, Job, QuickReferenceGist } from "@nsc/types";
import { Link } from "react-router-dom";
import { MARKER_COLORS, colorKeyForSecondaryStatus } from "./markerStyle.js";
import { api } from "../../lib/api.js";
import QuickModeDialog from "./QuickModeDialog.js";

interface Props {
  job: Job;
  onClose?: () => void;
  variant?: "popup" | "panel";
}

export default function JobCard({ job, onClose, variant = "popup" }: Props) {
  const [minimized, setMinimized] = useState(false);
  const [gist, setGist] = useState<QuickReferenceGist | null>(null);
  const [hasActivePrint, setHasActivePrint] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [quickModeOpen, setQuickModeOpen] = useState(false);
  const wo = job.workOrder;
  const status = job.jobStatus ?? "—";

  // Phase 7: load gist + prints metadata to display badges + sync icon
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getGist(job.jobId).catch(() => ({ gist: null as QuickReferenceGist | null })),
      api.listPrints(job.jobId).catch(() => ({ prints: [] as EngineeringPrint[], count: 0 })),
    ]).then(([g, p]) => {
      if (cancelled) return;
      setGist(g.gist);
      setHasActivePrint(p.prints.some((x) => x.active));
    });
    return () => { cancelled = true; };
  }, [job.jobId]);

  async function handleSyncGist() {
    setSyncing(true);
    try {
      const { gist: g } = await api.syncGist(job.jobId);
      setGist(g);
    } catch {
      // ignore — surfaced in workspace if needed
    } finally {
      setSyncing(false);
    }
  }

  // Minimized pill — always rendered in popup variant
  if (minimized && variant === "popup") {
    return (
      <div className="job-card-pill" title={`${wo} · ${status}`}>
        <span className="job-card-pill__wo">{wo}</span>
        <button
          className="job-card-pill__restore icon-btn"
          onClick={() => setMinimized(false)}
          aria-label="Restore job card"
          title="Restore"
        >
          ⌃
        </button>
        {onClose && (
          <button
            className="job-card-pill__close icon-btn"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`job-card job-card--${variant}`}>
      <header className="job-card__head">
        {/* Left: WO number + secondary status pill on same row */}
        <div className="job-card__head-left">
          <span className="job-card__wo">{wo}</span>
          {job.secondaryJobStatus && (
            <SecondaryStatusPill status={job.secondaryJobStatus} />
          )}
          {!job.inTracker && (
            <span className="status-pill status-archived">Archived</span>
          )}
        </div>

        {/* Right: minimize + close buttons */}
        <div className="job-card__head-actions">
          {variant === "popup" && (
            <button
              className="icon-btn"
              onClick={() => setMinimized(true)}
              aria-label="Minimize job card"
              title="Minimize"
            >
              −
            </button>
          )}
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
      </header>

      {/* Primary job status row */}
      <div style={{ paddingLeft: 12, paddingBottom: 4, marginTop: -2 }}>
        <span className={`status-pill status-${slugify(status)}`} style={{ fontSize: 9 }}>
          {status}
        </span>
      </div>

      {/* Phase 7: Engineering Print + Quick Reference indicators */}
      <div
        style={{
          padding: "0 12px 6px",
          display: "flex",
          gap: 6,
          alignItems: "center",
          flexWrap: "wrap",
          fontSize: 9,
        }}
      >
        {hasActivePrint && (
          <span
            title="Engineering print attached for this job"
            style={{
              padding: "1px 6px",
              borderRadius: 4,
              background: "#3aa7ff22",
              border: "1px solid #3aa7ff",
              color: "#3aa7ff",
              fontWeight: 600,
            }}
          >
            📄 Engineering Print Attached
          </span>
        )}
        <span
          title={gist ? (gist.outOfDate ? "Reference layer out of date" : "Reference layer synced") : "No reference layer yet"}
          style={{
            padding: "1px 6px",
            borderRadius: 4,
            background: gist ? (gist.outOfDate ? "#ff2d4a22" : "#39ff7a22") : "var(--surface-2)",
            border: `1px solid ${gist ? (gist.outOfDate ? "#ff2d4a" : "#39ff7a") : "var(--border)"}`,
            color: gist ? (gist.outOfDate ? "#ff2d4a" : "#39ff7a") : "var(--text-muted)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {gist ? (gist.outOfDate ? "● Ref outdated" : "✓ Ref synced") : "○ No ref"}
          <button
            type="button"
            onClick={handleSyncGist}
            disabled={syncing}
            title="Sync Reference Layer"
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              padding: 0,
              fontSize: 10,
              color: "inherit",
              opacity: syncing ? 0.5 : 1,
            }}
          >
            ⟳
          </button>
        </span>
        <button
          type="button"
          onClick={() => setQuickModeOpen(true)}
          style={{
            padding: "1px 6px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            color: "var(--text)",
            cursor: "pointer",
            fontSize: 9,
          }}
          title="Add a lightweight backfill entry for this job"
        >
          ⚡ Quick Mode
        </button>
      </div>

      {quickModeOpen && (
        <QuickModeDialog
          jobId={job.jobId}
          onClose={() => setQuickModeOpen(false)}
          onSaved={(g) => { setGist(g); setQuickModeOpen(false); }}
        />
      )}

      <Row label="Address" value={job.address} />
      <Row label="City" value={job.city} />
      <Row label="Crew / Foreman" value={job.constructionCrewForeman} />
      <Row label="Schedule Date" value={fmtDate(job.scheduleDate)} />
      <Row
        label="Traffic Control"
        value={
          job.trafficControlRequired === true
            ? "Required"
            : job.trafficControlRequired === false
              ? "Not required"
              : null
        }
      />
      <Row
        label="Completed"
        value={fmtDate(job.actualCompletionDate)}
      />

      {job.nscProjectNotes && (
        <div className="job-card__notes">
          <div className="job-card__notes-label">NSC Project Notes</div>
          <div className="job-card__notes-body">{job.nscProjectNotes}</div>
        </div>
      )}

      <footer className="job-card__foot">
        <Link to={`/jobs/${job.jobId}`} className="btn btn--primary">
          Open workspace →
        </Link>
        <Link to={`/asbuilt?jobId=${encodeURIComponent(job.workOrder ?? job.jobId)}`} className="btn btn--primary">
          Enter As-Built →
        </Link>
      </footer>
    </div>
  );
}

// Colored chip matching the neon pin color for this secondary status
function SecondaryStatusPill({ status }: { status: string }) {
  const key = colorKeyForSecondaryStatus(status);
  const color = MARKER_COLORS[key];
  return (
    <span
      className="job-card__secondary-pill"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 7px",
        borderRadius: 10,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.05em",
        background: `${color.core}22`,
        border: `1px solid ${color.core}88`,
        color: color.core,
        whiteSpace: "nowrap",
        verticalAlign: "middle",
        marginLeft: 6,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color.core,
          boxShadow: `0 0 4px ${color.glow}`,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      {status}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="job-card__row">
      <span className="job-card__row-label">{label}</span>
      <span className="job-card__row-value">{value}</span>
    </div>
  );
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  return d;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
