import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { checklistInstances } from "@/db/schema";
import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;

  const items = await db
    .select()
    .from(checklistInstances)
    .where(eq(checklistInstances.tripId, tripId))
    .orderBy(asc(checklistInstances.sortOrder), asc(checklistInstances.createdAt));

  return NextResponse.json(items);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;
  const body = await req.json();

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const maxOrder = await db
    .select({ sortOrder: checklistInstances.sortOrder })
    .from(checklistInstances)
    .where(eq(checklistInstances.tripId, tripId))
    .orderBy(asc(checklistInstances.sortOrder))
    .then((rows) =>
      rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder)) : -1
    );

  const [created] = await db
    .insert(checklistInstances)
    .values({
      id: nanoid(),
      tripId,
      templateId: body.templateId || null,
      text: body.text.trim(),
      category: body.category?.trim() || null,
      sortOrder: maxOrder + 1,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
