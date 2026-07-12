/**
 * Ziply plant geometry engine — arterial spine + parcel laterals.
 * Designed against Booker Engineering plan sets (Metron Rd, Lake Stevens, etc.).
 * Never emits hub-spoke starbursts.
 */

export type LatLng = { lat: number; lng: number };

export type PlantTerminal = {
  label: string;
  lat: number;
  lng: number;
  footageFt?: number | null;
  houseNumbers?: string[] | null;
  addressesServed?: string[] | null;
  /** Print topology: left/right of mainline */
  side?: "left" | "right" | null;
  /** Station order along mainline (lower = start of backbone) */
  sequenceOrder?: number | null;
};

export type PlantLateral = {
  label: string;
  path: LatLng[];
  joinIndex: number;
};

export type PlantLayout = {
  backbone: LatLng[];
  laterals: PlantLateral[];
  /** true if axis is primarily north-south */
  northSouth: boolean;
  mainlineStreet: string | null;
};

const M_PER_LAT = 111_320;

function mPerLng(lat: number): number {
  return M_PER_LAT * Math.cos((lat * Math.PI) / 180);
}

export function distM(a: LatLng, b: LatLng): number {
  const mid = (a.lat + b.lat) / 2;
  return Math.hypot((b.lat - a.lat) * M_PER_LAT, (b.lng - a.lng) * mPerLng(mid));
}

export function densify(points: LatLng[], stepsPerSeg = 5): LatLng[] {
  if (points.length < 2) return points.slice();
  const out: LatLng[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (let s = 0; s < stepsPerSeg; s++) {
      const t = s / stepsPerSeg;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

export function cleanPath(points: LatLng[]): LatLng[] {
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

/**
 * Fit a principal axis through hub + terminals (PCA-lite).
 * Booker plans almost always run mainline along one street (N-S or E-W).
 */
export function fitPlantAxis(
  hub: LatLng,
  terminals: PlantTerminal[]
): { northSouth: boolean; bearingDeg: number } {
  if (terminals.length === 0) return { northSouth: true, bearingDeg: 0 };

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const pts = [hub, ...terminals.map((t) => ({ lat: t.lat, lng: t.lng }))];
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.lng;
    my += p.lat;
  }
  mx /= n;
  my /= n;
  for (const p of pts) {
    const x = (p.lng - mx) * mPerLng(my);
    const y = (p.lat - my) * M_PER_LAT;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  // Principal eigenvector of covariance
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const bearingDeg = (angle * 180) / Math.PI;
  // Prefer N-S if variance in lat is larger, or angle near 90°
  const northSouth = syy >= sxx * 0.75 || Math.abs(Math.sin(angle)) > Math.abs(Math.cos(angle));
  return { northSouth, bearingDeg };
}

/**
 * Build arterial backbone + L-shaped laterals to each terminal.
 * This is the geometric heart of the print twin.
 */
export function buildMasterPlantLayout(
  hub: LatLng,
  terminals: PlantTerminal[],
  opts?: { mainlineStreet?: string | null; padMeters?: number }
): PlantLayout {
  const mainlineStreet = opts?.mainlineStreet ?? null;
  const padM = opts?.padMeters ?? 45;
  const { northSouth } = fitPlantAxis(hub, terminals);

  if (terminals.length === 0) {
    // Degenerate: short N-S stub so something draws
    const pad = padM / M_PER_LAT;
    return {
      backbone: densify(
        [
          { lat: hub.lat - pad, lng: hub.lng },
          hub,
          { lat: hub.lat + pad, lng: hub.lng },
        ],
        6
      ),
      laterals: [],
      northSouth: true,
      mainlineStreet,
    };
  }

  // Project onto axis through hub
  const project = (p: LatLng): number =>
    northSouth ? (p.lat - hub.lat) * M_PER_LAT : (p.lng - hub.lng) * mPerLng(hub.lat);

  const unproject = (sMeters: number): LatLng =>
    northSouth
      ? { lat: hub.lat + sMeters / M_PER_LAT, lng: hub.lng }
      : { lat: hub.lat, lng: hub.lng + sMeters / mPerLng(hub.lat) };

  const scalars = terminals.map((t) => project({ lat: t.lat, lng: t.lng }));
  let sMin = Math.min(0, ...scalars) - padM;
  let sMax = Math.max(0, ...scalars) + padM;

  // Ensure minimum backbone length ~80m for readability
  if (sMax - sMin < 80) {
    const mid = (sMin + sMax) / 2;
    sMin = mid - 40;
    sMax = mid + 40;
  }

  const lengthM = sMax - sMin;
  const segs = Math.max(12, Math.min(60, Math.round(lengthM / 12)));
  const backbone: LatLng[] = [];
  for (let i = 0; i <= segs; i++) {
    const s = sMin + (lengthM * i) / segs;
    backbone.push(unproject(s));
  }

  // Soften backbone corners with slight easement offset for multi-fiber look
  // (parallel strand offset by a few meters alternating — visual only for mainline)
  // Sort by print sequence, else by station along axis (sheet topology)
  const ordered = terminals
    .map((t, index) => ({ t, index, s: project({ lat: t.lat, lng: t.lng }) }))
    .sort((a, b) => {
      const sa = a.t.sequenceOrder;
      const sb = b.t.sequenceOrder;
      if (sa != null && sb != null && sa !== sb) return sa - sb;
      return a.s - b.s;
    });

  const laterals: PlantLateral[] = [];
  ordered.forEach(({ t, index }, ord) => {
    const s = project({ lat: t.lat, lng: t.lng });
    const join = unproject(s);
    // Find nearest backbone index for join
    let joinIndex = 0;
    let best = Infinity;
    for (let i = 0; i < backbone.length; i++) {
      const d = distM(backbone[i]!, join);
      if (d < best) {
        best = d;
        joinIndex = i;
      }
    }
    const joinPt = backbone[joinIndex]!;

    // Prefer print side; else geometric cross of axis
    const cross = northSouth
      ? t.lng - hub.lng
      : t.lat - hub.lat;
    const side =
      t.side === "left" ? -1 : t.side === "right" ? 1 : cross >= 0 ? 1 : -1;
    void ord;
    void index;

    // Approach: join → shoulder (ROW) → parcel front → terminal
    const shoulderM = 6 + (index % 3) * 2;
    const frontM = Math.min(
      40,
      Math.max(8, (t.footageFt != null && t.footageFt > 0 ? t.footageFt * 0.12 : 18))
    );

    const shoulder: LatLng = northSouth
      ? {
          lat: joinPt.lat,
          lng: joinPt.lng + (side * shoulderM) / mPerLng(hub.lat),
        }
      : {
          lat: joinPt.lat + (side * shoulderM) / M_PER_LAT,
          lng: joinPt.lng,
        };

    // Intermediate frontage point between shoulder and terminal (L-then-in)
    const term = { lat: t.lat, lng: t.lng };
    const dJoinTerm = distM(joinPt, term);
    let front: LatLng;
    if (dJoinTerm < 25) {
      front = {
        lat: (shoulder.lat + term.lat) / 2,
        lng: (shoulder.lng + term.lng) / 2,
      };
    } else {
      // Move from shoulder toward terminal by frontM meters along the vector
      const dx = term.lng - shoulder.lng;
      const dy = term.lat - shoulder.lat;
      const len = Math.hypot(dx * mPerLng(hub.lat), dy * M_PER_LAT) || 1;
      const scale = frontM / len;
      front = {
        lat: shoulder.lat + dy * scale,
        lng: shoulder.lng + dx * scale,
      };
    }

    const path = densify(cleanPath([joinPt, shoulder, front, term]), 5);
    laterals.push({ label: t.label, path, joinIndex });
  });

  return {
    backbone: densify(cleanPath(backbone), 3),
    laterals,
    northSouth,
    mainlineStreet,
  };
}

/**
 * Merge a road-network polyline with plant backbone preference:
 * if road path is much longer detour, keep synthetic backbone.
 */
export function preferPlantOrRoad(
  plantPath: LatLng[],
  roadPath: LatLng[] | null,
  maxDetourRatio = 1.85
): LatLng[] {
  if (!roadPath || roadPath.length < 3) return plantPath;
  let plantLen = 0;
  for (let i = 1; i < plantPath.length; i++) {
    plantLen += distM(plantPath[i - 1]!, plantPath[i]!);
  }
  let roadLen = 0;
  for (let i = 1; i < roadPath.length; i++) {
    roadLen += distM(roadPath[i - 1]!, roadPath[i]!);
  }
  if (plantLen < 5) return roadPath;
  if (roadLen / plantLen > maxDetourRatio) return plantPath;
  return roadPath;
}

/** Expand house numbers into geocode-ready address strings. */
export function expandHouseAddresses(
  houseNumbers: string[] | null | undefined,
  mainlineStreet: string | null | undefined,
  city: string | null | undefined,
  existing?: string[] | null
): string[] {
  const cityPart = (city ?? "").trim() || "WA";
  const street = (mainlineStreet ?? "").trim();
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (s: string) => {
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(s.trim());
  };

  for (const a of existing ?? []) {
    if (!a?.trim()) continue;
    if (/,/.test(a) || /\bWA\b/i.test(a)) push(a);
    else push(`${a}, ${cityPart}, WA`);
  }

  for (const h of houseNumbers ?? []) {
    const n = String(h).trim();
    if (!n) continue;
    // Already a street address
    if (/\d+\s+[A-Za-z]/.test(n) && /rd|st|ave|dr|ln|way|blvd|ct|pl|metron|circle|cir/i.test(n)) {
      push(`${n}, ${cityPart}, WA`);
      continue;
    }
    // Bare house number
    if (/^\d+[A-Za-z]?$/.test(n) && street) {
      push(`${n} ${street}, ${cityPart}, WA`);
    } else if (/^\d+[A-Za-z]?$/.test(n)) {
      push(`${n}, ${cityPart}, WA`);
    } else {
      push(street ? `${n} ${street}, ${cityPart}, WA` : `${n}, ${cityPart}, WA`);
    }
  }

  return out;
}

/**
 * Known gold-standard plant seeds from SHARED reference prints.
 * Used to boost geocoding when AI omits house numbers but job matches.
 */
export const GOLD_PLANT_SEEDS: Array<{
  match: (ctx: {
    address?: string | null;
    city?: string | null;
    workOrder?: string | null;
    hubId?: string | null;
    notes?: string | null;
  }) => boolean;
  hubAddress: string;
  city: string;
  mainlineStreet: string | null;
  houseNumbers: string[];
  projectLabel: string;
}> = [
  {
    match: (c) => {
      const blob = [c.address, c.city, c.workOrder, c.hubId, c.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (
        blob.includes("metron") ||
        blob.includes("6017044") ||
        blob.includes("s3065") ||
        blob.includes("artnwaxx-6017044") ||
        (blob.includes("arlington") && blob.includes("18154"))
      );
    },
    hubAddress: "18154 Metron Rd, Arlington, WA 98223",
    city: "Arlington",
    mainlineStreet: "Metron Rd",
    // From plan sheets in SHARED ARTNWAXX-6017044
    houseNumbers: [
      "18018",
      "18052",
      "18055",
      "18110",
      "18118",
      "18151",
      "18154",
      "18330",
      "18352",
      "18050",
    ],
    projectLabel: "ARTNWAXX-6017044-S3065 Metron Rd",
  },
  {
    match: (c) => {
      const blob = [c.address, c.city, c.workOrder, c.hubId, c.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (
        blob.includes("6017049") ||
        blob.includes("s3063") ||
        blob.includes("artnwaxx-6017049")
      );
    },
    hubAddress: "Arlington, WA",
    city: "Arlington",
    mainlineStreet: null,
    houseNumbers: [],
    projectLabel: "ARTNWAXX-6017049-S3063",
  },
  {
    match: (c) => {
      const blob = [c.address, c.city, c.workOrder, c.hubId, c.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (
        blob.includes("lake stevens") ||
        blob.includes("h2043") ||
        blob.includes("6007556") ||
        blob.includes("h3024") ||
        blob.includes("6007959") ||
        blob.includes("lkstwaxa")
      );
    },
    hubAddress: "Lake Stevens, WA",
    city: "Lake Stevens",
    mainlineStreet: null,
    houseNumbers: [],
    projectLabel: "LKSTWAXA Lake Stevens",
  },
];
