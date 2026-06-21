import type { ItineraryItem } from "@/db/types";

/**
 * Deterministic schedule sequencing — auto-fill blank start/end times.
 *
 * Pure, no DB, no LLM. Walks a single day's items in `sortOrder` and assigns
 * each a clock time by accumulating durations from a day-start cursor. This is
 * the data the Calendar view needs (untimed items can't be placed on a grid).
 *
 * Two keystones shape the rules:
 *  - GROUNDED GEOGRAPHY: a `drive` item's duration comes from the routing API
 *    (`drives[]` → `driveSecondsById`), never invented. We only fall back to a
 *    coarse default when the item hasn't been routed yet.
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
  startTime: string; // "HH:MM"
  endTime: string | null; // "HH:MM" or null when duration is unknown
  before: { startTime: string | null; endTime: string | null };
}

// Postgres `time` comes back as "HH:MM:SS" (or "HH:MM"); parse leniently.
function parseMinutes(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatMinutes(total: number): string {
  // Clamp into a single day so a runaway cursor doesn't produce "26:00".
  const clamped = Math.max(0, Math.min(total, 23 * 60 + 59));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isBooked(item: ItineraryItem): boolean {
  return item.confirmationStatus === "booked";
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
 */
export function sequenceDay(
  items: ItineraryItem[],
  driveSecondsById?: Map<string, number>,
  opts?: { dayStartMinutes?: number }
): ScheduleChange[] {
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  if (ordered.length === 0) return [];

  // Seed the cursor from the earliest existing anchor, else a default.
  const firstAnchor = ordered
    .map((i) => parseMinutes(i.startTime))
    .find((m): m is number => m != null);
  let cursor = opts?.dayStartMinutes ?? firstAnchor ?? DEFAULT_DAY_START_MINUTES;

  const changes: ScheduleChange[] = [];

  for (const item of ordered) {
    const anchor = parseMinutes(item.startTime);
    const dur = durationOf(item, driveSecondsById);

    if (anchor != null) {
      // Respect a human/booked time: snap the cursor forward to it (never
      // backwards — keep monotonic), then advance past it. No change emitted.
      cursor = Math.max(cursor, anchor) + dur;
      continue;
    }

    // Blank start. A booked item with no start is still hard-locked (we can't
    // write its facts) — advance the cursor but don't propose a change.
    if (isBooked(item)) {
      cursor += dur;
      continue;
    }

    const start = cursor;
    const knownDuration =
      (item.category === "drive" &&
        (driveSecondsById?.get(item.id) ?? 0) > 0) ||
      (item.durationMinutes != null && item.durationMinutes > 0);

    changes.push({
      itemId: item.id,
      startTime: formatMinutes(start),
      endTime: knownDuration ? formatMinutes(start + dur) : null,
      before: { startTime: item.startTime, endTime: item.endTime },
    });

    cursor = start + dur;
  }

  return changes;
}

/**
 * Sequence every dated day in a trip. Unscheduled items (no date) are skipped.
 * `driveSecondsById` maps drive itemId → routed seconds (from the routes API).
 */
export function sequenceTrip(
  items: ItineraryItem[],
  driveSecondsById?: Map<string, number>
): ScheduleChange[] {
  const byDay = new Map<string, ItineraryItem[]>();
  for (const item of items) {
    if (!item.date) continue;
    if (!byDay.has(item.date)) byDay.set(item.date, []);
    byDay.get(item.date)!.push(item);
  }
  const out: ScheduleChange[] = [];
  for (const dayItems of byDay.values()) {
    out.push(...sequenceDay(dayItems, driveSecondsById));
  }
  return out;
}
