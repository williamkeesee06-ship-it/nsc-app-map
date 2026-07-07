// NeonOrb — abstract electric-blue sphere for the Lumina briefing (no face).
// Upgraded to match the sophisticated 3D WebGL Raymarching Quantum Fusion style.

import WebGLOrb from "../../lumina/WebGLOrb.js";

export interface NeonOrbProps {
  /** Diameter in px. */
  size?: number;
}

export default function NeonOrb({ size = 140 }: NeonOrbProps) {
  return (
    <div
      className="neon-orb"
      style={{
        width: size,
        height: size,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        overflow: "hidden",
      }}
      aria-hidden
    >
      <WebGLOrb size={size * 0.85} rimColor="#00F0FF" glowColor="#7000FF" pulseSpeed={0.8} />
    </div>
  );
}
