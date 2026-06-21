import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  packingItems,
  packingItemTemplates,
  packingListItems,
} from "@/db/schema";
import { nanoid } from "nanoid";
import { eq, inArray } from "drizzle-orm";

// Instantiate master items into a trip's packing list. Body: { templateIds: [] }.
// Copies (a) all `alwaysInclude` items + (b) all items belonging to the chosen
// templates. Idempotent: skips items already present (matched on packingItemId).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;
  const body = await req.json().catch(() => ({}));
  const templateIds: string[] = Array.isArray(body.templateIds)
    ? body.templateIds.filter((t: unknown) => typeof t === "string")
    : [];

  // (a) always-include items.
  const alwaysItems = await db
    .select()
    .from(packingItems)
    .where(eq(packingItems.alwaysInclude, true));

  // (b) items in the chosen templates.
  let templateItems: typeof alwaysItems = [];
  if (templateIds.length > 0) {
    const links = await db
      .select({ packingItemId: packingItemTemplates.packingItemId })
      .from(packingItemTemplates)
      .where(inArray(packingItemTemplates.templateId, templateIds));
    const memberIds = [...new Set(links.map((l) => l.packingItemId))];
    if (memberIds.length > 0) {
      templateItems = await db
        .select()
        .from(packingItems)
        .where(inArray(packingItems.id, memberIds));
    }
  }

  // Union by id.
  const candidates = new Map<string, (typeof alwaysItems)[number]>();
  for (const it of [...alwaysItems, ...templateItems]) candidates.set(it.id, it);

  if (candidates.size === 0) {
    return NextResponse.json({ created: 0, skipped: 0 });
  }

  // Skip items already instantiated into this trip.
  const existing = await db
    .select({ packingItemId: packingListItems.packingItemId })
    .from(packingListItems)
    .where(eq(packingListItems.tripId, tripId));
  const already = new Set(existing.map((e) => e.packingItemId).filter(Boolean));

  const toCreate = [...candidates.values()].filter((it) => !already.has(it.id));

  if (toCreate.length === 0) {
    return NextResponse.json({ created: 0, skipped: candidates.size });
  }

  const maxOrder = await db
    .select({ sortOrder: packingListItems.sortOrder })
    .from(packingListItems)
    .where(eq(packingListItems.tripId, tripId))
    .then((rows) =>
      rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder)) : -1
    );

  await db.insert(packingListItems).values(
    toCreate
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((it, i) => ({
        id: nanoid(),
        tripId,
        packingItemId: it.id,
        name: it.name,
        category: it.category,
        requiredness: it.requiredness,
        quantity: it.defaultQuantity,
        shared: it.shared,
        sortOrder: maxOrder + 1 + i,
      }))
  );

  return NextResponse.json({
    created: toCreate.length,
    skipped: candidates.size - toCreate.length,
  });
}
