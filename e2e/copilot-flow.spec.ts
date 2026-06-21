import { test, expect, request as pwRequest } from "@playwright/test";
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/db";
import { planningTurns } from "../src/db/schema";
import { annotateActions, type PlanAction } from "../src/lib/ai/planner";
import type { ItineraryItem } from "../src/db/types";
import { nanoid } from "nanoid";

/**
 * Live copilot flow — exercises the REAL diff UI + apply path WITHOUT calling
 * Claude. We seed a planning turn straight into the DB, then intercept POST
 * /plan to hand the panel that same turn; clicking "Apply" hits the real
 * /plan/accept (guard, provenance, partial-success all included).
 *
 * Covers: create/update/delete diff cards render; a delete of a booked item is
 * shown 🔒 Locked and is NOT applied (sacred data preserved); applied changes
 * land in the table; the turn persists in History across a reload.
 */

const BASE = "http://localhost:3000";
let tripId: string;
let turnId: string;
let aiItemId: string; // updatable (ai_assumption)
let bookedItemId: string; // delete must be blocked
let actions: PlanAction[];

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });

  const tripRes = await ctx.post("/api/trips", {
    data: { name: "Copilot Flow Trip", startDate: "2026-08-01", endDate: "2026-08-02" },
  });
  expect(tripRes.ok()).toBeTruthy();
  tripId = (await tripRes.json()).id;

  // AI-owned item — the copilot may update its notes.
  const museum = await ctx.post(`/api/trips/${tripId}/items`, {
    data: {
      title: "Museum Visit",
      category: "activity",
      date: "2026-08-01",
      sortOrder: 0,
      notes: "original notes",
      _provenance: "ai_assumption",
    },
  });
  aiItemId = (await museum.json()).id;

  // Booked item — the copilot must NOT be able to delete it.
  const hotel = await ctx.post(`/api/trips/${tripId}/items`, {
    data: {
      title: "Grand Hotel",
      category: "lodging",
      date: "2026-08-01",
      sortOrder: 1,
      confirmationStatus: "booked",
      _provenance: "user_provided",
    },
  });
  bookedItemId = (await hotel.json()).id;

  const existing = (await (
    await ctx.get(`/api/trips/${tripId}/items`)
  ).json()) as ItineraryItem[];

  // Raw proposals: one create, one allowed update, one delete that must block.
  const raw: PlanAction[] = [
    {
      type: "create",
      item: {
        date: "2026-08-01",
        title: "Coffee Stop",
        category: "meal",
        startTime: "08:00",
        endTime: null,
        durationMinutes: 30,
        originName: null,
        destinationName: "Local Cafe",
        notes: null,
        costCents: 800,
        confirmationStatus: "idea",
      },
    },
    {
      type: "update",
      itemId: aiItemId,
      changes: { notes: "AI-updated notes" },
      reason: "Added a tip about timed tickets",
    },
    { type: "delete", itemId: bookedItemId, reason: "Trying to cut lodging" },
  ];

  // Annotate exactly as the real /plan route does (attaches before + blocked).
  actions = annotateActions(raw, existing);

  turnId = nanoid();
  await db.insert(planningTurns).values({
    id: turnId,
    tripId,
    prompt: "add a coffee stop, update the museum notes, and drop the hotel",
    reasoning: "Test reasoning.",
    actions,
    acceptedActionIds: [],
  });

  await ctx.dispose();
});

test.afterAll(async () => {
  if (!tripId) return;
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  await ctx.dispose();
});

test("diff cards render, sacred data is locked, apply persists, history survives reload", async ({
  page,
}) => {
  // Hand the panel our seeded turn instead of calling Claude.
  await page.route(/\/plan$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        turnId,
        reasoning: "Test reasoning.",
        actions,
        messages: [
          { role: "user", content: "refine my trip" },
          { role: "assistant", content: "Test reasoning." },
        ],
      }),
    });
  });

  await page.goto(`/trips/${tripId}`);

  // Generate (mocked).
  await page.locator("textarea").first().fill("refine my trip");
  await page.getByRole("button", { name: "Plan", exact: true }).click();

  // Three diff cards: new / edit / remove. The delete is locked.
  await expect(page.getByText("Coffee Stop")).toBeVisible();
  await expect(page.getByText("Museum Visit").first()).toBeVisible();
  await expect(page.getByText(/🔒/)).toBeVisible();

  // Only the two non-blocked actions are selectable.
  const applyBtn = page.getByRole("button", { name: /Apply 2 changes/ });
  await expect(applyBtn).toBeVisible();
  await applyBtn.click();

  // Apply summary, with a note that something was skipped.
  await expect(page.getByText(/Applied 2 changes/)).toBeVisible();

  // New item is in the itinerary; booked hotel survived the blocked delete.
  await expect(page.locator("tr", { hasText: "Coffee Stop" })).toBeVisible();
  await expect(page.locator("tr", { hasText: "Grand Hotel" })).toBeVisible();

  // History persists across reload (no interception needed — it's in the DB).
  await page.reload();
  await page.getByRole("button", { name: /History \(/ }).click();
  await expect(page.getByText("2/3 applied")).toBeVisible();
});

test("refinement replaces the proposal and records the conversation", async ({
  page,
}) => {
  const revised: PlanAction[] = [
    {
      type: "create",
      item: {
        date: "2026-08-01",
        title: "Tea House",
        category: "meal",
        startTime: "08:00",
        endTime: null,
        durationMinutes: 30,
        originName: null,
        destinationName: "Tea House",
        notes: null,
        costCents: 600,
        confirmationStatus: "idea",
      },
    },
  ];

  // Generate hands back the seeded turn; refine swaps coffee for tea.
  await page.route(/\/plan$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        turnId,
        reasoning: "Initial proposal.",
        actions,
        messages: [
          { role: "user", content: "refine my trip" },
          { role: "assistant", content: "Initial proposal." },
        ],
      }),
    });
  });
  await page.route(/\/plan\/refine$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        turnId,
        reasoning: "Swapped the coffee stop for a tea house.",
        actions: revised,
        messages: [
          { role: "user", content: "refine my trip" },
          { role: "assistant", content: "Initial proposal." },
          { role: "user", content: "no coffee, tea instead" },
          { role: "assistant", content: "Swapped the coffee stop for a tea house." },
        ],
      }),
    });
  });

  await page.goto(`/trips/${tripId}`);
  await page.locator("textarea").first().fill("refine my trip");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  // Proposal rendered — the Refine input only appears once a proposal is active.
  // (Don't assert on "Coffee Stop": prior tests may have applied it to the table.)
  const refineBox = page.getByPlaceholder(/Ask for changes/);
  await expect(refineBox).toBeVisible();

  // Refine.
  await refineBox.fill("no coffee, tea instead");
  await page.getByRole("button", { name: "Refine", exact: true }).click();

  // Proposal now shows the revised item, and the conversation captured the ask.
  await expect(page.getByText("Tea House", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("no coffee, tea instead")).toBeVisible();
  await expect(
    page.getByText("Swapped the coffee stop for a tea house.")
  ).toBeVisible();
});

test("confirm-level edits apply when selected, with correct provenance", async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const t = (
    await (
      await ctx.post("/api/trips", {
        data: { name: "Confirm Trip", startDate: "2026-10-01", endDate: "2026-10-02" },
      })
    ).json()
  ).id as string;

  // A user-authored notes field (confirm to overwrite) and a booked item whose
  // LABEL is editable-with-confirm but whose FACTS are hard-locked.
  const userItem = await (
    await ctx.post(`/api/trips/${t}/items`, {
      data: {
        title: "My Notes Item",
        category: "activity",
        date: "2026-10-01",
        notes: "my own notes",
        _provenance: "user_provided",
      },
    })
  ).json();
  const bookedItem = await (
    await ctx.post(`/api/trips/${t}/items`, {
      data: {
        title: "Booked Flight",
        category: "flight",
        date: "2026-10-01",
        startTime: "08:00",
        confirmationStatus: "booked",
        _provenance: "user_provided",
      },
    })
  ).json();

  const existing = (await (await ctx.get(`/api/trips/${t}/items`)).json()) as ItineraryItem[];
  const raw: PlanAction[] = [
    { type: "update", itemId: userItem.id, changes: { notes: "AI-improved notes" }, reason: null },
    { type: "update", itemId: bookedItem.id, changes: { title: "Booked Flight ✈️", startTime: "09:00" }, reason: null },
  ];
  const annotated = annotateActions(raw, existing);
  const turn = nanoid();
  await db.insert(planningTurns).values({
    id: turn,
    tripId: t,
    prompt: "improve notes and relabel the flight",
    reasoning: "",
    actions: annotated,
    acceptedActionIds: [],
  });

  // Apply both (simulating the user confirming the unchecked diffs).
  const res = await ctx.post(`/api/trips/${t}/plan/accept`, {
    data: { turnId: turn, actionIndexes: [0, 1] },
  });
  expect(res.ok()).toBeTruthy();

  const after = (await (await ctx.get(`/api/trips/${t}/items`)).json()) as ItineraryItem[];
  const u = after.find((i) => i.id === userItem.id)!;
  const b = after.find((i) => i.id === bookedItem.id)!;

  // Confirmed edit to the user's field applied, but the field stays user_provided.
  expect(u.notes).toBe("AI-improved notes");
  expect((u.fieldProvenance as Record<string, string>).notes).toBe("user_provided");

  // Booked item's LABEL changed; its FACT (startTime) was hard-dropped.
  expect(b.title).toBe("Booked Flight ✈️");
  expect(b.startTime).toBe("08:00:00");

  await ctx.delete(`/api/trips/${t}`).catch(() => {});
  await ctx.dispose();
});

test("server rejects a blocked delete even if the client bypasses the UI", async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const deleteIndex = actions.findIndex((a) => a.type === "delete");

  // Forcibly ask the accept route to apply the locked delete.
  const res = await ctx.post(`/api/trips/${tripId}/plan/accept`, {
    data: { turnId, actionIndexes: [deleteIndex] },
  });
  const body = await res.json();
  const result = body.results.find(
    (r: { index: number }) => r.index === deleteIndex
  );
  expect(result.status).toBe("blocked");
  expect(body.appliedCount).toBe(0);

  // The booked item must still exist — the guard held server-side.
  const items = (await (
    await ctx.get(`/api/trips/${tripId}/items`)
  ).json()) as ItineraryItem[];
  expect(items.some((i) => i.id === bookedItemId)).toBeTruthy();
  await ctx.dispose();
});
