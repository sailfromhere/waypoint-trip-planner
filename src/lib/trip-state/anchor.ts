// Trip "anchor" — a single representative coordinate for the trip, used to bias
// geocoding/suggestions toward where the itinerary actually is so an ambiguous
// name ("Mammoth", "Cooke City") resolves near the rest of the trip instead of
// in the wrong state/country.
//
// We anchor on the LARGEST CLUSTER of known coords (not the mean/median) — robust
// even when a sizeable minority are wrong AND the wrong ones cluster together
// (e.g. several stale results all landing in Utah). The median broke in exactly
// that case; the plurality-correct cluster wins.

export type Pt = { lat: number; lng: number };

const CLUSTER_DEG = 1.0; // ~70mi: points this close count as the same region

export function largestClusterCentroid(
  pts: Pt[],
  clusterDeg = CLUSTER_DEG
): Pt | undefined {
  if (!pts.length) return undefined;
  let best: Pt[] = [];
  for (const p of pts) {
    const near = pts.filter(
      (q) => Math.hypot(q.lat - p.lat, q.lng - p.lng) <= clusterDeg
    );
    if (near.length > best.length) best = near;
  }
  return {
    lat: best.reduce((s, c) => s + c.lat, 0) / best.length,
    lng: best.reduce((s, c) => s + c.lng, 0) / best.length,
  };
}

// Collect every known endpoint coordinate from a set of itinerary items
// (destination + origin), skipping nulls.
export function itemCoords(
  items: {
    destinationLat: number | null;
    destinationLng: number | null;
    originLat: number | null;
    originLng: number | null;
  }[]
): Pt[] {
  const pts: Pt[] = [];
  for (const it of items) {
    if (it.destinationLat != null && it.destinationLng != null)
      pts.push({ lat: it.destinationLat, lng: it.destinationLng });
    if (it.originLat != null && it.originLng != null)
      pts.push({ lat: it.originLat, lng: it.originLng });
  }
  return pts;
}

export function tripAnchor(
  items: Parameters<typeof itemCoords>[0]
): Pt | undefined {
  return largestClusterCentroid(itemCoords(items));
}
