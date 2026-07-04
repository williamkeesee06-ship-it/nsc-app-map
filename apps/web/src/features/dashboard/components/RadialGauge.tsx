// RadialGauge — the signature dyson-ring gauge. Pure SVG, no dependencies.
// An outer brushed-steel ring, a white inner face, and a neon arc whose fill
// is proportional to value/max. Presentation only; all numbers are passed in.

import { useId, type ReactNode } from "react";

export interface RadialGaugeProps {
  value: number;
  /** Denominator for the arc fill. Defaults to a full ring. */
  max?: number;
  label: string;
  /** Override for the centered text (e.g. "78%" or "5:28 AM"). */
  display?: string;
  /** Neon ring color (hex). */
  color: string;
  icon?: ReactNode;
  /** Diameter in px. */
  size?: number;
}

export default function RadialGauge({
  value,
  max,
  label,
  display,
  color,
  icon,
  size = 132,
}: RadialGaugeProps) {
  const uid = useId().replace(/[:]/g, "");
  const glowId = `gauge-glow-${uid}`;
  const faceId = `gauge-face-${uid}`;
  const ringId = `gauge-ring-${uid}`;

  // Arc fill as a fraction of the ring (clamped 0..1). With no usable max the
  // ring reads as full.
  const ratio =
    max && max > 0 ? Math.max(0, Math.min(1, value / max)) : 1;
  const pct = ratio * 100;

  const center = size / 2;
  const ringStroke = Math.max(6, size * 0.06);
  const arcStroke = Math.max(4, size * 0.045);
  const r = center - ringStroke;
  const circumference = 2 * Math.PI * r;

  const numberSize = Math.round(size * 0.22);
  const labelSize = Math.max(8, Math.round(size * 0.075));
  const iconSize = Math.round(size * 0.13);
  const shown = display ?? String(value);

  return (
    <div
      className="radial-gauge"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${shown}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="radial-gauge__svg"
      >
        <defs>
          <radialGradient id={faceId} cx="50%" cy="38%" r="70%">
            <stop offset="0%" stopColor="var(--gauge-face-color, #ffffff)" />
            <stop offset="78%" stopColor="var(--gauge-face-color, #ffffff)" />
            <stop offset="100%" stopColor="var(--gauge-face-shadow, #eef2f7)" />
          </radialGradient>
          <linearGradient id={ringId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e6ebf0" />
            <stop offset="50%" stopColor="#b5bec8" />
            <stop offset="100%" stopColor="#e6ebf0" />
          </linearGradient>
          <filter id={glowId} x="-75%" y="-75%" width="250%" height="250%">
            <feGaussianBlur stdDeviation={arcStroke * 1.1} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer chrome ring */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={`url(#${ringId})`}
          strokeWidth={ringStroke}
        />

        {/* Inner white face */}
        <circle cx={center} cy={center} r={r - ringStroke / 2} fill={`url(#${faceId})`} />

        {/* Full-circle neon track so the ring always reads as a complete
            colored dyson ring, with the brighter progress arc layered on top. */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={arcStroke}
          strokeOpacity={0.22}
        />

        {/* Neon progress arc */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={arcStroke}
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
          filter={`url(#${glowId})`}
        />
      </svg>

      <div className="radial-gauge__content">
        {icon && (
          <span
            className="radial-gauge__icon"
            style={{ width: iconSize, height: iconSize, color }}
          >
            {icon}
          </span>
        )}
        <span
          className="radial-gauge__value"
          style={{ fontSize: numberSize }}
        >
          {shown}
        </span>
        <span
          className="radial-gauge__label"
          style={{ fontSize: labelSize }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
