import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itineraryItems } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { routing } from "@/lib/integrations";

export interface DayRoute {
  date: string;
  legs: {
    fromItemId: string;
    toItemId: string;
    distanceMeters: number;
    durationSeconds: number;
    geometry?: GeoJSON.LineString;
  }[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
}

// Fingerprint of the endpoint coords a drive's cached geometry was computed
// from. A mismatch (an endpoint moved) is what triggers a recompute.
function routeSignature(
  oLat: number,
  oLng: number,
  dLat: number,
  dLng: number
): string {
  const r = (n: number) => n.toFixed(5);
  return `o:${r(oLat)},${r(oLng)}|d:${r(dLat)},${r(dLng)}`;
}

// A drive item routed along its own origin → destination (the real road path).
export interface DriveRoute {
  itemId: string;
  date: string | null;
  distanceMeters: number;
  durationSeconds: number;
  geometry?: GeoJSON.LineString;
}

export interface RoutesResponse {
  days: DayRoute[];
  drives: DriveRoute[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;

  const items = await db
    .select()
    .from(itineraryItems)
    .where(eq(itineraryItems.tripId, tripId))
    .orderBy(asc(itineraryItems.date), asc(itineraryItems.sortOrder));

  // Route each drive along its OWN origin → destination, CACHE-BACKED: the
  // routed geometry/distance/duration are persisted on the item keyed by an
  // endpoint signature. If the signature still matches the current endpoints we
  // serve the stored result (no OSRM) so the map draws drives instantly on
  // refresh — like marker coords. Only a moved endpoint (signature mismatch)
  // triggers a recompute, which writes the fresh result back.
  const drives: DriveRoute[] = [];
  for (const item of items) {
    if (item.category !== "drive") continue;
    if (
      item.originLat == null ||
      item.originLng == null ||
      item.destinationLat == null ||
      item.destinationLng == null
    )
      continue;

    const sig = routeSignature(
      item.originLat,
      item.originLng,
      item.destinationLat,
      item.destinationLng
    );

    // Cache hit — endpoints unchanged since we last routed them.
    if (item.routeSignature === sig) {
      drives.push({
        itemId: item.id,
        date: item.date,
        distanceMeters: item.routeDistanceMeters ?? 0,
        durationSeconds: item.routeDurationSeconds ?? 0,
        geometry: item.routeGeometry ?? undefined,
      });
      continue;
    }

    // Stale/never-computed — route via OSRM and persist for next time.
    try {
      const result = await routing.getRoute([
        { lat: item.originLat, lng: item.originLng },
        { lat: item.destinationLat, lng: item.destinationLng },
      ]);
      const geometry = result.legs[0]?.geometry;
      const distanceMeters = result.totalDistanceMeters;
      const durationSeconds = result.totalDurationSeconds;
      await db
        .update(itineraryItems)
        .set({
          routeGeometry: geometry ?? null,
          routeDistanceMeters: distanceMeters,
          routeDurationSeconds: durationSeconds,
          routeSignature: sig,
          updatedAt: new Date(),
        })
        .where(eq(itineraryItems.id, item.id));
      drives.push({ itemId: item.id, date: item.date, distanceMeters, durationSeconds, geometry });
    } catch {
      // Transient failure — don't persist the signature, so we retry next load.
      drives.push({ itemId: item.id, date: item.date, distanceMeters: 0, durationSeconds: 0 });
    }
  }

  // Per-day driving totals — summed from the (now persisted) drive-item routed
  // durations. This is still API-derived time (the geography keystone: drive
  // times never invented), just read from cache. `legs` is empty: the map draws
  // day connectors client-side as straight lines between consecutive stops, so
  // we no longer pay an OSRM call per leg on every load.
  const dayTotals = new Map<string, { dist: number; dur: number }>();
  for (const d of drives) {
    if (!d.date) continue;
    const t = dayTotals.get(d.date) ?? { dist: 0, dur: 0 };
    t.dist += d.distanceMeters;
    t.dur += d.durationSeconds;
    dayTotals.set(d.date, t);
  }
  const days: DayRoute[] = [...dayTotals].map(([date, t]) => ({
    date,
    legs: [],
    totalDistanceMeters: t.dist,
    totalDurationSeconds: t.dur,
  }));

  const response: RoutesResponse = { days, drives };
  return NextResponse.json(response);
}
