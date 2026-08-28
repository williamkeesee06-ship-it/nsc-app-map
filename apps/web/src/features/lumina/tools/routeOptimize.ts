/**
 * Tool: routeOptimize
 *
 * Greedy nearest-neighbor TSP for multi-stop driving order. Given a start
 * point + a list of jobIds, returns the jobs in the order Billy should drive
 * them to minimize total backtracking. Not globally optimal (true TSP is
 * NP-hard) but excellent for 5–20 stops and 100x faster than a routing API.
 *
 * Distances are haversine miles — close enough for sequencing. Actual drive
 * times from a routing API can be added later without changing the contract.
 */

import type { Job } from "@nsc/types";
import { api } from "../../../lib/api.js";
import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface RouteOptimizeInput {
  startLat: number;
  startLng: number;
  jobIds: string[];
  /** If true, append the start back to the end of the route (round trip). */
  returnToStart?: boolean;
}

interface Stop {
  order: number;
  jobId: string;
  workOrder: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  legMiles: number;
  cumulativeMiles: number;
}

interface RouteOptimizeData {
  totalMiles: number;
  stops: Stop[];
  /** Jobs we couldn't include because they lack a geocode. */
  ungeocoded: string[];
}

function miles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function run(
  input: RouteOptimizeInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<RouteOptimizeData>> {
  if (typeof input.startLat !== "number" || typeof input.startLng !== "number") {
    return { ok: false, message: "routeOptimize requires startLat and startLng." };
  }
  if (!input.jobIds || input.jobIds.length === 0) {
    return { ok: false, message: "routeOptimize requires a non-empty jobIds array." };
  }
  const all = await api.listJobs();
  const byId = new Map<string, Job>();
  for (const j of all.jobs) {
    byId.set(j.jobId, j);
    byId.set(j.workOrder, j);
  }
  type Pin = { jobId: string; workOrder: string; address: string | null; city: string | null; lat: number; lng: number };
  const pending: Pin[] = [];
  const ungeocoded: string[] = [];
  for (const id of input.jobIds) {
    const j = byId.get(id);
    if (!j) {
      ungeocoded.push(id);
      continue;
    }
    if (!j.geocode || j.geocode.status !== "OK") {
      ungeocoded.push(id);
      continue;
    }
    pending.push({
      jobId: j.jobId,
      workOrder: j.workOrder,
      address: j.address ?? null,
      city: j.city ?? null,
      lat: j.geocode.lat,
      lng: j.geocode.lng,
    });
  }
  // Greedy nearest-neighbor.
  let cursor = { lat: input.startLat, lng: input.startLng };
  const stops: Stop[] = [];
  let cum = 0;
  let order = 1;
  while (pending.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pending.length; i++) {
      const d = miles(cursor, pending[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const picked = pending.splice(bestIdx, 1)[0];
    cum += bestDist;
    stops.push({
      order,
      jobId: picked.jobId,
      workOrder: picked.workOrder,
      address: picked.address,
      city: picked.city,
      lat: picked.lat,
      lng: picked.lng,
      legMiles: Math.round(bestDist * 10) / 10,
      cumulativeMiles: Math.round(cum * 10) / 10,
    });
    cursor = { lat: picked.lat, lng: picked.lng };
    order++;
  }
  if (input.returnToStart) {
    const back = miles(cursor, { lat: input.startLat, lng: input.startLng });
    cum += back;
  }
  return {
    ok: true,
    message: `Optimized ${stops.length} stop${stops.length === 1 ? "" : "s"}; total ${Math.round(cum * 10) / 10} mi${ungeocoded.length ? `; ${ungeocoded.length} ungeocoded skipped` : ""}.`,
    data: {
      totalMiles: Math.round(cum * 10) / 10,
      stops,
      ungeocoded,
    },
  };
}

export const routeOptimizeTool: LuminaTool<RouteOptimizeInput, RouteOptimizeData> = {
  name: "routeOptimize",
  description:
    "Order a list of jobs into a near-optimal driving sequence from a start point. Returns each stop with leg + cumulative miles. Use when Billy asks for a route, run-order, or 'best way to hit these in order'.",
  kind: "read",
  run,
};
