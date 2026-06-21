import { test, expect } from "@playwright/test";
import { sequenceDay, sequenceTrip } from "../src/lib/trip-state/sequence";
import type { ItineraryItem } from "../src/db/types";

/**
 * Pure-mechanism tests for the deterministic schedule sequencer (no DB/LLM).
 * Proves: cursor accumulation, anchoring on existing/booked times (never
 * overwriting them), real drive-seconds vs category-default spacing, and
 * safe-empty endTime when duration is unknown.
 */

let seq = 0;
function item(overrides: Partial<ItineraryItem>): ItineraryItem {
  const base = {
    id: `item_${seq++}`,
    tripId: "trip_1",
    title: "Thing",
    category: "activity",
    confirmationStatus: "idea",
    date: "2026-07-01",
    startTime: null,
    endTime: null,
    durationMinutes: null,
    originName: null,
    originLat: null,
    originLng: null,
    destinationName: null,
    destinationLat: null,
    destinationLng: null,
    costCents: null,
    currency: "USD",
    notes: null,
    links: [],
    sortOrder: 0,
    fieldProvenance: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...base, ...overrides } as ItineraryItem;
}

test("fills blanks from a default 9am start, accumulating durations", () => {
  const a = item({ sortOrder: 0, durationMinutes: 90 });
  const b = item({ sortOrder: 1, durationMinutes: 60 });
  const changes = sequenceDay([b, a]); // unsorted input

  expect(changes.map((c) => c.itemId)).toEqual([a.id, b.id]); // sorted
  expect(changes[0]).toMatchObject({ startTime: "09:00", endTime: "10:30" });
  expect(changes[1]).toMatchObject({ startTime: "10:30", endTime: "11:30" });
});

test("anchors on an existing user start time without emitting a change for it", () => {
  const a = item({ sortOrder: 0, durationMinutes: 60, startTime: "13:00:00" });
  const b = item({ sortOrder: 1, durationMinutes: 30 });
  const changes = sequenceDay([a, b]);

  // a is an anchor → not in the changes; b is filled starting at 14:00.
  expect(changes.map((c) => c.itemId)).toEqual([b.id]);
  expect(changes[0]).toMatchObject({ startTime: "14:00", endTime: "14:30" });
});

test("never overwrites a booked item's time, but advances the cursor past it", () => {
  const a = item({
    sortOrder: 0,
    durationMinutes: 60,
    startTime: "10:00:00",
    confirmationStatus: "booked",
  });
  const b = item({ sortOrder: 1, durationMinutes: 45 });
  const changes = sequenceDay([a, b]);

  expect(changes.map((c) => c.itemId)).toEqual([b.id]);
  expect(changes[0]).toMatchObject({ startTime: "11:00" });
});

test("a booked item with no time is skipped (hard-locked) but still consumes time", () => {
  const a = item({ sortOrder: 0, durationMinutes: 120, confirmationStatus: "booked" });
  const b = item({ sortOrder: 1, durationMinutes: 30 });
  const changes = sequenceDay([a, b]);

  // a is booked+blank → no change; cursor still advances 120m → b at 11:00.
  expect(changes.map((c) => c.itemId)).toEqual([b.id]);
  expect(changes[0]).toMatchObject({ startTime: "11:00", endTime: "11:30" });
});

test("drive items use real routed seconds, not the category default", () => {
  const drive = item({ sortOrder: 0, category: "drive" });
  const after = item({ sortOrder: 1, durationMinutes: 60 });
  const driveSecs = new Map([[drive.id, 90 * 60]]); // 90 min routed

  const changes = sequenceDay([drive, after], driveSecs);
  expect(changes[0]).toMatchObject({ startTime: "09:00", endTime: "10:30" });
  expect(changes[1]).toMatchObject({ startTime: "10:30" }); // 9:00 + 90m
});

test("a drive's PLANNED duration wins over its routed time (block must match the next item's start)", () => {
  // Regression: a 60-min planned scenic drive whose raw routed time is only 16
  // min must advance the cursor by 60 (next item at +60), not 16 — otherwise the
  // calendar block (60) and the next start (12:21) disagree and look overlapped.
  const drive = item({ sortOrder: 0, category: "drive", startTime: "12:05:00", durationMinutes: 60 });
  const next = item({ sortOrder: 1, durationMinutes: 30 });
  const driveSecs = new Map([[drive.id, 16 * 60]]); // routed = 16 min

  const changes = sequenceDay([drive, next], driveSecs);
  // drive is anchored at 12:05 → not emitted; next must land at 13:05 (12:05+60).
  expect(changes.map((c) => c.itemId)).toEqual([next.id]);
  expect(changes[0].startTime).toBe("13:05");
});

test("endTime stays null when duration is unknown, but cursor still spaces items", () => {
  const a = item({ sortOrder: 0, category: "activity" }); // no duration → 120m default
  const b = item({ sortOrder: 1, category: "meal" });
  const changes = sequenceDay([a, b]);

  expect(changes[0].endTime).toBeNull();
  expect(changes[0].startTime).toBe("09:00");
  expect(changes[1].startTime).toBe("11:00"); // advanced by 120m default
  expect(changes[1].endTime).toBeNull();
});

test("sequenceTrip groups by date and skips undated items", () => {
  const d1a = item({ date: "2026-07-01", sortOrder: 0, durationMinutes: 60 });
  const d1b = item({ date: "2026-07-01", sortOrder: 1, durationMinutes: 60 });
  const d2a = item({ date: "2026-07-02", sortOrder: 0, durationMinutes: 60 });
  const undated = item({ date: null, sortOrder: 0, durationMinutes: 60 });

  const changes = sequenceTrip([d1a, d1b, d2a, undated]);
  const ids = changes.map((c) => c.itemId);
  expect(ids).toContain(d1a.id);
  expect(ids).toContain(d2a.id);
  expect(ids).not.toContain(undated.id);
  // each day restarts at 09:00
  expect(changes.find((c) => c.itemId === d2a.id)!.startTime).toBe("09:00");
});
