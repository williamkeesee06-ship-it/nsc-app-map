// TopbarActions — Undo / Redo / Screenshot / Save "polished metal coin" buttons in the topbar.
// Lives outside the DrawingProvider on routes like /sync, so it must gracefully
// handle the case where DrawingContext is absent.
import { useContext, useState, useEffect } from "react";
import { DrawingContext } from "./drawingContext.js";
import { downloadScreenshot } from "./screenshot.js";

export default function TopbarActions() {
  // Gracefully consume the context — may be null outside DrawingProvider routes
  const ctx = useContext(DrawingContext);

  const [savedFlash, setSavedFlash] = useState(false);
  const [screenshotting, setScreenshotting] = useState(false);

  // Flash "Saved ✓" for 2 s after successful save
  const prevDirty = ctx?.state.dirty;
  const saving = ctx?.state.saving ?? false;

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
  const { dirty, saving: isSaving, saveError, targetJobId, targetWorkOrder } = state;
  const noTarget = !targetJobId;

  function saveLabel() {
    if (isSaving) return "⏳";
    if (savedFlash) return "✓";
    return "💾";
  }

  return (
    <div className="topbar-actions">
      <CoinBtn onClick={undo} disabled={!canUndo} title="Undo (Cmd+Z)">↶</CoinBtn>
      <CoinBtn onClick={redo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)">↷</CoinBtn>

      {/* Screenshot button */}
      <CoinBtn
        onClick={handleScreenshot}
        disabled={screenshotting || noTarget}
        title={noTarget ? "Select a job first" : "Download screenshot (PNG)"}
      >
        {screenshotting ? "⏳" : <ScreenshotIcon />}
      </CoinBtn>

      {/* Save target badge */}
      <div className="save-target-badge">
        {noTarget ? (
          <span className="save-target-badge__hint">No job selected</span>
        ) : (
          <>
            <span className="save-target-badge__hint">Saving to:</span>
            <span className="save-target-badge__wo">{targetWorkOrder ?? targetJobId}</span>
          </>
        )}
        {saveError && (
          <span style={{ fontSize: 9, color: "var(--danger)" }}>⚠ Failed</span>
        )}
      </div>

      <CoinBtn
        onClick={save}
        disabled={!dirty || isSaving || noTarget}
        title={noTarget ? "Select a job first" : dirty ? "Save drawings" : "No unsaved changes"}
        variant="save"
        extraClass={isSaving ? "saving" : savedFlash ? "saved" : undefined}
      >
        {saveLabel()}
      </CoinBtn>
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
  variant?: "save";
  extraClass?: string;
}) {
  const cls = [
    "coin-btn",
    variant === "save" ? "coin-btn--save" : "",
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
