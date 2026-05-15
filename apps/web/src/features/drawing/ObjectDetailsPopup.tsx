// ObjectDetailsPopup.tsx — Phase 5.1
// Google My-Maps-style details popup shown after any drawing object is finalized.
// Renders at a fixed screen position (pixel coords from the map projection).
// Used for both new objects and editing existing objects from the layers panel.

import { useEffect, useRef, useState } from "react";

export interface ObjectDetailsPopupProps {
  /** Pixel position (viewport-relative) to anchor the popup near. */
  screenPos: { x: number; y: number };
  /** True = point telecom tool → placeholder "A-TAG #", False → "Name this object" */
  isPointTool: boolean;
  /** Pre-fill for edit mode */
  initialLabel?: string;
  /** Pre-fill for edit mode */
  initialDescription?: string;
  onSave: (label: string, description: string) => void;
  onCancel: () => void;
}

const POPUP_W = 280;
const POPUP_H = 148; // approx height to help with viewport clamping

export default function ObjectDetailsPopup({
  screenPos,
  isPointTool,
  initialLabel = "",
  initialDescription = "",
  onSave,
  onCancel,
}: ObjectDetailsPopupProps) {
  const [label, setLabel] = useState(initialLabel);
  const [description, setDescription] = useState(initialDescription);
  const titleRef = useRef<HTMLInputElement>(null);

  // Autofocus title on mount
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Clamp position to viewport so popup doesn't go offscreen
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const OFFSET = 12; // px offset from click point
  let left = screenPos.x + OFFSET;
  let top = screenPos.y - POPUP_H / 2;
  if (left + POPUP_W > vw - 8) left = screenPos.x - POPUP_W - OFFSET;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  if (top + POPUP_H > vh - 8) top = vh - POPUP_H - 8;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    // Ctrl/Cmd+Enter anywhere saves
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSave(label.trim(), description.trim());
    }
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      // Move focus to description
      const ta = (e.currentTarget.closest(".odp")?.querySelector("textarea")) as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
      } else {
        onSave(label.trim(), description.trim());
      }
    }
  }

  function handleDescKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      onSave(label.trim(), description.trim());
    }
  }

  return (
    <div
      className="odp"
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        left,
        top,
        width: POPUP_W,
        zIndex: 9999,
        background: "rgba(20, 28, 42, 0.97)",
        border: "1px solid rgba(200, 208, 218, 0.28)",
        borderRadius: 8,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 4px 28px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04) inset",
        padding: "12px 12px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
      }}
      // Prevent map click events bubbling through the popup
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Title input */}
      <input
        ref={titleRef}
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={handleTitleKeyDown}
        placeholder={isPointTool ? "A-TAG # (optional)" : "Name this object (optional)"}
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(200,208,218,0.18)",
          borderRadius: 4,
          color: "#f4f8ff",
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 700,
          padding: "6px 8px",
          width: "100%",
          outline: "none",
          boxSizing: "border-box",
          letterSpacing: "0.04em",
        }}
      />

      {/* Description textarea */}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleDescKeyDown}
        placeholder="Add a description, notes, or details (optional)"
        rows={2}
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(200,208,218,0.14)",
          borderRadius: 4,
          color: "#c8d0da",
          fontFamily: "inherit",
          fontSize: 11,
          padding: "6px 8px",
          width: "100%",
          outline: "none",
          resize: "none",
          boxSizing: "border-box",
          lineHeight: 1.5,
        }}
      />

      {/* Buttons row */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: "transparent",
            border: "1px solid rgba(200,208,218,0.22)",
            borderRadius: 4,
            color: "#8a96a3",
            fontFamily: "inherit",
            fontSize: 11,
            padding: "4px 12px",
            cursor: "pointer",
            letterSpacing: "0.03em",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(label.trim(), description.trim())}
          style={{
            background: "#3aa7ff",
            border: "1px solid rgba(58,167,255,0.6)",
            borderRadius: 4,
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 11,
            fontWeight: 700,
            padding: "4px 14px",
            cursor: "pointer",
            letterSpacing: "0.04em",
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
