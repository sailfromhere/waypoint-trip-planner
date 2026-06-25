import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itineraryItems, trips } from "@/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { geocoding } from "@/lib/integrations";
import type { FieldProvenance } from "@/db/types";
import { largestClusterCentroid, type Pt } from "@/lib/trip-state/anchor";
import tzLookup from "tz-lookup";

// IANA timezone from coords — offline, no key. A pure machine-derived cache
// (outside the provenance/sacred-data system), recomputed when an endpoint moves.
function tzFor(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  try {
    return tzLookup(lat, lng);
  } catch {
    return null;
  }
}

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

  // Candidates for the trip's home timezone (set lazily, below): the destination
  // tz of dated items, earliest date wins. The trip "lives" where its first
  // grounded stop is.
  const homeCandidates: { date: string | null; tz: string }[] = [];
  const noteHomeTz = (date: string | null, tz: string | null) => {
    if (tz) homeCandidates.push({ date, tz });
  };

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

      // Derive endpoint timezones from the final coords (fresh this run, else
      // existing). Recompute when coords moved OR backfill when tz is missing.
      const finalOriginLat = (updates.originLat as number) ?? item.originLat;
      const finalOriginLng = (updates.originLng as number) ?? item.originLng;
      if (updates.originLat != null || item.originTimezone == null) {
        const tz = tzFor(finalOriginLat, finalOriginLng);
        if (tz && tz !== item.originTimezone) {
          updates.originTimezone = tz;
          changed = true;
        }
      }
      const finalDestLat = (updates.destinationLat as number) ?? item.destinationLat;
      const finalDestLng = (updates.destinationLng as number) ?? item.destinationLng;
      if (updates.destinationLat != null || item.destinationTimezone == null) {
        const tz = tzFor(finalDestLat, finalDestLng);
        if (tz && tz !== item.destinationTimezone) {
          updates.destinationTimezone = tz;
          changed = true;
        }
      }
      noteHomeTz(
        item.date,
        (updates.destinationTimezone as string) ?? item.destinationTimezone
      );

      if (changed) {
        await db.update(itineraryItems).set(updates).where(eq(itineraryItems.id, item.id));
        results.push(result);
      }
    } else {
      // Non-drive: geocode destinationName when needed, then derive its tz.
      const updates: Record<string, unknown> = {};
      let destLat = item.destinationLat;
      let destLng = item.destinationLng;
      let changed = false;

      if (shouldGeocode("destinationLat", item.destinationLat)) {
        const geo = await geocoding.geocode(item.destinationName, { proximity: proximity() });
        if (geo) {
          destLat = geo.lat;
          destLng = geo.lng;
          freshCoords.push({ lat: geo.lat, lng: geo.lng });
          updates.destinationLat = geo.lat;
          updates.destinationLng = geo.lng;
          updates.fieldProvenance = {
            ...prov,
            destinationLat: "live_researched",
            destinationLng: "live_researched",
          };
          changed = true;
        }
      }

      // Derive tz when coords are fresh OR the tz column is empty (backfill).
      if (updates.destinationLat != null || item.destinationTimezone == null) {
        const tz = tzFor(destLat, destLng);
        if (tz && tz !== item.destinationTimezone) {
          updates.destinationTimezone = tz;
          changed = true;
        }
      }
      noteHomeTz(
        item.date,
        (updates.destinationTimezone as string) ?? item.destinationTimezone
      );

      if (changed) {
        updates.updatedAt = new Date();
        await db.update(itineraryItems).set(updates).where(eq(itineraryItems.id, item.id));
        results.push({
          id: item.id,
          destinationLat: destLat ?? undefined,
          destinationLng: destLng ?? undefined,
        });
      }
    }
  }

  // Lazily set the trip's home timezone (display axis + coord-less fallback) from
  // the earliest dated grounded stop, only if not already set.
  if (homeCandidates.length > 0) {
    const [tripRow] = await db
      .select({ homeTimezone: trips.homeTimezone })
      .from(trips)
      .where(eq(trips.id, tripId));
    if (tripRow && tripRow.homeTimezone == null) {
      const home = homeCandidates.sort((a, b) =>
        (a.date ?? "9999").localeCompare(b.date ?? "9999")
      )[0].tz;
      await db
        .update(trips)
        .set({ homeTimezone: home, updatedAt: new Date() })
        .where(eq(trips.id, tripId));
    }
  }

  return NextResponse.json({ geocoded: results.length, results });
}
