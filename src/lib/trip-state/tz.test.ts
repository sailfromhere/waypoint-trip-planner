import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localToInstant,
  instantToLocal,
  arrivalLocal,
  zoneAbbrev,
  itemLocalTz,
  itemOriginTz,
  isCrossTimezone,
} from "./tz";

const LA = "America/Los_Angeles";
const NY = "America/New_York";

test("localToInstant interprets wall-clock in its zone (PDT in July)", () => {
  // 09:00 PDT (= UTC-7 in July) → 16:00 UTC.
  const dt = localToInstant("2026-07-12", "09:00", LA);
  assert.equal(dt.toUTC().toISO(), "2026-07-12T16:00:00.000Z");
});

test("LAX→JFK flight: 09:00 origin + 5h30m elapsed lands 17:30 destination, same day", () => {
  const a = arrivalLocal("2026-07-12", "09:00", 330, LA, NY);
  assert.equal(a.hhmm, "17:30");
  assert.equal(a.date, "2026-07-12");
  assert.equal(a.dayOffset, 0);
});

test("red-eye rolls to next day (dayOffset = 1)", () => {
  // 23:00 PDT + 5h30m → 07:30 EDT the following calendar day.
  const a = arrivalLocal("2026-07-12", "23:00", 330, LA, NY);
  assert.equal(a.hhmm, "07:30");
  assert.equal(a.date, "2026-07-13");
  assert.equal(a.dayOffset, 1);
});

test("DST spring-forward: elapsed time is honored, wall clock skips the gap", () => {
  // 2026-03-08 02:00 PST→PDT spring-forward. Depart 01:30, +60 min ELAPSED →
  // 03:30 wall clock (02:00–03:00 doesn't exist locally).
  const a = arrivalLocal("2026-03-08", "01:30", 60, LA, LA);
  assert.equal(a.hhmm, "03:30");
  assert.equal(a.dayOffset, 0);
});

test("same-tz arrival reduces to plain wall-clock + duration", () => {
  const a = arrivalLocal("2026-07-12", "14:00", 90, NY, NY);
  assert.equal(a.hhmm, "15:30");
  assert.equal(a.date, "2026-07-12");
});

test("instantToLocal round-trips a wall-clock through its own zone", () => {
  const dt = localToInstant("2026-07-12", "09:00", LA);
  const back = instantToLocal(dt, LA);
  assert.deepEqual(back, { date: "2026-07-12", hhmm: "09:00" });
});

test("zoneAbbrev is DST-aware (PDT in July, PST in January)", () => {
  assert.equal(zoneAbbrev(LA, localToInstant("2026-07-12", "12:00", LA)), "PDT");
  assert.equal(zoneAbbrev(LA, localToInstant("2026-01-12", "12:00", LA)), "PST");
});

test("itemLocalTz / itemOriginTz resolve the fallback chain", () => {
  const flight = { originTimezone: LA, destinationTimezone: NY };
  assert.equal(itemLocalTz(flight, "UTC"), NY);
  assert.equal(itemOriginTz(flight, "UTC"), LA);

  const activity = { originTimezone: null, destinationTimezone: NY };
  assert.equal(itemLocalTz(activity, "UTC"), NY);
  assert.equal(itemOriginTz(activity, "UTC"), NY); // falls through to destination

  const bare = { originTimezone: null, destinationTimezone: null };
  assert.equal(itemLocalTz(bare, "Asia/Tokyo"), "Asia/Tokyo"); // home fallback
});

test("isCrossTimezone only when both ends known AND differ", () => {
  assert.equal(isCrossTimezone({ originTimezone: LA, destinationTimezone: NY }), true);
  assert.equal(isCrossTimezone({ originTimezone: LA, destinationTimezone: LA }), false);
  assert.equal(isCrossTimezone({ originTimezone: null, destinationTimezone: NY }), false);
});
