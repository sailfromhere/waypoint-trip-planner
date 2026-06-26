import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Phase 3 regression smoke tests.
 *
 * These are written to FAIL against the buggy Phase 3 code and pass once the
 * fixes land — they encode the three user-reported breakages:
 *   1. text cells can't be edited (remount-on-select kills edit mode)
 *   2. map markers vanish on reload (StrictMode teardown leaves stale markers)
 *   3. drive items have no split origin/destination Location inputs
 *
 * Seeds a self-contained trip via the real API (coords pre-set so markers
 * render without hitting Nominatim), then cleans it up.
 */

const BASE = "http://localhost:3000";
let tripId: string;

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });

  const tripRes = await ctx.post("/api/trips", {
    data: { name: "E2E Smoke Trip", startDate: "2026-07-01", endDate: "2026-07-02" },
  });
  expect(tripRes.ok()).toBeTruthy();
  tripId = (await tripRes.json()).id;

  const items = [
    {
      title: "Old Faithful",
      category: "activity",
      date: "2026-07-01",
      sortOrder: 0,
      destinationName: "Old Faithful, WY",
      destinationLat: 44.4605,
      destinationLng: -110.8281,
    },
    {
      title: "Hotel Stay",
      category: "lodging",
      date: "2026-07-01",
      sortOrder: 1,
      destinationName: "West Yellowstone, MT",
      destinationLat: 44.6621,
      destinationLng: -111.1041,
    },
    {
      title: "Drive to Bozeman",
      category: "drive",
      date: "2026-07-02",
      sortOrder: 0,
      originName: "West Yellowstone, MT",
      originLat: 44.6621,
      originLng: -111.1041,
      destinationName: "Bozeman, MT",
      destinationLat: 45.6796,
      destinationLng: -111.0386,
    },
  ];
  for (const item of items) {
    const r = await ctx.post(`/api/trips/${tripId}/items`, { data: item });
    expect(r.ok()).toBeTruthy();
  }
  await ctx.dispose();
});

test.afterAll(async () => {
  if (!tripId) return;
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  await ctx.dispose();
});

test("text cells are editable and the edit persists", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);

  const row = page.locator("tr", { hasText: "Old Faithful" }).first();
  await expect(row).toBeVisible();

  // Click the title text to enter edit mode.
  await row.getByText("Old Faithful", { exact: true }).click();

  // BUG 2: clicking the cell bubbles to the row's onClick → selection →
  // parent re-render → unstable columns remount the cell → edit mode dies and
  // this input is detached before it can be filled.
  // Title/notes now edit as a <textarea> (multi-line, S7-C3); blur commits
  // (plain Enter inserts a newline in a textarea).
  const input = row.locator("textarea").first();
  await expect(input).toBeVisible();
  await input.fill("Old Faithful EDITED");

  // Wait for the write to COMMIT (the PATCH response) before reloading — the
  // optimistic update makes the assertion below pass immediately, but a bare
  // reload would abort the in-flight request and the edit would be lost.
  const commit = page.waitForResponse(
    (r) => /\/items\//.test(r.url()) && r.request().method() === "PATCH"
  );
  await input.blur();
  await commit;

  await expect(row).toContainText("Old Faithful EDITED");

  // Survives a reload (persisted to DB).
  await page.reload();
  await expect(
    page.locator("tr", { hasText: "Old Faithful EDITED" })
  ).toBeVisible();
});

test("typing a space in a cell keeps editing (no dnd-kit row drag)", async ({
  page,
}) => {
  await page.goto(`/trips/${tripId}`);

  await page
    .locator("tr", { hasText: "Hotel Stay" })
    .first()
    .getByText("Hotel Stay", { exact: true })
    .click();

  // The title editor (stable placeholder) — NOT scoped by the row's title text,
  // which we're about to clear (re-resolving a `hasText:"Hotel Stay"` row would
  // then fail), and not the panel textareas elsewhere on the page.
  const input = page.getByPlaceholder("Untitled");
  await expect(input).toBeVisible();
  await input.fill("");
  // Real keystrokes (not fill()) so the Space keydown actually fires. The row is
  // a dnd-kit draggable whose KeyboardSensor starts a drag on Space — if the
  // editor doesn't stop keydown propagation, the space lifts the row and the
  // remaining characters never land, so the value loses its spaces.
  await input.pressSequentially("Hotel by the Lake");
  await expect(input).toHaveValue("Hotel by the Lake");
});

test("start time saves and displays as 24h HH:MM (no seconds)", async ({
  page,
}) => {
  await page.goto(`/trips/${tripId}`);

  const row = page.locator("tr", { hasText: "Hotel Stay" }).first();
  await expect(row).toBeVisible();

  // Start is the 3rd cell (actions ✕, title+category, start, …). Click the
  // cell's TOP edge — NOT the centered value — to prove the whole tall cell is a
  // click target (regression: after the row-height bump the value became a thin
  // vertically-centered strip, so clicks elsewhere in the cell missed it and
  // start time "couldn't be entered").
  const startCell = row.locator("td").nth(2);
  await startCell.click({ position: { x: 8, y: 5 } });

  // S7-4: the time input must accept the value and not blank out. A native
  // <input type="time"> rejects a seconds-bearing value, so this fails against
  // the old code that fed it the raw "HH:MM:SS".
  const timeInput = row.locator('input[type="time"]');
  await expect(timeInput).toBeVisible();
  await timeInput.fill("14:30");
  await timeInput.blur();

  // Read view shows exactly 24h "14:30" (no ":00" seconds tail).
  await expect(startCell).toHaveText("14:30");

  // Persists across reload.
  await page.reload();
  const startCell2 = page
    .locator("tr", { hasText: "Hotel Stay" })
    .first()
    .locator("td")
    .nth(2);
  await expect(startCell2).toHaveText("14:30");
});

test("map markers are present after a reload", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible();

  await page.reload();
  await expect(page.locator(".maplibregl-map")).toBeVisible();
  await expect(page.locator(".maplibregl-marker").first()).toBeVisible({ timeout: 15000 });

  // BUG 1: under StrictMode the map is torn down and rebuilt, but markersRef
  // still points at the dead map, so nothing is re-added → 0 markers.
  // Drives render as lines (no markers), so the seed yields 2 destination
  // markers — but they're ~30km apart and cluster at the default fit zoom, so
  // zoom in to split the cluster before asserting both point markers exist.
  await page.evaluate(() => {
    const m = (
      window as unknown as {
        __waypointMap?: { setCenter(c: [number, number]): void; setZoom(z: number): void };
      }
    ).__waypointMap;
    m?.setCenter([-110.95, 44.56]);
    m?.setZoom(9);
  });
  await expect(page.locator(".maplibregl-marker .waypoint-icon")).toHaveCount(2);
});

test("drive items show separate origin and destination Location inputs", async ({
  page,
}) => {
  await page.goto(`/trips/${tripId}`);

  const row = page.locator("tr", { hasText: "Drive to Bozeman" }).first();
  await expect(row).toBeVisible();

  // BUG 2b: a drive's Location cell should expose two distinct inputs.
  await expect(row.getByTestId("drive-origin")).toBeVisible();
  await expect(row.getByTestId("drive-dest")).toBeVisible();
});
