import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRouteSegments, type OffsetRoute } from "./route-offsets";

function line(coords: [number, number][]): GeoJSON.LineString {
  return { type: "LineString", coordinates: coords };
}

// 6-point straight path → 5 edges (plenty to clear MIN_RUN_EDGES of 3).
const PATH: [number, number][] = [
  [0, 0],
  [0.001, 0],
  [0.002, 0],
  [0.003, 0],
  [0.004, 0],
  [0.005, 0],
];

// All offsets seen across a route's segments.
function offsets(segs: { offset: number }[]): number[] {
  return segs.map((s) => s.offset);
}

test("two fully-overlapping routes on DIFFERENT days fan (baseline day at 0, other offset)", () => {
  const routes: OffsetRoute[] = [
    { itemId: "x", geometry: line(PATH), day: "d1" },
    { itemId: "y", geometry: line(PATH), day: "d2" },
  ];
  const segs = computeRouteSegments(routes, 4);
  // Each is a single run, fully offset to its day's lane.
  assert.deepEqual(offsets(segs.get("x")!), [0]); // earliest day = lane 0
  assert.deepEqual(offsets(segs.get("y")!), [4]);
});

test("two fully-overlapping routes on the SAME day are NOT fanned (one run at 0)", () => {
  const routes: OffsetRoute[] = [
    { itemId: "x", geometry: line(PATH), day: "d1" },
    { itemId: "y", geometry: line(PATH), day: "d1" },
  ];
  const segs = computeRouteSegments(routes, 4);
  assert.deepEqual(offsets(segs.get("x")!), [0]);
  assert.deepEqual(offsets(segs.get("y")!), [0]);
});

test("PARTIAL cross-day overlap: shared stretch is offset, the unique tail stays on the road (0)", () => {
  // x runs the full PATH. y shares the first 3 edges then diverges north.
  const x: OffsetRoute = { itemId: "x", geometry: line(PATH), day: "d1" };
  const y: OffsetRoute = {
    itemId: "y",
    day: "d2",
    geometry: line([
      [0, 0],
      [0.001, 0],
      [0.002, 0],
      [0.003, 0], // shared with x through here (3 edges)
      [0.003, 0.001],
      [0.003, 0.002], // unique tail heading north
    ]),
  };
  const segs = computeRouteSegments([x, y], 4);
  // y is the non-baseline day: its shared head is offset, its unique tail is 0.
  const yOff = offsets(segs.get("y")!);
  assert.equal(yOff.length, 2, "y should split into shared + unique segments");
  assert.notEqual(yOff[0], 0, "shared head is offset");
  assert.equal(yOff[yOff.length - 1], 0, "unique tail is back on the road");
  // x is the baseline day → lane 0 everywhere → a single run.
  assert.deepEqual(offsets(segs.get("x")!), [0]);
});

test("a brief crossing (below MIN_RUN_EDGES) is NOT offset", () => {
  // y shares exactly 2 edges with x in the middle, then leaves — too short to fan.
  const x: OffsetRoute = { itemId: "x", geometry: line(PATH), day: "d1" };
  const y: OffsetRoute = {
    itemId: "y",
    day: "d2",
    geometry: line([
      [0.001, 0.002],
      [0.001, 0], // arrives onto the shared road
      [0.002, 0], // shared edge 1
      [0.003, 0], // shared edge 2
      [0.003, 0.002], // leaves
    ]),
  };
  const segs = computeRouteSegments([x, y], 4);
  assert.ok(
    offsets(segs.get("y")!).every((o) => o === 0),
    "a 2-edge crossing should not be offset"
  );
});

test("disjoint routes are a single on-road run each", () => {
  const routes: OffsetRoute[] = [
    { itemId: "x", geometry: line(PATH), day: "d1" },
    {
      itemId: "y",
      day: "d2",
      geometry: line([
        [10, 10],
        [10.001, 10],
        [10.002, 10],
      ]),
    },
  ];
  const segs = computeRouteSegments(routes, 4);
  assert.deepEqual(offsets(segs.get("x")!), [0]);
  assert.deepEqual(offsets(segs.get("y")!), [0]);
});

test("a route with no geometry yields no segments and doesn't crash", () => {
  const routes: OffsetRoute[] = [
    { itemId: "x", geometry: line(PATH), day: "d1" },
    { itemId: "y", day: "d2" },
  ];
  const segs = computeRouteSegments(routes, 4);
  assert.deepEqual(segs.get("y"), []);
});
