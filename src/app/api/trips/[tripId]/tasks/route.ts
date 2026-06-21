import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tripTasks } from "@/db/schema";
import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;

  const tasks = await db
    .select()
    .from(tripTasks)
    .where(eq(tripTasks.tripId, tripId))
    .orderBy(asc(tripTasks.sortOrder), asc(tripTasks.createdAt));

  return NextResponse.json(tasks);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;
  const body = await req.json().catch(() => ({}));

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const maxOrder = await db
    .select({ sortOrder: tripTasks.sortOrder })
    .from(tripTasks)
    .where(eq(tripTasks.tripId, tripId))
    .orderBy(asc(tripTasks.sortOrder))
    .then((rows) => (rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder)) : -1));

  const [created] = await db
    .insert(tripTasks)
    .values({
      id: nanoid(),
      tripId,
      text: body.text.trim(),
      sortOrder: maxOrder + 1,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
