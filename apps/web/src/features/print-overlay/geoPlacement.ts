// Bridges the Stage 4 free transform to the same GeoSolution the Stage 5
// georeferencing math produces, so a single code path renders the page overlay
// on the map in both stages. All placement is expressed in geographic space
// (via GeoSolution) so it stays stable across map pan/zoom.
import type { GeoSolution, PrintOverlayTransform } from "@nsc/types";

/**
 * Ground width (meters) a page spans at scale 1 before the user resizes it.
 * Arbitrary but sensible for a construction print; the Stage 4 scale slider and
 * Stage 5 georeference both adjust the true ground size from here.
 */
export const DEFAULT_GROUND_WIDTH_M = 120;

/**
 * Build a GeoSolution from a free transform. The page's own pixel space (the
 * rendered preview raster) maps to ground meters via a base meters-per-pixel
 * derived from DEFAULT_GROUND_WIDTH_M, divided by the user's scale. Rotation is
 * clockwise degrees. `imgW`/`imgH` are the preview raster's natural pixel size.
 */
export function solutionFromTransform(
  t: PrintOverlayTransform,
  imgW: number,
  imgH: number
): GeoSolution {
  const baseMpp = DEFAULT_GROUND_WIDTH_M / Math.max(1, imgW);
  return {
    pageOrigin: { x: imgW / 2, y: imgH / 2 },
    origin: { lat: t.center.lat, lng: t.center.lng },
    metersPerPixel: baseMpp / (t.scale || 1),
    rotationRad: (t.rotationDeg * Math.PI) / 180,
    refLatDeg: t.center.lat,
  };
}
