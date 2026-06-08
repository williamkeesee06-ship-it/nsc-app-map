/**
 * Lumina Orb — true 3D rotating Dyson sphere wireframe.
 *
 * Three great-circle rings rendered as actual 3D circles, projected to 2D
 * each frame with a rotating view matrix. Background is fully transparent —
 * only the neon rings, particle motes, and core nucleus are visible. The
 * sphere tumbles continuously on multiple axes so it always feels alive.
 *
 * Positioned above Google's bottom-right controls. Tap = open Lumina tab.
 *
 * State theming: hue + glow intensity + rotation speed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLumina, type OrbState } from "./store/luminaStore.js";

interface StateStyle {
  hue: string;
  hueAlt?: string;
  glow: string;
  /** Radians per second of rotation. Higher = faster. */
  spin: number;
  glowScale: number;
}

const STATE_STYLES: Record<OrbState, StateStyle> = {
  idle:      { hue: "#1ea7ff", glow: "rgba(30,167,255,0.55)",  spin: 0.45, glowScale: 1.0 },
  listening: { hue: "#00d4ff", glow: "rgba(0,212,255,0.85)",   spin: 1.4,  glowScale: 1.4 },
  thinking:  { hue: "#ffb84d", glow: "rgba(255,184,77,0.65)",  spin: 2.2,  glowScale: 1.2 },
  speaking:  { hue: "#1ea7ff", hueAlt: "#d040ff", glow: "rgba(160,32,192,0.6)", spin: 0.9, glowScale: 1.25 },
  queued:    { hue: "#ffc857", glow: "rgba(255,200,87,0.75)",  spin: 0.5,  glowScale: 1.15 },
  error:     { hue: "#ff4d4d", glow: "rgba(255,77,77,0.65)",   spin: 0.4,  glowScale: 1.0 },
};

// Orb size in CSS pixels. Smaller than before per Billy's feedback.
const SIZE = 56;
// Sphere radius in viewbox units (viewbox is 100×100).
const R = 36;
// Number of samples used to draw each great circle as a polyline.
const RING_SEGMENTS = 64;

// Stable particle field — generated once, deterministic. The interior of
// the sphere is FILLED with these neon motes, sampled uniformly inside the
// 3D ball via rejection sampling so they read as a glowing volume of stars.
const PARTICLES = (() => {
  let s = 1337;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const out: Array<{ x: number; y: number; z: number; r: number; delay: number; dur: number; baseOp: number }> = [];
  const TARGET = 90;
  while (out.length < TARGET) {
    // Uniform cube sample in [-R..R]^3, reject if outside sphere.
    const x = (rand() - 0.5) * 2 * R;
    const y = (rand() - 0.5) * 2 * R;
    const z = (rand() - 0.5) * 2 * R;
    if (x * x + y * y + z * z > R * R) continue;
    out.push({
      x, y, z,
      // Wide size variance — a few bigger "hero" sparkles, lots of fine dust.
      r: rand() < 0.15 ? 0.9 + rand() * 0.8 : 0.3 + rand() * 0.55,
      delay: rand() * 5,
      // Faster pulse on a portion so the field actively twinkles.
      dur: rand() < 0.35 ? 0.6 + rand() * 0.8 : 1.6 + rand() * 2.4,
      baseOp: 0.55 + rand() * 0.45,
    });
  }
  return out;
})();

// Build a great-circle ring as N points in 3D space, on a given plane.
// `axis` defines which axis the ring is perpendicular to (the "pole" axis).
function makeRingPoints(axis: "x" | "y" | "z"): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const t = (i / RING_SEGMENTS) * Math.PI * 2;
    const c = Math.cos(t) * R;
    const s = Math.sin(t) * R;
    // Plane perpendicular to `axis` — the other two axes carry (c, s).
    if (axis === "z") pts.push([c, s, 0]);
    else if (axis === "y") pts.push([c, 0, s]);
    else /* x */          pts.push([0, c, s]);
  }
  return pts;
}

const RING_Z = makeRingPoints("z"); // equatorial
const RING_Y = makeRingPoints("y"); // polar #1
const RING_X = makeRingPoints("x"); // polar #2

// Rotate a 3D point by Euler angles (rx around X, ry around Y, rz around Z).
function rotate(p: [number, number, number], rx: number, ry: number, rz: number): [number, number, number] {
  let [x, y, z] = p;
  // Rotate around X
  let cy = Math.cos(rx), sy = Math.sin(rx);
  [y, z] = [y * cy - z * sy, y * sy + z * cy];
  // Rotate around Y
  cy = Math.cos(ry); sy = Math.sin(ry);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  // Rotate around Z
  cy = Math.cos(rz); sy = Math.sin(rz);
  [x, y] = [x * cy - y * sy, x * sy + y * cy];
  return [x, y, z];
}

// Project a 3D point to 2D with a slight perspective divide. Returns
// (cx, cy) in viewbox space plus a depth-based opacity multiplier so the
// back half of each ring fades — that's what sells the 3D illusion.
function project(p: [number, number, number]): { x: number; y: number; depth: number } {
  // Perspective: closer points (positive z) appear slightly larger / brighter.
  const fov = 140;
  const k = fov / (fov + p[2]);
  return {
    x: 50 + p[0] * k,
    y: 50 + p[1] * k,
    // depth in [0..1]: 1 = facing camera, 0 = far side
    depth: (p[2] + R) / (R * 2),
  };
}

// Build an SVG polyline string from projected ring points, splitting into
// "front" and "back" segments so we can render the back faded.
function ringPaths(
  pts: Array<[number, number, number]>,
  rx: number, ry: number, rz: number
): { front: string; back: string } {
  const projected = pts.map((p) => project(rotate(p, rx, ry, rz)));
  // Walk the ring; classify each segment by whether its midpoint is on the
  // front half (depth > 0.5). Emit one path string per visibility class.
  let frontParts: string[] = [];
  let backParts: string[] = [];
  let currentFront: string[] = [];
  let currentBack: string[] = [];
  for (let i = 0; i < projected.length; i++) {
    const a = projected[i]!;
    const b = projected[(i + 1) % projected.length]!;
    const midDepth = (a.depth + b.depth) / 2;
    const seg = `${a.x.toFixed(2)},${a.y.toFixed(2)} ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
    if (midDepth >= 0.5) {
      if (currentBack.length) { backParts.push(currentBack.join(" ")); currentBack = []; }
      currentFront.push(seg);
    } else {
      if (currentFront.length) { frontParts.push(currentFront.join(" ")); currentFront = []; }
      currentBack.push(seg);
    }
  }
  if (currentFront.length) frontParts.push(currentFront.join(" "));
  if (currentBack.length) backParts.push(currentBack.join(" "));
  // Convert collected segments to SVG `M x,y L x,y` paths.
  const toPath = (parts: string[]): string =>
    parts
      .map((seg) => {
        const coords = seg.split(" ");
        const first = coords[0]!;
        const rest = coords.slice(1);
        return `M${first} L${rest.join(" L")}`;
      })
      .join(" ");
  return { front: toPath(frontParts), back: toPath(backParts) };
}

export default function Orb() {
  const { orbState, toggleTab } = useLumina();
  const style = STATE_STYLES[orbState];
  const [hover, setHover] = useState(false);

  // Speaking-state shimmer between primary and alt hue.
  const [shimmerOn, setShimmerOn] = useState(false);
  useEffect(() => {
    if (orbState !== "speaking") return;
    const id = window.setInterval(() => setShimmerOn((v) => !v), 280);
    return () => window.clearInterval(id);
  }, [orbState]);
  const hue = orbState === "speaking" && shimmerOn && style.hueAlt ? style.hueAlt : style.hue;

  // Drive the rotation off requestAnimationFrame so the orb tumbles smoothly
  // in 3D. We rotate on all three axes at slightly different rates so it
  // never repeats visibly — that's what makes it feel alive vs robotic.
  const [tick, setTick] = useState(0);
  const startRef = useRef<number>(performance.now());
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setTick((performance.now() - startRef.current) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Compute current Euler angles based on elapsed time + state spin speed.
  const rx = tick * style.spin * 0.7;
  const ry = tick * style.spin * 1.0;
  const rz = tick * style.spin * 0.4;

  // Recompute ring projections every frame.
  const rings = useMemo(() => {
    return {
      a: ringPaths(RING_Z, rx, ry, rz),
      b: ringPaths(RING_Y, rx, ry, rz),
      c: ringPaths(RING_X, rx, ry, rz),
    };
  }, [rx, ry, rz]);

  // Outer glow halo — soft multi-layer drop-shadow on the wrapper button.
  const haloShadow = useMemo(() => {
    const g = style.glow;
    const s = style.glowScale;
    return [
      `0 0 ${10 * s}px ${g}`,
      `0 0 ${22 * s}px ${g}`,
      `0 0 ${40 * s}px ${g}`,
    ].join(", ");
  }, [style.glow, style.glowScale]);

  const filterId = useMemo(() => `lx-orb-glow-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <button
      type="button"
      aria-label={`Lumina — ${orbState}`}
      onClick={toggleTab}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        right: 20,
        bottom: 144, // above Google's pan diamond + Pegman
        width: SIZE,
        height: SIZE,
        padding: 0,
        border: "none",
        borderRadius: "50%",
        background: "transparent",
        // Halo is a CSS shadow so it sits OUTSIDE the SVG and doesn't clip.
        boxShadow: haloShadow,
        transform: hover ? "scale(1.08)" : "scale(1)",
        transition: "transform 180ms ease, box-shadow 280ms ease",
        cursor: "pointer",
        zIndex: 50,
        pointerEvents: "auto",
      }}
    >
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        style={{ display: "block", overflow: "visible", background: "transparent" }}
      >
        <defs>
          {/* Soft neon glow filter on every stroke. */}
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="0.9" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Sparkling neon particle field — fills the interior volume of the
            sphere. Each mote is projected every frame so it drifts with the
            rotation, and twinkles via an SVG opacity animation. Depth fades
            give the back of the sphere a softer feel. */}
        <g filter={`url(#${filterId})`}>
          {PARTICLES.map((p, i) => {
            const proj = project(rotate([p.x, p.y, p.z], rx, ry, rz));
            // Depth fade: front-half particles bright, back-half dimmer.
            const depthMul = 0.35 + proj.depth * 0.65;
            const op = p.baseOp * depthMul;
            return (
              <circle key={i} cx={proj.x} cy={proj.y} r={p.r} fill={hue} opacity={op}>
                <animate
                  attributeName="opacity"
                  values={`${op * 0.15};${op};${op * 0.15}`}
                  dur={`${p.dur}s`}
                  begin={`${p.delay}s`}
                  repeatCount="indefinite"
                />
              </circle>
            );
          })}
        </g>

        {/* Three great-circle rings — back half drawn faded for 3D depth. */}
        {/* Back halves first (lower z-order, dimmer) */}
        <g filter={`url(#${filterId})`} opacity="0.35">
          <path d={rings.a.back} fill="none" stroke={hue} strokeWidth="1.1" />
          <path d={rings.b.back} fill="none" stroke={hue} strokeWidth="1.1" />
          <path d={rings.c.back} fill="none" stroke={hue} strokeWidth="1.1" />
        </g>
        {/* Front halves on top, full brightness */}
        <g filter={`url(#${filterId})`}>
          <path d={rings.a.front} fill="none" stroke={hue} strokeWidth="1.3" />
          <path d={rings.b.front} fill="none" stroke={hue} strokeWidth="1.3" />
          <path d={rings.c.front} fill="none" stroke={hue} strokeWidth="1.3" />
        </g>

        {/* Bright energy nucleus at the center, gentle pulse. */}
        <circle cx="50" cy="50" r="1.8" fill={hue} opacity="0.95" filter={`url(#${filterId})`}>
          <animate
            attributeName="r"
            values="1.4;2.6;1.4"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </circle>

        {/* Queued indicator dot below the orb. */}
        {orbState === "queued" && (
          <circle cx="50" cy="94" r="2" fill="#ffc857">
            <animate attributeName="opacity" values="0.4;1;0.4" dur="1.4s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
    </button>
  );
}
