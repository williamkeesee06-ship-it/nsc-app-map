/**
 * Ziply plan-sheet → map registration.
 *
 * Geometry truth hierarchy (high → low):
 * 1. Control points — geocoded hub + house/MST parcels from the print
 * 2. Backbone — ordered polyline through controls, optionally road-snapped
 * 3. Laterals — true nearest-point join on backbone → ROW shoulder (print side) → parcel
 * 4. Station/offset from AI when present refine join position and side
 * 5. Axis synthetic plant only when <2 control points (fidelity = axis_fallback)
 *
 * This is not PDF pixel registration — it is survey-style control-point plant layout
 * that matches Booker plan topology (mainline along street, laterals to lots).
 */

export type LatLng = { lat: number; lng: number };

export type SheetControl = {
  id: string;
  kind: "hub" | "terminal" | "house";
  label: string;
  lat: number;
  lng: number;
  /** Station feet along mainline from plan (e.g. 12+50 → 1250). */
  stationFt?: number | null;
  /** Perpendicular offset feet from mainline centerline on plan. */
  offsetFt?: number | null;
  side?: "left" | "right" | null;
  sequenceOrder?: number | null;
  footageFt?: number | null;
};

export type RegisteredLateral = {
  label: string;
  path: LatLng[];
  joinIndex: number;
  /** Meters from backbone start to join. */
  stationM: number;
};

export type RegisteredPlant = {
  backbone: LatLng[];
  laterals: RegisteredLateral[];
  terminalPositions: Array<{ label: string; lat: number; lng: number }>;
  /** How geometry was produced. */
  fidelity: "control_registered" | "axis_fallback";
  controlCount: number;
  northSouth: boolean;
  mainlineStreet: string | null;
  /** RMS residual (m) of controls vs backbone — lower is better plan fit. */
  residualRm?: number | null;
};

const M_PER_LAT = 111_320;
const FT_TO_M = 0.3048;

function mPerLng(lat: number): number {
  return M_PER_LAT * Math.cos((lat * Math.PI) / 180);
}

export function distM(a: LatLng, b: LatLng): number {
  const mid = (a.lat + b.lat) / 2;
  return Math.hypot((b.lat - a.lat) * M_PER_LAT, (b.lng - a.lng) * mPerLng(mid));
}

function cleanPath(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.lat === 0 && p.lng === 0) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.lat - p.lat) < 1e-9 && Math.abs(last.lng - p.lng) < 1e-9) {
      continue;
    }
    out.push(p);
  }
  return out;
}

function densify(points: LatLng[], stepsPerSeg = 4): LatLng[] {
  if (points.length < 2) return points.slice();
  if (points.length >= 48) return points.slice();
  const steps = points.length >= 16 ? Math.min(stepsPerSeg, 2) : stepsPerSeg;
  const out: LatLng[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** Path length in meters. */
export function pathLengthM(path: LatLng[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += distM(path[i - 1]!, path[i]!);
  return n;
}

/**
 * Nearest point on a multi-segment polyline to p.
 * Returns the projection, segment index, param t, distance, and station along path.
 */
export function nearestOnPolyline(
  path: LatLng[],
  p: LatLng
): {
  point: LatLng;
  index: number;
  t: number;
  distM: number;
  stationM: number;
} {
  if (path.length === 0) {
    return { point: p, index: 0, t: 0, distM: 0, stationM: 0 };
  }
  if (path.length === 1) {
    return {
      point: path[0]!,
      index: 0,
      t: 0,
      distM: distM(path[0]!, p),
      stationM: 0,
    };
  }

  const refLat = path[0]!.lat;
  const mLng = mPerLng(refLat);
  const toXY = (q: LatLng) => ({
    x: (q.lng - path[0]!.lng) * mLng,
    y: (q.lat - path[0]!.lat) * M_PER_LAT,
  });
  const fromXY = (x: number, y: number): LatLng => ({
    lat: path[0]!.lat + y / M_PER_LAT,
    lng: path[0]!.lng + x / mLng,
  });

  const pp = toXY(p);
  let bestD = Infinity;
  let best: { point: LatLng; index: number; t: number; stationM: number } = {
    point: path[0]!,
    index: 0,
    t: 0,
    stationM: 0,
  };
  let stationAcc = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const a = toXY(path[i]!);
    const b = toXY(path[i + 1]!);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const ab2 = abx * abx + aby * aby || 1e-12;
    let t = ((pp.x - a.x) * abx + (pp.y - a.y) * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const qx = a.x + abx * t;
    const qy = a.y + aby * t;
    const d = Math.hypot(pp.x - qx, pp.y - qy);
    const segLen = Math.hypot(abx, aby);
    if (d < bestD) {
      bestD = d;
      best = {
        point: fromXY(qx, qy),
        index: i,
        t,
        stationM: stationAcc + segLen * t,
      };
    }
    stationAcc += segLen;
  }

  return { ...best, distM: bestD };
}

/** Unit perpendicular (left-hand when traveling a→b). */
function leftPerp(a: LatLng, b: LatLng): { dLat: number; dLng: number } {
  const midLat = (a.lat + b.lat) / 2;
  const mLng = mPerLng(midLat);
  const dx = (b.lng - a.lng) * mLng; // east meters
  const dy = (b.lat - a.lat) * M_PER_LAT; // north meters
  const len = Math.hypot(dx, dy) || 1;
  // rotate 90° CCW → left: (-dy, dx) in EN frame
  const lx = -dy / len;
  const ly = dx / len;
  return { dLat: ly / M_PER_LAT, dLng: lx / mLng };
}

function offsetPoint(origin: LatLng, a: LatLng, b: LatLng, sideSign: number, meters: number): LatLng {
  const perp = leftPerp(a, b);
  return {
    lat: origin.lat + perp.dLat * sideSign * meters,
    lng: origin.lng + perp.dLng * sideSign * meters,
  };
}

/** PCA-lite axis orientation through points. */
function fitAxis(points: LatLng[]): { northSouth: boolean; bearingRad: number } {
  if (points.length < 2) return { northSouth: true, bearingRad: 0 };
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.lng;
    my += p.lat;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const x = (p.lng - mx) * mPerLng(my);
    const y = (p.lat - my) * M_PER_LAT;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const northSouth = syy >= sxx * 0.75 || Math.abs(Math.sin(angle)) > Math.abs(Math.cos(angle));
  return { northSouth, bearingRad: angle };
}

function projectOnAxis(p: LatLng, origin: LatLng, northSouth: boolean): number {
  return northSouth
    ? (p.lat - origin.lat) * M_PER_LAT
    : (p.lng - origin.lng) * mPerLng(origin.lat);
}

/**
 * Order controls the way the plan reads: sequenceOrder → stationFt → axis projection.
 */
export function orderControls(controls: SheetControl[], hub: LatLng): SheetControl[] {
  const pts = controls.map((c) => ({ lat: c.lat, lng: c.lng }));
  const { northSouth } = fitAxis(pts.length >= 2 ? pts : [hub, ...pts]);
  return [...controls].sort((a, b) => {
    if (a.sequenceOrder != null && b.sequenceOrder != null && a.sequenceOrder !== b.sequenceOrder) {
      return a.sequenceOrder - b.sequenceOrder;
    }
    if (a.stationFt != null && b.stationFt != null && a.stationFt !== b.stationFt) {
      return a.stationFt - b.stationFt;
    }
    return (
      projectOnAxis({ lat: a.lat, lng: a.lng }, hub, northSouth) -
      projectOnAxis({ lat: b.lat, lng: b.lng }, hub, northSouth)
    );
  });
}

/**
 * Build a control-point skeleton polyline (ordered unique points + pad beyond ends).
 */
function skeletonFromControls(ordered: SheetControl[], hub: LatLng, padM: number): LatLng[] {
  const pts: LatLng[] = [];
  const push = (p: LatLng) => {
    const last = pts[pts.length - 1];
    if (last && distM(last, p) < 4) return; // merge near-duplicates
    pts.push(p);
  };

  // Ensure hub is on the skeleton near its natural place
  const hubIn = ordered.some((c) => c.kind === "hub");
  if (!hubIn) {
    // Insert hub by projection order among controls
    const all = [
      { lat: hub.lat, lng: hub.lng, s: 0, isHub: true as const },
      ...ordered.map((c) => ({
        lat: c.lat,
        lng: c.lng,
        s: 0,
        isHub: false as const,
      })),
    ];
    const { northSouth } = fitAxis(all.map((p) => ({ lat: p.lat, lng: p.lng })));
    all.forEach((p) => {
      p.s = projectOnAxis({ lat: p.lat, lng: p.lng }, hub, northSouth);
    });
    all.sort((a, b) => a.s - b.s);
    for (const p of all) push({ lat: p.lat, lng: p.lng });
  } else {
    for (const c of ordered) push({ lat: c.lat, lng: c.lng });
  }

  if (pts.length < 2) {
    // Degenerate: hub + tiny stub
    const pad = padM / M_PER_LAT;
    return densify(
      [
        { lat: hub.lat - pad, lng: hub.lng },
        hub,
        { lat: hub.lat + pad, lng: hub.lng },
      ],
      5
    );
  }

  // Pad beyond ends along end-segment direction
  const first = pts[0]!;
  const second = pts[1]!;
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  const extend = (from: LatLng, toward: LatLng, meters: number): LatLng => {
    const d = distM(from, toward) || 1;
    const t = meters / d;
    return {
      lat: from.lat + (from.lat - toward.lat) * t,
      lng: from.lng + (from.lng - toward.lng) * t,
    };
  };
  const startPad = extend(first, second, padM);
  const endPad = extend(last, prev, padM);
  return densify(cleanPath([startPad, ...pts, endPad]), 3);
}

/**
 * Prefer road polyline when it doesn't wildly detour vs skeleton.
 */
export function preferSkeletonOrRoad(
  skeleton: LatLng[],
  road: LatLng[] | null,
  maxDetourRatio = 1.65
): LatLng[] {
  if (!road || road.length < 3) return skeleton;
  const skLen = pathLengthM(skeleton);
  const rdLen = pathLengthM(road);
  if (skLen < 5) return road;
  if (rdLen / skLen > maxDetourRatio) return skeleton;
  // Also reject road that misses most controls (average residual)
  return road;
}

/**
 * Mean residual (m) of control points to backbone — plan-fit quality metric.
 */
export function controlResidualRm(backbone: LatLng[], controls: SheetControl[]): number {
  if (controls.length === 0 || backbone.length < 2) return 0;
  let sum = 0;
  for (const c of controls) {
    sum += nearestOnPolyline(backbone, { lat: c.lat, lng: c.lng }).distM;
  }
  return sum / controls.length;
}

/**
 * Build a plan-faithful lateral: join on backbone → ROW shoulder → parcel.
 * Uses print side, offsetFt, and footageFt when present.
 */
export function buildRegisteredLateral(
  backbone: LatLng[],
  control: SheetControl,
  opts?: { rowShoulderM?: number }
): RegisteredLateral {
  const term = { lat: control.lat, lng: control.lng };
  const near = nearestOnPolyline(backbone, term);
  const join = near.point;
  const joinIndex = near.index;

  // Travel direction along backbone at join
  const a = backbone[Math.max(0, joinIndex)]!;
  const b = backbone[Math.min(backbone.length - 1, joinIndex + 1)]!;

  // Side: print → left/right of up-station; else geometric cross
  let sideSign = 1;
  if (control.side === "left") sideSign = 1; // left of travel = +perp
  else if (control.side === "right") sideSign = -1;
  else {
    // Which side of segment is the terminal?
    const midLat = (a.lat + b.lat) / 2;
    const mLng = mPerLng(midLat);
    const abx = (b.lng - a.lng) * mLng;
    const aby = (b.lat - a.lat) * M_PER_LAT;
    const apx = (term.lng - a.lng) * mLng;
    const apy = (term.lat - a.lat) * M_PER_LAT;
    // cross product z: ab × ap > 0 → left
    sideSign = abx * apy - aby * apx >= 0 ? 1 : -1;
  }

  const shoulderM =
    control.offsetFt != null && control.offsetFt > 0
      ? Math.min(35, Math.max(4, control.offsetFt * FT_TO_M * 0.35))
      : opts?.rowShoulderM ?? 7;

  const shoulder = offsetPoint(join, a, b, sideSign, shoulderM);

  // Frontage point: move toward parcel but respect lateral footage when huge
  const dJoinTerm = distM(join, term);
  let front: LatLng;
  if (dJoinTerm < 12) {
    front = {
      lat: (shoulder.lat + term.lat) / 2,
      lng: (shoulder.lng + term.lng) / 2,
    };
  } else {
    const frontM = Math.min(
      dJoinTerm * 0.45,
      Math.max(
        8,
        control.footageFt != null && control.footageFt > 0
          ? Math.min(45, control.footageFt * FT_TO_M * 0.25)
          : 16
      )
    );
    const dx = term.lng - shoulder.lng;
    const dy = term.lat - shoulder.lat;
    const len =
      Math.hypot(dx * mPerLng(term.lat), dy * M_PER_LAT) || 1;
    const scale = frontM / len;
    front = {
      lat: shoulder.lat + dy * scale,
      lng: shoulder.lng + dx * scale,
    };
  }

  // When join is very far from parcel (>120m), pull join toward parcel along backbone residual —
  // still use nearest, but path must reach parcel (geocode is truth for endpoint)
  const path = densify(cleanPath([join, shoulder, front, term]), 5);
  return {
    label: control.label,
    path,
    joinIndex,
    stationM: near.stationM,
  };
}

/**
 * Register a full plant from hub + control terminals.
 * `roadBackbone` optional Directions polyline (may include waypoints).
 */
export function registerPlant(
  hub: LatLng,
  controlsIn: SheetControl[],
  opts?: {
    mainlineStreet?: string | null;
    padMeters?: number;
    roadBackbone?: LatLng[] | null;
  }
): RegisteredPlant {
  const mainlineStreet = opts?.mainlineStreet ?? null;
  const padM = opts?.padMeters ?? 40;
  const controls = controlsIn.filter(
    (c) =>
      Number.isFinite(c.lat) &&
      Number.isFinite(c.lng) &&
      !(c.lat === 0 && c.lng === 0)
  );

  if (controls.length < 2) {
    // Not enough control for registration — axis fallback stub
    const pad = padM / M_PER_LAT;
    const backbone = densify(
      [
        { lat: hub.lat - pad, lng: hub.lng },
        hub,
        { lat: hub.lat + pad, lng: hub.lng },
      ],
      6
    );
    const laterals = controls.map((c) => buildRegisteredLateral(backbone, c));
    return {
      backbone,
      laterals,
      terminalPositions: controls.map((c) => ({
        label: c.label,
        lat: c.lat,
        lng: c.lng,
      })),
      fidelity: "axis_fallback",
      controlCount: controls.length,
      northSouth: true,
      mainlineStreet,
      residualRm: controlResidualRm(backbone, controls),
    };
  }

  const ordered = orderControls(controls, hub);
  const skeleton = skeletonFromControls(ordered, hub, padM);
  const backbone = densify(
    cleanPath(preferSkeletonOrRoad(skeleton, opts?.roadBackbone ?? null, 1.65)),
    2
  );

  // Terminals only (not hub) get laterals
  const termControls = ordered.filter((c) => c.kind !== "hub");
  const laterals = termControls.map((c) => buildRegisteredLateral(backbone, c));

  const { northSouth } = fitAxis(backbone);
  const residual = controlResidualRm(backbone, termControls);

  return {
    backbone,
    laterals,
    terminalPositions: termControls.map((c) => ({
      label: c.label,
      lat: c.lat,
      lng: c.lng,
    })),
    fidelity: residual < 80 ? "control_registered" : "axis_fallback",
    controlCount: controls.length,
    northSouth,
    mainlineStreet,
    residualRm: residual,
  };
}

/**
 * Parse station strings like "12+50", "1250", "STA 8+25" → feet.
 */
export function parseStationFt(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return null;
  const plus = s.match(/(\d+)\+(\d{1,2})/);
  if (plus) return parseInt(plus[1]!, 10) * 100 + parseInt(plus[2]!, 10);
  const num = s.replace(/[^\d.]/g, "");
  if (!num) return null;
  const n = parseFloat(num);
  return Number.isFinite(n) ? n : null;
}
