// TopbarActions — Undo / Redo / Save "polished metal coin" buttons in the topbar.
// Lives outside the DrawingProvider on routes like /sync, so it must gracefully
// handle the case where DrawingContext is absent.
import { useContext, useState, useEffect } from "react";
import { DrawingContext } from "./drawingContext.js";

export default function TopbarActions() {
  // Gracefully consume the context — may be null outside DrawingProvider routes
  const ctx = useContext(DrawingContext);

  const [savedFlash, setSavedFlash] = useState(false);

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

  if (!ctx) {
    // Outside DrawingProvider — render disabled coin buttons as placeholders
    return (
      <div className="topbar-actions">
        <CoinBtn disabled title="Undo">↶</CoinBtn>
        <CoinBtn disabled title="Redo">↷</CoinBtn>
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
