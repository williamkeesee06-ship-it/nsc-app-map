import { useId } from "react";

interface WebGLOrbProps {
  size?: number;
  rimColor?: string;
  glowColor?: string;
  pulseSpeed?: number;
}

export default function WebGLOrb({
  size = 100,
  rimColor = "#00F0FF",
  glowColor = "#7000FF",
  pulseSpeed = 1.0,
}: WebGLOrbProps) {
  const uid = useId().replace(/[:]/g, "");

  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{`
        @keyframes lx-ring-spin-forward-${uid} {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -200; }
        }
        @keyframes lx-ring-spin-backward-${uid} {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: 200; }
        }
        @keyframes lx-lightning-flash-1-${uid} {
          0%, 85%, 91%, 95%, 100% { opacity: 0; }
          87%, 93% { opacity: 0.9; }
          89% { opacity: 0.3; }
        }
        @keyframes lx-lightning-flash-2-${uid} {
          0%, 80%, 86%, 92%, 100% { opacity: 0; }
          82%, 89% { opacity: 0.85; }
          84% { opacity: 0.25; }
        }
        @keyframes lx-plasma-pulse-${uid} {
          0%, 100% { transform: scale(0.97); filter: drop-shadow(0 0 8px ${rimColor}); }
          50% { transform: scale(1.03); filter: drop-shadow(0 0 16px ${glowColor}); }
        }
      `}</style>

      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{
          overflow: "visible",
          pointerEvents: "none",
        }}
      >
        <defs>
          {/* Liquid volumetric plasma displacement filter */}
          <filter id={`lx-plasma-displace-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" result="noise">
              <animate attributeName="seed" values="1;120;1" dur="16s" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" />
          </filter>

          {/* Core glow filter */}
          <filter id={`lx-core-glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Gradients for Metallic Rings */}
          {/* Polished Gold */}
          <linearGradient id={`lx-gold-grad-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="30%" stopColor="#eab308" />
            <stop offset="65%" stopColor="#854d0e" />
            <stop offset="85%" stopColor="#fef08a" />
            <stop offset="100%" stopColor="#ca8a04" />
          </linearGradient>

          {/* Rose Bronze */}
          <linearGradient id={`lx-bronze-grad-${uid}`} x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffedd5" />
            <stop offset="25%" stopColor="#ea580c" />
            <stop offset="60%" stopColor="#9a3412" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>

          {/* Blue-Steel Chrome */}
          <linearGradient id={`lx-chrome-grad-${uid}`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e2e8f0" />
            <stop offset="40%" stopColor="#38bdf8" />
            <stop offset="70%" stopColor="#1e3a8a" />
            <stop offset="100%" stopColor="#f1f5f9" />
          </linearGradient>

          {/* Radial mask for the inner plasma sphere */}
          <clipPath id={`lx-core-clip-${uid}`}>
            <circle cx="50" cy="50" r="28" />
          </clipPath>
        </defs>

        {/* ==========================================
            STAGE 1: BACK ARCS OF ROTATING RINGS 
            (Renders behind the central sphere)
            ========================================== */}
        
        {/* Ring 1 Back - Gold (tilt 75deg, rotated 30deg) */}
        <g transform="rotate(30 50 50)">
          <path
            d="M 92 50 A 42 11 0 0 0 8 50"
            fill="none"
            stroke={`url(#lx-gold-grad-${uid})`}
            strokeWidth="1.8"
            strokeOpacity="0.85"
          />
          {/* Animated Gold energy pulse */}
          <path
            d="M 92 50 A 42 11 0 0 0 8 50"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeDasharray="15 85"
            style={{ animation: `lx-ring-spin-forward-${uid} 2.4s linear infinite` }}
            filter={`url(#lx-core-glow-${uid})`}
          />
        </g>

        {/* Ring 2 Back - Rose Bronze (tilt 75deg, rotated -45deg) */}
        <g transform="rotate(-45 50 50)">
          <path
            d="M 92 50 A 42 11 0 0 0 8 50"
            fill="none"
            stroke={`url(#lx-bronze-grad-${uid})`}
            strokeWidth="1.8"
            strokeOpacity="0.8"
          />
          {/* Animated Bronze energy pulse */}
          <path
            d="M 92 50 A 42 11 0 0 0 8 50"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeDasharray="20 80"
            style={{ animation: `lx-ring-spin-backward-${uid} 3.2s linear infinite` }}
            filter={`url(#lx-core-glow-${uid})`}
          />
        </g>

        {/* Ring 3 Back - Blue-Steel Chrome (tilt 75deg, rotated 115deg) */}
        <g transform="rotate(115 50 50)">
          <path
            d="M 92 50 A 42 11 0 0 0 8 50"
            fill="none"
            stroke={`url(#lx-chrome-grad-${uid})`}
            strokeWidth="1.2"
            strokeOpacity="0.75"
          />
        </g>


        {/* ==========================================
            STAGE 2: VOLUMETRIC LIQUID PLASMA CORE
            ========================================== */}
        <g style={{ transformOrigin: "50px 50px", animation: `lx-plasma-pulse-${uid} 3s ease-in-out infinite` }}>
          {/* Base shadow backer */}
          <circle cx="50" cy="50" r="28.5" fill="#03030c" />

          {/* Swirling Liquid displaced photorealistic core texture */}
          <g clipPath={`url(#lx-core-clip-${uid})`} filter={`url(#lx-plasma-displace-${uid})`}>
            {/* The high-fidelity Quantum Fusion texture */}
            <image
              href="/dashboard/quantum_fusion_orb.jpg"
              x="20"
              y="20"
              width="60"
              height="60"
              preserveAspectRatio="xMidYMid slice"
            />
          </g>

          {/* Deep volumetric edge shadow */}
          <circle
            cx="50"
            cy="50"
            r="28"
            fill="none"
            stroke="#000000"
            strokeWidth="2.5"
            strokeOpacity="0.8"
          />
        </g>


        {/* ==========================================
            STAGE 3: FRONT ARCS OF ROTATING RINGS
            (Renders in front of the central sphere)
            ========================================== */}
        
        {/* Ring 1 Front - Gold */}
        <g transform="rotate(30 50 50)">
          <path
            d="M 8 50 A 42 11 0 0 0 92 50"
            fill="none"
            stroke={`url(#lx-gold-grad-${uid})`}
            strokeWidth="1.8"
            strokeOpacity="0.95"
            filter={`url(#lx-core-glow-${uid})`}
          />
          <path
            d="M 8 50 A 42 11 0 0 0 92 50"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeDasharray="15 85"
            style={{ animation: `lx-ring-spin-forward-${uid} 2.4s linear infinite` }}
            filter={`url(#lx-core-glow-${uid})`}
          />
        </g>

        {/* Ring 2 Front - Rose Bronze */}
        <g transform="rotate(-45 50 50)">
          <path
            d="M 8 50 A 42 11 0 0 0 92 50"
            fill="none"
            stroke={`url(#lx-bronze-grad-${uid})`}
            strokeWidth="1.8"
            strokeOpacity="0.9"
            filter={`url(#lx-core-glow-${uid})`}
          />
          <path
            d="M 8 50 A 42 11 0 0 0 92 50"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeDasharray="20 80"
            style={{ animation: `lx-ring-spin-backward-${uid} 3.2s linear infinite` }}
            filter={`url(#lx-core-glow-${uid})`}
          />
        </g>

        {/* Ring 3 Front - Blue-Steel Chrome */}
        <g transform="rotate(115 50 50)">
          <path
            d="M 8 50 A 42 11 0 0 0 92 50"
            fill="none"
            stroke={`url(#lx-chrome-grad-${uid})`}
            strokeWidth="1.2"
            strokeOpacity="0.85"
          />
        </g>


        {/* ==========================================
            STAGE 4: CRACKLING PLASMA LIGHTNING & GLOSS
            ========================================== */}

        {/* Erratic Lightning Arcs */}
        <g style={{ animation: `lx-lightning-flash-1-${uid} 3.4s infinite` }}>
          <path
            d="M 32 30 Q 40 45 42 42 T 50 50"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.2"
            strokeLinecap="round"
            filter={`drop-shadow(0 0 3px ${rimColor})`}
          />
        </g>
        <g style={{ animation: `lx-lightning-flash-2-${uid} 2.6s infinite 0.7s` }}>
          <path
            d="M 68 70 Q 60 55 58 58 T 50 50"
            fill="none"
            stroke={rimColor}
            strokeWidth="1.5"
            strokeLinecap="round"
            filter={`drop-shadow(0 0 4px ${glowColor})`}
          />
        </g>

        {/* Volumetric glossy bubble glare overlay */}
        <circle
          cx="50"
          cy="50"
          r="28"
          fill="none"
          stroke="#ffffff"
          strokeWidth="0.8"
          strokeOpacity="0.3"
        />
        <path
          d="M 28 38 A 24 24 0 0 1 72 38"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeOpacity="0.4"
        />
      </svg>
    </div>
  );
}
