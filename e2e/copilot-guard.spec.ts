import { test, expect } from "@playwright/test";
import {
  guardHumanData,
  guardDelete,
  fieldLockLevel,
  deleteLockLevel,
} from "../src/lib/trip-state/guard";
import {
  annotateActions,
  parseActions,
  buildRefMaps,
  type PlanAction,
} from "../src/lib/ai/planner";
import type { ItineraryItem } from "../src/db/types";

/**
 * Tiered sacred-data model (revised 2026-06-20). AI edits are classified per
 * field: "hard" (booked facts — never apply), "confirm" (user data / booked
 * labels — apply only on opt-in), "open" (free). These prove the classification
 * and that the strict PATCH guard still blocks non-open writes. Pure, no Claude/DB.
 */

// Minimal stand-ins; the guard/annotate code only reads these fields.
function item(overrides: Partial<ItineraryItem>): ItineraryItem {
  const base = {
    id: "item_1",
    tripId: "trip_1",
    title: "Museum",
    category: "activity",
    confirmationStatus: "idea",
    fieldProvenance: {},
    date: "2026-07-01",
    startTime: "09:00",
    notes: "old notes",
    costCents: 1000,
  } as ItineraryItem;
  return { ...base, ...overrides } as ItineraryItem;
}

test.describe("short item refs — parseActions (#1 fix: no more silent drops)", () => {
  const items = [
    item({ id: "id_aaa", title: "First" }),
    item({ id: "id_bbb", title: "Second" }),
    item({ id: "id_ccc", title: "Third" }),
  ];
  const { refToId } = buildRefMaps(items);

  test("a ref (R2) resolves to the right item id", () => {
    const { actions, unmatchedRefs } = parseActions(
      { updates: [{ ref: "R2", notes: "x" }] },
      refToId
    );
    expect(unmatchedRefs).toEqual([]);
    expect((actions[0] as Extract<PlanAction, { type: "update" }>).itemId).toBe("id_bbb");
  });

  test("translating EVERY note resolves all refs (exhaustive)", () => {
    const { actions, unmatchedRefs } = parseActions(
      {
        updates: [
          { ref: "R1", notes: "一" },
          { ref: "R2", notes: "二" },
          { ref: "R3", notes: "三" },
        ],
      },
      refToId
    );
    expect(unmatchedRefs).toEqual([]);
    expect(actions).toHaveLength(3);
  });

  test("an unknown ref is reported as unmatched, not silently dropped", () => {
    const { actions, unmatchedRefs } = parseActions(
      { updates: [{ ref: "R1", notes: "ok" }, { ref: "R99", notes: "ghost" }] },
      refToId
    );
    expect(actions).toHaveLength(1);
    expect(unmatchedRefs).toContain("R99");
  });

  test("tolerates the model echoing a raw item id", () => {
    const { actions, unmatchedRefs } = parseActions(
      { deletes: [{ itemId: "id_ccc" }] },
      refToId
    );
    expect(unmatchedRefs).toEqual([]);
    expect(actions).toHaveLength(1);
  });
});

test.describe("fieldLockLevel — classification", () => {
  test("booked item's facts are HARD", () => {
    const booked = item({ confirmationStatus: "booked" });
    for (const f of ["date", "startTime", "destinationName", "costCents"]) {
      expect(fieldLockLevel(f, booked)).toBe("hard");
    }
  });

  test("booked item's labels are CONFIRM (AI may propose, user confirms)", () => {
    const booked = item({ confirmationStatus: "booked" });
    for (const f of ["title", "notes", "category"]) {
      expect(fieldLockLevel(f, booked)).toBe("confirm");
    }
  });

  test("a user_provided field on a non-booked item is CONFIRM", () => {
    const it = item({ fieldProvenance: { notes: "user_provided" } });
    expect(fieldLockLevel("notes", it)).toBe("confirm");
  });

  test("an ai_assumption field is OPEN", () => {
    const it = item({ fieldProvenance: { notes: "ai_assumption" } });
    expect(fieldLockLevel("notes", it)).toBe("open");
  });

  test("delete: booked = hard, user-data = confirm, ai-only = open", () => {
    expect(deleteLockLevel(item({ confirmationStatus: "booked" }))).toBe("hard");
    expect(deleteLockLevel(item({ fieldProvenance: { title: "user_provided" } }))).toBe("confirm");
    expect(deleteLockLevel(item({ fieldProvenance: { title: "ai_assumption" } }))).toBe("open");
  });
});

test.describe("guardHumanData / guardDelete — strict PATCH guard (no confirm UI)", () => {
  test("blocks AI overwriting a user_provided field", () => {
    const existing = item({ fieldProvenance: { notes: "user_provided" } });
    expect(guardHumanData(existing, { notes: "AI notes" }, "ai_assumption").length).toBeGreaterThan(0);
  });

  test("blocks AI touching a booked item's facts", () => {
    const existing = item({ confirmationStatus: "booked" });
    expect(guardHumanData(existing, { startTime: "10:00" }, "ai_assumption").length).toBeGreaterThan(0);
  });

  test("allows AI overwriting its own ai_assumption field", () => {
    const existing = item({ fieldProvenance: { notes: "ai_assumption" } });
    expect(guardHumanData(existing, { notes: "better notes" }, "ai_assumption")).toEqual([]);
  });

  test("always allows direct user edits", () => {
    const existing = item({
      confirmationStatus: "booked",
      fieldProvenance: { notes: "user_provided" },
    });
    expect(guardHumanData(existing, { notes: "x" }, "user_provided")).toEqual([]);
  });

  test("blocks AI deleting a booked item", () => {
    expect(guardDelete(item({ confirmationStatus: "booked" }), "ai_assumption").length).toBeGreaterThan(0);
  });

  test("allows AI deleting a fully-AI item", () => {
    expect(guardDelete(item({ fieldProvenance: { title: "ai_assumption" } }), "ai_assumption")).toEqual([]);
  });
});

test.describe("annotateActions — preview-time flags", () => {
  const existing = [
    item({ id: "ai_item", fieldProvenance: { notes: "ai_assumption" }, notes: "old" }),
    item({ id: "human_item", fieldProvenance: { notes: "user_provided" }, notes: "mine" }),
    item({ id: "booked_item", confirmationStatus: "booked" }),
  ];

  test("an update to a user_provided field is CONFIRM (not blocked), with a before snapshot", () => {
    const actions: PlanAction[] = [
      { type: "update", itemId: "human_item", changes: { notes: "AI rewrite" }, reason: null },
    ];
    const [a] = annotateActions(actions, existing) as Extract<PlanAction, { type: "update" }>[];
    expect(a.lockLevel).toBe("confirm");
    expect(a.confirmReasons!.length).toBeGreaterThan(0);
    expect(a.before).toEqual({ notes: "mine" });
  });

  test("an update to a booked item's facts is BLOCKED", () => {
    const actions: PlanAction[] = [
      { type: "update", itemId: "booked_item", changes: { startTime: "10:00" }, reason: null },
    ];
    const [a] = annotateActions(actions, existing) as Extract<PlanAction, { type: "update" }>[];
    expect(a.lockLevel).toBe("blocked");
    expect(a.hardReasons!.length).toBeGreaterThan(0);
  });

  test("an update to a booked item's label is CONFIRM", () => {
    const actions: PlanAction[] = [
      { type: "update", itemId: "booked_item", changes: { title: "New title" }, reason: null },
    ];
    const [a] = annotateActions(actions, existing) as Extract<PlanAction, { type: "update" }>[];
    expect(a.lockLevel).toBe("confirm");
  });

  test("an update mixing a booked fact + a label keeps the label (confirm) and flags the fact (hard)", () => {
    const actions: PlanAction[] = [
      {
        type: "update",
        itemId: "booked_item",
        changes: { startTime: "10:00", title: "New title" },
        reason: null,
      },
    ];
    const [a] = annotateActions(actions, existing) as Extract<PlanAction, { type: "update" }>[];
    expect(a.lockLevel).toBe("confirm");
    expect(a.hardReasons!.length).toBeGreaterThan(0);
    expect(a.confirmReasons!.length).toBeGreaterThan(0);
  });

  test("an update to an ai_assumption field is OPEN", () => {
    const actions: PlanAction[] = [
      { type: "update", itemId: "ai_item", changes: { notes: "AI rewrite" }, reason: null },
    ];
    const [a] = annotateActions(actions, existing) as Extract<PlanAction, { type: "update" }>[];
    expect(a.lockLevel).toBe("open");
  });

  test("deleting a booked item is BLOCKED", () => {
    const actions: PlanAction[] = [{ type: "delete", itemId: "booked_item", reason: null }];
    const [a] = annotateActions(actions, existing) as Extract<PlanAction, { type: "delete" }>[];
    expect(a.lockLevel).toBe("blocked");
  });

  test("deleting a user-data item is CONFIRM", () => {
    const actions: PlanAction[] = [{ type: "delete", itemId: "human_item", reason: null }];
    const [a] = annotateActions(actions, existing) as Extract<PlanAction, { type: "delete" }>[];
    expect(a.lockLevel).toBe("confirm");
  });

  test("never blocks a create", () => {
    const actions: PlanAction[] = [
      {
        type: "create",
        item: {
          date: "2026-07-02",
          title: "New stop",
          category: "activity",
          startTime: null,
          endTime: null,
          durationMinutes: null,
          originName: null,
          destinationName: null,
          notes: null,
          costCents: null,
          confirmationStatus: "idea",
        },
      },
    ];
    const [a] = annotateActions(actions, existing);
    expect(a.type).toBe("create");
  });

  test("flags an update referencing an unknown item id as blocked", () => {
    const actions: PlanAction[] = [
      { type: "update", itemId: "ghost", changes: { notes: "x" }, reason: null },
    ];
    const [a] = annotateActions(actions, existing) as Extract<PlanAction, { type: "update" }>[];
    expect(a.lockLevel).toBe("blocked");
  });
});
