import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { packingListItems } from "@/db/schema";
import { packingRequiredness } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> }
) {
  const { tripId, itemId } = await params;
  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string") updates.name = body.name.trim();
  if (typeof body.packed === "boolean") updates.packed = body.packed;
  if (typeof body.sortOrder === "number") updates.sortOrder = body.sortOrder;
  if (body.category !== undefined)
    updates.category = body.category?.trim() || null;
  if (packingRequiredness.includes(body.requiredness))
    updates.requiredness = body.requiredness;
  if (Number.isInteger(body.quantity) && body.quantity > 0)
    updates.quantity = body.quantity;
  if (typeof body.shared === "boolean") updates.shared = body.shared;
  if (body.assignedTravelerId !== undefined)
    updates.assignedTravelerId = body.assignedTravelerId || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(packingListItems)
    .set(updates)
    .where(
      and(
        eq(packingListItems.id, itemId),
        eq(packingListItems.tripId, tripId)
      )
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> }
) {
  const { tripId, itemId } = await params;

  const [deleted] = await db
    .delete(packingListItems)
    .where(
      and(
        eq(packingListItems.id, itemId),
        eq(packingListItems.tripId, tripId)
      )
    )
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
