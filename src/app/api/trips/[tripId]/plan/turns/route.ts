import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { planningTurns } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

// History of AI copilot turns for a trip, newest first.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;

  const turns = await db
    .select()
    .from(planningTurns)
    .where(eq(planningTurns.tripId, tripId))
    .orderBy(desc(planningTurns.createdAt));

  return NextResponse.json(turns);
}
