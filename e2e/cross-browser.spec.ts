import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Cross-browser regression guard. Runs in BOTH chromium and webkit (see
 * playwright.config.ts) because native form controls diverge across engines.
 *
 * The Start cell no longer uses a native <input type="time"> — Safari rendered
 * an empty one as a misleading "12:30 PM" (12h, looks filled but empty) and its
 * 12h/24h format follows the OS locale. It's now a custom UNCONTROLLED text
 * field (placeholder "HH:MM", 24h on every engine) that reads the DOM value at
 * commit and accepts lenient input ("930" → "09:30"). This guards both the
 * lenient parse and the commit→persist path that historically broke in WebKit.
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

test("start time entry commits and persists (custom 24h text input)", async ({ page }) => {
  await page.goto(`/trips/${tripId}`);
  const row = page.locator("tr", { hasText: "Tour" }).first();
  await expect(row).toBeVisible();

  // Cells: actions ✕ (0), title+category (1), Start (2), … — title & category
  // are one merged cell, so Start is nth(2).
  const startCell = row.locator("td").nth(2);
  await startCell.getByText("—").click();
  // The editor is now a text field with a clear "HH:MM" empty-state hint.
  const timeInput = row.getByPlaceholder("HH:MM");
  await expect(timeInput).toBeVisible();

  // Lenient input: bare "930" must normalize to 24h "09:30".
  await timeInput.fill("930");
  // Commit via Enter (blur path is covered by the chromium smoke test). Wait for
  // the PATCH to COMMIT before reloading — otherwise reload aborts the in-flight
  // optimistic write and the post-reload assertion races (the classic
  // optimistic-persistence flake).
  const patched = page.waitForResponse(
    (r) => r.url().includes("/items/") && r.request().method() === "PATCH" && r.ok()
  );
  await page.keyboard.press("Enter");
  await patched;

  // The normalized value must survive commit (it "went away" in WebKit before
  // the original uncontrolled fix)…
  await expect(startCell).toHaveText("09:30");
  // …and a reload (persisted to the DB).
  await page.reload();
  await expect(
    page.locator("tr", { hasText: "Tour" }).first().locator("td").nth(2)
  ).toHaveText("09:30");
});
