// LabelEditPopup.tsx — small floating editor for any markup label.
// Opens when the user clicks a label on the map. Lets them change:
//   - text content
//   - text color
//   - font size (px)
//   - background color (transparent if blank)
//   - border color (transparent if blank)
//   - border width (px)
//
// Edit 1 finish — Billy 6/5.

import { useEffect, useRef, useState } from "react";

export interface LabelEditValues {
  text: string;
  textColor: string;
  fontSize: number;
  bg: string;
  border: string;
  borderWidth: number;
}

interface Props {
  x: number;
  y: number;
  initial: LabelEditValues;
  onSave: (values: LabelEditValues) => void;
  onCancel: () => void;
}

const PRESET_TEXT_COLORS = ["#f4f8ff", "#39ff7a", "#ff2d4a", "#00e5ff", "#ffd700", "#ffffff", "#000000"];
const PRESET_BG_COLORS = ["", "#000000cc", "#0b1220cc", "#ffffffcc", "#00e5ff33", "#39ff7a33"];

export default function LabelEditPopup({ x, y, initial, onSave, onCancel }: Props) {
  const [values, setValues] = useState<LabelEditValues>(initial);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onCancel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(values);
    }
    // Defer adding the click listener so the originating click that opened the
    // popup doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [values, onCancel, onSave]);

  // Clamp popup inside viewport
  const W = 280;
  const H = 360;
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, x + 12));
  const top = Math.max(8, Math.min(window.innerHeight - H - 8, y + 12));

  function set<K extends keyof LabelEditValues>(key: K, val: LabelEditValues[K]) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  return (
    <div
      ref={rootRef}
      style={{
        position: "fixed",
        left,
        top,
        width: W,
        zIndex: 9999,
        background: "#0b1220",
        color: "#f4f8ff",
        border: "1px solid #1f2a44",
        borderRadius: 10,
        boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
        padding: 12,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 12, letterSpacing: 0.5 }}>EDIT LABEL</strong>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: "transparent",
            color: "#9aa4b2",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>

      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ display: "block", color: "#9aa4b2", marginBottom: 4 }}>Text</span>
        <input
          autoFocus
          value={values.text}
          onChange={(e) => set("text", e.target.value)}
          style={{
            width: "100%",
            background: "#0a0f1c",
            color: "#f4f8ff",
            border: "1px solid #1f2a44",
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ display: "block", color: "#9aa4b2", marginBottom: 4 }}>Text color</span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="color"
            value={values.textColor}
            onChange={(e) => set("textColor", e.target.value)}
            style={{ width: 32, height: 28, padding: 0, border: "1px solid #1f2a44", borderRadius: 4, background: "transparent" }}
          />
          {PRESET_TEXT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set("textColor", c)}
              style={{
                width: 18,
                height: 18,
                background: c,
                border: values.textColor === c ? "2px solid #00e5ff" : "1px solid #1f2a44",
                borderRadius: 4,
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
      </label>

      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ display: "block", color: "#9aa4b2", marginBottom: 4 }}>
          Font size: {values.fontSize}px
        </span>
        <input
          type="range"
          min={8}
          max={32}
          value={values.fontSize}
          onChange={(e) => set("fontSize", Number(e.target.value))}
          style={{ width: "100%" }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ display: "block", color: "#9aa4b2", marginBottom: 4 }}>Background</span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="color"
            value={values.bg || "#000000"}
            onChange={(e) => set("bg", e.target.value)}
            style={{ width: 32, height: 28, padding: 0, border: "1px solid #1f2a44", borderRadius: 4, background: "transparent" }}
          />
          {PRESET_BG_COLORS.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => set("bg", c)}
              title={c === "" ? "transparent" : c}
              style={{
                width: 18,
                height: 18,
                background: c === "" ? "repeating-conic-gradient(#444 0% 25%, #222 0% 50%) 50% / 8px 8px" : c,
                border: values.bg === c ? "2px solid #00e5ff" : "1px solid #1f2a44",
                borderRadius: 4,
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
      </label>

      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ display: "block", color: "#9aa4b2", marginBottom: 4 }}>Border</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="color"
            value={values.border || "#000000"}
            onChange={(e) => set("border", e.target.value)}
            style={{ width: 32, height: 28, padding: 0, border: "1px solid #1f2a44", borderRadius: 4, background: "transparent" }}
          />
          <button
            type="button"
            onClick={() => set("border", "")}
            style={{
              background: "#0a0f1c",
              color: "#9aa4b2",
              border: "1px solid #1f2a44",
              borderRadius: 4,
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            None
          </button>
          <input
            type="number"
            min={0}
            max={8}
            value={values.borderWidth}
            onChange={(e) => set("borderWidth", Number(e.target.value))}
            style={{
              width: 50,
              background: "#0a0f1c",
              color: "#f4f8ff",
              border: "1px solid #1f2a44",
              borderRadius: 4,
              padding: "4px 6px",
              fontSize: 12,
              boxSizing: "border-box",
            }}
          />
          <span style={{ color: "#9aa4b2" }}>px</span>
        </div>
      </label>

      {/* Live preview */}
      <div style={{ marginTop: 10, marginBottom: 10, color: "#9aa4b2", fontSize: 11 }}>Preview</div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: 10,
          background: "#0a0f1c",
          borderRadius: 6,
          border: "1px solid #1f2a44",
          marginBottom: 12,
        }}
      >
        <span
          style={{
            color: values.textColor,
            fontSize: values.fontSize,
            fontWeight: 700,
            fontFamily: "ui-monospace, monospace",
            background: values.bg || "transparent",
            border: values.border ? `${values.borderWidth || 1}px solid ${values.border}` : "none",
            borderRadius: 4,
            padding: values.bg || values.border ? "2px 6px" : 0,
          }}
        >
          {values.text || "Sample"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: "transparent",
            color: "#9aa4b2",
            border: "1px solid #1f2a44",
            borderRadius: 6,
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(values)}
          style={{
            background: "#00e5ff",
            color: "#0a0f1c",
            border: "none",
            borderRadius: 6,
            padding: "6px 14px",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
