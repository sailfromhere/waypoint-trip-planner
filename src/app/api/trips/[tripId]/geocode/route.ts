import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itineraryItems } from "@/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { geocoding } from "@/lib/integrations";
import type { FieldProvenance } from "@/db/types";
import { largestClusterCentroid, type Pt } from "@/lib/trip-state/anchor";

interface GeocodedResult {
  id: string;
  destinationLat?: number;
  destinationLng?: number;
  originLat?: number;
  originLng?: number;
}

// Legacy support: drives that still encode both ends in destinationName ("A → B").
// New drives store originName/destinationName as separate fields.
function splitDriveEndpoints(name: string): { origin: string; destination: string } | null {
  for (const sep of [" → ", " -> ", " to ", " – "]) {
    const idx = name.toLowerCase().indexOf(sep.toLowerCase());
    if (idx > 0) {
      const origin = name.slice(0, idx).trim();
      const destination = name.slice(idx + sep.length).trim();
      if (origin && destination) return { origin, destination };
    }
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;
  const body = await req.json().catch(() => ({}));
  const itemIds: string[] | undefined = body.itemIds;
  // force=true re-geocodes even items that already have coords (used to fix
  // stale mock coordinates after switching to a real provider). user_provided
  // coords are still never touched — sacred-human-data invariant.
  const force: boolean = body.force === true;

  const allItems = await db
    .select()
    .from(itineraryItems)
    .where(
      and(eq(itineraryItems.tripId, tripId), isNotNull(itineraryItems.destinationName))
    );

  const filtered = itemIds ? allItems.filter((item) => itemIds.includes(item.id)) : allItems;
  const results: GeocodedResult[] = [];

  // Proximity bias: nudge ambiguous names toward where the trip actually is.
  // Anchor on the LARGEST CLUSTER of coords (not the mean/median) — robust even
  // when a big minority are wrong AND the wrong ones cluster (e.g. several stale
  // results all in Utah). Existing coords seed it; freshly-geocoded results are
  // folded in as we go, so a force re-map self-corrects.
  const existingCoords: Pt[] = [];
  for (const it of allItems) {
    if (it.destinationLat != null && it.destinationLng != null)
      existingCoords.push({ lat: it.destinationLat, lng: it.destinationLng });
    if (it.originLat != null && it.originLng != null)
      existingCoords.push({ lat: it.originLat, lng: it.originLng });
  }
  const freshCoords: Pt[] = [];
  const proximity = () =>
    largestClusterCentroid([...existingCoords, ...freshCoords]);

  for (const item of filtered) {
    if (!item.destinationName) continue;
    const prov = (item.fieldProvenance ?? {}) as FieldProvenance;

    // Should we (re)geocode a coordinate field?
    const shouldGeocode = (
      provKey: keyof FieldProvenance,
      currentValue: number | null
    ): boolean => {
      if (prov[provKey] === "user_provided") return false; // sacred
      return force || currentValue == null;
    };

    if (item.category === "drive") {
      // Prefer explicit origin/destination fields; fall back to splitting a
      // legacy "A → B" destinationName.
      let originQuery = item.originName;
      let destQuery = item.destinationName;
      if (!originQuery) {
        const endpoints = splitDriveEndpoints(item.destinationName);
        if (endpoints) {
          originQuery = endpoints.origin;
          destQuery = endpoints.destination;
        }
      }

      const updates: Record<string, unknown> = {
        fieldProvenance: { ...prov } as Record<string, string>,
        updatedAt: new Date(),
      };
      const result: GeocodedResult = { id: item.id };
      let changed = false;

      if (originQuery && shouldGeocode("originLat", item.originLat)) {
        const originGeo = await geocoding.geocode(originQuery, { proximity: proximity() });
        if (originGeo) {
          updates.originName = originQuery;
          updates.originLat = originGeo.lat;
          updates.originLng = originGeo.lng;
          const fp = updates.fieldProvenance as Record<string, string>;
          fp.originName = "live_researched";
          fp.originLat = "live_researched";
          fp.originLng = "live_researched";
          result.originLat = originGeo.lat;
          result.originLng = originGeo.lng;
          freshCoords.push({ lat: originGeo.lat, lng: originGeo.lng });
          changed = true;
        }
      }

      if (destQuery && shouldGeocode("destinationLat", item.destinationLat)) {
        const destGeo = await geocoding.geocode(destQuery, { proximity: proximity() });
        if (destGeo) {
          updates.destinationLat = destGeo.lat;
          updates.destinationLng = destGeo.lng;
          const fp = updates.fieldProvenance as Record<string, string>;
          fp.destinationLat = "live_researched";
          fp.destinationLng = "live_researched";
          result.destinationLat = destGeo.lat;
          result.destinationLng = destGeo.lng;
          freshCoords.push({ lat: destGeo.lat, lng: destGeo.lng });
          changed = true;
        }
      }

      if (changed) {
        await db.update(itineraryItems).set(updates).where(eq(itineraryItems.id, item.id));
        results.push(result);
      }
    } else {
      // Non-drive: geocode destinationName.
      if (!shouldGeocode("destinationLat", item.destinationLat)) continue;
      const geo = await geocoding.geocode(item.destinationName, { proximity: proximity() });
      if (!geo) continue;
      freshCoords.push({ lat: geo.lat, lng: geo.lng });

      await db
        .update(itineraryItems)
        .set({
          destinationLat: geo.lat,
          destinationLng: geo.lng,
          fieldProvenance: {
            ...prov,
            destinationLat: "live_researched",
            destinationLng: "live_researched",
          },
          updatedAt: new Date(),
        })
        .where(eq(itineraryItems.id, item.id));
      results.push({ id: item.id, destinationLat: geo.lat, destinationLng: geo.lng });
    }
  }

  return NextResponse.json({ geocoded: results.length, results });
}
