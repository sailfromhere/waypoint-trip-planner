import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Phase 4.5 — Calendar view + schedule sequencing. Real-browser smoke (the
 * project's lesson: UI lifecycle bugs only reproduce in a browser under
 * StrictMode). Proves:
 *  - FullCalendar mounts under StrictMode and renders timed events;
 *  - "Auto-schedule all" fills blank start times (deterministic sequencer)
 *    and the fill is undoable.
 */

const BASE = "http://localhost:3000";
let tripId: string;
const D1 = "2026-09-01";
const D2 = "2026-09-02";

type ApiItem = { title: string; date: string | null; startTime: string | null };

async function getItems(): Promise<ApiItem[]> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const res = await ctx.get(`/api/trips/${tripId}/items`);
  const items = (await res.json()) as ApiItem[];
  await ctx.dispose();
  return items;
}

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const tripRes = await ctx.post("/api/trips", {
    data: { name: "Calendar Trip", startDate: D1, endDate: D2 },
  });
  tripId = (await tripRes.json()).id;

  const items = [
    // Day 1: already-timed (anchors) — should render on the grid + not be moved.
    { title: "Morning Hike", category: "activity", date: D1, sortOrder: 0, startTime: "09:00", durationMinutes: 90 },
    { title: "Lunch Spot", category: "meal", date: D1, sortOrder: 1, startTime: "12:30", durationMinutes: 60 },
    // Day 2: blank times — fodder for Auto-schedule.
    { title: "Museum Visit", category: "activity", date: D2, sortOrder: 0, durationMinutes: 120 },
    { title: "Dinner", category: "meal", date: D2, sortOrder: 1, durationMinutes: 60 },
  ];
  for (const item of items) {
    await ctx.post(`/api/trips/${tripId}/items`, { data: item });
  }
  await ctx.dispose();
});

test.afterAll(async () => {
  if (!tripId) return;
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  await ctx.dispose();
});

test("calendar view mounts and renders timed events", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: /Calendar/ }).click();

  // FullCalendar root mounts (would fail if React19/StrictMode broke it).
  await expect(page.locator(".fc")).toBeVisible();
  // Day-1 items are timed → on the grid; day-2 untimed items → all-day lane.
  await expect(page.locator(".fc-timegrid-event")).toHaveCount(2);
  await expect(page.locator(".fc-daygrid-event")).toHaveCount(2);
  await expect(page.locator(".fc").getByText("Morning Hike")).toBeVisible();
});

test("Auto-schedule all fills blank start times, and Undo reverts them", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);

  // Pre-condition: day-2 items have no start time.
  let items = await getItems();
  const museum = () => items.find((i) => i.title === "Museum Visit")!;
  expect(museum().startTime).toBeNull();

  await page.getByRole("button", { name: /Auto-schedule all/ }).click();
  await expect(page.getByText(/Filled \d+ start time/)).toBeVisible();

  // Day-2 blanks got filled; day-1 anchors were preserved.
  await expect.poll(async () => {
    items = await getItems();
    return museum().startTime;
  }).not.toBeNull();
  expect(museum().startTime).toMatch(/^09:00/); // day restarts at 9am
  const anchor = items.find((i) => i.title === "Morning Hike")!;
  expect(anchor.startTime).toMatch(/^09:00/); // unchanged anchor

  // Undo nulls the filled times again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => {
    items = await getItems();
    return museum().startTime;
  }).toBeNull();
});
