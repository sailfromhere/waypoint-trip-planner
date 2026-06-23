import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Marker hover shows a title pill ABOVE the dot — and, critically, does NOT also
 * highlight the drive route under it (markers sit on drive endpoints, and their
 * mousemove bubbles to the canvas → without the `originalEvent.target` guard the
 * route handler would fire too). The marker is seeded AT the drive's destination
 * to reproduce that exact conflict.
 */

const BASE = "http://localhost:3000";
let tripId: string;
let markerId: string;

type MapHandle = {
  getStyle(): { layers: { id: string }[] } | null;
  project(lngLat: [number, number]): { x: number; y: number };
};

const A: [number, number] = [-111.1, 44.66];
const B: [number, number] = [-111.05, 44.72]; // drive dest === marker location
// A point ~30% along A→B, well clear of the marker at B, for the route-hover case.
const ON_ROUTE: [number, number] = [A[0] + 0.3 * (B[0] - A[0]), A[1] + 0.3 * (B[1] - A[1])];

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const tripRes = await ctx.post("/api/trips", {
    data: { name: "Marker Hover Trip", startDate: "2026-09-01", endDate: "2026-09-02" },
  });
  tripId = (await tripRes.json()).id;

  await ctx.post(`/api/trips/${tripId}/items`, {
    data: {
      title: "Hover Drive",
      category: "drive",
      date: "2026-09-01",
      sortOrder: 0,
      originName: "Start",
      originLat: A[1],
      originLng: A[0],
      destinationName: "End",
      destinationLat: B[1],
      destinationLng: B[0],
      routeGeometry: { type: "LineString", coordinates: [A, B] },
      routeDistanceMeters: 187000,
      routeDurationSeconds: 8100,
      routeSignature: `o:${A[1].toFixed(5)},${A[0].toFixed(5)}|d:${B[1].toFixed(5)},${B[0].toFixed(5)}`,
    },
  });
  // A non-drive marker sitting exactly on the drive's destination.
  const mRes = await ctx.post(`/api/trips/${tripId}/items`, {
    data: {
      title: "Lookout Point",
      category: "activity",
      date: "2026-09-01",
      sortOrder: 1,
      destinationName: "End",
      destinationLat: B[1],
      destinationLng: B[0],
    },
  });
  markerId = (await mRes.json()).id;
  await ctx.dispose();
});

test.afterAll(async () => {
  if (!tripId) return;
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  await ctx.dispose();
});

test("hovering a marker shows its title and does NOT highlight the route under it", async ({
  page,
}) => {
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible();

  const marker = page.locator(`[data-item-id="${markerId}"]`);
  await expect(marker).toBeVisible({ timeout: 20000 });

  // Hover the marker → its title pill; the route pill must stay hidden.
  await marker.hover();
  await expect(page.locator("text=Lookout Point").last()).toBeVisible({ timeout: 5000 });
  await expect(page.locator("text=/2h 15m · 187 km/")).toBeHidden();

  // Move to empty map → pill gone.
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + 5, box.y + 5);
  await expect(page.locator("div.pointer-events-none.z-30")).toHaveCount(0, { timeout: 5000 });

  // Hovering the route AWAY from the marker still shows the route pill.
  const pt = await page.evaluate((p) => {
    const m = (window as unknown as { __waypointMap?: MapHandle }).__waypointMap!;
    const q = m.project(p as [number, number]);
    return { x: q.x, y: q.y };
  }, ON_ROUTE);
  await page.mouse.move(box.x + pt.x - 4, box.y + pt.y - 4);
  await page.mouse.move(box.x + pt.x, box.y + pt.y);
  await expect(page.locator("text=/2h 15m · 187 km/")).toBeVisible({ timeout: 5000 });
});

test("gliding from the route onto the marker and HOLDING shows the marker pill (no mouseout flicker-clear)", async ({
  page,
}) => {
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible();
  const marker = page.locator(`[data-item-id="${markerId}"]`);
  await expect(marker).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(900); // let the fitBounds animation settle

  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("no canvas box");
  // Target the marker's REAL element box (robust vs a stale projected point).
  const mb = (await marker.boundingBox())!;
  const cx = mb.x + mb.width / 2;
  const cy = mb.y + mb.height / 2;

  // Approach over the canvas, glide onto the marker, then HOLD STILL — the real
  // bug: a bubbling mouseout (cursor crossing marker→icon) used to clear the pill
  // and, with no re-enter, it stayed gone. Both pills would then be hidden.
  await page.mouse.move(cx - 60, cy);
  await page.mouse.move(cx, cy, { steps: 15 });
  await page.waitForTimeout(250); // hold — no jitter that would re-fire mouseenter

  await expect(page.locator("text=Lookout Point").last()).toBeVisible({ timeout: 5000 });
  await expect(page.locator("text=/2h 15m · 187 km/")).toBeHidden();
});
