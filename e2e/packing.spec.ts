import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Phase 5 packing smoke tests.
 *
 *  1. instantiate mechanism: a template item + an always-include item are both
 *     copied into a trip from one template selection, and re-instantiating is
 *     idempotent (adds nothing).
 *  2. UI: the Packing tab renders seeded items, and toggling one "packed"
 *     persists across a reload (moves into the Packed section).
 *
 * Templates + master items are user-level (not trip-scoped), so they're cleaned
 * up explicitly in afterAll — deleting the trip only cascades its instances.
 */

const BASE = "http://localhost:3000";
let tripId: string;
let templateId: string;
let tentId: string;
let passportId: string;

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });

  const tripRes = await ctx.post("/api/trips", {
    data: { name: "E2E Packing Trip" },
  });
  expect(tripRes.ok()).toBeTruthy();
  tripId = (await tripRes.json()).id;

  // A template with one member item...
  const tplRes = await ctx.post("/api/packing-templates", {
    data: { name: "E2E Backpacking" },
  });
  expect(tplRes.ok()).toBeTruthy();
  templateId = (await tplRes.json()).id;

  const tentRes = await ctx.post("/api/packing-items", {
    data: {
      name: "E2E Tent",
      category: "Camping",
      requiredness: "required",
      shared: true,
      templateIds: [templateId],
    },
  });
  expect(tentRes.ok()).toBeTruthy();
  tentId = (await tentRes.json()).id;

  // ...and an always-include item that should come in regardless of template.
  const passportRes = await ctx.post("/api/packing-items", {
    data: { name: "E2E Passport", category: "Documents", alwaysInclude: true },
  });
  expect(passportRes.ok()).toBeTruthy();
  passportId = (await passportRes.json()).id;

  await ctx.dispose();
});

test.afterAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  if (tripId) await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  if (tentId) await ctx.delete(`/api/packing-items/${tentId}`).catch(() => {});
  if (passportId)
    await ctx.delete(`/api/packing-items/${passportId}`).catch(() => {});
  if (templateId)
    await ctx.delete(`/api/packing-templates/${templateId}`).catch(() => {});
  await ctx.dispose();
});

test("instantiate copies template + always-include items, idempotently", async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });

  const first = await ctx.post(`/api/trips/${tripId}/packing/instantiate`, {
    data: { templateIds: [templateId] },
  });
  expect(first.ok()).toBeTruthy();
  // Tent (template) + Passport (always-include) at minimum.
  expect((await first.json()).created).toBeGreaterThanOrEqual(2);

  const list = await (await ctx.get(`/api/trips/${tripId}/packing`)).json();
  const names = list.map((i: { name: string }) => i.name);
  expect(names).toContain("E2E Tent");
  expect(names).toContain("E2E Passport");

  // Re-instantiating the same selection adds nothing.
  const second = await ctx.post(`/api/trips/${tripId}/packing/instantiate`, {
    data: { templateIds: [templateId] },
  });
  expect((await second.json()).created).toBe(0);

  await ctx.dispose();
});

test("Packing tab renders items and packed-state persists across reload", async ({
  page,
}) => {
  await page.goto(`/trips/${tripId}`);

  // The panel is on the "Packing" tab (not the default tab).
  await page.getByRole("button", { name: /Packing/ }).click();

  const tentRow = page.locator("div.group", { hasText: "E2E Tent" }).first();
  await expect(tentRow).toBeVisible();

  // Toggle it packed (the checkbox is visually hidden behind the custom circle).
  // Use click (not check) — the input is React-controlled, so its DOM `checked`
  // updates asynchronously; we verify the effect via the "Packed" section below.
  // Wait for the PATCH to commit before reloading, else navigation aborts the
  // in-flight write (the optimistic UI updates synchronously, so a bare reload
  // races the persistence).
  const patchDone = page.waitForResponse(
    (r) =>
      /\/packing\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH"
  );
  await tentRow.locator('input[type="checkbox"]').click({ force: true });
  await patchDone;

  // It moves under the "Packed" section.
  await expect(page.getByText(/^Packed \(/)).toBeVisible();

  // Survives a reload (persisted to DB).
  await page.reload();
  await page.getByRole("button", { name: /Packing/ }).click();
  await expect(page.getByText(/^Packed \(/)).toBeVisible();
  await expect(
    page.locator("div.group", { hasText: "E2E Tent" }).first()
  ).toBeVisible();
});
