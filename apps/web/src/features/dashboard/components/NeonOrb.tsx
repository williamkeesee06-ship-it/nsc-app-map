// NeonOrb — abstract electric-blue sphere for the Lumina briefing (no face).
// Concentric rings + soft radial glow + Gaussian blur. Presentation only.

import { useId } from "react";

export interface NeonOrbProps {
  /** Diameter in px. */
  size?: number;
}

export default function NeonOrb({ size = 140 }: NeonOrbProps) {
  const uid = useId().replace(/[:]/g, "");
  const coreId = `orb-core-${uid}`;
  const glowId = `orb-glow-${uid}`;

  const c = size / 2;

  return (
    <div className="neon-orb" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <radialGradient id={coreId} cx="42%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#eaf6ff" />
            <stop offset="40%" stopColor="#6cc0ff" />
            <stop offset="80%" stopColor="#2f8fe6" />
            <stop offset="100%" stopColor="#0b4ea0" />
          </radialGradient>
          <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={size * 0.04} />
          </filter>
        </defs>

        <circle cx={c} cy={c} r={c * 0.62} fill={`url(#${coreId})`} filter={`url(#${glowId})`} />
        <circle cx={c} cy={c} r={c * 0.62} fill={`url(#${coreId})`} />

        <ellipse
          cx={c}
          cy={c}
          rx={c * 0.86}
          ry={c * 0.34}
          fill="none"
          stroke="#7bc4ff"
          strokeWidth={size * 0.012}
          opacity="0.8"
          transform={`rotate(-22 ${c} ${c})`}
        />
        <ellipse
          cx={c}
          cy={c}
          rx={c * 0.72}
          ry={c * 0.26}
          fill="none"
          stroke="#bfe3ff"
          strokeWidth={size * 0.01}
          opacity="0.6"
          transform={`rotate(28 ${c} ${c})`}
        />
        <circle
          cx={c}
          cy={c}
          r={c * 0.78}
          fill="none"
          stroke="#3da9ff"
          strokeWidth={size * 0.008}
          opacity="0.45"
        />
      </svg>
    </div>
  );
}
