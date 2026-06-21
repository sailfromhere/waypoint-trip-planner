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
  const input = row.locator('input[type="text"]').first();
  await expect(input).toBeVisible();
  await input.fill("Old Faithful EDITED");
  await input.press("Enter");

  await expect(row).toContainText("Old Faithful EDITED");

  // Survives a reload (persisted to DB).
  await page.reload();
  await expect(
    page.locator("tr", { hasText: "Old Faithful EDITED" })
  ).toBeVisible();
});

test("map markers are present after a reload", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible();

  await page.reload();
  await expect(page.locator(".maplibregl-map")).toBeVisible();

  // BUG 1: under StrictMode the map is torn down and rebuilt, but markersRef
  // still points at the dead map, so nothing is re-added → 0 markers.
  // Drives render as lines (no markers), so the seed yields 2 markers:
  // the activity destination and the lodging destination.
  await expect(page.locator(".maplibregl-marker")).toHaveCount(2);
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
