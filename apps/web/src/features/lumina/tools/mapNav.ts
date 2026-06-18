/**
 * Map navigation tool suite — 12 tools that drive the map UI.
 *
 * All `kind: "navigate"` — they perform UI side effects (pan/zoom/select/
 * filter/pin) but never write to Firestore. The bridge to actual map state
 * lives in MapBridge.tsx; here we just call into ctx.map.
 *
 * Conventions:
 *   - All return { ok: true, message: "..." } when the bridge isn't ready
 *     (instead of throwing) so the model can hear "map not ready yet".
 *   - flyTo* tools always trigger the arrival glow (cinematic Option C
 *     ring sweep from orb → target).
 *   - dropPin accepts EITHER an address OR raw lat/lng.
 */

import { api } from "../../../lib/api.js";
import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// flyToAddress — geocode + pan + drop pin
// ─────────────────────────────────────────────────────────────────────────────

interface FlyToAddressInput {
  address: string;
  label?: string;
}

const flyToAddressTool: LuminaTool<FlyToAddressInput, { lat: number; lng: number; formattedAddress: string }> = {
  name: "flyToAddress",
  description: "Geocode an address and pan/zoom the map to it with a neon arrival glow.",
  kind: "navigate",
  async run(input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    if (!input.address) return { ok: false, message: "flyToAddress requires address." };
    const res = await fetch(`/api/lumina/geocode?q=${encodeURIComponent(input.address)}`);
    if (!res.ok) return { ok: false, message: `Geocode failed (${res.status}).` };
    const j = (await res.json()) as {
      status: string;
      lat: number;
      lng: number;
      formattedAddress: string;
    };
    if (j.status !== "OK") return { ok: false, message: `No result for "${input.address}".` };
    ctx.map.flyTo({ lat: j.lat, lng: j.lng, label: input.label ?? j.formattedAddress });
    return {
      ok: true,
      message: `Flying to ${j.formattedAddress}.`,
      data: { lat: j.lat, lng: j.lng, formattedAddress: j.formattedAddress },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// flyToJob — pan to a job's geocode
// ─────────────────────────────────────────────────────────────────────────────

interface FlyToJobInput {
  jobId: string;
}

interface FlyToJobData {
  // Always present.
  jobId: string;
  // "nsc" = found on Billy's NSC tracker (map flown, card opened).
  // "otherSupervisor" = not on NSC but exists in Smartsheet under someone else.
  // "unassigned" = exists in Smartsheet with no supervisor yet.
  // "notFound" = not anywhere on the tracker.
  outcome: "nsc" | "otherSupervisor" | "unassigned" | "notFound";
  workOrder?: string;
  address?: string;
  city?: string;
  lat?: number;
  lng?: number;
  // Populated on otherSupervisor / unassigned so Lumina can tell Billy
  // who owns the row and offer to look closer.
  smartsheetHit?: {
    rowId: number;
    supervisor: string | null;
    city: string | null;
    jobStatus: string | null;
  };
}

const flyToJobTool: LuminaTool<FlyToJobInput, FlyToJobData> = {
  name: "flyToJob",
  description:
    "Pan/zoom the map to a job and open its JobCard. ALWAYS call this first when Billy mentions a work order \u2014 it handles the full flow: (1) if the job is on Billy's NSC tracker, the map flies there and the card pops; (2) if not, it falls back to a sheet-wide Smartsheet lookup and reports who owns the row (or that it's unrouted, or that it doesn't exist at all). Returns an `outcome` field plus address/city so the caller can immediately mine the inbox for related threads.",
  kind: "navigate",
  async run(input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    if (!input.jobId) return { ok: false, message: "flyToJob requires jobId." };

    // Path A — try NSC tracker first. selectJob is the single source of truth
    // for "where is the user looking" — it drives both the camera and the card.
    try {
      const r = await api.getJob(input.jobId);
      ctx.map.selectJob(r.job.jobId);
      const g = r.job.geocode;
      if (g?.status === "OK") {
        ctx.map.triggerArrivalGlow({ lat: g.lat, lng: g.lng });
        return {
          ok: true,
          message: `Flying to ${r.job.workOrder} in ${r.job.city ?? "unknown city"}.`,
          data: {
            jobId: r.job.jobId,
            outcome: "nsc",
            workOrder: r.job.workOrder,
            address: r.job.address ?? undefined,
            city: r.job.city ?? undefined,
            lat: g.lat,
            lng: g.lng,
          },
        };
      }
      return {
        ok: true,
        message: `Selected ${r.job.workOrder} on the tracker (no geocode on file).`,
        data: {
          jobId: r.job.jobId,
          outcome: "nsc",
          workOrder: r.job.workOrder,
          address: r.job.address ?? undefined,
          city: r.job.city ?? undefined,
        },
      };
    } catch {
      // Fall through to the Smartsheet-wide fallback below.
    }

    // Path B — not on Billy's NSC tracker. Search the entire Smartsheet so
    // we can tell Billy whether it's routed to another supervisor, sitting
    // unassigned, or genuinely doesn't exist.
    try {
      const loc = await api.locateSmartsheetJob(input.jobId);
      if (!loc.found || loc.hits.length === 0) {
        return {
          ok: true, // not an error — it's a valid "not found" result
          message: `Work order ${input.jobId} isn't on the Smartsheet tracker at all.`,
          data: { jobId: input.jobId, outcome: "notFound" },
        };
      }
      const hit = loc.hits[0]; // sorted Billy-first on the server
      const outcome: FlyToJobData["outcome"] = hit.supervisor
        ? "otherSupervisor"
        : "unassigned";
      const supLabel = hit.supervisor ?? "unassigned";
      return {
        ok: true,
        message:
          outcome === "otherSupervisor"
            ? `Work order ${hit.workOrder} is on Smartsheet but routed to ${supLabel}, not Billy.`
            : `Work order ${hit.workOrder} is on Smartsheet but has no supervisor assigned yet.`,
        data: {
          jobId: input.jobId,
          outcome,
          workOrder: hit.workOrder,
          city: hit.city ?? undefined,
          smartsheetHit: {
            rowId: hit.rowId,
            supervisor: hit.supervisor,
            city: hit.city,
            jobStatus: hit.jobStatus,
          },
        },
      };
    } catch (err) {
      return {
        ok: false,
        message: `Couldn't look up ${input.jobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// flyToCoords
// ─────────────────────────────────────────────────────────────────────────────

interface FlyToCoordsInput {
  lat: number;
  lng: number;
  zoom?: number;
}

const flyToCoordsTool: LuminaTool<FlyToCoordsInput, FlyToCoordsInput> = {
  name: "flyToCoords",
  description: "Pan/zoom to a specific lat/lng.",
  kind: "navigate",
  async run(input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    if (typeof input.lat !== "number" || typeof input.lng !== "number") {
      return { ok: false, message: "flyToCoords requires lat and lng." };
    }
    ctx.map.flyTo({ lat: input.lat, lng: input.lng, zoom: input.zoom });
    return { ok: true, message: `Flying to ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}.`, data: input };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// flyToMarkup
// ─────────────────────────────────────────────────────────────────────────────

interface FlyToMarkupInput {
  jobId: string;
  objectId: string;
}

const flyToMarkupTool: LuminaTool<FlyToMarkupInput, { lat: number; lng: number }> = {
  name: "flyToMarkup",
  description: "Zoom to a specific markup object (pole, MH, splice, etc.) on a given job.",
  kind: "navigate",
  async run(input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    if (!input.jobId || !input.objectId)
      return { ok: false, message: "flyToMarkup requires jobId and objectId." };
    const doc = await api.getDrawing(input.jobId, ctx.username || undefined);
    const objects = (doc as { objects?: unknown[] }).objects ?? [];
    type ObjMaybePos = {
      id: string;
      position?: { lat: number; lng: number };
      vertices?: Array<{ lat: number; lng: number }>;
      bounds?: { n: number; s: number; e: number; w: number };
    };
    const obj = (objects as ObjMaybePos[]).find((o) => o?.id === input.objectId);
    if (!obj) return { ok: false, message: `Object ${input.objectId} not found on ${input.jobId}.` };

    let lat: number | null = null;
    let lng: number | null = null;
    if (obj.position) {
      lat = obj.position.lat;
      lng = obj.position.lng;
    } else if (obj.vertices && obj.vertices.length > 0) {
      lat = obj.vertices[0].lat;
      lng = obj.vertices[0].lng;
    } else if (obj.bounds) {
      lat = (obj.bounds.n + obj.bounds.s) / 2;
      lng = (obj.bounds.e + obj.bounds.w) / 2;
    }
    if (lat == null || lng == null)
      return { ok: false, message: "Markup has no position." };
    ctx.map.flyTo({ lat, lng, zoom: 19, label: input.objectId });
    return { ok: true, message: `Zooming to ${input.objectId}.`, data: { lat, lng } };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// setMapType / setZoom
// ─────────────────────────────────────────────────────────────────────────────

const setMapTypeTool: LuminaTool<{ mapType: "roadmap" | "satellite" | "hybrid" | "terrain" }, null> = {
  name: "setMapType",
  description: "Change the map base layer.",
  kind: "navigate",
  async run(input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    ctx.map.setMapType(input.mapType);
    return { ok: true, message: `Map set to ${input.mapType}.` };
  },
};

const setZoomTool: LuminaTool<{ zoom: number }, null> = {
  name: "setZoom",
  description: "Set the map zoom level explicitly.",
  kind: "navigate",
  async run(input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    if (typeof input.zoom !== "number")
      return { ok: false, message: "setZoom requires zoom." };
    ctx.map.zoomTo(input.zoom);
    return { ok: true, message: `Zoom set to ${input.zoom}.` };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// dropPin / clearPins
// ─────────────────────────────────────────────────────────────────────────────

interface DropPinInput {
  address?: string;
  lat?: number;
  lng?: number;
  label?: string;
}

const dropPinTool: LuminaTool<DropPinInput, { pinId: string; lat: number; lng: number }> = {
  name: "dropPin",
  description: "Drop a temporary Lumina-owned marker (separate from job markups).",
  kind: "navigate",
  async run(input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    let lat = input.lat;
    let lng = input.lng;
    if ((lat == null || lng == null) && input.address) {
      const res = await fetch(`/api/lumina/geocode?q=${encodeURIComponent(input.address)}`);
      if (!res.ok) return { ok: false, message: `Geocode failed (${res.status}).` };
      const j = (await res.json()) as { status: string; lat: number; lng: number };
      if (j.status !== "OK") return { ok: false, message: `No result for "${input.address}".` };
      lat = j.lat;
      lng = j.lng;
    }
    if (lat == null || lng == null)
      return { ok: false, message: "dropPin requires address or lat/lng." };
    const pinId = ctx.map.dropPin({ lat, lng, label: input.label });
    return { ok: true, message: `Pin dropped${input.label ? ` (${input.label})` : ""}.`, data: { pinId, lat, lng } };
  },
};

const clearPinsTool: LuminaTool<Record<string, never>, null> = {
  name: "clearPins",
  description: "Remove all Lumina-dropped pins from the map.",
  kind: "navigate",
  async run(_input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    ctx.map.clearPins();
    return { ok: true, message: "Pins cleared." };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// showRoute — overlay a route line between two jobs
// We stub this for now (the route layer lives in features/route-builder).
// Wiring it requires reaching into the route store; deferred to a follow-up.
// ─────────────────────────────────────────────────────────────────────────────

const showRouteTool: LuminaTool<{ fromJobId: string; toJobId: string }, null> = {
  name: "showRoute",
  description: "Draw a route line overlay between two jobs.",
  kind: "navigate",
  async run(_input) {
    return {
      ok: false,
      message:
        "Route overlay isn't wired yet — use the ROUTE tab to build a route manually.",
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// selectJob
// ─────────────────────────────────────────────────────────────────────────────

const selectJobTool: LuminaTool<{ jobId: string }, null> = {
  name: "selectJob",
  description: "Open the job card overlay for a job (same as clicking the job pin).",
  kind: "navigate",
  async run(input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    if (!input.jobId) return { ok: false, message: "selectJob requires jobId." };
    ctx.map.selectJob(input.jobId);
    return { ok: true, message: `Opened ${input.jobId}.` };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// filterJobsOnMap / clearFilters
// ─────────────────────────────────────────────────────────────────────────────

interface FilterInput {
  crew?: string;
  status?: string;
  olderThanDays?: number;
}

const filterJobsOnMapTool: LuminaTool<FilterInput, { description: string }> = {
  name: "filterJobsOnMap",
  description: "Hide/show jobs on the map by crew, status, or age in days.",
  kind: "navigate",
  async run(input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    const { description } = ctx.map.applyFilter(input);
    return { ok: true, message: `Filtered jobs by ${description}.`, data: { description } };
  },
};

const clearFiltersTool: LuminaTool<Record<string, never>, null> = {
  name: "clearFilters",
  description: "Restore the default job view (all jobs visible).",
  kind: "navigate",
  async run(_input, ctx) {
    if (!ctx.map) return { ok: false, message: "Map not ready." };
    ctx.map.resetFilters();
    return { ok: true, message: "Filters cleared." };
  },
};

export const mapNavTools = [
  flyToAddressTool,
  flyToJobTool,
  flyToCoordsTool,
  flyToMarkupTool,
  setMapTypeTool,
  setZoomTool,
  dropPinTool,
  clearPinsTool,
  showRouteTool,
  selectJobTool,
  filterJobsOnMapTool,
  clearFiltersTool,
];
