// ObjectDetailsPopup.tsx — Phase 5.1
// Google My-Maps-style details popup shown after any drawing object is finalized.
// Renders at a fixed screen position (pixel coords from the map projection).
// Used for both new objects and editing existing objects from the layers panel.

import { useEffect, useRef, useState } from "react";
import { useActiveContract } from "../workspace/contractStore.js";

export interface ObjectDetailsPopupProps {
  /** Pixel position (viewport-relative) to anchor the popup near. */
  screenPos: { x: number; y: number };
  /** Tool the pending object was drawn with — drives per-type label prompt and auto-prefix. */
  tool: string;
  /** Pre-fill for edit mode */
  initialLabel?: string;
  /** Pre-fill for edit mode */
  initialDescription?: string;
  onSave: (label: string, description: string, method?: string, size?: string) => void;
  onCancel: () => void;
}

function isLine(tool: string): boolean {
  return (
    tool === "placed_cable" ||
    tool === "removed_cable" ||
    tool === "line" ||
    tool === "arrow" ||
    tool === "ziply_feeder" ||
    tool === "ziply_distribution" ||
    tool === "ziply_drop" ||
    tool === "ziply_bore"
  );
}

function parseLineProps(label: string, desc: string) {
  const footageMatch = label.match(/^(\d+)/);
  const footage = footageMatch ? footageMatch[1] : "";
  
  let method = "";
  if (/BORE/i.test(label) || /BORE/i.test(desc)) method = "BORE";
  else if (/TRENCH/i.test(label) || /TRENCH/i.test(desc)) method = "TRENCH";
  else if (/AERIAL|OH/i.test(label) || /AERIAL|OH/i.test(desc)) method = "AERIAL";
  
  let size = "";
  if (/1-2"\s*DUCT/i.test(desc)) size = "1-2\" DUCT";
  else if (/10MStrand/i.test(desc)) size = "10MStrand";
  else if (/144F/i.test(desc)) size = "144F";
  else if (/72F/i.test(desc)) size = "72F";
  else if (/24F/i.test(desc)) size = "24F";
  
  return { footage, method, size };
}

// Per-icon-type prompt config
type IconPrompt = {
  placeholder: string;
  prefix: string | null;
};

function promptForTool(tool: string): IconPrompt {
  if (tool === "pole_new" || tool === "pole_removed" || tool === "ziply_pole") {
    return { placeholder: "Ziply Pole / A-TAG (e.g. A-1234)", prefix: "A-" };
  }
  if (tool === "mh_new" || tool === "mh_removed") {
    return { placeholder: "MH # (e.g. MH-54)", prefix: "MH-" };
  }
  if (tool === "hh_new" || tool === "hh_removed" || tool === "ziply_handhole") {
    return { placeholder: "HH # (e.g. HH-1123)", prefix: "HH-" };
  }
  if (tool === "ziply_hub") {
    return { placeholder: "Ziply Splitter Hub (e.g. S3063)", prefix: null };
  }
  if (tool === "ziply_terminal") {
    return { placeholder: "Ziply Terminal (e.g. T2)", prefix: null };
  }
  if (tool === "ziply_address") {
    return { placeholder: "Customer Address (e.g. 18402 McElroy Rd)", prefix: null };
  }
  if (tool === "ped_new" || tool === "ped_removed" || tool === "ziply_flower_pot" || tool.startsWith("flower_pot")) {
    return { placeholder: "Flower Pot / PED # / label (e.g. FP-1)", prefix: null };
  }
  if (tool === "cabinet_new" || tool === "cabinet_removed") {
    return { placeholder: "Cabinet # / label (e.g. CAB-7)", prefix: null };
  }
  if (tool === "anchor_new" || tool === "anchor_removed") {
    return { placeholder: "Anchor # / label (optional)", prefix: null };
  }
  if (tool === "ziply_splitter") {
    return { placeholder: "Splitter ID / ratio (e.g. 1x8, SP-3)", prefix: null };
  }
  if (tool === "ziply_riser") {
    return { placeholder: "Riser # / label (optional)", prefix: null };
  }
  if (tool === "ziply_slack_loop") {
    return { placeholder: "Slack length ft (e.g. 50)", prefix: null };
  }
  if (tool === "text") {
    return { placeholder: "Type the text to show on the map\u2026", prefix: null };
  }
  if (tool === "callout") {
    return { placeholder: "Callout text\u2026", prefix: null };
  }
  return { placeholder: "Name this object (optional)", prefix: null };
}

function applyPrefix(label: string, prefix: string | null): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  if (!prefix) return trimmed;
  return trimmed.toLowerCase().startsWith(prefix.toLowerCase())
    ? trimmed
    : prefix + trimmed;
}

const POPUP_W = 280;
// Make height dynamic based on tool type to prevent clipping
const POPUP_H_POINT = 148;
const POPUP_H_LINE = 240;

export default function ObjectDetailsPopup({
  screenPos,
  tool,
  initialLabel = "",
  initialDescription = "",
  onSave,
  onCancel,
}: ObjectDetailsPopupProps) {
  const { contract } = useActiveContract();
  const isLineTool = isLine(tool);

  // Line States
  const parsed = isLineTool ? parseLineProps(initialLabel, initialDescription) : null;
  const [footage, setFootage] = useState(parsed?.footage ?? (initialLabel.replace(/'/g, "") || ""));
  const [method, setMethod] = useState(parsed?.method ?? "");
  const [size, setSize] = useState(parsed?.size ?? "");
  const [sizeOption, setSizeOption] = useState(() => {
    if (!parsed?.size) return "";
    const common = ["1-2\" DUCT", "10MStrand", "144F", "72F", "24F"];
    return common.includes(parsed.size) ? parsed.size : "custom";
  });

  // Point States
  const [label, setLabel] = useState(initialLabel);
  const [description, setDescription] = useState(initialDescription);
  
  const titleRef = useRef<HTMLInputElement>(null);
  const prompt = promptForTool(tool);

  const prefix = contract === "Ziply" ? null : prompt.prefix;
  const popupHeight = isLineTool ? POPUP_H_LINE : POPUP_H_POINT;

  const finalize = () => {
    if (isLineTool) {
      const cleanFootage = footage.replace(/['\s]/g, "").trim();
      const resolvedLabel = cleanFootage ? `${cleanFootage}' ${method}`.trim() : "";
      const resolvedDesc = [size, method].filter(Boolean).join(" ");
      onSave(resolvedLabel, resolvedDesc, method, size);
    } else {
      let finalLabel = applyPrefix(label, prefix);
      if (contract === "Ziply" && /^a-/i.test(finalLabel)) {
        finalLabel = finalLabel.slice(2);
      }
      onSave(finalLabel, description.trim());
    }
  };

  // Autofocus title/footage on mount
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Clamp position to viewport so popup doesn't go offscreen
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const OFFSET = 12; // px offset from click point
  let left = screenPos.x + OFFSET;
  let top = screenPos.y - popupHeight / 2;
  if (left + POPUP_W > vw - 8) left = screenPos.x - POPUP_W - OFFSET;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  if (top + popupHeight > vh - 8) top = vh - popupHeight - 8;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finalize();
    }
  }

  const inputStyle: React.CSSProperties = {
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
  };

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
        gap: 10,
        fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isLineTool ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Footage Field */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: "bold", textTransform: "uppercase" }}>Footage</span>
            <input
              ref={titleRef}
              type="text"
              value={footage}
              onChange={(e) => setFootage(e.target.value)}
              placeholder="e.g. 275"
              style={inputStyle}
            />
          </div>

          {/* Placement Method Field */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: "bold", textTransform: "uppercase" }}>Placement Method</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              style={inputStyle}
            >
              <option value="">-- Select Method --</option>
              <option value="BORE">BORE (Underground)</option>
              <option value="TRENCH">TRENCH (Underground)</option>
              <option value="AERIAL">AERIAL (Overhead)</option>
            </select>
          </div>

          {/* Cable / Conduit Size Field */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: "bold", textTransform: "uppercase" }}>Size / Spec</span>
            <select
              value={sizeOption}
              onChange={(e) => {
                setSizeOption(e.target.value);
                if (e.target.value !== "custom") setSize(e.target.value);
              }}
              style={inputStyle}
            >
              <option value="">-- Select Size --</option>
              <option value="1-2&quot; DUCT">1-2&quot; DUCT</option>
              <option value="10MStrand">10MStrand</option>
              <option value="144F">144F</option>
              <option value="72F">72F</option>
              <option value="24F">24F</option>
              <option value="custom">Other / Custom...</option>
            </select>
            {sizeOption === "custom" && (
              <input
                type="text"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="Enter custom size..."
                style={{ ...inputStyle, marginTop: 4 }}
              />
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Title input */}
          <input
            ref={titleRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={prompt.placeholder}
            style={inputStyle}
          />

          {/* Description textarea */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
        </>
      )}

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
          onClick={finalize}
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
