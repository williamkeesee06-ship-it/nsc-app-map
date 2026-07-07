// NeonOrb — abstract electric-blue sphere for the Lumina briefing (no face).
// Upgraded to match the high-fidelity Quantum Fusion Orb 3D layout.

import { useId } from "react";

export interface NeonOrbProps {
  /** Diameter in px. */
  size?: number;
}

export default function NeonOrb({ size = 140 }: NeonOrbProps) {
  const uid = useId().replace(/[:]/g, "");
  const glowId = `orb-glow-${uid}`;

  const c = size / 2;

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
      }}
      aria-hidden
    >
      <style>{`
        @keyframes neon-spin-${uid} {
          to { transform: rotate(360deg); }
        }
        @keyframes neon-spin-rev-${uid} {
          to { transform: rotate(-360deg); }
        }
      `}</style>

      {/* Photorealistic 3D Quantum Fusion texture */}
      <img
        src="/dashboard/quantum_fusion_orb.jpg"
        alt=""
        style={{
          position: "absolute",
          width: size * 0.85,
          height: size * 0.85,
          borderRadius: "50%",
          objectFit: "cover",
          pointerEvents: "none",
          boxShadow: "0 0 20px rgba(0, 240, 255, 0.4), inset 0 0 10px rgba(255, 255, 255, 0.2)",
        }}
      />

      {/* Interactive SVG overlay rings */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      >
        <defs>
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Orbiting Ring 1 */}
        <g style={{ transformOrigin: `${c}px ${c}px`, animation: `neon-spin-${uid} 10s linear infinite` }}>
          <ellipse
            cx={c}
            cy={c}
            rx={c * 0.85}
            ry={c * 0.24}
            fill="none"
            stroke="#00F0FF"
            strokeWidth={size * 0.012}
            opacity="0.8"
            transform={`rotate(30 ${c} ${c})`}
            filter={`url(#${glowId})`}
          />
        </g>

        {/* Orbiting Ring 2 */}
        <g style={{ transformOrigin: `${c}px ${c}px`, animation: `neon-spin-rev-${uid} 12s linear infinite` }}>
          <ellipse
            cx={c}
            cy={c}
            rx={c * 0.24}
            ry={c * 0.85}
            fill="none"
            stroke="#7000FF"
            strokeWidth={size * 0.012}
            opacity="0.75"
            transform={`rotate(-45 ${c} ${c})`}
            filter={`url(#${glowId})`}
          />
        </g>
      </svg>
    </div>
  );
}
