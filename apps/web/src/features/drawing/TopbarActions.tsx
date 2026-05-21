// TopbarActions — Undo / Redo / Screenshot / Save "polished metal coin" buttons in the topbar.
// Phase 5: workspace mode shows auto-save status pill instead of the manual save coin.
// Phase 5.2: when noTarget && dirty, Save opens SaveDrawingDialog instead of calling save().
// Phase 5.3: Save/Undo/Redo always enabled; Cmd+Z / Cmd+Shift+Z shortcuts.
// Lives outside the DrawingProvider on routes like /sync, so it must gracefully
// handle the case where DrawingContext is absent.
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
  // Phase 5.3: "nothing to undo" flash
  const [undoFlash, setUndoFlash] = useState(false);
  const [redoFlash, setRedoFlash] = useState(false);

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
    if (!ctx) return;
    const map = ctx.mapRef?.current;
    if (!map) {
      alert("Map is not ready.");
      return;
    }
    setScreenshotting(true);
    try {
      await downloadScreenshot(map, ctx.state.objects);
    } catch (err) {
      alert(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScreenshotting(false);
    }
  }

  if (!ctx) {
    // Outside DrawingProvider — render disabled coin buttons as placeholders
    return (
      <div className="topbar-actions">
        {isWorkspace && (
          <CoinBtn onClick={() => navigate("/")} title="Back to Jobs Map" variant="back">←</CoinBtn>
        )}
        <CoinBtn disabled title="Undo">↶</CoinBtn>
        <CoinBtn disabled title="Redo">↷</CoinBtn>
        <CoinBtn disabled title="Screenshot">
          <ScreenshotIcon />
        </CoinBtn>
        <CoinBtn disabled title="Save" variant="save">💾</CoinBtn>
      </div>
    );
  }

  const { state, undo, redo, canUndo, canRedo, save } = ctx;
  const { dirty, saving: isSaving, saveError, targetJobId, targetWorkOrder, autoSaveCountdown } = state;
  const noTarget = !targetJobId;
  // Phase 5.2: "Save as new job" mode — no target but objects exist
  const canSaveNew = noTarget && state.objects.length > 0;

  function handleUndo() {
    if (!canUndo) {
      // Flash "nothing to undo"
      setUndoFlash(true);
      setTimeout(() => setUndoFlash(false), 1200);
      return;
    }
    undo();
  }

  function handleRedo() {
    if (!canRedo) {
      setRedoFlash(true);
      setTimeout(() => setRedoFlash(false), 1200);
      return;
    }
    redo();
  }

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

        {/* Phase 5.3: always enabled; flash if nothing to undo */}
        <CoinBtn
          onClick={handleUndo}
          title={undoFlash ? "Nothing to undo" : "Undo (Cmd+Z)"}
          extraClass={undoFlash ? "coin-btn--flash" : undefined}
        >↶</CoinBtn>
        <CoinBtn
          onClick={handleRedo}
          title={redoFlash ? "Nothing to redo" : "Redo (Cmd+Shift+Z)"}
          extraClass={redoFlash ? "coin-btn--flash" : undefined}
        >↷</CoinBtn>

        {/* Screenshot button */}
        <CoinBtn
          onClick={handleScreenshot}
          disabled={screenshotting || noTarget}
          title={noTarget ? "Select a job first" : "Download screenshot (PNG)"}
        >
          {screenshotting ? "⏳" : <ScreenshotIcon />}
        </CoinBtn>

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
        <span className="autosave-pill__text">Saved</span>
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
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
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
