import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Column customization: hide a column via the Columns menu, confirm it
 * disappears from every day-table, and that the preference survives a reload
 * (persisted to localStorage).
 */

const BASE = "http://localhost:3000";
let tripId: string;

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const tripRes = await ctx.post("/api/trips", {
    data: { name: "E2E Columns", startDate: "2026-07-01", endDate: "2026-07-02" },
  });
  tripId = (await tripRes.json()).id;
  await ctx.post(`/api/trips/${tripId}/items`, {
    data: { title: "Alpha", category: "activity", date: "2026-07-01", sortOrder: 0, costCents: 1234 },
  });
  await ctx.dispose();
});

test.afterAll(async () => {
  if (!tripId) return;
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  await ctx.dispose();
});

test("hide a column persists across reload", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);

  // Cost column header is present initially.
  await expect(page.locator("th", { hasText: "Cost" })).toBeVisible();

  // Open the Columns menu and uncheck "Cost".
  await page.getByRole("button", { name: /Columns/ }).click();
  const costRow = page.locator("label", { hasText: "Cost" });
  await costRow.getByRole("checkbox").uncheck();

  // Close the menu and assert the Cost column is gone.
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await expect(page.locator("th", { hasText: "Cost" })).toHaveCount(0);

  // Survives reload.
  await page.reload();
  await expect(page.locator("tr", { hasText: "Alpha" }).first()).toBeVisible();
  await expect(page.locator("th", { hasText: "Cost" })).toHaveCount(0);
  // The menu button shows the hidden count.
  await expect(page.getByRole("button", { name: /Columns · 1 hidden/ })).toBeVisible();
});

test("resizing a column persists across reload", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  await page.waitForLoadState("networkidle");

  // Resize the Category column (left side, always visible — Status sits past the
  // pane's horizontal-scroll edge).
  const th = page.locator("th", { hasText: "Category" }).first();
  const before = (await th.boundingBox())!.width;
  // Title is the sibling we assert must NOT shrink: resizing should GROW the table
  // (push columns right + scroll), never squeeze the others to a fixed width — the
  // explicit pixel table width is what guarantees this cross-engine.
  const titleTh = page.locator("th", { hasText: "Title" }).first();
  const titleBefore = (await titleTh.boundingBox())!.width;

  const handle = th.locator('[title*="resize"]');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 90, hb.y + hb.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => (await th.boundingBox())!.width)
    .toBeGreaterThan(before + 40);
  // The sibling column kept its width (grow-and-scroll, not proportional squeeze).
  expect((await titleTh.boundingBox())!.width).toBeGreaterThan(titleBefore - 5);

  // Wait for the debounced persist, then confirm it survives a reload.
  await page.waitForTimeout(350);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const after = (await page.locator("th", { hasText: "Category" }).first().boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 40);
});
