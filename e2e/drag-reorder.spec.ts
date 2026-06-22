import { test, expect, request as pwRequest, type Page } from "@playwright/test";

/**
 * Drag-reorder ([D2]a): rows reorder within a day and move ACROSS days via
 * dnd-kit whole-row drag. Written to FAIL before the feature lands (no drag
 * wiring → order/date unchanged) and pass after.
 *
 * Outcomes are asserted via the REAL API (sortOrder / date), not pixel order —
 * dnd simulation is the flaky part; the persisted state is deterministic.
 */

const BASE = "http://localhost:3000";
let tripId: string;
const ids: Record<string, string> = {};

const D1 = "2026-08-01";
const D2 = "2026-08-02";

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const tripRes = await ctx.post("/api/trips", {
    data: { name: "E2E Drag Trip", startDate: D1, endDate: D2 },
  });
  expect(tripRes.ok()).toBeTruthy();
  tripId = (await tripRes.json()).id;

  const seed = [
    { key: "A", title: "Alpha Activity", category: "activity", date: D1, sortOrder: 0 },
    { key: "B", title: "Bravo Activity", category: "activity", date: D1, sortOrder: 1 },
    { key: "C", title: "Charlie Activity", category: "activity", date: D1, sortOrder: 2 },
    { key: "D", title: "Delta Activity", category: "activity", date: D2, sortOrder: 0 },
  ];
  for (const { key, ...item } of seed) {
    const r = await ctx.post(`/api/trips/${tripId}/items`, { data: item });
    expect(r.ok()).toBeTruthy();
    ids[key] = (await r.json()).id;
  }
  await ctx.dispose();
});

test.afterAll(async () => {
  if (!tripId) return;
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  await ctx.dispose();
});

async function fetchItems(page: Page) {
  const res = await page.request.get(`/api/trips/${tripId}/items`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as {
    id: string;
    title: string;
    date: string | null;
    sortOrder: number;
  }[];
}

// Simulate a dnd-kit whole-row drag from one row to another. Multiple stepped
// moves are required: the PointerSensor only activates after 6px of travel, and
// the sortable needs intermediate positions to settle the drop slot.
async function dragRowOnto(page: Page, sourceText: string, targetText: string) {
  const source = page.locator("tr", { hasText: sourceText }).first();
  const target = page.locator("tr", { hasText: targetText }).first();
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  // Wait for the client to be truly READY before dragging: the itinerary query
  // only fires after the "use client" component hydrates, so once the network is
  // idle the dnd pointer listeners are bound. (Visible ≠ hydrated — on a cold
  // Next.js dev compile the first drag otherwise races listener binding and
  // misfires, landing the row cross-day.)
  await page.waitForLoadState("networkidle");
  const sb = (await source.boundingBox())!;
  const tb = (await target.boundingBox())!;
  // Grab the source on its left edge (over the grip area, away from editors).
  await page.mouse.move(sb.x + 12, sb.y + sb.height / 2);
  await page.mouse.down();
  // Cross the 6px activation threshold.
  await page.mouse.move(sb.x + 12, sb.y + sb.height / 2 + 12, { steps: 4 });
  // Travel to the target, ending just past its centre so the drop lands there.
  await page.mouse.move(tb.x + 12, tb.y + tb.height / 2, { steps: 12 });
  await page.mouse.move(tb.x + 12, tb.y + tb.height * 0.66, { steps: 4 });
  await page.waitForTimeout(60);
  await page.mouse.up();
}

test("reorders rows within a day (drag Alpha below Charlie)", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator("tr", { hasText: "Alpha Activity" }).first()).toBeVisible();

  await dragRowOnto(page, "Alpha Activity", "Charlie Activity");

  // Alpha should now sit last in day 1 (after Bravo and Charlie), same date.
  await expect
    .poll(async () => {
      const items = await fetchItems(page);
      const day1 = items
        .filter((i) => i.date === D1)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => i.title);
      return day1.join(",");
    })
    .toBe("Bravo Activity,Charlie Activity,Alpha Activity");
});

test("moves a row across days (drag Bravo onto day 2)", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator("tr", { hasText: "Bravo Activity" }).first()).toBeVisible();

  await dragRowOnto(page, "Bravo Activity", "Delta Activity");

  // Bravo's date should now be D2 (it left day 1 for day 2).
  await expect
    .poll(async () => {
      const items = await fetchItems(page);
      return items.find((i) => i.title === "Bravo Activity")?.date ?? null;
    })
    .toBe(D2);
});
