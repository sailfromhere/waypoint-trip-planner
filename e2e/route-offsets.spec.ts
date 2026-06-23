import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Segment-level cross-day route fanning (computeRouteSegments). Each drive is one
 * MapLibre source whose features are offset-tagged runs: stretches shared with a
 * DIFFERENT day are offset into a lane, unique stretches stay at 0 (on the road).
 *
 * Drive routes are canvas-drawn (no DOM), so we read the source GeoJSON off the
 * map instance at window.__waypointMap. Geometry is seeded directly on the items
 * (routeGeometry) so the assertion is deterministic and OSRM-independent.
 */

const BASE = "http://localhost:3000";
let tripId: string;

type MapHandle = {
  getStyle(): { layers: { id: string }[] } | null;
  getSource(id: string): { serialize(): { data?: GeoJSON.FeatureCollection } } | undefined;
};

// A shared road (6 pts → 5 edges, clears MIN_RUN_EDGES).
const SHARED: [number, number][] = [
  [-111.10, 44.66],
  [-111.09, 44.70],
  [-111.08, 44.74],
  [-111.07, 44.78],
  [-111.06, 44.82],
  [-111.05, 44.86],
];
// B follows SHARED for the first 4 pts, then diverges east (unique tail).
const PARTIAL: [number, number][] = [
  ...SHARED.slice(0, 4),
  [-111.00, 44.80],
  [-110.95, 44.82],
];
const FAR: [number, number][] = [
  [-120.0, 40.0],
  [-120.01, 40.1],
  [-120.02, 40.2],
];

function geom(coords: [number, number][]) {
  return { type: "LineString", coordinates: coords };
}

// The distinct offset values across a drive source's features.
async function offsetsOf(page: import("@playwright/test").Page, id: string) {
  return page.evaluate((sourceId) => {
    const m = (window as unknown as { __waypointMap?: MapHandle }).__waypointMap;
    const src = m?.getSource(sourceId);
    const fc = src?.serialize().data;
    if (!fc?.features) return null;
    return fc.features.map((f) => (f.properties as { offset?: number }).offset ?? 0);
  }, id);
}

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const tripRes = await ctx.post("/api/trips", {
    data: { name: "Route Segments Trip", startDate: "2026-09-01", endDate: "2026-09-03" },
  });
  tripId = (await tripRes.json()).id;

  const drives = [
    // A: baseline day, full shared road.
    {
      title: "Drive A",
      category: "drive",
      date: "2026-09-01",
      sortOrder: 0,
      originLat: 44.66,
      originLng: -111.1,
      destinationLat: 44.86,
      destinationLng: -111.05,
      routeGeometry: geom(SHARED),
    },
    // B: different day, shares only the first stretch then diverges.
    {
      title: "Drive B",
      category: "drive",
      date: "2026-09-02",
      sortOrder: 0,
      originLat: 44.66,
      originLng: -111.1,
      destinationLat: 44.82,
      destinationLng: -110.95,
      routeGeometry: geom(PARTIAL),
    },
    // C: alone on its own road.
    {
      title: "Drive C (far)",
      category: "drive",
      date: "2026-09-03",
      sortOrder: 0,
      originLat: 40.0,
      originLng: -120.0,
      destinationLat: 40.2,
      destinationLng: -120.02,
      routeGeometry: geom(FAR),
    },
  ];
  const ids: string[] = [];
  for (const d of drives) {
    const res = await ctx.post(`/api/trips/${tripId}/items`, { data: d });
    ids.push((await res.json()).id);
  }
  (globalThis as Record<string, unknown>).__segIds = ids;
  await ctx.dispose();
});

test.afterAll(async () => {
  if (!tripId) return;
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.delete(`/api/trips/${tripId}`).catch(() => {});
  await ctx.dispose();
});

test("partial cross-day overlap is offset only on the shared stretch; unique tail and lone drive stay on the road", async ({
  page,
}) => {
  const [idA, idB, idC] = (globalThis as Record<string, unknown>).__segIds as string[];

  await page.goto(`/trips/${tripId}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (window as unknown as { __waypointMap?: MapHandle }).__waypointMap;
          const style = m && typeof m.getStyle === "function" ? m.getStyle() : null;
          if (!style?.layers) return -1;
          // Visible route layers only — exclude the transparent `drive-hit-*`
          // hover-target layers that share each route's source.
          return style.layers.filter(
            (l) => l.id.startsWith("drive-") && !l.id.startsWith("drive-hit-")
          ).length;
        }),
      { timeout: 20000 }
    )
    .toBe(3);

  const offA = await offsetsOf(page, `drive-${idA}`);
  const offB = await offsetsOf(page, `drive-${idB}`);
  const offC = await offsetsOf(page, `drive-${idC}`);

  // B (the non-baseline day) splits: a non-zero shared head, a 0 unique tail.
  expect(offB).not.toBeNull();
  expect(offB!.some((o) => o !== 0)).toBe(true); // shared stretch fanned
  expect(offB!.some((o) => o === 0)).toBe(true); // unique tail back on the road

  // A is the baseline day → lane 0 everywhere.
  expect(offA!.every((o) => o === 0)).toBe(true);
  // C is alone → entirely on the road.
  expect(offC!.every((o) => o === 0)).toBe(true);
});
