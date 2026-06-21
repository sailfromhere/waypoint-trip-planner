import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itineraryItems } from "@/db/schema";
import type { FieldProvenance, Provenance } from "@/db/types";
import { guardHumanData } from "@/lib/trip-state/guard";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> }
) {
  const { tripId, itemId } = await params;
  const body = await req.json().catch(() => ({}));

  const source: Provenance = body._provenance ?? "user_provided";
  delete body._provenance;

  const [existing] = await db
    .select()
    .from(itineraryItems)
    .where(
      and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId))
    );

  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Sacred-human-data invariant: reject AI overwrites of user_provided or booked fields
  if (source !== "user_provided") {
    const violations = guardHumanData(existing, body, source);
    if (violations.length > 0) {
      return NextResponse.json(
        {
          error: "Cannot overwrite user-provided or booked data",
          violations,
        },
        { status: 409 }
      );
    }
  }

  // Merge provenance: update only the fields being changed
  const mergedProvenance: FieldProvenance = {
    ...(existing.fieldProvenance as FieldProvenance),
  };
  for (const key of Object.keys(body)) {
    if (key !== "fieldProvenance") {
      mergedProvenance[key] = source;
    }
  }

  const [updated] = await db
    .update(itineraryItems)
    .set({ ...body, fieldProvenance: mergedProvenance, updatedAt: new Date() })
    .where(
      and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId))
    )
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> }
) {
  const { tripId, itemId } = await params;

  const [deleted] = await db
    .delete(itineraryItems)
    .where(
      and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId))
    )
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
