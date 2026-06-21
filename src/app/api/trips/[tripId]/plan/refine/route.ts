import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { trips, itineraryItems, planningTurns } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { refinePlan, type PlanAction, type ConversationMessage } from "@/lib/ai/planner";

// Continue a planning conversation: the user gives feedback on the current
// (not-yet-applied) proposal; Claude returns a revised full proposal, which
// replaces the turn's actions and appends to its conversation.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;
  const { turnId, message } = (await req.json()) as {
    turnId?: string;
    message?: string;
  };

  if (!turnId || !message?.trim()) {
    return NextResponse.json(
      { error: "turnId and a message are required" },
      { status: 400 }
    );
  }

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const [turn] = await db
    .select()
    .from(planningTurns)
    .where(and(eq(planningTurns.id, turnId), eq(planningTurns.tripId, tripId)));
  if (!turn) {
    return NextResponse.json({ error: "Planning turn not found" }, { status: 404 });
  }

  const existingItems = await db
    .select()
    .from(itineraryItems)
    .where(eq(itineraryItems.tripId, tripId))
    .orderBy(asc(itineraryItems.date), asc(itineraryItems.sortOrder));

  const result = await refinePlan(
    trip,
    existingItems,
    turn.messages as ConversationMessage[],
    turn.actions as PlanAction[],
    message.trim()
  );

  // The proposal is replaced wholesale; reset acceptedActionIds since indexes
  // no longer line up with the prior set.
  await db
    .update(planningTurns)
    .set({
      reasoning: result.reasoning,
      messages: result.messages,
      actions: result.actions,
      acceptedActionIds: [],
    })
    .where(eq(planningTurns.id, turnId));

  return NextResponse.json({ turnId, ...result });
}
