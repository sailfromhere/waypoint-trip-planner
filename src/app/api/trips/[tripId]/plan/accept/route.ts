import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { trips, itineraryItems, planningTurns } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { stampProvenance } from "@/db/types";
import type { FieldProvenance } from "@/db/types";
import type { PlanAction } from "@/lib/ai/planner";
import { fieldLockLevel, fieldLockReason, deleteLockLevel } from "@/lib/trip-state/guard";
import { nanoid } from "nanoid";

const AI_SOURCE = "ai_assumption" as const;

interface ActionResult {
  index: number;
  type: PlanAction["type"];
  status: "applied" | "blocked" | "error";
  itemId?: string;
  violations?: string[];
  message?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params;
  const { turnId, actionIndexes } = (await req.json().catch(() => ({}))) as {
    turnId?: string;
    actionIndexes?: number[];
  };

  if (!turnId || !Array.isArray(actionIndexes) || actionIndexes.length === 0) {
    return NextResponse.json(
      { error: "turnId and a non-empty actionIndexes array are required" },
      { status: 400 }
    );
  }

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const [turn] = await db
    .select()
    .from(planningTurns)
    .where(and(eq(planningTurns.id, turnId), eq(planningTurns.tripId, tripId)));
  if (!turn) {
    return NextResponse.json({ error: "Planning turn not found" }, { status: 404 });
  }

  const allActions = turn.actions as PlanAction[];

  // Running max sortOrder per date, so accepted creates stack after existing items.
  const existing = await db
    .select({ sortOrder: itineraryItems.sortOrder, date: itineraryItems.date })
    .from(itineraryItems)
    .where(eq(itineraryItems.tripId, tripId));
  const maxSortByDate = new Map<string, number>();
  for (const e of existing) {
    const key = e.date ?? "__unscheduled__";
    maxSortByDate.set(key, Math.max(maxSortByDate.get(key) ?? -1, e.sortOrder));
  }

  const results: ActionResult[] = [];
  const accepted = new Set<string>(turn.acceptedActionIds as string[]);

  for (const index of actionIndexes) {
    const action = allActions[index];
    if (!action) {
      results.push({ index, type: "create", status: "error", message: "No such action" });
      continue;
    }

    try {
      if (action.type === "create") {
        const r = await applyCreate(tripId, action, maxSortByDate);
        results.push({ index, type: "create", status: "applied", itemId: r.id });
        accepted.add(String(index));
      } else if (action.type === "update") {
        const r = await applyUpdate(
          tripId,
          action.itemId,
          action.changes as Record<string, unknown>
        );
        if (r.blocked) {
          results.push({ index, type: "update", status: "blocked", violations: r.blocked, itemId: action.itemId });
        } else {
          results.push({ index, type: "update", status: "applied", itemId: action.itemId });
          accepted.add(String(index));
        }
      } else {
        const r = await applyDelete(tripId, action.itemId);
        if (r.blocked) {
          results.push({ index, type: "delete", status: "blocked", violations: r.blocked, itemId: action.itemId });
        } else {
          results.push({ index, type: "delete", status: "applied", itemId: action.itemId });
          accepted.add(String(index));
        }
      }
    } catch (err) {
      results.push({
        index,
        type: action.type,
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const acceptedActionIds = Array.from(accepted);
  await db
    .update(planningTurns)
    .set({ acceptedActionIds })
    .where(eq(planningTurns.id, turnId));

  const appliedCount = results.filter((r) => r.status === "applied").length;
  return NextResponse.json(
    { results, acceptedActionIds, appliedCount },
    { status: appliedCount > 0 ? 201 : 200 }
  );
}

// ── Apply helpers — each re-checks the guard against current DB state ──────────

async function applyCreate(
  tripId: string,
  action: Extract<PlanAction, { type: "create" }>,
  maxSortByDate: Map<string, number>
) {
  const item = action.item;
  const dateKey = item.date ?? "__unscheduled__";
  const nextSort = (maxSortByDate.get(dateKey) ?? -1) + 1;
  maxSortByDate.set(dateKey, nextSort);

  const fields = {
    date: item.date ?? undefined,
    title: item.title,
    category: item.category,
    startTime: item.startTime ?? undefined,
    endTime: item.endTime ?? undefined,
    durationMinutes: item.durationMinutes ?? undefined,
    originName: item.originName ?? undefined,
    destinationName: item.destinationName ?? undefined,
    notes: item.notes ?? undefined,
    costCents: item.costCents ?? undefined,
    confirmationStatus: item.confirmationStatus,
  };

  const [created] = await db
    .insert(itineraryItems)
    .values({
      id: nanoid(),
      tripId,
      ...fields,
      sortOrder: nextSort,
      fieldProvenance: stampProvenance(fields, AI_SOURCE),
    })
    .returning();
  return created;
}

// Selecting an action IS the confirmation, so "confirm"-level fields apply;
// only "hard" fields are dropped. Re-evaluated against current DB state.
async function applyUpdate(
  tripId: string,
  itemId: string,
  changes: Record<string, unknown>
): Promise<{ blocked?: string[]; droppedHardFields?: string[] }> {
  const [existing] = await db
    .select()
    .from(itineraryItems)
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId)));
  if (!existing) return { blocked: ["Item no longer exists"] };

  const applied: Record<string, unknown> = {};
  const droppedHardFields: string[] = [];
  const provenance: FieldProvenance = {
    ...(existing.fieldProvenance as FieldProvenance),
  };
  const existingProv = (existing.fieldProvenance ?? {}) as FieldProvenance;

  for (const [field, value] of Object.entries(changes)) {
    const level = fieldLockLevel(field, existing);
    if (level === "hard") {
      droppedHardFields.push(field);
      continue;
    }
    applied[field] = value;
    // A confirmed edit to the user's own field stays user_provided (they're
    // curating it); everything else becomes an AI assumption.
    if (field !== "sortOrder") {
      provenance[field] =
        level === "confirm" && existingProv[field as keyof FieldProvenance] === "user_provided"
          ? "user_provided"
          : AI_SOURCE;
    }
  }

  if (Object.keys(applied).length === 0) {
    return { blocked: droppedHardFields.map((f) => fieldLockReason(f, "hard")) };
  }

  await db
    .update(itineraryItems)
    .set({ ...applied, fieldProvenance: provenance, updatedAt: new Date() })
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId)));
  return { droppedHardFields: droppedHardFields.length ? droppedHardFields : undefined };
}

async function applyDelete(
  tripId: string,
  itemId: string
): Promise<{ blocked?: string[] }> {
  const [existing] = await db
    .select()
    .from(itineraryItems)
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId)));
  if (!existing) return { blocked: ["Item no longer exists"] };

  // Only a booked item is hard-locked from deletion; "confirm" deletes apply
  // because the user selected the action.
  if (deleteLockLevel(existing) === "hard") {
    return { blocked: ["Item is booked — remove manually"] };
  }

  await db
    .delete(itineraryItems)
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId)));
  return {};
}
