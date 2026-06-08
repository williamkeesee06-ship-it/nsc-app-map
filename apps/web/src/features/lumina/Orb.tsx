/**
 * Lumina Orb — floating presence on the map.
 *
 * Positioned ABOVE Google's bottom-right controls (pan diamond + Pegman).
 * Tap = open Lumina tab. Long-press = push-to-talk Live mode (Phase 2.5).
 *
 * State colors (locked):
 *   idle      → soft cyan, slow pulse
 *   listening → bright cyan, fast pulse (mic open)
 *   thinking  → amber, rotating ring (tool firing / streaming)
 *   speaking  → magenta-cyan shimmer (Live voice replying)
 *   queued    → solid gold, steady glow (action awaiting approval)
 *   error     → red, single pulse
 */

import { useEffect, useMemo, useState } from "react";
import { useLumina, type OrbState } from "./store/luminaStore.js";

interface StateStyle {
  rim: string;
  core: string;
  glow: string;
  /** Tailwind animation class — uses keyframes from tailwind.config.ts. */
  anim?: string;
}

const STATE_STYLES: Record<OrbState, StateStyle> = {
  idle: {
    rim: "#1ea7ff",
    core: "#0084d4",
    glow: "rgba(30,167,255,0.55)",
    anim: "lx-animate-orb-pulse",
  },
  listening: {
    rim: "#00d4ff",
    core: "#0099cc",
    glow: "rgba(0,212,255,0.85)",
    anim: "lx-animate-pulse",
  },
  thinking: {
    rim: "#ffb84d",
    core: "#cc8a2e",
    glow: "rgba(255,184,77,0.65)",
    anim: "lx-animate-spin",
  },
  speaking: {
    rim: "#1ea7ff",
    core: "#a020c0",
    glow: "rgba(160,32,192,0.55)",
  },
  queued: {
    rim: "#ffc857",
    core: "#cc9a3e",
    glow: "rgba(255,200,87,0.75)",
  },
  error: {
    rim: "#ff4d4d",
    core: "#990000",
    glow: "rgba(255,77,77,0.65)",
  },
};

export default function Orb() {
  const { orbState, toggleTab } = useLumina();
  const style = STATE_STYLES[orbState];
  const [hover, setHover] = useState(false);

  // Speaking state — small shimmer animation toggling rim between two tones.
  const [shimmerOn, setShimmerOn] = useState(false);
  useEffect(() => {
    if (orbState !== "speaking") return;
    const id = window.setInterval(() => setShimmerOn((v) => !v), 280);
    return () => window.clearInterval(id);
  }, [orbState]);

  const rim = orbState === "speaking" && shimmerOn ? "#a020c0" : style.rim;

  const gradient = useMemo(
    () => `radial-gradient(circle at 30% 30%, ${rim} 0%, ${style.core} 55%, #0a1320 100%)`,
    [rim, style.core]
  );

  const shadow = `0 0 18px ${style.glow}, 0 0 38px ${style.glow}, 0 0 0 2px rgba(255,255,255,0.06) inset`;

  return (
    <button
      type="button"
      aria-label={`Lumina — ${orbState}`}
      onClick={toggleTab}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`lumina-orb-root ${style.anim ?? ""}`}
      style={{
        position: "absolute",
        right: 16,
        bottom: 140, // above Google's pan diamond + Pegman
        width: 80,
        height: 80,
        borderRadius: "50%",
        border: `1.5px solid ${rim}`,
        background: gradient,
        boxShadow: shadow,
        transform: hover ? "scale(1.05)" : "scale(1)",
        transition: "transform 160ms ease, box-shadow 220ms ease, border-color 220ms ease",
        cursor: "pointer",
        zIndex: 50,
        // ensure it never blocks panning when the user mis-clicks
        pointerEvents: "auto",
      }}
    >
      {/* Inner gloss — a soft highlight that gives the orb dimensionality. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 10,
          left: 16,
          width: 22,
          height: 14,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 80%)",
          filter: "blur(2px)",
          pointerEvents: "none",
        }}
      />
      {/* State indicator dot, very small, bottom-center of orb. */}
      {orbState === "queued" && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#ffc857",
            boxShadow: "0 0 6px #ffc857",
          }}
        />
      )}
    </button>
  );
}
