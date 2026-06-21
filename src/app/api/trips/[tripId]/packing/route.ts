import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { packingListItems } from "@/db/schema";
import { packingRequiredness } from "@/db/schema";
import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;

  const items = await db
    .select()
    .from(packingListItems)
    .where(eq(packingListItems.tripId, tripId))
    .orderBy(asc(packingListItems.sortOrder), asc(packingListItems.createdAt));

  return NextResponse.json(items);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;
  const body = await req.json().catch(() => ({}));

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const requiredness = packingRequiredness.includes(body.requiredness)
    ? body.requiredness
    : "recommended";

  const maxOrder = await db
    .select({ sortOrder: packingListItems.sortOrder })
    .from(packingListItems)
    .where(eq(packingListItems.tripId, tripId))
    .then((rows) =>
      rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder)) : -1
    );

  const [created] = await db
    .insert(packingListItems)
    .values({
      id: nanoid(),
      tripId,
      packingItemId: body.packingItemId || null,
      name: body.name.trim(),
      category: body.category?.trim() || null,
      requiredness,
      quantity:
        Number.isInteger(body.quantity) && body.quantity > 0
          ? body.quantity
          : 1,
      shared: !!body.shared,
      assignedTravelerId: body.assignedTravelerId || null,
      sortOrder: maxOrder + 1,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
