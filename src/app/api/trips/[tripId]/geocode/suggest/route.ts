import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itineraryItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { geocoding } from "@/lib/integrations";
import { tripAnchor } from "@/lib/trip-state/anchor";

// Type-ahead suggestions for a location cell. Proximity-biased to where the
// trip already is so ambiguous names rank near the rest of the itinerary.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const sessionToken = req.nextUrl.searchParams.get("session") ?? undefined;
  if (q.length < 2) return NextResponse.json({ suggestions: [] });

  const items = await db
    .select()
    .from(itineraryItems)
    .where(eq(itineraryItems.tripId, tripId));
  const proximity = tripAnchor(items);

  const suggestions = await geocoding.suggest(q, { proximity, sessionToken });
  return NextResponse.json({ suggestions });
}
