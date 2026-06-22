import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * S7-9 type-ahead location picker + S7-5 auto-geocode fallback.
 *
 * The dropdown is driven by /geocode/suggest → /geocode/retrieve. We STUB both
 * endpoints (page.route) so the test is deterministic regardless of which
 * geocoding provider the dev server is bound to (real Mapbox is non-hermetic).
 *
 * Seeds a self-contained activity item (no coords) so we can prove a pick fills
 * exact coordinates, and a plain-text edit triggers the fallback geocode.
 */

const BASE = "http://localhost:3000";
let tripId: string;
let itemId: string;

test.beforeEach(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const tripRes = await ctx.post("/api/trips", {
    data: { name: "E2E Location Picker", startDate: "2026-08-01", endDate: "2026-08-02" },
  });
  tripId = (await tripRes.json()).id;
  const itemRes = await ctx.post(`/api/trips/${tripId}/items`, {
    data: { title: "Visit", category: "activity", date: "2026-08-01", sortOrder: 0 },
  });
  itemId = (await itemRes.json()).id;
  await ctx.dispose();
});

test.afterEach(async () => {
  if (!tripId) return;
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  await ctx.dispose();
});

async function stubGeocode(page: import("@playwright/test").Page) {
  await page.route("**/geocode/suggest**", (route) =>
    route.fulfill({
      json: {
        suggestions: [
          { id: "test:ofi", name: "Old Faithful Inn", context: "Yellowstone NP, WY" },
          { id: "test:ofg", name: "Old Faithful Geyser", context: "Yellowstone NP, WY" },
        ],
      },
    })
  );
  await page.route("**/geocode/retrieve**", (route) =>
    route.fulfill({
      json: { lat: 44.4598, lng: -110.8307, displayName: "Old Faithful Inn" },
    })
  );
}

test("picking a suggestion stores the name + exact coordinates", async ({ page }) => {
  await stubGeocode(page);
  await page.goto(`/trips/${tripId}`);

  const row = page.locator("tr", { hasText: "Visit" }).first();
  await expect(row).toBeVisible();

  // Location is the 5th column (title, category, start, duration, location, …).
  const locationCell = row.locator("td").nth(4);
  await locationCell.getByText("—").click();

  const input = locationCell.locator("textarea");
  await input.fill("Old Faithful");

  // Dropdown (portaled to body) shows the stubbed candidates.
  const option = page.getByText("Old Faithful Inn", { exact: true });
  await expect(option).toBeVisible();
  await option.click();

  // Read view shows the picked name.
  await expect(locationCell).toContainText("Old Faithful Inn");

  // Coordinates were retrieved and persisted (exact, not fuzzy).
  await expect
    .poll(async () => {
      const ctx = await pwRequest.newContext({ baseURL: BASE });
      const items = await (await ctx.get(`/api/trips/${tripId}/items`)).json();
      await ctx.dispose();
      const it = items.find((i: { id: string }) => i.id === itemId);
      return it?.destinationLat;
    })
    .toBeCloseTo(44.4598, 2);
});

test("typing plain text (no pick) triggers the fallback geocode", async ({ page }) => {
  await stubGeocode(page);
  await page.goto(`/trips/${tripId}`);

  // Count fallback re-geocode calls (POST to the trip geocode endpoint).
  let geocodeCalls = 0;
  await page.route("**/geocode", (route) => {
    if (route.request().method() === "POST") geocodeCalls++;
    return route.fulfill({ json: { geocoded: 0, results: [] } });
  });

  const row = page.locator("tr", { hasText: "Visit" }).first();
  const locationCell = row.locator("td").nth(4);
  await locationCell.getByText("—").click();

  const input = locationCell.locator("textarea");
  await input.fill("Some Custom Place");
  await input.blur();

  // Name persists as typed text.
  await expect(locationCell).toContainText("Some Custom Place");

  // The debounced fallback geocode (S7-5, ~700ms) fires for this item.
  await expect.poll(() => geocodeCalls, { timeout: 4000 }).toBeGreaterThan(0);
});
