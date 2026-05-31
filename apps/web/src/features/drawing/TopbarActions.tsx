// TopbarActions — Screenshot + Save buttons in the topbar.
// - Screenshot: always available, captures entire visible app as JPEG
// - Shortcut: Ctrl/Cmd + Shift + S
// - Save: Ctrl/Cmd + S (or opens Save dialog when no target)
// Lives outside the DrawingProvider on routes like /sync.
import { useContext, useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DrawingContext } from "./drawingContext.js";
import { downloadScreenshot } from "./screenshot.js";
import SaveDrawingDialog from "./SaveDrawingDialog.js";
import LocateMeButton from "./LocateMe.js";
import { useJobsContext } from "../jobs-map/jobsContext.js";

export default function TopbarActions() {
  // Gracefully consume the context — may be null outside DrawingProvider routes
  const ctx = useContext(DrawingContext);
  // Phase 5.2: jobs list for SaveDrawingDialog (defaults to empty outside JobsProvider)
  const { jobs, refreshJobs } = useJobsContext();

  const [savedFlash, setSavedFlash] = useState(false);
  const [screenshotting, setScreenshotting] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  // Undo/redo lives in the LeftRail toolbox now.

  const location = useLocation();
  const navigate = useNavigate();

  // Is this a workspace route?
  const isWorkspace = location.pathname.startsWith("/jobs/");

  // Flash "Saved ✓" for 2 s after successful save
  const prevDirty = ctx?.state.dirty;
  const saving = ctx?.state.saving ?? false;

  // Stable refs for shortcuts
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const showSaveDialogRef = useRef(setShowSaveDialog);
  showSaveDialogRef.current = setShowSaveDialog;

  // Cmd/Ctrl+S shortcut — always active when context is available
  // Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z shortcuts — Phase 5.3
  useEffect(() => {
    if (!ctx) return;
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? "";
      const inInput = tag === "INPUT" || tag === "TEXTAREA";

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "s") {
        e.preventDefault();
        const { targetJobId, objects } = ctxRef.current!.state;
        if (!targetJobId && objects.length > 0) {
          showSaveDialogRef.current(true);
        } else {
          void ctxRef.current!.save();
        }
        return;
      }

      // Screenshot shortcut: Ctrl/Cmd + Shift + S
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleScreenshot();
        return;
      }

      // Undo / Redo shortcuts — don't fire inside text inputs
      if (!inInput && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        ctxRef.current!.undo();
        return;
      }
      if (!inInput && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        ctxRef.current!.redo();
        return;
      }
      if (!inInput && (e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        ctxRef.current!.redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx]);

  useEffect(() => {
    // When saving transitions from true → false and dirty becomes false, flash
    if (!saving && prevDirty === false && ctx) {
      setSavedFlash(true);
      const t = setTimeout(() => setSavedFlash(false), 2000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);

  async function handleScreenshot() {
    setScreenshotting(true);
    try {
      // The underlying function captures document.body (entire visible app),
      // so we don't strictly need the map ref anymore.
      const map = ctx?.mapRef?.current ?? null;
      const objects = ctx?.state.objects ?? [];
      await downloadScreenshot(map as any, objects);
    } catch (err) {
      alert(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScreenshotting(false);
    }
  }

  if (!ctx) {
    // Outside DrawingProvider — still allow full-screen screenshot
    return (
      <div className="topbar-actions">
        {isWorkspace && (
          <CoinBtn onClick={() => navigate("/")} title="Back to Jobs Map" variant="back">←</CoinBtn>
        )}
        <button
          type="button"
          className="screenshot-btn"
          onClick={handleScreenshot}
          disabled={screenshotting}
          title="Screenshot entire screen (JPEG) — Ctrl/Cmd + Shift + S"
          aria-label="Take full screen screenshot"
        >
          {screenshotting ? "⏳" : <ScreenshotIcon />}
        </button>
        <CoinBtn disabled title="Save" variant="save">💾</CoinBtn>
      </div>
    );
  }

  const { state, save } = ctx;
  const { dirty, saving: isSaving, saveError, targetJobId, targetWorkOrder, autoSaveCountdown } = state;
  const noTarget = !targetJobId;
  // Phase 5.2: "Save as new job" mode — no target but objects exist
  const canSaveNew = noTarget && state.objects.length > 0;


  function handleSave() {
    if (canSaveNew) {
      setShowSaveDialog(true);
    } else {
      // Always save — even if not dirty (force re-sync to Firestore)
      void save();
    }
  }

  function saveLabel() {
    if (isSaving) return "⏳";
    if (savedFlash) return "✓";
    return "💾";
  }

  function saveBtnTitle() {
    if (canSaveNew) return "Save as new job or attach to existing";
    if (noTarget) return "Save drawing";
    if (dirty) return "Save drawings";
    return "Re-sync to Firestore";
  }

  return (
    <>
      <div className="topbar-actions">
        {/* Phase 5: back arrow in workspace mode */}
        {isWorkspace && (
          <CoinBtn onClick={() => navigate("/")} title="Back to Jobs Map" variant="back">←</CoinBtn>
        )}

        {/* Phase 9: Locate Me */}
        <LocateMeButton />

        {/* Undo/Redo moved into LeftRail toolbox — see ToolsSection. */}

        {/* Screenshot button — always usable, even with no target job */}
        <button
          type="button"
          className="screenshot-btn"
          onClick={handleScreenshot}
          disabled={screenshotting}
          title="Screenshot entire screen (JPEG) — Ctrl/Cmd + Shift + S"
          aria-label="Take full screen screenshot"
        >
          {screenshotting ? "⏳" : <ScreenshotIcon />}
        </button>

        {/* Phase 5: workspace mode shows auto-save status pill */}
        {isWorkspace ? (
          <AutoSavePill
            dirty={dirty}
            saving={isSaving}
            saveError={saveError}
            autoSaveCountdown={autoSaveCountdown}
            savedFlash={savedFlash}
            workOrder={targetWorkOrder ?? targetJobId}
            onRetry={() => void save()}
          />
        ) : (
          <>
            {/* Save target badge */}
            <div className="save-target-badge">
              {noTarget ? (
                <span className="save-target-badge__hint">
                  {canSaveNew ? "Unsaved drawing" : "No job selected"}
                </span>
              ) : (
                <>
                  <span className="save-target-badge__hint">Saving to:</span>
                  <span className="save-target-badge__wo">{targetWorkOrder ?? targetJobId}</span>
                </>
              )}
              {saveError && (
                <span
                  style={{ fontSize: 9, color: "var(--danger)", cursor: "pointer" }}
                  title={saveError}
                  onClick={() => window.alert(`Save failed:\n\n${saveError}`)}
                >⚠ Failed (click for details)</span>
              )}
            </div>

            {/* Phase 5.3: always enabled save button */}
            <CoinBtn
              onClick={handleSave}
              disabled={isSaving}
              title={saveBtnTitle()}
              variant="save"
              extraClass={isSaving ? "saving" : savedFlash ? "saved" : undefined}
            >
              {saveLabel()}
            </CoinBtn>

            {/* Quick access to Field Findings — core use case: document cut cables,
                damage, or anything seen in the field not tied to a specific work order. */}
            {!isWorkspace && (
              <CoinBtn
                onClick={() => {
                  // Best experience: let the user draw immediately as a field finding.
                  // We set a synthetic target so autosave + tools work, then the Save
                  // button will offer to persist it as a proper Field Finding.
                  const ffId = `__ff__quick-${Date.now().toString(36)}`;
                  if (ctx && typeof ctx.setTarget === "function") {
                    ctx.setTarget(ffId, "Field Finding (unsaved)");
                  }
                  setShowSaveDialog(true);
                }}
                title="Start documenting something seen in the field (cut cables, damage, unmarked infrastructure, etc.). Draw now — it will save as a Field Finding visible on the main Jobs Map."
              >
                📍
              </CoinBtn>
            )}
          </>
        )}
      </div>

      {/* Phase 5.2: Save Drawing dialog */}
      {showSaveDialog && (
        <SaveDrawingDialog
          jobs={jobs}
          onClose={() => setShowSaveDialog(false)}
          onJobsRefresh={() => {
            setShowSaveDialog(false);
            refreshJobs();
          }}
        />
      )}
    </>
  );
}

// ─── Auto-Save Status Pill ─────────────────────────────────────────────────

interface AutoSavePillProps {
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  autoSaveCountdown: number | null;
  savedFlash: boolean;
  workOrder: string | null;
  onRetry: () => void;
}

function AutoSavePill({ dirty, saving, saveError, autoSaveCountdown, savedFlash, workOrder, onRetry }: AutoSavePillProps) {
  if (saveError) {
    return (
      <button
        type="button"
        className="autosave-pill autosave-pill--error"
        onClick={onRetry}
        title="Click to retry saving"
      >
        <span className="autosave-pill__dot" />
        <span className="autosave-pill__text">Save failed · Retry</span>
      </button>
    );
  }

  if (saving) {
    return (
      <div className="autosave-pill autosave-pill--saving">
        <span className="autosave-pill__spinner" />
        <span className="autosave-pill__text">Saving{workOrder ? ` ${workOrder}` : ""}…</span>
      </div>
    );
  }

  if (dirty && autoSaveCountdown !== null) {
    return (
      <div className="autosave-pill autosave-pill--pending">
        <span className="autosave-pill__dot" />
        <span className="autosave-pill__text">Unsaved · {autoSaveCountdown}s</span>
      </div>
    );
  }

  if (!dirty) {
    return (
      <div className={`autosave-pill autosave-pill--saved${savedFlash ? " autosave-pill--flash" : ""}`}>
        <span className="autosave-pill__dot" />
        <span className="autosave-pill__text" title="Visible on the main Jobs Map for this job">Saved ✓ on map</span>
      </div>
    );
  }

  // dirty but countdown not yet started
  return (
    <div className="autosave-pill autosave-pill--pending">
      <span className="autosave-pill__dot" />
      <span className="autosave-pill__text">Unsaved…</span>
    </div>
  );
}

function ScreenshotIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* Modern high-tech camera icon */}
      <rect x="3" y="5" width="18" height="14" rx="2" ry="2"/>
      <circle cx="12" cy="12" r="3.5"/>
      <path d="M8 2v3"/>
      <path d="M16 2v3"/>
      {/* Small tech accent line */}
      <line x1="19" y1="8" x2="21" y2="8" strokeWidth="1.5"/>
    </svg>
  );
}

function CoinBtn({
  children,
  onClick,
  disabled,
  title,
  variant,
  extraClass,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "save" | "back";
  extraClass?: string;
}) {
  const cls = [
    "coin-btn",
    variant === "save" ? "coin-btn--save" : "",
    variant === "back" ? "coin-btn--back" : "",
    extraClass ?? "",
  ].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}
