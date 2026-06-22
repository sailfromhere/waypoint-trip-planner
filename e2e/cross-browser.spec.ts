import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Cross-browser regression guard. Runs in BOTH chromium and webkit (see
 * playwright.config.ts) because native form controls diverge across engines —
 * a controlled <input type="time"> is wiped mid-entry by Safari/WebKit, so the
 * editable cells use UNCONTROLLED inputs + read the DOM value at commit. This
 * test failed in webkit before that fix (start time "went away" on commit).
 *
 * NOTE: Playwright's keyboard.type does NOT populate WebKit's native time
 * segments, so we use locator.fill() (reliable cross-engine) to set the value,
 * then exercise the commit + persistence path that actually broke.
 */

const BASE = "http://localhost:3000";
let tripId: string;

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const trip = await (
    await ctx.post("/api/trips", {
      data: { name: "Cross-browser cell", startDate: "2026-10-01", endDate: "2026-10-02" },
    })
  ).json();
  tripId = trip.id;
  await ctx.post(`/api/trips/${tripId}/items`, {
    data: { title: "Tour", category: "activity", date: "2026-10-01", sortOrder: 0 },
  });
  await ctx.dispose();
});

test.afterAll(async () => {
  if (!tripId) return;
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  await ctx.dispose();
});

test("start time entry commits and persists (uncontrolled time input)", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  const row = page.locator("tr", { hasText: "Tour" }).first();
  await expect(row).toBeVisible();

  // Cells: actions ✕, title, category, start, … → Start is nth(3).
  const startCell = row.locator("td").nth(3);
  await startCell.getByText("—").click();
  const timeInput = row.locator('input[type="time"]');
  await expect(timeInput).toBeVisible();

  await timeInput.fill("14:30");
  // Commit via Enter (blur path is covered by the chromium smoke test). Wait for
  // the PATCH to COMMIT before reloading — otherwise reload aborts the in-flight
  // optimistic write and the post-reload assertion races (the classic
  // optimistic-persistence flake).
  const patched = page.waitForResponse(
    (r) => r.url().includes("/items/") && r.request().method() === "PATCH" && r.ok()
  );
  await page.keyboard.press("Enter");
  await patched;

  // The value must survive commit (it "went away" in WebKit before the fix)…
  await expect(startCell).toHaveText("14:30");
  // …and a reload (persisted to the DB).
  await page.reload();
  await expect(
    page.locator("tr", { hasText: "Tour" }).first().locator("td").nth(3)
  ).toHaveText("14:30");
});
