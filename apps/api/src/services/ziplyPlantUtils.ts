import { Job } from "@nsc/types";
type LatLng = { lat: number; lng: number };

const M_PER_LAT = 111320;
function mPerLng(lat: number) {
  return 40075000 * Math.cos((lat * Math.PI) / 180) / 360;
}

export function distM(a: LatLng, b: LatLng): number {
  const mid = (a.lat + b.lat) / 2;
  return Math.hypot((b.lat - a.lat) * M_PER_LAT, (b.lng - a.lng) * mPerLng(mid));
}

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
      const all = Object.values(c).join(" ").toLowerCase();
      return all.includes("109th") || all.includes("24th") || all.includes("lake stevens");
    },
    hubAddress: "2303 109th Ave SE",
    city: "Lake Stevens",
    mainlineStreet: "109th Ave SE",
    houseNumbers: ["2303", "2305", "2311", "2317", "2319", "2323", "2325", "2329"],
    projectLabel: "LAKE STEVENS SOUTH HUB",
  },
];

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
    } else if (n.includes("-")) {
      const parts = n.split("-");
      if (parts.length === 2) {
        const p1 = parseInt(parts[0]!, 10);
        const p2 = parseInt(parts[1]!, 10);
        if (!isNaN(p1) && !isNaN(p2) && p2 > p1 && p2 - p1 <= 20) {
          for (let i = p1; i <= p2; i++) {
            if (street) push(`${i} ${street}, ${cityPart}, WA`);
            else push(`${i}, ${cityPart}, WA`);
          }
          continue;
        }
      }
      push(`${n}, ${cityPart}, WA`);
    } else {
      push(`${n}, ${cityPart}, WA`);
    }
  }

  return out;
}