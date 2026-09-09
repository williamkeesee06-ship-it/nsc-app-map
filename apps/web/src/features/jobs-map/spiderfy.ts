// Spiderfy / radial spread engine for Google Maps markers and hub badges.
// When markers sit at identical or very close coordinates (e.g. within 30 screen px),
// this utility separates them into a clean radial constellation with subtle leader lines.

export interface MarkerPoint {
  id: string;
  position: { lat: number; lng: number };
  isHub?: boolean;
}

export interface SpiderfiedPosition {
  id: string;
  originalPosition: { lat: number; lng: number };
  displayPosition: { lat: number; lng: number };
  isSpiderfied: boolean;
}

const COLLISION_RADIUS_PX = 32; // Pixel threshold for considering two markers overlapping

/**
 * Computes spiderfied screen offsets for a set of marker locations.
 */
export function computeSpiderfiedPositions(
  markers: MarkerPoint[],
  map: google.maps.Map
): SpiderfiedPosition[] {
  const proj = map.getProjection();
  if (!proj) {
    return markers.map((m) => ({
      id: m.id,
      originalPosition: m.position,
      displayPosition: m.position,
      isSpiderfied: false,
    }));
  }

  const zoom = map.getZoom() ?? 14;
  const scale = Math.pow(2, zoom);

  // Project lat/lng to pixel coordinates
  const projected = markers.map((m) => {
    const pt = proj.fromLatLngToPoint(new google.maps.LatLng(m.position.lat, m.position.lng));
    return {
      id: m.id,
      marker: m,
      px: pt ? { x: pt.x * scale, y: pt.y * scale } : { x: 0, y: 0 },
      worldPt: pt,
    };
  });

  // Cluster nearby points using greedy grouping
  const clusters: Array<typeof projected> = [];
  const assigned = new Set<string>();

  for (let i = 0; i < projected.length; i++) {
    const p1 = projected[i]!;
    if (assigned.has(p1.id)) continue;

    const cluster = [p1];
    assigned.add(p1.id);

    for (let j = i + 1; j < projected.length; j++) {
      const p2 = projected[j]!;
      if (assigned.has(p2.id)) continue;

      const dx = p1.px.x - p2.px.x;
      const dy = p1.px.y - p2.px.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < COLLISION_RADIUS_PX) {
        cluster.push(p2);
        assigned.add(p2.id);
      }
    }

    clusters.push(cluster);
  }

  // Calculate fan-out positions for clustered items
  const results: SpiderfiedPosition[] = [];

  for (const cluster of clusters) {
    if (cluster.length === 1) {
      const item = cluster[0]!;
      results.push({
        id: item.id,
        originalPosition: item.marker.position,
        displayPosition: item.marker.position,
        isSpiderfied: false,
      });
      continue;
    }

    // Multiple markers colliding: distribute in a radial circle
    const count = cluster.length;
    // Radius scales with cluster size (min 40px to give plenty of clearance for pills/hubs)
    const radiusPx = Math.max(40, count * 16);

    cluster.forEach((item, index) => {
      // Start from top (-90 deg) and space evenly
      const angle = -Math.PI / 2 + (index / count) * 2 * Math.PI;
      const offsetPxX = Math.cos(angle) * radiusPx;
      const offsetPxY = Math.sin(angle) * radiusPx;

      if (!item.worldPt) {
        results.push({
          id: item.id,
          originalPosition: item.marker.position,
          displayPosition: item.marker.position,
          isSpiderfied: false,
        });
        return;
      }

      const newWorldPt = new google.maps.Point(
        item.worldPt.x + offsetPxX / scale,
        item.worldPt.y + offsetPxY / scale
      );
      const newLatLng = proj.fromPointToLatLng(newWorldPt);

      results.push({
        id: item.id,
        originalPosition: item.marker.position,
        displayPosition: newLatLng
          ? { lat: newLatLng.lat(), lng: newLatLng.lng() }
          : item.marker.position,
        isSpiderfied: true,
      });
    });
  }

  return results;
}
