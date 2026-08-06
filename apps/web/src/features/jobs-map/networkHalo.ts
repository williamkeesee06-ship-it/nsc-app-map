// Network View polyline halo companion.
//
// Google Maps polylines are canvas-rendered, so CSS filters/blend-modes
// don't reach them. To fake the "hot filament core + colored halo" look
// we paint each cable as TWO polylines:
//
//   halo  — a wide, semi-transparent polyline in the cable's own color
//   core  — the original polyline (kept unchanged, still handles clicks)
//
// The halo width and opacity are driven by the same zoom bands as the CSS
// vars in networkView.ts. This module owns halo lifecycle only: create,
// path sync, zoom rescale, theme on/off, dispose.
//
// USAGE (from an overlay that already created its `core` polyline):
//
//   const halo = attachNetworkHalo(map, core, style.strokeColor);
//   // ...later, when the path changes:
//   halo.syncPath();
//   // ...on teardown:
//   halo.dispose();
//
// The halo attaches immediately if Network View is currently on and lies
// dormant otherwise; it observes `<html data-map-theme>` to appear/disappear
// live when the user flips the toggle.

import { computeZoomBand } from "./networkView.js";

export interface NetworkHalo {
  /** Push the core polyline's current path into the halo. Call after edits. */
  syncPath: () => void;
  /** Push a new stroke color into the halo. Call if the cable is recolored. */
  setColor: (color: string) => void;
  /** Fully destroy the halo and detach all listeners. Safe to call twice. */
  dispose: () => void;
}

function isNetworkOn(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-map-theme") === "network";
}

/**
 * Wrap a Google Maps polyline with a Network View halo.
 * The halo is only visible when Network View is active; when the user
 * toggles it off, the halo hides itself but remains attached so the next
 * flip is instant.
 */
export function attachNetworkHalo(
  map: google.maps.Map,
  core: google.maps.Polyline,
  color: string
): NetworkHalo {
  let disposed = false;
  let currentColor = color || "#00d4ff";

  const halo = new google.maps.Polyline({
    path: core.getPath(),
    // Colored halo — screen-blended would be nicer but Google canvas can't
    // do blend modes. Semi-transparent + wide gives 90% of the effect.
    strokeColor: currentColor,
    strokeOpacity: 0, // set by applyZoomBand below
    strokeWeight: 1,  // set by applyZoomBand below
    clickable: false,
    zIndex: (core.get("zIndex") ?? 0) - 1,
    // Halos never occlude icons or the core.
    map: isNetworkOn() ? map : null,
  });

  function applyZoomBand(): void {
    if (disposed) return;
    const z = map.getZoom();
    if (typeof z !== "number") return;
    const band = computeZoomBand(z);
    halo.setOptions({
      strokeWeight: band.haloWeight,
      strokeOpacity: band.haloOpacity,
    });
  }

  function applyThemeVisibility(): void {
    if (disposed) return;
    halo.setMap(isNetworkOn() ? map : null);
    if (isNetworkOn()) applyZoomBand();
  }

  // React to zoom (bands change halo width/opacity).
  const zoomListener = map.addListener("zoom_changed", applyZoomBand);
  const idleListener = map.addListener("idle", applyZoomBand);

  // React to theme changes on <html data-map-theme>.
  const themeObserver =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver(applyThemeVisibility)
      : null;
  if (themeObserver) {
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-map-theme"],
    });
  }

  // Prime once.
  applyZoomBand();

  return {
    syncPath() {
      if (disposed) return;
      halo.setPath(core.getPath());
    },
    setColor(c: string) {
      if (disposed) return;
      currentColor = c || currentColor;
      halo.setOptions({ strokeColor: currentColor });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      google.maps.event.removeListener(zoomListener);
      google.maps.event.removeListener(idleListener);
      themeObserver?.disconnect();
      halo.setMap(null);
    },
  };
}
