import { test, expect } from "@playwright/test";
import { autoDriveDuration } from "../src/lib/trip-state/drive-duration";
import type { ItineraryItem } from "../src/db/types";

/**
 * Pure-mechanism tests for the drive-duration auto-sync (no DB/LLM). Proves it
 * fills blanks, REFRESHES its own prior auto-derived value when the route
 * changes (the "corrected a mis-geocoded location but the drive duration didn't
 * update" field bug), and never clobbers a planned user/AI duration.
 */

type D = Pick<ItineraryItem, "category" | "durationMinutes" | "fieldProvenance">;
const drive = (o: Partial<D>): D => ({
  category: "drive",
  durationMinutes: null,
  fieldProvenance: {},
  ...o,
});

test("fills a blank duration from the routed time", () => {
  expect(autoDriveDuration(drive({}), 90 * 60)).toBe(90);
});

test("refreshes a prior historical_estimate when the route changed (field bug)", () => {
  const it = drive({ durationMinutes: 40, fieldProvenance: { durationMinutes: "historical_estimate" } });
  // Location corrected → re-routed to 25 min → stale 40 must follow.
  expect(autoDriveDuration(it, 25 * 60)).toBe(25);
});

test("no-op when the auto-derived value already matches (no loop)", () => {
  const it = drive({ durationMinutes: 25, fieldProvenance: { durationMinutes: "historical_estimate" } });
  expect(autoDriveDuration(it, 25 * 60)).toBeNull();
});

test("never overwrites a user_provided planned duration", () => {
  const it = drive({ durationMinutes: 60, fieldProvenance: { durationMinutes: "user_provided" } });
  expect(autoDriveDuration(it, 16 * 60)).toBeNull();
});

test("never overwrites an ai_assumption planned duration", () => {
  const it = drive({ durationMinutes: 60, fieldProvenance: { durationMinutes: "ai_assumption" } });
  expect(autoDriveDuration(it, 16 * 60)).toBeNull();
});

test("ignores non-drives and unrouted drives", () => {
  expect(autoDriveDuration(drive({ category: "activity" }), 90 * 60)).toBeNull();
  expect(autoDriveDuration(drive({}), 0)).toBeNull();
  expect(autoDriveDuration(drive({}), undefined)).toBeNull();
});
