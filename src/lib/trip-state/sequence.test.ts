import { test } from "node:test";
import assert from "node:assert/strict";
import { sequenceDay, type ScheduleChange } from "./sequence";
import type { ItineraryItem } from "@/db/types";

const LA = "America/Los_Angeles";
const NY = "America/New_York";

let seq = 0;
function item(overrides: Partial<ItineraryItem>): ItineraryItem {
  return {
    id: `i${seq++}`,
    tripId: "t1",
    date: "2026-07-12",
    startTime: null,
    endTime: null,
    durationMinutes: null,
    originName: null,
    originLat: null,
    originLng: null,
    destinationName: null,
    destinationLat: null,
    destinationLng: null,
    originTimezone: null,
    destinationTimezone: null,
    category: "activity",
    title: "x",
    notes: null,
    confirmationStatus: "idea",
    costCents: null,
    currency: "USD",
    links: [],
    sortOrder: seq,
    fieldProvenance: {},
    routeGeometry: null,
    routeDistanceMeters: null,
    routeDurationSeconds: null,
    routeSignature: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ItineraryItem;
}

function byId(changes: ScheduleChange[]) {
  return new Map(changes.map((c) => [c.itemId, c]));
}

test("BACKWARD COMPAT: single-tz day fills from 09:00 default by duration", () => {
  const a = item({ id: "a", sortOrder: 0, durationMinutes: 120, destinationTimezone: NY });
  const b = item({ id: "b", sortOrder: 1, durationMinutes: 60, destinationTimezone: NY });
  const changes = byId(sequenceDay([a, b], undefined, { homeTimezone: NY }));
  assert.equal(changes.get("a")!.startTime, "09:00");
  assert.equal(changes.get("a")!.endTime, "11:00");
  assert.equal(changes.get("b")!.startTime, "11:00");
  assert.equal(changes.get("b")!.endTime, "12:00");
});

test("BACKWARD COMPAT: works with NO tz anywhere (system fallback, internally consistent)", () => {
  const a = item({ id: "a", sortOrder: 0, durationMinutes: 90 });
  const b = item({ id: "b", sortOrder: 1, durationMinutes: 30 });
  const changes = byId(sequenceDay([a, b]));
  assert.equal(changes.get("a")!.startTime, "09:00");
  assert.equal(changes.get("a")!.endTime, "10:30");
  assert.equal(changes.get("b")!.startTime, "10:30");
});

test("user anchor is respected and seeds the cursor", () => {
  const anchor = item({
    id: "anchor",
    sortOrder: 0,
    startTime: "10:00",
    durationMinutes: 60,
    destinationTimezone: NY,
    fieldProvenance: { startTime: "user_provided" },
  });
  const next = item({ id: "next", sortOrder: 1, durationMinutes: 30, destinationTimezone: NY });
  const changes = byId(sequenceDay([anchor, next], undefined, { homeTimezone: NY }));
  assert.equal(changes.has("anchor"), false); // anchor not moved
  assert.equal(changes.get("next")!.startTime, "11:00"); // after 10:00 + 60m
});

test("CROSS-TZ flight: depart 09:00 LA + 330m elapsed → endTime 17:30 in NY, next item flows in NY", () => {
  const flight = item({
    id: "flight",
    sortOrder: 0,
    category: "flight",
    startTime: "09:00",
    durationMinutes: 330,
    originTimezone: LA,
    destinationTimezone: NY,
    fieldProvenance: { startTime: "user_provided" },
  });
  // Item after arrival lives in NY (its tz), should start at 17:30 NY, not 14:30.
  const dinner = item({
    id: "dinner",
    sortOrder: 1,
    durationMinutes: 90,
    destinationTimezone: NY,
  });
  const changes = byId(sequenceDay([flight, dinner], undefined, { homeTimezone: LA }));
  // flight is a user anchor → not emitted, but it advances the cursor by elapsed.
  assert.equal(changes.has("flight"), false);
  assert.equal(changes.get("dinner")!.startTime, "17:30");
  assert.equal(changes.get("dinner")!.endTime, "19:00");
});

test("CROSS-TZ flight as a BLANK fill emits origin-local start + dest-local end", () => {
  const flight = item({
    id: "f",
    sortOrder: 0,
    category: "flight",
    durationMinutes: 330,
    originTimezone: LA,
    destinationTimezone: NY,
  });
  const changes = byId(sequenceDay([flight], undefined, { homeTimezone: LA }));
  const c = changes.get("f")!;
  assert.equal(c.startTime, "09:00"); // origin tz (LA), day default
  assert.equal(c.endTime, "17:30"); // 09:00 LA + 330m = 14:30 LA = 17:30 NY
  assert.equal(c.endDate, null);
});

test("idempotent: re-running an already-sequenced day yields no changes", () => {
  const a = item({
    id: "a",
    sortOrder: 0,
    startTime: "09:00",
    endTime: "11:00",
    durationMinutes: 120,
    destinationTimezone: NY,
    fieldProvenance: { startTime: "historical_estimate" },
  });
  const changes = sequenceDay([a], undefined, { homeTimezone: NY });
  assert.deepEqual(changes, []);
});
