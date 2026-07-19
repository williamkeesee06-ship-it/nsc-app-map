// @ts-nocheck

// Helper: Haversine distance in feet
function getDistanceInFeet(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 20902231; // Radius of the Earth in feet
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate bounding box or midpoint of a line
function getLineMidpoint(path: { lat: number; lng: number }[]) {
  if (!path || path.length === 0) return { lat: 0, lng: 0 };
  if (path.length === 1) return path[0];
  
  // simple average of points
  let sumLat = 0;
  let sumLng = 0;
  path.forEach((p) => {
    sumLat += p.lat;
    sumLng += p.lng;
  });
  return { lat: sumLat / path.length, lng: sumLng / path.length };
}

export function findMatchingTerminal(
  drawnPoint: { lat: number; lng: number },
  mapObjects: any,
  typedLabel?: string
): any | null {
  if (!mapObjects || !mapObjects.terminals) return null;

  // 1. Match by label name first (case-insensitive) if provided
  if (typedLabel) {
    const cleanTyped = typedLabel.trim().toUpperCase();
    const nameMatch = mapObjects.terminals.find(
      (t: any) =>
        (t.label || "").trim().toUpperCase() === cleanTyped ||
        (t.name || "").trim().toUpperCase() === cleanTyped
    );
    if (nameMatch) return nameMatch;
  }

  // 2. Fallback to spatial distance within 150ft
  let closest: any | null = null;
  let minDistance = 150; // max search radius 150ft

  mapObjects.terminals.forEach((t: any) => {
    if (!t.geocode) return;
    const dist = getDistanceInFeet(drawnPoint.lat, drawnPoint.lng, t.geocode.lat, t.geocode.lng);
    if (dist < minDistance) {
      minDistance = dist;
      closest = t;
    }
  });

  return closest;
}

export function findMatchingCable(
  drawnPath: { lat: number; lng: number }[],
  mapObjects: any
): any | null {
  if (!mapObjects || !mapObjects.cables || drawnPath.length < 2) return null;

  const drawnMidpoint = getLineMidpoint(drawnPath);
  
  let closest: ZiplyCableData | null = null;
  let minDistance = 300; // max search radius for midpoint in feet

  mapObjects.cables.forEach((c) => {
    if (!c.geometry || c.geometry.length < 2) return;
    const cMidpoint = getLineMidpoint(c.geometry);
    const dist = getDistanceInFeet(drawnMidpoint.lat, drawnMidpoint.lng, cMidpoint.lat, cMidpoint.lng);
    
    if (dist < minDistance) {
      minDistance = dist;
      closest = c;
    }
  });

  return closest;
}
