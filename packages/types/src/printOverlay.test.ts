// Run with:  node --import tsx --test packages/types/src/printOverlay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  suggestCropRect,
  clampCropRect,
  isValidCropRect,
  solveGeoSolution,
  pageToLatLng,
  alignmentResidualFt,
  alignmentQualityLabel,
  type GeoAlignment,
  type PagePoint,
} from "./printOverlay.js";
import { distanceFt, FEET_PER_METER } from "./geo.js";

// ── Crop suggestion ──────────────────────────────────────────────────────────

test("suggestCropRect trims plain margins around detected content", () => {
  // Content occupies the middle of a 1000×800 raster.
  const rect = suggestCropRect(
    { minX: 200, minY: 160, maxX: 800, maxY: 640 },
    1000,
    800,
    0.015
  );
  assert.ok(rect, "expected a crop suggestion");
  // Left edge = (200 - 15)/1000 = 0.185
  assert.ok(Math.abs(rect!.x - 0.185) < 1e-6);
  assert.ok(Math.abs(rect!.y - (160 - 12) / 800) < 1e-6);
  // The crop must be strictly inside the page.
  assert.ok(isValidCropRect(rect!));
  assert.ok(rect!.width < 1 && rect!.height < 1);
});

test("suggestCropRect never cuts into content (content stays inside crop)", () => {
  const content = { minX: 300, minY: 250, maxX: 700, maxY: 550 };
  const rect = suggestCropRect(content, 1000, 800)!;
  assert.ok(rect.x * 1000 <= content.minX, "left crop must not cut content");
  assert.ok(rect.y * 800 <= content.minY, "top crop must not cut content");
  assert.ok((rect.x + rect.width) * 1000 >= content.maxX, "right crop must not cut content");
  assert.ok((rect.y + rect.height) * 800 >= content.maxY, "bottom crop must not cut content");
});

test("suggestCropRect returns null for blank/degenerate pages", () => {
  assert.equal(suggestCropRect({ minX: 500, minY: 400, maxX: 500, maxY: 400 }, 1000, 800), null);
  assert.equal(suggestCropRect({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 0, 0), null);
});

test("suggestCropRect returns null when content fills the page (nothing to trim)", () => {
  assert.equal(suggestCropRect({ minX: 0, minY: 0, maxX: 1000, maxY: 800 }, 1000, 800), null);
});

test("clampCropRect keeps rects inside the unit square with a minimum size", () => {
  const clamped = clampCropRect({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 });
  assert.ok(clamped.x + clamped.width <= 1 + 1e-9);
  assert.ok(clamped.y + clamped.height <= 1 + 1e-9);
  const tiny = clampCropRect({ x: 0.1, y: 0.1, width: 0.0001, height: 0.0001 }, 0.02);
  assert.ok(tiny.width >= 0.02 && tiny.height >= 0.02);
});

test("isValidCropRect rejects out-of-range and zero-area rects", () => {
  assert.equal(isValidCropRect({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }), true);
  assert.equal(isValidCropRect({ x: -0.1, y: 0, width: 0.5, height: 0.5 }), false);
  assert.equal(isValidCropRect({ x: 0.6, y: 0, width: 0.5, height: 0.5 }), false);
  assert.equal(isValidCropRect({ x: 0, y: 0, width: 0, height: 0.5 }), false);
});

// ── Georeferencing similarity transform ───────────────────────────────────────

// A known ground point near Woodinville, WA.
const ORIGIN = { lat: 47.75, lng: -122.15 };
const REF_LAT = 47.75;
const FEET_PER_DEGREE_LAT = 364567.2;
const toRad = (d: number) => (d * Math.PI) / 180;

// Synthesize the true geographic image of a page point for a chosen
// metersPerPixel + rotation, using the same flat-earth model as production.
function trueLatLng(p: PagePoint, pageOrigin: PagePoint, mpp: number, rotRad: number) {
  const dx = p.x - pageOrigin.x;
  const dy = -(p.y - pageOrigin.y);
  const east = (dx * Math.cos(rotRad) - dy * Math.sin(rotRad)) * mpp;
  const north = (dx * Math.sin(rotRad) + dy * Math.cos(rotRad)) * mpp;
  const eastFt = east * FEET_PER_METER;
  const northFt = north * FEET_PER_METER;
  return {
    lat: ORIGIN.lat + northFt / FEET_PER_DEGREE_LAT,
    lng: ORIGIN.lng + eastFt / (FEET_PER_DEGREE_LAT * Math.cos(toRad(REF_LAT))),
  };
}

test("solveGeoSolution recovers scale and rotation from two anchors", () => {
  const pageOrigin = { x: 100, y: 700 };
  const mpp = 0.05; // 5 cm per page pixel
  const rot = toRad(20);
  const aPage = pageOrigin;
  const bPage = { x: 900, y: 200 };
  const alignment = {
    anchorA: { page: aPage, map: trueLatLng(aPage, pageOrigin, mpp, rot) },
    anchorB: { page: bPage, map: trueLatLng(bPage, pageOrigin, mpp, rot) },
  };
  const sol = solveGeoSolution(alignment, REF_LAT)!;
  assert.ok(sol, "expected a solution");
  assert.ok(Math.abs(sol.metersPerPixel - mpp) < 1e-4, `mpp ${sol.metersPerPixel}`);
  assert.ok(Math.abs(sol.rotationRad - rot) < 1e-4, `rot ${sol.rotationRad}`);
});

test("pageToLatLng round-trips anchors within a foot", () => {
  const pageOrigin = { x: 100, y: 700 };
  const mpp = 0.03;
  const rot = toRad(-35);
  const aPage = pageOrigin;
  const bPage = { x: 640, y: 120 };
  const alignment = {
    anchorA: { page: aPage, map: trueLatLng(aPage, pageOrigin, mpp, rot) },
    anchorB: { page: bPage, map: trueLatLng(bPage, pageOrigin, mpp, rot) },
  };
  const sol = solveGeoSolution(alignment, REF_LAT)!;
  // Anchor A is the transform origin — its image is its own map coordinate.
  // (distanceFt uses the spherical law of cosines, which has ~sub-foot floating
  // noise for coincident points, so compare within a foot rather than exactly.)
  const gotA = pageToLatLng(sol, aPage);
  assert.ok(distanceFt(gotA, alignment.anchorA.map) < 1);
  // Anchor B round-trips back to B within a foot.
  const gotB = pageToLatLng(sol, bPage);
  assert.ok(distanceFt(gotB, alignment.anchorB.map) < 1, "B round-trip within 1 ft");
});

test("solveGeoSolution returns null for coincident page anchors", () => {
  const alignment = {
    anchorA: { page: { x: 100, y: 100 }, map: ORIGIN },
    anchorB: { page: { x: 100, y: 100 }, map: { lat: 47.76, lng: -122.14 } },
  };
  assert.equal(solveGeoSolution(alignment, REF_LAT), null);
});

test("alignmentResidualFt is ~0 for a perfectly consistent control point", () => {
  const pageOrigin = { x: 0, y: 500 };
  const mpp = 0.04;
  const rot = toRad(12);
  const aPage = pageOrigin;
  const bPage = { x: 800, y: 100 };
  const cPage = { x: 400, y: 300 };
  const alignment: GeoAlignment = {
    anchorA: { page: aPage, map: trueLatLng(aPage, pageOrigin, mpp, rot) },
    anchorB: { page: bPage, map: trueLatLng(bPage, pageOrigin, mpp, rot) },
    control: { page: cPage, map: trueLatLng(cPage, pageOrigin, mpp, rot) },
  };
  const residual = alignmentResidualFt(alignment, REF_LAT)!;
  assert.ok(residual < 1, `residual ${residual} ft should be ~0`);
});

test("alignmentResidualFt reports the offset of a deliberately-wrong control point", () => {
  const pageOrigin = { x: 0, y: 500 };
  const mpp = 0.04;
  const rot = 0;
  const aPage = pageOrigin;
  const bPage = { x: 800, y: 500 };
  const cPage = { x: 400, y: 500 };
  const good = trueLatLng(cPage, pageOrigin, mpp, rot);
  // Nudge the observed control point north by ~10 ft.
  const off = { lat: good.lat + 10 / FEET_PER_DEGREE_LAT, lng: good.lng };
  const alignment: GeoAlignment = {
    anchorA: { page: aPage, map: trueLatLng(aPage, pageOrigin, mpp, rot) },
    anchorB: { page: bPage, map: trueLatLng(bPage, pageOrigin, mpp, rot) },
    control: { page: cPage, map: off },
  };
  const residual = alignmentResidualFt(alignment, REF_LAT)!;
  assert.ok(Math.abs(residual - 10) < 0.5, `residual ${residual} ~ 10 ft`);
});

test("alignmentResidualFt is null without a control point", () => {
  const alignment: GeoAlignment = {
    anchorA: { page: { x: 0, y: 0 }, map: ORIGIN },
    anchorB: { page: { x: 100, y: 0 }, map: { lat: 47.751, lng: -122.15 } },
  };
  assert.equal(alignmentResidualFt(alignment, REF_LAT), null);
});

test("alignmentQualityLabel buckets residuals into plain language", () => {
  assert.match(alignmentQualityLabel(null), /Add a 3rd point/);
  assert.match(alignmentQualityLabel(1.5), /Excellent/);
  assert.match(alignmentQualityLabel(6), /Good/);
  assert.match(alignmentQualityLabel(20), /Fair/);
  assert.match(alignmentQualityLabel(50), /Loose/);
});
