import React from "react";
import { AVAILABLE_ICONS, type IconKey } from "./icons/iconRegistry.js";

interface IconPickerProps {
  value?: string;
  onChange: (iconKey: IconKey) => void;
  compact?: boolean;
}

export default function IconPicker({ value, onChange, compact = false }: IconPickerProps) {
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: compact ? 4 : 6,
      maxWidth: compact ? 220 : 280,
    }}>
      {AVAILABLE_ICONS.map((icon) => {
        const isSelected = value === icon.key;
        return (
          <button
            key={icon.key}
            type="button"
            onClick={() => onChange(icon.key)}
            title={icon.label}
            style={{
              width: compact ? 28 : 36,
              height: compact ? 28 : 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: compact ? 14 : 18,
              borderRadius: 6,
              border: isSelected ? "2px solid #39ff7a" : "1px solid #3a4756",
              background: isSelected ? "rgba(57,255,122,0.15)" : "var(--surface, #1f2836)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {icon.emoji}
          </button>
        );
      })}
    </div>
  );
}
