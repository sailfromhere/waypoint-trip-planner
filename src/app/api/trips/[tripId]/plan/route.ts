import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { trips, itineraryItems, planningTurns } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { generatePlan } from "@/lib/ai/planner";
import { nanoid } from "nanoid";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;
  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: string };

  if (!prompt?.trim()) {
    return NextResponse.json(
      { error: "A planning prompt is required" },
      { status: 400 }
    );
  }

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const existingItems = await db
    .select()
    .from(itineraryItems)
    .where(eq(itineraryItems.tripId, tripId))
    .orderBy(asc(itineraryItems.date), asc(itineraryItems.sortOrder));

  const result = await generatePlan(trip, existingItems, prompt.trim());

  // Persist the turn so prompt/reasoning/proposed actions survive reload and
  // form a durable history inside Central Trip State.
  const turnId = nanoid();
  await db.insert(planningTurns).values({
    id: turnId,
    tripId,
    prompt: prompt.trim(),
    reasoning: result.reasoning,
    messages: result.messages,
    actions: result.actions,
    acceptedActionIds: [],
  });

  return NextResponse.json({ turnId, ...result });
}
