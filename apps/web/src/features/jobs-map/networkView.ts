// Network View zoom-band system.
//
// Runs on `zoom_changed`, coalesced through requestAnimationFrame so continuous
// wheel-zoom never thrashes the DOM. On every settled zoom it writes CSS
// custom-properties on <html> so every polyline/marker in the app can read
// them via var(...) rules gated on `[data-map-theme="network"]`.
//
// Numbers match the spec Billy approved (map-studio-gis reference, ported to
// Google Maps):
//
//   z >= 17            zoom-near      labels appear
//   14.3 <= z < 17     zoom-mid       structures at working size
//   11 <= z < 14.3     zoom-far       paths only, wide bloom
//   z < 12.3           zoom-trunk-only  paths only, widest bloom + heavier core
//   z < 11             zoom-micro     paths only, maximum bloom
//
// Cable weight tracks the basemap's own road weights so a run reads as part
// of the street network rather than a decoration on top of it.

import { useEffect } from "react";

export const NETWORK_VIEW_ATTR = "data-map-theme";
export const NETWORK_VIEW_VALUE = "network";

interface ZoomBandStyles {
  /** Continuous scale for structure icons (0.06 tiny → ~1.0 close). */
  iconScale: number;
  /** Continuous opacity for structure icons (0 → 1). */
  iconOpacity: number;
  /** Continuous cable core stroke weight in pixels. Matches Google roads. */
  cableWeight: number;
  /** Halo bloom radius in pixels (drop-shadow radius). */
  cableGlow: number;
  /** How much of the cable's own color to keep in its core stroke.
   *  Higher = more saturated. Lower = whiter (hot filament). */
  coreColorMix: number;
  /** Halo stroke width in pixels (widens the visible glow footprint). */
  haloWeight: number;
  /** Halo stroke opacity (0-1). */
  haloOpacity: number;
  /** Which band class to add to <html>. */
  band: "zoom-micro" | "zoom-far" | "zoom-mid" | "zoom-near";
  /** True below 12.3 — trunk-only reading, cold cable drops out. */
  trunkOnly: boolean;
  /** True at z >= 14.3 — structures allowed on screen. */
  structuresOn: boolean;
  /** True at z >= 19 — footages allowed. */
  footagesOn: boolean;
}

const ALL_BANDS = ["zoom-micro", "zoom-far", "zoom-mid", "zoom-near"] as const;

export function computeZoomBand(zoom: number): ZoomBandStyles {
  // ─── Icon scale + opacity (continuous, no popping) ─────────────────────
  let iconScale: number;
  let iconOpacity = 1;
  if (zoom >= 17) {
    iconScale = 0.82 + Math.max(0, zoom - 17) * 0.09;
  } else if (zoom >= 14.3) {
    iconScale = 0.52 + (zoom - 14.3) * (0.3 / 2.7);
  } else if (zoom >= 13.3) {
    const k = zoom - 13.3; // 0 → 1
    iconScale = 0.06 + k * k * 0.46;
    iconOpacity = k * k;
  } else {
    iconScale = 0.15;
    iconOpacity = 0;
  }

  // ─── Cable weight tracks Google's road stroke weights ──────────────────
  let cableWeight: number;
  if (zoom >= 16) cableWeight = 4;
  else if (zoom >= 14.3) cableWeight = 3;
  else if (zoom >= 13.3) cableWeight = 2;
  else if (zoom >= 12.3) cableWeight = 1.7;
  else if (zoom >= 11) cableWeight = 1.6;
  else cableWeight = 1.4;

  // ─── Halo bloom radius by band ─────────────────────────────────────────
  let cableGlow: number;
  let coreColorMix: number;
  let haloWeight: number;
  let haloOpacity: number;
  let band: ZoomBandStyles["band"];

  if (zoom >= 17) {
    // Zoomed in — the line is the subject. Minimal bloom, saturated core.
    band = "zoom-near";
    cableGlow = 6;
    coreColorMix = 0.85;
    haloWeight = cableWeight + 6;
    haloOpacity = 0.45;
  } else if (zoom >= 14.3) {
    band = "zoom-mid";
    cableGlow = 11;
    coreColorMix = 0.55;
    haloWeight = cableWeight + 10;
    haloOpacity = 0.55;
  } else if (zoom >= 11) {
    band = "zoom-far";
    cableGlow = 17;
    coreColorMix = 0.4;
    haloWeight = cableWeight + 14;
    haloOpacity = 0.65;
  } else {
    band = "zoom-micro";
    cableGlow = 26;
    coreColorMix = 0.3;
    haloWeight = cableWeight + 20;
    haloOpacity = 0.75;
  }

  // ─── Trunk-only band — below 12.3 the basemap drops side streets ───────
  const trunkOnly = zoom < 12.3;
  if (trunkOnly) {
    cableGlow = Math.max(cableGlow, 32);
    haloWeight = cableWeight + 22;
    haloOpacity = 0.8;
  }

  return {
    iconScale,
    iconOpacity,
    cableWeight,
    cableGlow,
    coreColorMix,
    haloWeight,
    haloOpacity,
    band,
    trunkOnly,
    structuresOn: zoom >= 14.3,
    footagesOn: zoom >= 19,
  };
}

/**
 * Push a zoom band's numbers onto the document root so every downstream
 * consumer (SVG filters, CSS var(--cable-*)) picks it up. Also mirrors the
 * band as a class on <html> so per-band rules can match.
 */
function applyBandToDom(band: ZoomBandStyles): void {
  const root = document.documentElement;
  root.style.setProperty("--map-zoom-scale", band.iconScale.toFixed(3));
  root.style.setProperty("--icon-opacity", band.iconOpacity.toFixed(3));
  root.style.setProperty("--cable-weight", `${band.cableWeight}px`);
  root.style.setProperty("--cable-glow", `${band.cableGlow}px`);
  root.style.setProperty("--cable-core-mix", band.coreColorMix.toFixed(3));
  root.style.setProperty("--cable-halo-weight", `${band.haloWeight}px`);
  root.style.setProperty("--cable-halo-opacity", band.haloOpacity.toFixed(3));

  for (const b of ALL_BANDS) root.classList.toggle(b, b === band.band);
  root.classList.toggle("zoom-trunk-only", band.trunkOnly);
  root.classList.toggle("zoom-structures", band.structuresOn);
  root.classList.toggle("zoom-full", band.footagesOn);
}

function clearBandFromDom(): void {
  const root = document.documentElement;
  for (const prop of [
    "--map-zoom-scale",
    "--icon-opacity",
    "--cable-weight",
    "--cable-glow",
    "--cable-core-mix",
    "--cable-halo-weight",
    "--cable-halo-opacity",
  ]) {
    root.style.removeProperty(prop);
  }
  for (const b of ALL_BANDS) root.classList.remove(b);
  root.classList.remove("zoom-trunk-only", "zoom-structures", "zoom-full");
}

/**
 * Subscribe to a Google Map's zoom and keep <html>'s Network View CSS
 * variables in sync. Enabled controls whether the effect runs at all — pass
 * `theme === "network"` from the theme context.
 */
export function useNetworkViewBands(
  map: google.maps.Map | null,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled || !map) {
      clearBandFromDom();
      return;
    }

    let rafId: number | null = null;
    const update = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const z = map.getZoom();
        if (typeof z !== "number") return;
        applyBandToDom(computeZoomBand(z));
      });
    };

    // Prime once so the first render doesn't wait for a zoom event.
    update();
    const listener = map.addListener("zoom_changed", update);
    // Also refresh on idle (covers programmatic setCenter/fitBounds).
    const idle = map.addListener("idle", update);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      google.maps.event.removeListener(listener);
      google.maps.event.removeListener(idle);
      clearBandFromDom();
    };
  }, [map, enabled]);
}

/**
 * Mix a hex color toward white by `t` (0=white, 1=own color).
 * Used to build the "hot filament" core stroke color from the cable's own
 * color at the current zoom band's `--cable-core-mix`.
 */
export function mixTowardWhite(hex: string, t: number): string {
  const h = hex.trim().replace(/^#/, "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}
