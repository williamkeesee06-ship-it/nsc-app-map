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
  0%, 100% { transform: scale(0.95); opacity: 0.85; }
  50%      { transform: scale(1.05); opacity: 1; }
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
@keyframes lx-ring-pulse {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: -80; }
}
@keyframes lx-ring-pulse-reverse {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: 80; }
}
@keyframes lx-lightning-1 {
  0%, 86%, 92%, 96%, 100% { opacity: 0; }
  88%, 94% { opacity: 1; }
  90% { opacity: 0.4; }
}
@keyframes lx-lightning-2 {
  0%, 82%, 88%, 94%, 100% { opacity: 0; }
  85%, 91% { opacity: 1; }
  87% { opacity: 0.3; }
}
@keyframes lx-lightning-3 {
  0%, 75%, 83%, 92%, 100% { opacity: 0; }
  78%, 87% { opacity: 1; }
  80% { opacity: 0.4; }
}
`;

interface OrbProps {
  /** Override the SVG canvas size in CSS pixels. Default 44 (original spec). */
  size?: number;
}

export default function Orb({ size = 40 }: OrbProps) {
  // Orb is the Live-mode hardware switch. Clicking it ONLY flips voice on/off
  // — it never opens or closes the Lumina tab. This lets Billy fire up voice
  // while he's deep in Tools/Filters without his workspace getting yanked away.
  const { orbState, tabOpen, setTabOpen, liveOn } = useLumina();
  const { rim, glow, halo } = PALETTE[orbState];

  const handleClick = () => {
    setTabOpen(!tabOpen);
  };

  // The original component used `frame = size + 28` to give the breathing
  // halo room outside the orb body. Keep the same ratio so the visual
  // weight matches the original.
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
          // Stacked above the Google Street View pegman (~bottom:24, ~40px tall)
          // so the orb never blocks the pegman drag handle. Billy 6/11.
          bottom: 72,
          width: frame,
          height: frame,
          padding: 0,
          border: "none",
          background: "transparent",
          borderRadius: "9999px",
          cursor: "pointer",
          zIndex: 999999, // above every Google Maps internal layer so clicks always hit the orb
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

        {/* Photorealistic 3D Quantum Fusion texture */}
        <img
          src="/dashboard/quantum_fusion_orb.jpg"
          alt=""
          style={{
            position: "absolute",
            width: frame * 0.72,
            height: frame * 0.72,
            borderRadius: "50%",
            objectFit: "cover",
            pointerEvents: "none",
            boxShadow: `0 0 20px ${rim}, inset 0 0 10px rgba(255,255,255,0.2)`,
            opacity: 0.95,
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
            {/* Dynamic, shifting quantum fusion gradient core */}
            <radialGradient id={`lx-orb-core-${orbState}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={glow} stopOpacity="0.95">
                <animate attributeName="stopColor" values={`${glow};#3b82f6;#8b5cf6;${glow}`} dur="7s" repeatCount="indefinite" />
              </stop>
              <stop offset="50%" stopColor={rim} stopOpacity="0.5">
                <animate attributeName="stopColor" values={`${rim};#00d4ff;#a020c0;${rim}`} dur="9s" repeatCount="indefinite" />
              </stop>
              <stop offset="100%" stopColor={rim} stopOpacity="0" />
            </radialGradient>
            <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* 1. Free-floating animated shift core - blended color-dodge on top of the image */}
          <circle cx={50} cy={50} r={28} fill={`url(#lx-orb-core-${orbState})`} fillOpacity="0.4" style={{ mixBlendMode: "color-dodge", filter: "url(#neon-glow)" }} />
          <circle cx={50} cy={50} r={16} fill="#ffffff" fillOpacity="0.08" style={{ filter: "blur(2px)" }} />

          {/* 2. Quantum Fusion dynamic lightning crackles / electricity */}
          <path d="M 22 28 Q 34 26 38 42 L 50 50" fill="none" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" opacity="0" style={{ animation: "lx-lightning-1 2.8s infinite", filter: `drop-shadow(0 0 3px ${rim})` }} />
          <path d="M 78 72 Q 66 74 62 58 L 50 50" fill="none" stroke={rim} strokeWidth="1.5" strokeLinecap="round" opacity="0" style={{ animation: "lx-lightning-2 2s infinite 0.5s", filter: `drop-shadow(0 0 4px ${glow})` }} />
          <path d="M 78 28 L 64 34 L 50 50" fill="none" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" opacity="0" style={{ animation: "lx-lightning-3 3.3s infinite 1.1s", filter: `drop-shadow(0 0 3px ${rim})` }} />
          <path d="M 22 72 Q 38 68 44 58 L 50 50" fill="none" stroke={glow} strokeWidth="1.2" strokeLinecap="round" opacity="0" style={{ animation: "lx-lightning-1 2.4s infinite 1.6s", filter: `drop-shadow(0 0 4px ${glow})` }} />

          {/* 3. Orbiting Rings - Free floating, multi-axis 3D rotation */}
          {/* Ring 1 - X-axis dominant */}
          <g style={{ transformOrigin: "50px 50px", animation: "lx-orb-spin 9s linear infinite" }}>
            <ellipse cx="50" cy="50" rx="38" ry="11" fill="none" stroke={rim} strokeOpacity="0.75" strokeWidth="1.2" transform="rotate(30 50 50)" style={{ filter: "url(#neon-glow)" }} />
            {/* Sliding energy segment on Ring 1 */}
            <ellipse cx="50" cy="50" rx="38" ry="11" fill="none" stroke="#ffffff" strokeOpacity="0.95" strokeWidth="1.8" strokeDasharray="12 40" transform="rotate(30 50 50)" style={{ animation: "lx-ring-pulse 2s linear infinite" }} />
          </g>

          {/* Ring 2 - Y-axis dominant */}
          <g style={{ transformOrigin: "50px 50px", animation: "lx-orb-spin-reverse 11s linear infinite" }}>
            <ellipse cx="50" cy="50" rx="11" ry="38" fill="none" stroke={glow} strokeOpacity="0.7" strokeWidth="1.2" transform="rotate(-45 50 50)" style={{ filter: "url(#neon-glow)" }} />
            {/* Sliding energy segment on Ring 2 */}
            <ellipse cx="50" cy="50" rx="11" ry="38" fill="none" stroke="#ffffff" strokeOpacity="0.95" strokeWidth="1.8" strokeDasharray="16 48" transform="rotate(-45 50 50)" style={{ animation: "lx-ring-pulse-reverse 2.6s linear infinite" }} />
          </g>

          {/* Ring 3 - Oblique axis */}
          <g style={{ transformOrigin: "50px 50px", animation: "lx-orb-spin 14s linear infinite" }}>
            <ellipse cx="50" cy="50" rx="38" ry="15" fill="none" stroke={rim} strokeOpacity="0.65" strokeWidth="0.8" transform="rotate(115 50 50)" />
            <ellipse cx="50" cy="50" rx="38" ry="15" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1.2" strokeDasharray="8 32" transform="rotate(115 50 50)" style={{ animation: "lx-ring-pulse 3s linear infinite" }} />
          </g>

          {/* Flickering sparkle particles inside the core */}
          {PARTICLES.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={p.r * 0.85}
              fill="#ffffff"
              style={{
                filter: `drop-shadow(0 0 1.5px ${glow})`,
                animation: `lx-sparkle-flicker ${1.3 + (i % 5) * 0.25}s ease-in-out ${p.d}s infinite`,
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
