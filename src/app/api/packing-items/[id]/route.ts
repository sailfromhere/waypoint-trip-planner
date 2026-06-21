import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { packingItems, packingItemTemplates } from "@/db/schema";
import { packingRequiredness } from "@/db/schema";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string") updates.name = body.name.trim();
  if (body.category !== undefined)
    updates.category = body.category?.trim() || null;
  if (packingRequiredness.includes(body.requiredness))
    updates.requiredness = body.requiredness;
  if (typeof body.alwaysInclude === "boolean")
    updates.alwaysInclude = body.alwaysInclude;
  if (typeof body.shared === "boolean") updates.shared = body.shared;
  if (Number.isInteger(body.defaultQuantity) && body.defaultQuantity > 0)
    updates.defaultQuantity = body.defaultQuantity;
  if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
  if (typeof body.sortOrder === "number") updates.sortOrder = body.sortOrder;

  const hasFieldUpdates = Object.keys(updates).length > 0;
  const replaceTemplates = Array.isArray(body.templateIds);

  if (!hasFieldUpdates && !replaceTemplates) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  let updated;
  if (hasFieldUpdates) {
    [updated] = await db
      .update(packingItems)
      .set(updates)
      .where(eq(packingItems.id, id))
      .returning();
  } else {
    [updated] = await db
      .select()
      .from(packingItems)
      .where(eq(packingItems.id, id));
  }

  if (!updated) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Replace template membership wholesale when a templateIds array is provided.
  let templateIds: string[];
  if (replaceTemplates) {
    templateIds = body.templateIds.filter((t: unknown) => typeof t === "string");
    await db
      .delete(packingItemTemplates)
      .where(eq(packingItemTemplates.packingItemId, id));
    if (templateIds.length > 0) {
      await db.insert(packingItemTemplates).values(
        templateIds.map((templateId) => ({
          id: nanoid(),
          packingItemId: id,
          templateId,
        }))
      );
    }
  } else {
    const links = await db
      .select({ templateId: packingItemTemplates.templateId })
      .from(packingItemTemplates)
      .where(eq(packingItemTemplates.packingItemId, id));
    templateIds = links.map((l) => l.templateId);
  }

  return NextResponse.json({ ...updated, templateIds });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Join rows cascade; instance rows keep their copy (packingItemId → null).
  const [deleted] = await db
    .delete(packingItems)
    .where(eq(packingItems.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
