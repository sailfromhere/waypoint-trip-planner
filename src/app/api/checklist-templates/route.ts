import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { checklistTemplates } from "@/db/schema";
import { nanoid } from "nanoid";
import { asc } from "drizzle-orm";

export async function GET() {
  const templates = await db
    .select()
    .from(checklistTemplates)
    .orderBy(asc(checklistTemplates.sortOrder), asc(checklistTemplates.createdAt));

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const maxOrder = await db
    .select({ sortOrder: checklistTemplates.sortOrder })
    .from(checklistTemplates)
    .orderBy(asc(checklistTemplates.sortOrder))
    .then((rows) =>
      rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder)) : -1
    );

  const [created] = await db
    .insert(checklistTemplates)
    .values({
      id: nanoid(),
      text: body.text.trim(),
      category: body.category?.trim() || null,
      sortOrder: maxOrder + 1,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
