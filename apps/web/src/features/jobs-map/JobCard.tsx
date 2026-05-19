// Compact job card. Shows exactly the fields the user picked:
//   Work Order (job #), Address, City, Secondary Job Status,
//   Construction Crew/Foreman, Schedule Date, Traffic Control,
//   NSC Project Notes, Actual Completion Date.
// Plus Job Status as a pill (used for marker color too).
// Phase 4.2: minimizable — collapses to a slim bottom-right pill.
// Phase 5.3: secondary-status pill moved to header row alongside WO number.
import { useEffect, useState } from "react";
import type { Job, QuickReferenceGist } from "@nsc/types";
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
  const [syncing, setSyncing] = useState(false);
  const [quickModeOpen, setQuickModeOpen] = useState(false);
  const wo = job.workOrder;
  const status = job.jobStatus ?? "—";

  // Phase 8: load reference layer gist for sync chip state
  useEffect(() => {
    let cancelled = false;
    api.getGist(job.jobId)
      .catch(() => ({ gist: null as QuickReferenceGist | null }))
      .then((g) => { if (!cancelled) setGist(g.gist); });
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

  // Sync chip state: "none" | "out_of_date" | "synced"
  const chipState: "none" | "out_of_date" | "synced" =
    !gist ? "none" : gist.outOfDate ? "out_of_date" : "synced";

  return (
    <div className={`job-card job-card--${variant}`}>
      {/* Top row: WO# + status pill + sync chip + minimize/close */}
      <header className="job-card__head">
        <div className="job-card__head-left">
          <span className="job-card__wo">{wo}</span>
          <span className={`status-pill status-${slugify(status)}`} style={{ fontSize: 9 }}>
            {status}
          </span>
          {job.secondaryJobStatus && (
            <SecondaryStatusPill status={job.secondaryJobStatus} />
          )}
          {!job.inTracker && (
            <span className="status-pill status-archived">Archived</span>
          )}
          <SyncChip state={chipState} syncing={syncing} onSync={handleSyncGist} />
        </div>

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

      {quickModeOpen && (
        <QuickModeDialog
          jobId={job.jobId}
          onClose={() => setQuickModeOpen(false)}
          onSaved={(g) => { setGist(g); setQuickModeOpen(false); }}
        />
      )}

      {/* Second row: Address, City */}
      <Row label="Address" value={job.address} />
      <Row label="City" value={job.city} />

      {/* Main details */}
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

      {/* Notes block: collapsed to 2-3 lines unless expanded */}
      {job.nscProjectNotes && (
        <NotesBlock notes={job.nscProjectNotes} />
      )}

      {/* Footer: Enter Workspace + Sync Ref Layer + Quick Mode */}
      <footer className="job-card__foot">
        <Link to={`/jobs/${job.jobId}`} className="btn btn--primary">
          Enter Workspace →
        </Link>
        <button
          type="button"
          className="btn"
          onClick={handleSyncGist}
          disabled={syncing}
          title="Sync Reference Layer"
        >
          {syncing ? "Syncing…" : "Sync Reference Layer ⟳"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setQuickModeOpen(true)}
          title="Add a lightweight backfill entry for this job"
        >
          ⚡ Quick Mode
        </button>
      </footer>
    </div>
  );
}

function SyncChip({
  state,
  syncing,
  onSync,
}: {
  state: "none" | "out_of_date" | "synced";
  syncing: boolean;
  onSync: () => void;
}) {
  const cfg = state === "synced"
    ? { color: "#39ff7a", bg: "#39ff7a22", icon: "✓", label: "Synced", title: "Reference layer synced" }
    : state === "out_of_date"
      ? { color: "#ff2d4a", bg: "#ff2d4a22", icon: "●", label: "Out of date", title: "Reference layer out of date" }
      : { color: "var(--text-muted)", bg: "var(--surface-2)", icon: "○", label: "No ref", title: "No reference layer yet" };
  return (
    <span
      title={cfg.title}
      style={{
        marginLeft: 6,
        padding: "1px 6px",
        borderRadius: 4,
        background: cfg.bg,
        border: `1px solid ${cfg.color}`,
        color: cfg.color,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 9,
        fontWeight: 600,
      }}
    >
      <span>{cfg.icon} {cfg.label}</span>
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        title="Re-sync from job card"
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
  );
}

function NotesBlock({ notes }: { notes: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = notes.length > 140 || notes.split("\n").length > 3;
  return (
    <div className="job-card__notes">
      <div className="job-card__notes-label">NSC Project Notes</div>
      <div
        className="job-card__notes-body"
        style={
          !expanded
            ? {
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
            : undefined
        }
      >
        {notes}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            border: 0,
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 10,
            padding: "2px 0",
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
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
