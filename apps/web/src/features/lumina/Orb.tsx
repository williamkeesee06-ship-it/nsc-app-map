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

interface Palette {
  rim: string;
  glow: string;
  halo: string;
}

// Map NSC's OrbState set onto the original LUMINA palette. Modes that don't
// have an exact 1:1 equivalent fall back to the closest visual analog:
//   idle      → Quantum Singularity (blue+purple plasma)
//   listening → live (hot magenta, mic open)
//   thinking  → thinking (electric magenta)
//   speaking  → escort (teal-cyan)
//   queued    → listening (amber, awaiting action)
//   error     → alert (red-amber)
const PALETTE: Record<OrbState, Palette> = {
  idle:      { rim: "#00F0FF", glow: "#7000FF", halo: "rgba(112,0,255,0.65)" },
  listening: { rim: "#FF1F8A", glow: "#9D00FF", halo: "rgba(255,31,138,0.85)" },
  thinking:  { rim: "#E020FF", glow: "#4A00E0", halo: "rgba(224,32,255,0.65)" },
  speaking:  { rim: "#3CFFD2", glow: "#00B8FF", halo: "rgba(60,255,210,0.65)" },
  queued:    { rim: "#FFB347", glow: "#FF3D00", halo: "rgba(255,179,71,0.65)" },
  error:     { rim: "#FF3300", glow: "#CC0000", halo: "rgba(255,51,0,0.85)" },
};

// Stable particle positions — concentrated near the center, fading outward.
// Verbatim from the original LUMINA component.
const PARTICLES = [
  { x: 50, y: 50, r: 1.4, d: 0 },
  { x: 47, y: 48, r: 1.0, d: 0.2 },
  { x: 53, y: 51, r: 0.9, d: 0.4 },
  { x: 49, y: 53, r: 0.8, d: 0.6 },
  { x: 51, y: 47, r: 0.8, d: 0.8 },
  { x: 45, y: 50, r: 0.7, d: 1.0 },
  { x: 55, y: 49, r: 0.7, d: 1.2 },
  { x: 48, y: 45, r: 0.6, d: 1.4 },
  { x: 52, y: 55, r: 0.6, d: 1.6 },
  { x: 44, y: 52, r: 0.5, d: 1.8 },
  { x: 56, y: 51, r: 0.5, d: 2.0 },
  { x: 50, y: 43, r: 0.5, d: 2.2 },
  { x: 50, y: 57, r: 0.5, d: 2.4 },
  { x: 42, y: 47, r: 0.4, d: 2.6 },
  { x: 58, y: 53, r: 0.4, d: 2.8 },
  { x: 46, y: 56, r: 0.4, d: 3.0 },
  { x: 54, y: 44, r: 0.4, d: 3.2 },
  { x: 41, y: 51, r: 0.35, d: 3.4 },
  { x: 59, y: 48, r: 0.35, d: 3.6 },
  { x: 50, y: 41, r: 0.35, d: 3.8 },
  { x: 50, y: 59, r: 0.35, d: 4.0 },
];

// Inline keyframes so this component is self-contained inside the NSC Map App.
// These match the original LUMINA app's CSS exactly.
const KEYFRAMES_CSS = `
@keyframes lx-orb-pulse {
  0%, 100% { transform: scale(1); opacity: 0.92; }
  50%      { transform: scale(1.06); opacity: 1; }
}
@keyframes lx-orb-spin {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes lx-orb-spin-reverse {
  0%   { transform: rotate(360deg); }
  100% { transform: rotate(0deg); }
}
@keyframes lx-sparkle-flicker {
  0%, 100% { opacity: 0.95; transform: scale(1); }
  25%      { opacity: 0.4;  transform: scale(0.7); }
  50%      { opacity: 1;    transform: scale(1.25); }
  75%      { opacity: 0.55; transform: scale(0.85); }
}
`;

interface OrbProps {
  /** Override the SVG canvas size in CSS pixels. Default 44 (original spec). */
  size?: number;
}

export default function Orb({ size = 44 }: OrbProps) {
  const { orbState, toggleTab } = useLumina();
  const { rim, glow, halo } = PALETTE[orbState];

  // The original component used `frame = size + 28` to give the breathing
  // halo room outside the orb body. Keep the same ratio so the visual
  // weight matches the original.
  const frame = size + 28;

  return (
    <>
      <style>{KEYFRAMES_CSS}</style>
      <button
        type="button"
        aria-label={`Lumina — ${orbState}`}
        title="LUMINA"
        onClick={toggleTab}
        style={{
          position: "absolute",
          right: 16,
          bottom: 140, // above Google's pan diamond + Pegman
          width: frame,
          height: frame,
          padding: 0,
          border: "none",
          background: "transparent",
          borderRadius: "9999px",
          cursor: "pointer",
          zIndex: 50,
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
            background: `radial-gradient(circle, ${halo} 0%, transparent 65%)`,
            animation: "lx-orb-pulse 3.4s ease-in-out infinite",
            transition: "background 500ms ease",
          }}
        />

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
          <defs>
            <radialGradient id={`lx-orb-core-${orbState}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor={glow} stopOpacity="0.95" />
              <stop offset="35%"  stopColor={rim}  stopOpacity="0.55" />
              <stop offset="70%"  stopColor={rim}  stopOpacity="0.18" />
              <stop offset="100%" stopColor={rim}  stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Outer singularity rings — faint dotted/dashed boundaries */}
          <circle cx={50} cy={50} r={44} fill="none" stroke={rim}  strokeOpacity={0.15} strokeWidth={0.5} strokeDasharray="1 3" />
          <circle cx={50} cy={50} r={40} fill="none" stroke={glow} strokeOpacity={0.3}  strokeWidth={1}   strokeDasharray="4 4"
            style={{ transformOrigin: "50px 50px", animation: "lx-orb-spin-reverse 20s linear infinite" }} />

          {/* Inner glow fill — quantum plasma core */}
          <circle cx={50} cy={50} r={36} fill={`url(#lx-orb-core-${orbState})`} />

          {/* THICK BRIGHT RIM RING — the defining outer boundary */}
          <circle cx={50} cy={50} r={36} fill="none" stroke={rim}
            strokeOpacity={0.65} strokeWidth={4}
            style={{ filter: `drop-shadow(0 0 12px ${rim}) drop-shadow(0 0 24px ${glow})` }} />
          <circle cx={50} cy={50} r={36} fill="none" stroke={rim}
            strokeOpacity={1} strokeWidth={1.5}
            style={{ filter: `drop-shadow(0 0 4px ${rim})` }} />
          <circle cx={50} cy={50} r={36} fill="none" stroke="#ffffff"
            strokeOpacity={0.9} strokeWidth={0.5} />

          {/* Orbital rings + curved arc sweeps — spin clockwise */}
          <g style={{
            transformOrigin: "50px 50px",
            animation: "lx-orb-spin 15s linear infinite",
            filter: `drop-shadow(0 0 2px ${glow}) drop-shadow(0 0 4px ${rim})`,
          }}>
            <ellipse cx="50" cy="50" rx="36" ry="10" fill="none" stroke={rim}     strokeOpacity="0.8" strokeWidth="1"   transform="rotate(30 50 50)" />
            <ellipse cx="50" cy="50" rx="36" ry="10" fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="0.5" transform="rotate(-60 50 50)" />
            <path d="M 18 38 Q 50 22 82 38" fill="none" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={1.2} strokeLinecap="round" />
            <path d="M 18 62 Q 50 78 82 62" fill="none" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={1.2} strokeLinecap="round" />
          </g>

          {/* Inner geometry — counter-rotating triangle pair */}
          <g style={{ transformOrigin: "50px 50px", animation: "lx-orb-spin-reverse 10s linear infinite" }}>
            <polygon points="50,25 68,60 32,60" fill="none" stroke={rim}  strokeWidth="0.5" strokeOpacity="0.3" />
            <polygon points="50,75 32,40 68,40" fill="none" stroke={glow} strokeWidth="0.5" strokeOpacity="0.3" />
          </g>

          {/* Flickering sparkle particles — concentrated near the center */}
          {PARTICLES.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill="#ffffff"
              style={{
                filter: `drop-shadow(0 0 1.5px ${glow}) drop-shadow(0 0 3px ${glow})`,
                animation: `lx-sparkle-flicker ${1.4 + (i % 5) * 0.3}s ease-in-out ${p.d}s infinite`,
                transformOrigin: `${p.x}px ${p.y}px`,
                transformBox: "fill-box",
              }}
            />
          ))}

          {/* Queued indicator dot — small steady amber below the orb */}
          {orbState === "queued" && (
            <circle cx={50} cy={96} r={2} fill="#ffc857">
              <animate attributeName="opacity" values="0.4;1;0.4" dur="1.4s" repeatCount="indefinite" />
            </circle>
          )}
        </svg>
      </button>
    </>
  );
}
