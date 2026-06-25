import type { ItineraryItem, FieldProvenance } from "@/db/types";
import { DateTime } from "luxon";
import {
  localToInstant,
  instantToLocal,
  itemOriginTz,
  itemLocalTz,
} from "./tz";

/**
 * Deterministic schedule sequencing — auto-fill blank start/end times.
 *
 * Pure, no DB, no LLM. Walks a single day's items in `sortOrder` and assigns
 * each a clock time by accumulating durations from a day-start cursor. This is
 * the data the Calendar view needs (untimed items can't be placed on a grid).
 *
 * The cursor is a UTC INSTANT (Luxon), not minutes-of-day, so a cross-tz leg
 * (flight / long drive) is handled correctly: `startTime` is emitted in the
 * item's ORIGIN tz, `endTime` in its DESTINATION tz, and the cursor that carries
 * forward is the real arrival instant — so the next item sequences in the
 * arrival zone automatically. For a single-tz trip this reduces EXACTLY to the
 * old minute arithmetic (every item resolves to the same zone, so wall-clock
 * round-trips unchanged).
 *
 * Three keystones shape the rules:
 *  - GROUNDED GEOGRAPHY: a `drive` item's duration comes from the routing API
 *    (`drives[]` → `driveSecondsById`), never invented. We only fall back to a
 *    coarse default when the item hasn't been routed yet.
 *  - ELAPSED IS TRUTH: `durationMinutes` (real elapsed time) advances the cursor,
 *    never a wall-clock subtraction across a tz boundary.
 *  - SACRED HUMAN DATA: we never overwrite a time the human set or a booked
 *    item's facts. Items that already have a `startTime` (user anchors, booked
 *    items) are ANCHORS: we snap the cursor to them and advance past them, but
 *    emit no change. We only ever FILL BLANKS, so the write goes out as the
 *    `historical_estimate` source and clears the strict PATCH guard.
 */

// Coarse per-category spacing (minutes) used only to ADVANCE the cursor when an
// item has no explicit durationMinutes — so successive untimed items don't all
// collapse onto the same start time. We do NOT write a duration; endTime is set
// only when the real duration is known (safe-empty).
const DEFAULT_DURATION_MINUTES: Record<string, number> = {
  drive: 30,
  flight: 120,
  activity: 120,
  meal: 60,
  lodging: 0,
  transit: 30,
  rest: 60,
  other: 60,
};

const DEFAULT_DAY_START_MINUTES = 9 * 60; // 09:00

export interface ScheduleChange {
  itemId: string;
  startTime: string; // "HH:MM" wall-clock in the item's origin tz
  endTime: string | null; // "HH:MM" in the DESTINATION tz, or null when unknown
  // Arrival calendar date when it differs from the item's date (red-eye / long
  // cross-tz leg). Informational — the single-`date` writer ignores it; the
  // calendar derives rollover from duration. null when same-day.
  endDate?: string | null;
  before: { startTime: string | null; endTime: string | null };
}

// Postgres `time` comes back as "HH:MM:SS" (or "HH:MM"); normalize to "HH:MM".
function hhmmOf(t: string | null): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function minutesToHHMM(total: number): string {
  const clamped = Math.max(0, Math.min(total, 23 * 60 + 59));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isBooked(item: ItineraryItem): boolean {
  return item.confirmationStatus === "booked";
}

// An ANCHOR is a time we must not move: one the human set (user_provided) or a
// booked item's time. A previously auto-filled time (historical_estimate) is
// NOT an anchor — it's our own prior output, so re-running auto-schedule after
// the user changes a real anchor must recompute (re-flow) it. (Without this the
// first run "locks" the whole day and a second run does nothing.)
function isUserAnchor(item: ItineraryItem): boolean {
  if (isBooked(item)) return true;
  const prov = (item.fieldProvenance ?? {}) as FieldProvenance;
  return prov.startTime === "user_provided";
}

function durationOf(
  item: ItineraryItem,
  driveSecondsById?: Map<string, number>
): number {
  // Prefer the explicit PLANNED duration — that's the time the traveler intends
  // to spend on this leg (a scenic drive may be planned at 60 min even if the
  // raw routed time is 16), and it must match the block the calendar draws so
  // the next item starts when this one actually ends. Fall back to the real
  // routed time only for a drive with no planned duration, then to a default.
  // (The map still shows the routed time — that's separate from schedule pacing.)
  if (item.durationMinutes != null && item.durationMinutes > 0) {
    return item.durationMinutes;
  }
  if (item.category === "drive") {
    const secs = driveSecondsById?.get(item.id);
    if (secs != null && secs > 0) return Math.round(secs / 60);
  }
  return DEFAULT_DURATION_MINUTES[item.category] ?? 60;
}

/**
 * Sequence ONE day's items. `items` need not be pre-sorted — we sort by
 * sortOrder here. Returns only the items whose times actually change.
 *
 * `opts.homeTimezone` is the trip-level fallback tz for items whose coords
 * haven't resolved a tz yet (keeps a single-tz trip consistent); per-item tz on
 * the rows takes precedence.
 */
export function sequenceDay(
  items: ItineraryItem[],
  driveSecondsById?: Map<string, number>,
  opts?: { dayStartMinutes?: number; homeTimezone?: string | null }
): ScheduleChange[] {
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  if (ordered.length === 0) return [];

  const homeTz = opts?.homeTimezone ?? null;
  const dayDate = ordered.find((i) => i.date)?.date ?? null;
  if (!dayDate) return []; // no date → nothing to place on a clock
  const dayTz = itemOriginTz(ordered[0], homeTz);

  // Seed the cursor (a UTC instant) from the earliest USER/BOOKED anchor in
  // sortOrder (not a prior auto-fill), else the day-start default in the day tz.
  let cursor: DateTime = ((): DateTime => {
    for (const i of ordered) {
      if (isUserAnchor(i) && i.startTime && i.date) {
        const inst = localToInstant(i.date, i.startTime, itemOriginTz(i, homeTz));
        if (inst.isValid) return inst;
      }
    }
    const startMin = opts?.dayStartMinutes ?? DEFAULT_DAY_START_MINUTES;
    return localToInstant(dayDate, minutesToHHMM(startMin), dayTz);
  })();

  const changes: ScheduleChange[] = [];

  for (const item of ordered) {
    const originTz = itemOriginTz(item, homeTz);
    const destTz = itemLocalTz(item, homeTz);
    const dur = durationOf(item, driveSecondsById);
    const anchorInst =
      item.startTime && item.date
        ? localToInstant(item.date, item.startTime, originTz)
        : null;

    if (anchorInst?.isValid && isUserAnchor(item)) {
      // Respect a human/booked time: snap the cursor forward to it (monotonic,
      // never backwards), then advance past it. No change emitted.
      if (anchorInst.toMillis() > cursor.toMillis()) cursor = anchorInst;
      cursor = cursor.plus({ minutes: dur });
      continue;
    }

    // A booked item with no usable user time is hard-locked (we can't write its
    // facts) — advance the cursor but don't propose a change.
    if (isBooked(item)) {
      cursor = cursor.plus({ minutes: dur });
      continue;
    }

    // Blank OR a prior auto-fill (historical_estimate): (re)compute from cursor.
    const startInst = cursor;
    const knownDuration =
      (item.category === "drive" &&
        (driveSecondsById?.get(item.id) ?? 0) > 0) ||
      (item.durationMinutes != null && item.durationMinutes > 0);
    const endInst = knownDuration ? startInst.plus({ minutes: dur }) : null;

    // Wall-clock start in the ORIGIN tz, clamped to the item's own day (parity
    // with the old minute sequencer: a fill never rolls a START past midnight).
    const startLocal = instantToLocal(startInst, originTz);
    const startHHMM =
      startLocal.date === dayDate ? startLocal.hhmm : "23:59";

    // Wall-clock end in the DESTINATION tz (cross-tz aware). endDate is carried
    // when the arrival lands on a later calendar day (red-eye).
    const endLocal = endInst ? instantToLocal(endInst, destTz) : null;
    const endHHMM = endLocal ? endLocal.hhmm : null;
    const endDate = endLocal && endLocal.date !== dayDate ? endLocal.date : null;

    // Skip a no-op (idempotent re-runs / unchanged days) so the Undo banner
    // doesn't claim to have "filled" times that didn't move.
    const unchanged =
      hhmmOf(item.startTime) === startHHMM && hhmmOf(item.endTime) === endHHMM;
    if (!unchanged) {
      changes.push({
        itemId: item.id,
        startTime: startHHMM,
        endTime: endHHMM,
        endDate,
        before: { startTime: item.startTime, endTime: item.endTime },
      });
    }

    cursor = startInst.plus({ minutes: dur });
  }

  return changes;
}

/**
 * Sequence every dated day in a trip. Unscheduled items (no date) are skipped.
 * `driveSecondsById` maps drive itemId → routed seconds (from the routes API).
 */
export function sequenceTrip(
  items: ItineraryItem[],
  driveSecondsById?: Map<string, number>,
  opts?: { homeTimezone?: string | null }
): ScheduleChange[] {
  const byDay = new Map<string, ItineraryItem[]>();
  for (const item of items) {
    if (!item.date) continue;
    if (!byDay.has(item.date)) byDay.set(item.date, []);
    byDay.get(item.date)!.push(item);
  }
  const out: ScheduleChange[] = [];
  for (const dayItems of byDay.values()) {
    out.push(
      ...sequenceDay(dayItems, driveSecondsById, {
        homeTimezone: opts?.homeTimezone,
      })
    );
  }
  return out;
}
