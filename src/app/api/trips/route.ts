import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { trips } from "@/db/schema";
import { nanoid } from "nanoid";
import { desc } from "drizzle-orm";

export async function GET() {
  const allTrips = await db
    .select()
    .from(trips)
    .orderBy(desc(trips.updatedAt));

  return NextResponse.json(allTrips);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const trip = {
    id: nanoid(),
    name: body.name ?? "Untitled Trip",
    description: body.description ?? null,
    startDate: body.startDate ?? null,
    endDate: body.endDate ?? null,
    status: body.status ?? "dreaming",
    budgetCents: body.budgetCents ?? null,
    currency: body.currency ?? "USD",
  };

  const [created] = await db.insert(trips).values(trip).returning();
  return NextResponse.json(created, { status: 201 });
}
