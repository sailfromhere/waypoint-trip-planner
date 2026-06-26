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

// Month "+N more" must open our body-portaled popover (not FC's native one,
// which clips against the scrolling pane) and must NOT navigate away to Day
// view. Self-contained: builds its own dense-day trip so it's independent of
// the shared beforeAll. Guards the FC truthy-return suppression trick, which an
// FC upgrade could break.
test("month +N more opens the custom popover without navigating away", async ({ page }) => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const dense = "2026-09-15";
  const id = (
    await (
      await ctx.post("/api/trips", {
        data: { name: "Dense Month", startDate: dense, endDate: "2026-09-16" },
      })
    ).json()
  ).id;
  for (let i = 0; i < 7; i++) {
    await ctx.post(`/api/trips/${id}/items`, {
      data: {
        title: `Event ${i + 1}`,
        category: "activity",
        date: dense,
        sortOrder: i,
        startTime: `${String(8 + i).padStart(2, "0")}:00`,
        durationMinutes: 60,
      },
    });
  }
  await ctx.dispose();

  await page.goto(`/trips/${id}`);
  await page.getByRole("button", { name: /Calendar/ }).click();
  await expect(page.locator(".fc")).toBeVisible();
  await page.getByRole("button", { name: "month", exact: true }).click();
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();

  await page.locator(".fc-more-link").first().click();

  // Our popover opens; FC's native popover never renders; all 7 events listed.
  const pop = page.locator(".wp-morepop");
  await expect(pop).toBeVisible();
  await expect(page.locator(".fc-popover")).toHaveCount(0);
  await expect(pop.locator(".wp-morepop-row")).toHaveCount(7);
  // No navigate-away: still in Month.
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();

  // Clicking a row closes the popover (and selects the item).
  await pop.locator(".wp-morepop-row").first().click();
  await expect(pop).toHaveCount(0);

  const cleanup = await pwRequest.newContext({ baseURL: BASE });
  await cleanup.delete(`/api/trips/${id}`).catch(() => {});
  await cleanup.dispose();
});

// Month-view trip-day color band must land on the SAME cell as the trip date.
// Regression for the FC marker-date shift: `arg.date` must be read with UTC
// getters (fcDayStr), not local — local getters put every band one day late on
// a machine west of UTC. FC day cells carry data-date, so we assert the banded
// cells equal exactly the trip days.
test("month day band lands on the correct cell", async ({ page }) => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const days = ["2026-09-15", "2026-09-16", "2026-09-17"];
  const id = (
    await (
      await ctx.post("/api/trips", {
        data: { name: "Band Day", startDate: days[0], endDate: days[2] },
      })
    ).json()
  ).id;
  for (const d of days) {
    await ctx.post(`/api/trips/${id}/items`, {
      data: { title: `Item ${d}`, category: "activity", date: d, sortOrder: 0 },
    });
  }
  await ctx.dispose();

  await page.goto(`/trips/${id}`);
  await page.getByRole("button", { name: /Calendar/ }).click();
  await expect(page.locator(".fc")).toBeVisible();
  await page.getByRole("button", { name: "month", exact: true }).click();
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();

  const banded = await page
    .locator(".fc-daygrid-day.wp-has-band")
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-date")).sort()
    );
  expect(banded).toEqual(days);

  const cleanup = await pwRequest.newContext({ baseURL: BASE });
  await cleanup.delete(`/api/trips/${id}`).catch(() => {});
  await cleanup.dispose();
});

// Date-click navigation: (a) clicking a date (day number in month, day-of-week
// header in week) → Day view via navLinks; (b) clicking the EMPTY area of a
// month day cell → that Week. Uses the shared trip (events on Sep 1).
test("clicking a date drills into Day; empty month cell opens the Week", async ({ page }) => {
  // Week view: clicking a day-column header date → Day view.
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: /Calendar/ }).click();
  await expect(page.locator(".fc-timeGridWeek-view")).toBeVisible();
  await page.locator(".fc-col-header-cell-cushion").first().click();
  await expect(page.locator(".fc-timeGridDay-view")).toBeVisible();

  // Month view: clicking a day NUMBER → Day view.
  await page.getByRole("button", { name: "month", exact: true }).click();
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();
  await page
    .locator('.fc-daygrid-day[data-date="2026-09-01"] .fc-daygrid-day-number')
    .click();
  await expect(page.locator(".fc-timeGridDay-view")).toBeVisible();

  // Month view: clicking the EMPTY area of a day cell (no events) → Week view.
  await page.getByRole("button", { name: "month", exact: true }).click();
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();
  await page
    .locator('.fc-daygrid-day[data-date="2026-09-22"] .fc-daygrid-day-frame')
    .click({ position: { x: 30, y: 60 } });
  await expect(page.locator(".fc-timeGridWeek-view")).toBeVisible();
});
