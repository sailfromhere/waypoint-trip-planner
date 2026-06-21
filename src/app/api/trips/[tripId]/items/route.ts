import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itineraryItems } from "@/db/schema";
import { stampProvenance } from "@/db/types";
import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";

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

  return NextResponse.json(items);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;
  const body = await req.json().catch(() => ({}));

  const provenance = stampProvenance(body, body._provenance ?? "user_provided");
  delete body._provenance;

  const item = {
    id: nanoid(),
    tripId,
    ...body,
    fieldProvenance: provenance,
  };

  const [created] = await db
    .insert(itineraryItems)
    .values(item)
    .returning();

  return NextResponse.json(created, { status: 201 });
}
