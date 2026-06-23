import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Hover a drive route → a follow-cursor tooltip shows its drive time + distance
 * + origin→destination. Geometry AND the cached distance/duration are seeded
 * directly on the item, so the assertion is deterministic and OSRM-independent.
 *
 * We can't "hover a line" by CSS selector (routes are canvas-drawn), so we ask
 * the live map (window.__waypointMap) to project the route's midpoint to a pixel,
 * add the canvas offset, and dispatch a real mouse move there. The fat (14px)
 * transparent hit layer makes the target forgiving of projection rounding.
 */

const BASE = "http://localhost:3000";
let tripId: string;

type MapHandle = {
  getStyle(): { layers: { id: string }[] } | null;
  project(lngLat: [number, number]): { x: number; y: number };
};

// A short, near-straight leg so its midpoint lands squarely on the drawn line.
const A: [number, number] = [-111.1, 44.66];
const B: [number, number] = [-111.05, 44.72];
const MID: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const tripRes = await ctx.post("/api/trips", {
    data: { name: "Route Hover Trip", startDate: "2026-09-01", endDate: "2026-09-02" },
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
      // 187 km → "187 km"; 8100 s = 135 min → "2h 15m".
      routeDistanceMeters: 187000,
      routeDurationSeconds: 8100,
      // Matching signature (origin/dest at 5dp) so the /routes endpoint serves a
      // cache HIT with the seeded numbers instead of recomputing via the router.
      routeSignature: `o:${A[1].toFixed(5)},${A[0].toFixed(5)}|d:${B[1].toFixed(5)},${B[0].toFixed(5)}`,
    },
  });
  await ctx.dispose();
});

test.afterAll(async () => {
  if (!tripId) return;
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  await ctx.dispose();
});

test("hovering a drive route shows a tooltip with its time, distance, and route names", async ({
  page,
}) => {
  await page.goto(`/trips/${tripId}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible();

  // Wait until the route (and so its hit layer) is on the map.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (window as unknown as { __waypointMap?: MapHandle }).__waypointMap;
          const style = m?.getStyle?.() ?? null;
          if (!style?.layers) return 0;
          return style.layers.filter((l) => l.id.startsWith("drive-hit-")).length;
        }),
      { timeout: 20000 }
    )
    .toBe(1);

  // Project the route midpoint to a page pixel (canvas-relative + canvas offset).
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const pt = await page.evaluate((mid) => {
    const m = (window as unknown as { __waypointMap?: MapHandle }).__waypointMap!;
    const p = m.project(mid as [number, number]);
    return { x: p.x, y: p.y };
  }, MID);

  const px = box.x + pt.x;
  const py = box.y + pt.y;

  // Two-step move so the engine emits a genuine mousemove over the canvas.
  await page.mouse.move(px - 4, py - 4);
  await page.mouse.move(px, py);

  await expect(page.locator("text=/2h 15m · 187 km/")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("text=/Start → End/")).toBeVisible();

  // Moving off the route hides the tooltip again.
  await page.mouse.move(box.x + 5, box.y + 5);
  await expect(page.locator("text=/2h 15m · 187 km/")).toBeHidden({ timeout: 5000 });

  // Touch/click parity: tapping the route selects it and opens the popup, which
  // carries the same stats line (the only path to a drive's popup without hover).
  await page.mouse.click(px, py);
  const popup = page.locator(".maplibregl-popup-content");
  await expect(popup).toContainText("Hover Drive");
  await expect(popup).toContainText("2h 15m · 187 km");

  // Clicking empty map clears the selection (popup closes).
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(page.locator(".maplibregl-popup-content")).toHaveCount(0, { timeout: 5000 });
});
