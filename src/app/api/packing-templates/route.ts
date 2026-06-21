import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { packingTemplates } from "@/db/schema";
import { nanoid } from "nanoid";
import { asc } from "drizzle-orm";

export async function GET() {
  const templates = await db
    .select()
    .from(packingTemplates)
    .orderBy(asc(packingTemplates.sortOrder), asc(packingTemplates.createdAt));

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const maxOrder = await db
    .select({ sortOrder: packingTemplates.sortOrder })
    .from(packingTemplates)
    .then((rows) =>
      rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder)) : -1
    );

  const [created] = await db
    .insert(packingTemplates)
    .values({
      id: nanoid(),
      name: body.name.trim(),
      sortOrder: maxOrder + 1,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
