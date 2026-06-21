import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tripTasks } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string; taskId: string }> }
) {
  const { tripId, taskId } = await params;
  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.text === "string") updates.text = body.text.trim();
  if (typeof body.done === "boolean") updates.done = body.done;
  if (typeof body.sortOrder === "number") updates.sortOrder = body.sortOrder;

  const [updated] = await db
    .update(tripTasks)
    .set(updates)
    .where(and(eq(tripTasks.id, taskId), eq(tripTasks.tripId, tripId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ tripId: string; taskId: string }> }
) {
  const { tripId, taskId } = await params;

  const [deleted] = await db
    .delete(tripTasks)
    .where(and(eq(tripTasks.id, taskId), eq(tripTasks.tripId, tripId)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
