import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { checklistTemplates, checklistInstances } from "@/db/schema";
import { nanoid } from "nanoid";
import { eq, asc, inArray } from "drizzle-orm";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;

  const templates = await db
    .select()
    .from(checklistTemplates)
    .orderBy(asc(checklistTemplates.sortOrder), asc(checklistTemplates.createdAt));

  if (templates.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0 });
  }

  const existing = await db
    .select({ templateId: checklistInstances.templateId })
    .from(checklistInstances)
    .where(eq(checklistInstances.tripId, tripId));

  const alreadyInstantiated = new Set(
    existing.map((e) => e.templateId).filter(Boolean)
  );

  const toCreate = templates.filter((t) => !alreadyInstantiated.has(t.id));

  if (toCreate.length === 0) {
    return NextResponse.json({
      created: 0,
      skipped: templates.length,
    });
  }

  const maxOrder = await db
    .select({ sortOrder: checklistInstances.sortOrder })
    .from(checklistInstances)
    .where(eq(checklistInstances.tripId, tripId))
    .then((rows) =>
      rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder)) : -1
    );

  const values = toCreate.map((t, i) => ({
    id: nanoid(),
    tripId,
    templateId: t.id,
    text: t.text,
    category: t.category,
    sortOrder: maxOrder + 1 + i,
  }));

  await db.insert(checklistInstances).values(values);

  return NextResponse.json({
    created: toCreate.length,
    skipped: templates.length - toCreate.length,
  });
}
