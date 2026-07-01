// Run with:  node --import tsx --test packages/types/src/geo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  polygonAreaSqFt,
  polygonPerimeterFt,
  distanceFt,
  polygonBounds,
  buildPolygonData,
  FEET_PER_METER,
  WA_REFERENCE_LAT_DEG,
} from "./geo.js";

// Build a square whose sides are `feet` long, anchored at (lat0, lng0).
// Uses the same reference-latitude longitude scaling the production code uses
// so the square comes out axis-aligned in the local metric plane.
function squareFeet(feet: number, lat0 = WA_REFERENCE_LAT_DEG, lng0 = -122.3) {
  const EARTH_RADIUS_M = 6371008.8;
  const meters = feet / FEET_PER_METER;
  const dLat = (meters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng =
    (meters / (EARTH_RADIUS_M * Math.cos((lat0 * Math.PI) / 180))) *
    (180 / Math.PI);
  return [
    { lat: lat0, lng: lng0 },
    { lat: lat0, lng: lng0 + dLng },
    { lat: lat0 + dLat, lng: lng0 + dLng },
    { lat: lat0 + dLat, lng: lng0 },
  ];
}

test("100ft x 100ft square ≈ 10,000 sq ft", () => {
  const area = polygonAreaSqFt(squareFeet(100));
  assert.ok(
    Math.abs(area - 10_000) < 50,
    `expected ~10000 sqft, got ${area.toFixed(2)}`
  );
});

test("100ft x 100ft square perimeter ≈ 400 ft", () => {
  const perim = polygonPerimeterFt(squareFeet(100));
  assert.ok(
    Math.abs(perim - 400) < 2,
    `expected ~400 ft, got ${perim.toFixed(2)}`
  );
});

test("area is order-independent (CW vs CCW)", () => {
  const cw = squareFeet(100);
  const ccw = [...cw].reverse();
  assert.ok(Math.abs(polygonAreaSqFt(cw) - polygonAreaSqFt(ccw)) < 1e-6);
});

test("explicitly closed ring is not double-counted", () => {
  const open = squareFeet(100);
  const closed = [...open, open[0]!];
  assert.ok(
    Math.abs(polygonAreaSqFt(open) - polygonAreaSqFt(closed)) < 1e-6
  );
  assert.ok(
    Math.abs(polygonPerimeterFt(open) - polygonPerimeterFt(closed)) < 1e-6
  );
});

test("degenerate polygons return zero", () => {
  assert.equal(polygonAreaSqFt([]), 0);
  assert.equal(polygonAreaSqFt([{ lat: 47.4, lng: -122.3 }]), 0);
  assert.equal(
    polygonAreaSqFt([
      { lat: 47.4, lng: -122.3 },
      { lat: 47.4, lng: -122.29 },
    ]),
    0
  );
  assert.equal(polygonPerimeterFt([{ lat: 47.4, lng: -122.3 }]), 0);
});

test("distanceFt for identical points is 0 (no NaN)", () => {
  const p = { lat: 47.4, lng: -122.3 };
  assert.equal(distanceFt(p, p), 0);
});

test("polygonBounds returns tight axis-aligned box", () => {
  const b = polygonBounds([
    { lat: 47.4, lng: -122.3 },
    { lat: 47.5, lng: -122.2 },
    { lat: 47.45, lng: -122.25 },
  ]);
  assert.equal(b.swLat, 47.4);
  assert.equal(b.swLng, -122.3);
  assert.equal(b.neLat, 47.5);
  assert.equal(b.neLng, -122.2);
});

test("buildPolygonData assembles a complete record", () => {
  const verts = squareFeet(100);
  const data = buildPolygonData(verts, "William", 1234);
  assert.equal(data.drawnBy, "William");
  assert.equal(data.drawnAt, 1234);
  assert.equal(data.vertices.length, 4);
  assert.ok(Math.abs(data.areaSqFt - 10_000) < 50);
  assert.ok(Math.abs(data.perimeterFt - 400) < 2);
  assert.ok(data.bounds.neLat > data.bounds.swLat);
});
