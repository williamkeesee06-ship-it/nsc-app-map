// Phase 8: Native billing wrapper.
// Translates DrawingObjects from the Phase-3 schema into resolved units
// using the ported units.js dictionary (resolveSmartUnit / resolveUnit).
//
// NOTE: the Phase-3 DrawingObject schema only carries minimum attributes
// (tool name + position/vertices + style). The full attribute panels from
// the original tool (height, A-tag, hand-set, etc.) are not yet collected
// in the native UI. We map what we can:
//   - cable lines  → STRAND_10M (qty = footage in FT)
//   - point tools  → POLE/MH/HH/PEDESTAL/ANCHOR with Status NEW or REMOVE
// Where attributes are missing we surface that via TODO(merge-conflict)
// comments. Contract rules preserved:
//   - A-tag auto-prefix lives in units.js mapping
//   - SELECT BACKFILL 0.5 CY decimals preserved (no Math.round)
//   - Splice pits always NEW (units.js handles)
//   - No COAX anywhere
import { resolveUnit, type ResolvedUnit } from "./units.js";
import type { DrawingObject } from "@nsc/types";

const FEET_PER_METER = 3.28084;

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function polylineLengthFt(vertices: Array<{ lat: number; lng: number }>): number {
  if (vertices.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!;
    const b = vertices[i]!;
    d += haversineMeters(a.lat, a.lng, b.lat, b.lng);
  }
  return d * FEET_PER_METER;
}

export interface BillingEntry {
  unit_code: string;
  desc: string;
  unit: string;       // "EA" | "FT" | "HRS" | "CY"
  qty: number;
  source: "primary" | "extra";
}

/** Resolve a DrawingObject to one or more billing entries. */
export function resolveObjectUnits(obj: DrawingObject): BillingEntry[] {
  const entries: BillingEntry[] = [];

  // ── Lines: cable footage ────────────────────────────────────────────
  if (obj.tool === "placed_cable" && "vertices" in obj) {
    const ft = polylineLengthFt(obj.vertices);
    if (ft <= 0) return entries;
    // TODO(merge-conflict): the native schema does not yet capture cable
    // family (FIBER/COPPER/ASW/BSW) per line — defaulting to STRAND_10M
    // which is the contract's 10M strand item.
    const u = resolveUnit("STRAND_10M", { Status: "NEW" });
    pushResolved(entries, u, ft);
    return entries;
  }
  if (obj.tool === "removed_cable" && "vertices" in obj) {
    const ft = polylineLengthFt(obj.vertices);
    if (ft <= 0) return entries;
    // TODO(merge-conflict): which removal subtype (RMV_AER_FIBER, etc.)
    // requires aerial/underground + family attrs not yet in native schema.
    const u = resolveUnit("STRAND_10M", { Status: "REMOVE" });
    pushResolved(entries, u, ft);
    return entries;
  }

  // ── Points: POLE / MH / HH / PED / CABINET / ANCHOR ─────────────────
  const t = obj.tool;
  const isNew = t.endsWith("_new");
  const isRemove = t.endsWith("_removed");
  if (!isNew && !isRemove) return entries;

  const status = isNew ? "NEW" : "REMOVE";

  let symbolKey: string | null = null;
  if (t.startsWith("pole")) symbolKey = "POLE";
  else if (t.startsWith("mh")) symbolKey = "MH";
  else if (t.startsWith("hh")) symbolKey = "HH";
  else if (t.startsWith("ped")) symbolKey = "PEDESTAL";
  else if (t.startsWith("anchor")) symbolKey = "ANCHOR";
  else if (t.startsWith("cabinet")) {
    // Cabinets are not a Lumen unit code by themselves — treat as no-op
    // (canvas label only).
    return entries;
  }
  if (!symbolKey) return entries;

  // Pole: only NEW yields strong billing (height/class needed for material
  // code). For NEW poles without height we still bill the labor "POLE WOOD
  // <= 40ft" + material "POLE 35-5 DF" defaults from the units mapping.
  const attrs: Record<string, unknown> = { Status: status };
  if (symbolKey === "POLE" && isNew) {
    // TODO(merge-conflict): native UI does not yet collect Height / Class /
    // HandSet for new poles — units.js falls back to 35'/Class 5/non-hand-set.
  }
  if (symbolKey === "POLE" && isRemove) {
    // TODO(merge-conflict): native UI doesn't capture Owner (CTL vs Foreign)
    // for pole removals — units.js defaults to "CTL Owned".
  }

  const resolved = resolveUnit(symbolKey, attrs);
  pushResolved(entries, resolved, 1);
  return entries;
}

function pushResolved(out: BillingEntry[], r: ResolvedUnit | null, qty: number): void {
  if (!r) return;
  if (r.unit_code) {
    out.push({
      unit_code: r.unit_code,
      desc: r.desc,
      unit: r.unit,
      qty: r.unit === "FT" ? qty : (r.qty ?? 1) * (qty || 1),
      source: "primary",
    });
  }
  for (const e of r.extraUnits ?? []) {
    out.push({
      unit_code: e.unit_code,
      desc: e.desc,
      unit: e.unit,
      qty: e.qty,
      source: "extra",
    });
  }
}

/** Aggregate billing entries by unit_code, summing qty. */
export function aggregateUnits(objects: DrawingObject[]): BillingEntry[] {
  const map = new Map<string, BillingEntry>();
  for (const obj of objects) {
    if (obj.style.hidden) continue;
    const entries = resolveObjectUnits(obj);
    for (const e of entries) {
      const key = `${e.unit_code}::${e.unit}`;
      const cur = map.get(key);
      if (cur) {
        cur.qty += e.qty;
      } else {
        map.set(key, { ...e });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.unit_code.localeCompare(b.unit_code));
}
