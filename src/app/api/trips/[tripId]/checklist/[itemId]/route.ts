import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { checklistInstances } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> }
) {
  const { tripId, itemId } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if (typeof body.text === "string") updates.text = body.text.trim();
  if (typeof body.done === "boolean") updates.done = body.done;
  if (typeof body.sortOrder === "number") updates.sortOrder = body.sortOrder;
  if (body.category !== undefined)
    updates.category = body.category?.trim() || null;

  const [updated] = await db
    .update(checklistInstances)
    .set(updates)
    .where(
      and(
        eq(checklistInstances.id, itemId),
        eq(checklistInstances.tripId, tripId)
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
    .delete(checklistInstances)
    .where(
      and(
        eq(checklistInstances.id, itemId),
        eq(checklistInstances.tripId, tripId)
      )
    )
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
