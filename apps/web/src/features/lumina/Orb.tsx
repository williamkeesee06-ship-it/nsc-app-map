/**
 * Lumina Orb — ported verbatim from the standalone LUMINA app
 * (williamkeesee06-ship-it/LUMINA → src/components/lumina/Orb.tsx).
 *
 * Visual recipe (Billy's original spec): bright electric-blue plasma sphere
 * with a thick rim ring, curved white longitude arcs spinning across the
 * face, an inner radial glow, and dense sparkle particles flickering near
 * the center. Color palette shifts per mode.
 *
 * NSC-specific adaptations:
 *  - Maps NSC's OrbState (idle/listening/thinking/speaking/queued/error)
 *    onto the original LUMINA palette so existing engine code is unchanged
 *  - Wires onClick to NSC's toggleTab (open/close the Lumina vertical tab)
 *  - Inlines the four keyframe animations (orb-pulse, orb-spin,
 *    orb-spin-reverse, sparkle-flicker) so no shared Tailwind/CSS edits
 *    are needed inside the NSC Map App
 *  - Default size 44 (matches original); positioned absolute bottom-right
 *    above Google's pan diamond + Pegman controls
 */

import { useLumina, type OrbState } from "./store/luminaStore.js";
import WebGLOrb from "./WebGLOrb.js";

interface Palette {
  rim: string;
  glow: string;
  halo: string;
}

// Map NSC's OrbState set onto the original LUMINA palette. Modes that don't
// have an exact 1:1 equivalent fall back to the closest visual analog.
const PALETTE: Record<OrbState, Palette> = {
  idle:      { rim: "#00F0FF", glow: "#7000FF", halo: "rgba(112,0,255,0.65)" },
  listening: { rim: "#FF1F8A", glow: "#9D00FF", halo: "rgba(255,31,138,0.85)" },
  thinking:  { rim: "#E020FF", glow: "#4A00E0", halo: "rgba(224,32,255,0.65)" },
  speaking:  { rim: "#3CFFD2", glow: "#00B8FF", halo: "rgba(60,255,210,0.65)" },
  queued:    { rim: "#FFB347", glow: "#FF3D00", halo: "rgba(255,179,71,0.65)" },
  error:     { rim: "#FF3300", glow: "#CC0000", halo: "rgba(255,51,0,0.85)" },
};

const KEYFRAMES_CSS = `
@keyframes lx-orb-pulse {
  0%, 100% { transform: scale(0.95); opacity: 0.85; }
  50%      { transform: scale(1.05); opacity: 1; }
}
`;

interface OrbProps {
  /** Override the SVG canvas size in CSS pixels. Default 40 (original spec). */
  size?: number;
}

export default function Orb({ size = 40 }: OrbProps) {
  const { orbState, tabOpen, setTabOpen, liveOn } = useLumina();
  const { rim, glow, halo } = PALETTE[orbState];

  const handleClick = () => {
    setTabOpen(!tabOpen);
  };

  const frame = size + 28;

  return (
    <>
      <style>{KEYFRAMES_CSS}</style>
      <button
        type="button"
        aria-label={`Lumina Live — ${liveOn ? "on" : "off"} — ${orbState}`}
        title={liveOn ? "LUMINA Live — click to mute" : "LUMINA — click to start Live"}
        onClick={handleClick}
        style={{
          position: "absolute",
          right: 16,
          bottom: 72,
          width: frame,
          height: frame,
          padding: 0,
          border: "none",
          background: "transparent",
          borderRadius: "9999px",
          cursor: "pointer",
          zIndex: 999999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 300ms ease",
        }}
      >
        {/* Outer breathing halo — radial gradient that pulses in/out. */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            width: frame,
            height: frame,
            borderRadius: "9999px",
            pointerEvents: "none",
            background: `radial-gradient(circle, ${halo} 0%, transparent 68%)`,
            animation: "lx-orb-pulse 3s ease-in-out infinite",
            transition: "background 500ms ease",
          }}
        />

        {/* Sophisticated pure 3D WebGL Raymarching Quantum Fusion Orb */}
        <div style={{ pointerEvents: "none", borderRadius: "50%", overflow: "hidden" }}>
          <WebGLOrb size={size} rimColor={rim} glowColor={glow} pulseSpeed={1.0} />
        </div>

        {/* Queued indicator dot — small steady amber below the orb */}
        {orbState === "queued" && (
          <svg
            width={frame}
            height={frame}
            viewBox="0 0 100 100"
            style={{
              position: "absolute",
              inset: 0,
              overflow: "visible",
              pointerEvents: "none",
            }}
          >
            <circle cx={50} cy={96} r={2} fill="#ffc857">
              <animate attributeName="opacity" values="0.4;1;0.4" dur="1.4s" repeatCount="indefinite" />
            </circle>
          </svg>
        )}
      </button>
    </>
  );
}
