// Segment-level parallel-offset of overlapping drive routes — CROSS-DAY ONLY.
//
// Every drive is drawn as its own MapLibre line layer, colored by day. Where two
// routes share a road segment, the later layer's color overpaints the earlier.
// To show both, we fan overlapping stretches into parallel lanes via a
// per-feature `line-offset`.
//
// SEGMENT-LEVEL (not whole-line): a route is split into runs of coordinates, and
// only the runs that actually coincide with a DIFFERENT day's route are offset.
// The unique stretches stay at offset 0, on the true road. This is the key fix
// for real loop trips (e.g. Yellowstone's Grand Loop), where two days might share
// only a short connector — whole-line offset would shove the entire (mostly
// unique) line off the road and make it spiky from line-offset overshoot.
//
// Lanes are assigned per DAY, not per route: on a shared edge, the distinct days
// present fan out symmetrically (0, +step, −step, …); same-day routes share a lane
// (they're the same color, so stacking is fine). Returns, per route, an ordered
// list of {coordinates, offset} segments to render as a FeatureCollection.
//
// Pure + framework-free (mirrors anchor.ts) so it's unit-testable in isolation.

export interface OffsetRoute {
  itemId: string;
  geometry?: GeoJSON.LineString;
  // The route's day (color bucket). Only cross-day overlaps are fanned. Null =
  // undated (treated as its own bucket).
  day: string | null;
}

export interface RouteSegment {
  coordinates: [number, number][];
  offset: number; // perpendicular line-offset in px (0 = on the true road)
}

// Grid precision for matching coordinates: toFixed(4) ≈ 11m. Two routes on the
// same road quantize to the same edges; ones merely near each other do not.
const GRID_PRECISION = 4;

// A shared run must be at least this many edges (~11m each) before we offset it,
// so a mere intersection/crossing of one or two edges doesn't induce a tiny jog.
const MIN_RUN_EDGES = 3;

const DEFAULT_STEP_PX = 3;

function quantize(coord: number[]): string {
  return `${coord[0].toFixed(GRID_PRECISION)},${coord[1].toFixed(GRID_PRECISION)}`;
}

// Order-normalized edge key, so direction of travel doesn't matter.
function edgeKey(a: string, b: string): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

// Deterministic day order: chronological, nulls last.
function sortDays(days: (string | null)[]): (string | null)[] {
  return [...days].sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -1 : 1;
  });
}

// Symmetric lane offset for `day` among the sorted days sharing an edge:
// index 0 → 0, 1 → +step, 2 → −step, 3 → +2step, 4 → −2step, …
function laneOffset(sortedDays: (string | null)[], day: string | null, step: number): number {
  const idx = sortedDays.findIndex((d) => d === day);
  if (idx <= 0) return 0;
  const slot = ((idx + 1) >> 1) * (idx % 2 === 1 ? 1 : -1);
  return slot * step;
}

// In-place: zero out any maximal run of equal NON-zero offset shorter than
// minLen, so incidental short overlaps don't produce a visible jog.
function smoothShortRuns(offsets: number[], minLen: number): void {
  let start = 0;
  for (let i = 1; i <= offsets.length; i++) {
    if (i === offsets.length || offsets[i] !== offsets[start]) {
      if (offsets[start] !== 0 && i - start < minLen) {
        for (let j = start; j < i; j++) offsets[j] = 0;
      }
      start = i;
    }
  }
}

/**
 * Splits each route into offset-tagged segments. Unique stretches get offset 0;
 * stretches shared with a different day get a symmetric per-day lane offset.
 */
export function computeRouteSegments(
  routes: OffsetRoute[],
  stepPx = DEFAULT_STEP_PX
): Map<string, RouteSegment[]> {
  // 1. Index the set of distinct days traversing each quantized edge.
  const edgeDays = new Map<string, Set<string | null>>();
  for (const r of routes) {
    const coords = r.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const seen = new Set<string>(); // de-dupe a route's own repeated edges
    for (let i = 0; i < coords.length - 1; i++) {
      const key = edgeKey(quantize(coords[i]), quantize(coords[i + 1]));
      if (seen.has(key)) continue;
      seen.add(key);
      let set = edgeDays.get(key);
      if (!set) edgeDays.set(key, (set = new Set()));
      set.add(r.day);
    }
  }

  const result = new Map<string, RouteSegment[]>();

  for (const r of routes) {
    const coords = r.geometry?.coordinates;
    if (!coords || coords.length < 2) {
      result.set(r.itemId, []);
      continue;
    }

    // 2. Per-edge offset: fan only where ≥2 distinct days share the edge.
    const offsets: number[] = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const key = edgeKey(quantize(coords[i]), quantize(coords[i + 1]));
      const days = edgeDays.get(key);
      offsets.push(
        days && days.size >= 2 ? laneOffset(sortDays([...days]), r.day, stepPx) : 0
      );
    }

    // 3. Drop incidental short shared runs back to the road.
    smoothShortRuns(offsets, MIN_RUN_EDGES);

    // 4. Group consecutive equal-offset edges into segments. Adjacent segments
    //    share their boundary vertex so the line stays continuous.
    const segments: RouteSegment[] = [];
    let start = 0;
    for (let i = 1; i <= offsets.length; i++) {
      if (i === offsets.length || offsets[i] !== offsets[start]) {
        segments.push({
          coordinates: coords.slice(start, i + 1).map((p) => [p[0], p[1]] as [number, number]),
          offset: offsets[start],
        });
        start = i;
      }
    }
    result.set(r.itemId, segments);
  }

  return result;
}
