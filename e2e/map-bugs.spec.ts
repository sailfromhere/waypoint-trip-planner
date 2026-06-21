import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Session-4 map bug fixes (written to fail on the pre-fix code):
 *   #5 drive routes vanish after hide/show (style-load race on remount)
 *   #4 "Fit" lives with the map zoom controls, not the filter pills
 *   #6 clicking empty map deselects the table row
 *
 * Drive routes are canvas-drawn (no DOM), so #5 is asserted via the map
 * instance exposed at window.__waypointMap.
 */

const BASE = "http://localhost:3000";
let tripId: string;

type MapHandle = { getStyle(): { layers: { id: string }[] } };

async function driveLayerCount(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const m = (window as unknown as { __waypointMap?: MapHandle }).__waypointMap;
    if (!m) return -1;
    return m.getStyle().layers.filter((l) => l.id.startsWith("drive-")).length;
  });
}

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const tripRes = await ctx.post("/api/trips", {
    data: { name: "Map Bugs Trip", startDate: "2026-09-01", endDate: "2026-09-02" },
  });
  tripId = (await tripRes.json()).id;

  const items = [
    {
      title: "Old Faithful",
      category: "activity",
      date: "2026-09-01",
      sortOrder: 0,
      destinationName: "Old Faithful, WY",
      destinationLat: 44.4605,
      destinationLng: -110.8281,
    },
    {
      title: "West Yellowstone Hotel",
      category: "lodging",
      date: "2026-09-01",
      sortOrder: 1,
      destinationName: "West Yellowstone, MT",
      destinationLat: 44.6621,
      destinationLng: -111.1041,
    },
    {
      title: "Drive to Bozeman",
      category: "drive",
      date: "2026-09-02",
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

test("[#5] drive routes survive hide/show of the map", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible();
  // Generous: the drive layer depends on /routes, which calls the public OSRM
  // demo and can be slow under full-suite load.
  await expect.poll(() => driveLayerCount(page), { timeout: 25000 }).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Hide map" }).click();
  await expect(page.locator(".maplibregl-map")).toHaveCount(0);

  await page.getByRole("button", { name: "Show map" }).click();
  await expect(page.locator(".maplibregl-map")).toBeVisible();

  // The bug: on remount the routes never redraw → count stays 0.
  // Generous: the drive layer depends on /routes, which calls the public OSRM
  // demo and can be slow under full-suite load.
  await expect.poll(() => driveLayerCount(page), { timeout: 25000 }).toBeGreaterThan(0);
});

test("[#4] Fit button sits with the map zoom controls", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible();
  await expect(
    page.locator(".maplibregl-ctrl-group button[title='Fit all to view']")
  ).toBeVisible();
});

test("[#6] clicking empty map deselects the table row", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator(".maplibregl-marker").first()).toBeVisible();

  await page.locator(".maplibregl-marker").first().click();
  await expect(page.locator("tr.bg-blue-50")).toHaveCount(1);

  // Click an empty corner of the map canvas (markers/legend are elsewhere).
  await page.locator(".maplibregl-canvas").click({ position: { x: 8, y: 8 } });
  await expect(page.locator("tr.bg-blue-50")).toHaveCount(0);
});
