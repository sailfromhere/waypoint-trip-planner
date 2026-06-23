import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Regression: "editing a freshly-created item interrupts the next interaction."
 *
 * Two root causes, both reproduced here via OBSERVABLE proxies (a native
 * <select>'s open popup isn't visible to headless Playwright, but the mechanisms
 * behind its dismissal are):
 *
 *  1. RC1 — every item PATCH used to invalidate the whole `items` query, so a
 *     refetch re-rendered the entire table a beat after the edit, dismissing a
 *     just-opened Category <select>. Proxy: a non-routing field edit must NOT
 *     trigger a GET of the items list.
 *
 *  2. RC2 — an optimistic create showed a `temp-…` id that `onSuccess` swapped
 *     for the real server id; rows keyed by that id REMOUNTED on the swap,
 *     destroying an in-progress edit. Proxy: type into a new row's title while
 *     the create POST is still in flight, then let it resolve — the editor and
 *     its text must survive.
 */

const BASE = "http://localhost:3000";
let tripId: string;
let itemId: string;

test.beforeEach(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const tripRes = await ctx.post("/api/trips", {
    data: { name: "E2E Edit Interruption", startDate: "2026-08-01", endDate: "2026-08-02" },
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

test("a non-routing field edit does not refetch the items list (RC1)", async ({ page }) => {
  // Count GETs of the items LIST (the `/items` collection, not `/items/:id`).
  let listGets = 0;
  await page.route("**/api/trips/*/items", async (route) => {
    if (route.request().method() === "GET") listGets++;
    await route.continue();
  });

  await page.goto(`/trips/${tripId}`);
  const row = page.locator("tr", { hasText: "Visit" }).first();
  await expect(row).toBeVisible();

  // Let the initial load settle, then snapshot the count.
  await page.waitForTimeout(500);
  const before = listGets;

  // Edit the title — a non-routing field (cells: actions 0, title 1, …).
  const titleCell = row.locator("td").nth(1);
  await titleCell.click();
  const editor = titleCell.locator("textarea");
  await editor.fill("Visit the geyser");
  await editor.blur();

  // Wait for the PATCH to persist, then settle.
  await page.waitForResponse(
    (r) => /\/items\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH"
  );
  await page.waitForTimeout(500);

  // The optimistic write is authoritative; no items-list refetch should fire.
  expect(listGets).toBe(before);
});

test("editing a freshly added row survives the create resolving (RC2)", async ({ page }) => {
  // Delay the create POST so we can edit the row during the temp-id window.
  await page.route("**/api/trips/*/items", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });

  await page.goto(`/trips/${tripId}`);
  await expect(page.locator("tr", { hasText: "Visit" }).first()).toBeVisible();

  // Add a new item — appears optimistically with a temp id. Wait for the
  // optimistic row to render before touching it (else, under load, `.last()`
  // resolves to the seeded row and the click opens the wrong editor).
  await page.getByRole("button", { name: "+ Add item" }).first().click();
  await expect(page.locator("tbody tr")).toHaveCount(2);

  // The new (last) row's title cell → open the editor and type.
  const newRow = page.locator("tbody tr").last();
  const titleCell = newRow.locator("td").nth(1);
  await titleCell.click();
  const titleEditor = titleCell.locator("textarea");
  await titleEditor.fill("My New Activity");

  // Let the create POST resolve → temp id is swapped for the real server id.
  await page.waitForResponse(
    (r) =>
      r.url().endsWith("/items") &&
      r.request().method() === "POST" &&
      r.request().url().includes(tripId)
  );
  await page.waitForTimeout(300);

  // No remount: the editor is still open, focused, and holds the typed text.
  await expect(titleEditor).toBeFocused();
  await expect(titleEditor).toHaveValue("My New Activity");
});

test("an items refetch (text-commit geocode) doesn't remount a session-created row mid-edit (RC2 edge)", async ({ page }) => {
  // Deterministic geocode: empty suggestions (no dropdown), and the debounced
  // re-geocode POST returns a body that still invalidates the items list.
  await page.route("**/geocode/suggest**", (route) =>
    route.fulfill({ json: { suggestions: [] } })
  );
  await page.route("**/geocode", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { geocoded: 0, results: [] } })
      : route.continue()
  );

  await page.goto(`/trips/${tripId}`);
  await expect(page.locator("tr", { hasText: "Visit" }).first()).toBeVisible();

  // Add a row via the UI so it carries a session `_key` through the temp→real
  // id swap; wait for the create to resolve so the row holds its real id.
  await page.getByRole("button", { name: "+ Add item" }).first().click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.waitForResponse(
    (r) =>
      r.url().endsWith("/items") &&
      r.request().method() === "POST" &&
      r.request().url().includes(tripId)
  );

  const newRow = page.locator("tbody tr").last();

  // Commit a free-text location (no pick) → starts the ~700ms re-geocode timer.
  const locationCell = newRow.locator("td").nth(5);
  await locationCell.click();
  const locInput = locationCell.locator("textarea");
  await locInput.fill("Somewhere Custom");
  await locInput.blur();

  // Immediately start editing the Title and type — the geocode (and its items
  // refetch) will land WHILE this editor is open.
  const titleCell = newRow.locator("td").nth(1);
  await titleCell.click();
  const titleEditor = titleCell.locator("textarea");
  await titleEditor.fill("Keep Me");

  // The debounced geocode POST fires → its onSuccess invalidates items → refetch.
  await page.waitForResponse(
    (r) => r.url().endsWith("/geocode") && r.request().method() === "POST"
  );
  await page.waitForTimeout(600); // let the items GET land + re-render

  // `_key` survived the refetch → no remount → the Title edit is intact.
  await expect(titleEditor).toBeFocused();
  await expect(titleEditor).toHaveValue("Keep Me");
});

test("the Category select is uncontrolled but still reflects an external change (key remount)", async ({ page }) => {
  // Drive a deterministic in-app items refetch via the text-commit geocode.
  await page.route("**/geocode/suggest**", (route) =>
    route.fulfill({ json: { suggestions: [] } })
  );
  await page.route("**/geocode", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { geocoded: 0, results: [] } })
      : route.continue()
  );

  await page.goto(`/trips/${tripId}`);
  const row = page.locator("tr", { hasText: "Visit" }).first();
  const select = row.locator("td").nth(2).locator("select");
  await expect(select).toHaveValue("activity");

  // A user pick via the select still round-trips (onChange fires on the
  // uncontrolled control) and the rendered value follows.
  await select.selectOption("meal");
  await expect(select).toHaveValue("meal");
  await page.waitForResponse(
    (r) => /\/items\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH"
  );

  // Change the category OUT OF BAND on the server, then force an in-app refetch
  // (debounced geocode). With `defaultValue` alone the select would stay stale;
  // the `key` remounts it to the new value.
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.patch(`/api/trips/${tripId}/items/${itemId}`, { data: { category: "lodging" } });
  await ctx.dispose();

  const locCell = row.locator("td").nth(5);
  await locCell.click();
  const locInput = locCell.locator("textarea");
  await locInput.fill("Anywhere");
  await locInput.blur();
  await page.waitForResponse(
    (r) => r.url().endsWith("/geocode") && r.request().method() === "POST"
  );

  await expect(select).toHaveValue("lodging");
});

test("picking a location keeps focus in the Category cell (map popup must not steal it)", async ({ page }) => {
  await page.route("**/geocode/suggest**", (route) =>
    route.fulfill({
      json: { suggestions: [{ id: "x:1", name: "Old Faithful Inn", context: "WY" }] },
    })
  );
  await page.route("**/geocode/retrieve**", (route) =>
    route.fulfill({ json: { lat: 44.46, lng: -110.83, displayName: "Old Faithful Inn" } })
  );

  await page.goto(`/trips/${tripId}`);
  await expect(page.locator("tr", { hasText: "Visit" }).first()).toBeVisible();

  // Add a row, then pick a location on it — this selects the row AND gives it
  // coords, so the map opens a popup anchored to it.
  await page.getByRole("button", { name: "+ Add item" }).first().click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.waitForResponse((r) => r.url().endsWith("/items") && r.request().method() === "POST");

  const newRow = page.locator("tbody tr").last();
  await newRow.locator("td").nth(5).click();
  await newRow.locator("td").nth(5).locator("textarea").fill("Old Faithful");
  await page.getByText("Old Faithful Inn", { exact: true }).click();

  // Focus the Category select (as the user does next), then let the map settle.
  const select = newRow.locator("td").nth(2).locator("select");
  await select.focus();
  await page.waitForResponse((r) => r.url().endsWith("/routes")).catch(() => {});

  // The popup opened (scenario reproduced) but `focusAfterOpen:false` means it
  // did NOT pull focus out of the Category cell.
  await expect(page.locator(".maplibregl-popup")).toBeVisible();
  await expect(select).toBeFocused();
});
