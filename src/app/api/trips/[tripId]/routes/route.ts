import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itineraryItems } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { routing } from "@/lib/integrations";
import type { LatLng } from "@/lib/integrations";

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

  const byDay = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.date || item.destinationLat == null || item.destinationLng == null) continue;
    const day = item.date;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(item);
  }

  const dayRoutes: DayRoute[] = [];

  for (const [date, dayItems] of byDay) {
    if (dayItems.length < 2) {
      dayRoutes.push({ date, legs: [], totalDistanceMeters: 0, totalDurationSeconds: 0 });
      continue;
    }

    const legs: DayRoute["legs"] = [];
    let totalDist = 0;
    let totalDur = 0;

    for (let i = 0; i < dayItems.length - 1; i++) {
      const from: LatLng = { lat: dayItems[i].destinationLat!, lng: dayItems[i].destinationLng! };
      const to: LatLng = { lat: dayItems[i + 1].destinationLat!, lng: dayItems[i + 1].destinationLng! };

      try {
        const result = await routing.getRoute([from, to]);
        const leg = result.legs[0];
        legs.push({
          fromItemId: dayItems[i].id,
          toItemId: dayItems[i + 1].id,
          distanceMeters: leg?.distanceMeters ?? 0,
          durationSeconds: leg?.durationSeconds ?? 0,
          geometry: leg?.geometry,
        });
        totalDist += leg?.distanceMeters ?? 0;
        totalDur += leg?.durationSeconds ?? 0;
      } catch {
        legs.push({
          fromItemId: dayItems[i].id,
          toItemId: dayItems[i + 1].id,
          distanceMeters: 0,
          durationSeconds: 0,
        });
      }
    }

    dayRoutes.push({ date, legs, totalDistanceMeters: totalDist, totalDurationSeconds: totalDur });
  }

  // Route each drive along its OWN origin → destination (this is what the map
  // draws as the drive line — previously drives were never actually routed).
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

    try {
      const result = await routing.getRoute([
        { lat: item.originLat, lng: item.originLng },
        { lat: item.destinationLat, lng: item.destinationLng },
      ]);
      drives.push({
        itemId: item.id,
        date: item.date,
        distanceMeters: result.totalDistanceMeters,
        durationSeconds: result.totalDurationSeconds,
        geometry: result.legs[0]?.geometry,
      });
    } catch {
      drives.push({
        itemId: item.id,
        date: item.date,
        distanceMeters: 0,
        durationSeconds: 0,
      });
    }
  }

  const response: RoutesResponse = { days: dayRoutes, drives };
  return NextResponse.json(response);
}
