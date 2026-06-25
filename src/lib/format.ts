// Shared display formatting helpers.

import type { ItineraryItem } from "@/db/types";
import {
  localToInstant,
  instantToLocal,
  zoneAbbrev,
  itemOriginTz,
  itemLocalTz,
  isCrossTimezone,
} from "./trip-state/tz";

/** The placeholder shown for an itinerary item that has no title yet. Keep in
 * sync with the table's EditableCell placeholder so the empty-title fallback
 * reads identically across the table, map popups, and the calendar. */
export const UNTITLED_LABEL = "Untitled";

/** True when an itinerary item has no meaningful (non-whitespace) title. */
export function isUntitled(title: string | null | undefined): boolean {
  return !title || !title.trim();
}

/** The title to display, falling back to the shared placeholder when empty. */
export function displayTitle(title: string | null | undefined): string {
  return isUntitled(title) ? UNTITLED_LABEL : (title as string);
}

/** Friendly itinerary date from an ISO `YYYY-MM-DD` string, e.g. "Mon, Jul 12".
 * Parsed timezone-SAFELY: we split the parts and build a LOCAL `Date(y, m-1, d)`
 * — `new Date("2026-07-12")` parses as UTC midnight and renders the previous day
 * in negative-offset zones. Falls back to the raw string if it isn't ISO-shaped. */
export function formatItineraryDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function hhmm(t: string | null): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** Fields the timezone-aware label reads. */
type TimeLabelItem = Pick<
  ItineraryItem,
  | "date"
  | "startTime"
  | "endTime"
  | "durationMinutes"
  | "originTimezone"
  | "destinationTimezone"
>;

/**
 * Smart timezone-aware time label, shared by the table, map popup, and calendar
 * so they read identically. Returns `null` when there's nothing special to add
 * (no start time, or the item sits in the trip's home tz) — callers then show
 * the plain `startTime`.
 *
 *  - Single-place item in a NON-home tz → `"19:00 EST"`.
 *  - Cross-tz movement (flight / long drive) → `"09:00 PST → 17:30 EST"`,
 *    suffixed `" +1"` when the arrival lands on a later day (red-eye).
 *  - durationMinutes (elapsed truth) drives the arrival; falls back to a stored
 *    endTime only when there's no duration.
 */
export function formatItemTimeLabel(
  item: TimeLabelItem,
  homeTz: string | null | undefined
): string | null {
  const start = hhmm(item.startTime);
  if (!start || !item.date) return null;

  const originTz = itemOriginTz(item, homeTz);
  const destTz = itemLocalTz(item, homeTz);
  const departInstant = localToInstant(item.date, start, originTz);
  if (!departInstant.isValid) return null;

  const cross = isCrossTimezone(item);

  if (!cross) {
    // Single tz. Annotate only when it differs from the trip home tz.
    if (!homeTz || originTz === homeTz) return null;
    return `${start} ${zoneAbbrev(originTz, departInstant)}`;
  }

  // Cross-tz movement: depart-local → arrive-local, both labeled.
  const startAbbrev = zoneAbbrev(originTz, departInstant);
  let arriveInstant = departInstant;
  if (item.durationMinutes != null && item.durationMinutes > 0) {
    arriveInstant = departInstant.plus({ minutes: item.durationMinutes });
  } else {
    const end = hhmm(item.endTime);
    if (end) arriveInstant = localToInstant(item.date, end, destTz);
  }
  const arr = instantToLocal(arriveInstant, destTz);
  const arrAbbrev = zoneAbbrev(destTz, arriveInstant);
  const rollover = arr.date !== item.date ? " +1" : "";
  return `${start} ${startAbbrev} → ${arr.hhmm} ${arrAbbrev}${rollover}`;
}

/**
 * COMPACT tz badge for the dense table Start cell — just the zone abbreviation,
 * not the full time. `null` (nothing to show) for a plain home-tz item.
 *  - Cross-tz movement → arrival zone, arrow-prefixed: `"→EST"` (where you land).
 *  - Single-place item in a non-home tz → its zone: `"EST"`.
 * Pair with `formatItemTimeLabel` as the cell's tooltip for the full detail.
 */
export function formatItemTzBadge(
  item: TimeLabelItem,
  homeTz: string | null | undefined
): string | null {
  const start = hhmm(item.startTime);
  if (!start || !item.date) return null;
  const originTz = itemOriginTz(item, homeTz);
  const departInstant = localToInstant(item.date, start, originTz);
  if (!departInstant.isValid) return null;

  if (isCrossTimezone(item)) {
    const destTz = itemLocalTz(item, homeTz);
    const arriveInstant =
      item.durationMinutes != null && item.durationMinutes > 0
        ? departInstant.plus({ minutes: item.durationMinutes })
        : departInstant;
    return `→${zoneAbbrev(destTz, arriveInstant)}`;
  }
  if (!homeTz || originTz === homeTz) return null;
  return zoneAbbrev(originTz, departInstant);
}

/** Human-readable duration from a count of MINUTES, e.g. "2h 15m", "45m".
 * Centralizes the logic that was duplicated in planning-panel.tsx. */
export function formatDurationMinutes(min: number): string {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  }
  return `${min}m`;
}

/** Human-readable duration from a count of SECONDS (rounded to the minute),
 * e.g. "2h 15m", "45m". Used for routed drive durations. */
export function formatDurationSeconds(seconds: number): string {
  return formatDurationMinutes(Math.round(seconds / 60));
}

export type DistanceUnit = "km" | "mi";

/** Human-readable distance from a count of METERS in the requested unit, e.g.
 * "187 km" / "116 mi". Defaults to km (the app-wide convention); the `unit`
 * param leaves the door open for a future user setting (cf. 12/24h time). */
export function formatDistanceMeters(meters: number, unit: DistanceUnit = "km"): string {
  if (unit === "mi") {
    const mi = meters / 1609.344;
    return `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
  }
  const km = meters / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}
