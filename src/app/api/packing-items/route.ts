import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { packingItems, packingItemTemplates } from "@/db/schema";
import { packingRequiredness } from "@/db/schema";
import { nanoid } from "nanoid";
import { asc } from "drizzle-orm";

// Master gear repository (user-level). Each item returns its template membership
// as a `templateIds` array so the manage-repository UI can show/edit it.
export async function GET() {
  const items = await db
    .select()
    .from(packingItems)
    .orderBy(asc(packingItems.sortOrder), asc(packingItems.createdAt));

  const links = await db.select().from(packingItemTemplates);
  const byItem = new Map<string, string[]>();
  for (const link of links) {
    const arr = byItem.get(link.packingItemId) ?? [];
    arr.push(link.templateId);
    byItem.set(link.packingItemId, arr);
  }

  return NextResponse.json(
    items.map((it) => ({ ...it, templateIds: byItem.get(it.id) ?? [] }))
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const requiredness = packingRequiredness.includes(body.requiredness)
    ? body.requiredness
    : "recommended";

  const maxOrder = await db
    .select({ sortOrder: packingItems.sortOrder })
    .from(packingItems)
    .then((rows) =>
      rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder)) : -1
    );

  const id = nanoid();
  const [created] = await db
    .insert(packingItems)
    .values({
      id,
      name: body.name.trim(),
      category: body.category?.trim() || null,
      requiredness,
      alwaysInclude: !!body.alwaysInclude,
      shared: !!body.shared,
      defaultQuantity:
        Number.isInteger(body.defaultQuantity) && body.defaultQuantity > 0
          ? body.defaultQuantity
          : 1,
      notes: body.notes?.trim() || null,
      sortOrder: maxOrder + 1,
    })
    .returning();

  const templateIds: string[] = Array.isArray(body.templateIds)
    ? body.templateIds.filter((t: unknown) => typeof t === "string")
    : [];

  if (templateIds.length > 0) {
    await db.insert(packingItemTemplates).values(
      templateIds.map((templateId) => ({
        id: nanoid(),
        packingItemId: id,
        templateId,
      }))
    );
  }

  return NextResponse.json({ ...created, templateIds }, { status: 201 });
}
