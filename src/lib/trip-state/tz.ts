import { DateTime } from "luxon";
import type { ItineraryItem } from "@/db/types";

/**
 * Timezone math for the itinerary. The ONLY module that touches Luxon directly,
 * so the dependency stays swappable and every tz conversion is in one place.
 *
 * The model (see CLAUDE.md keystones + the TZ plan):
 *  - `startTime` is wall-clock in the item's ORIGIN tz; `endTime` is wall-clock
 *    in its DESTINATION tz. They differ only for cross-tz movement.
 *  - `durationMinutes` is the source of truth for ELAPSED time. We never derive
 *    elapsed from a wall-clock subtraction across a tz boundary.
 *  - We compute on UTC INSTANTS and convert to a zone only for display/anchoring.
 *  - IANA names (never frozen offsets) → Luxon resolves DST per-date.
 */

/** Browser/system IANA tz — the last-resort fallback when nothing else is known. */
export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Wall-clock (`YYYY-MM-DD` + `HH:MM`) interpreted in `tz` → a UTC instant. */
export function localToInstant(date: string, hhmm: string, tz: string): DateTime {
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!dm) return DateTime.invalid("bad date");
  return DateTime.fromObject(
    {
      year: Number(dm[1]),
      month: Number(dm[2]),
      day: Number(dm[3]),
      hour: tm ? Number(tm[1]) : 0,
      minute: tm ? Number(tm[2]) : 0,
    },
    { zone: tz }
  ).toUTC();
}

/** UTC instant → wall-clock parts (`date` + `hhmm`) in `tz`. */
export function instantToLocal(
  dt: DateTime,
  tz: string
): { date: string; hhmm: string } {
  const z = dt.setZone(tz);
  return { date: z.toFormat("yyyy-MM-dd"), hhmm: z.toFormat("HH:mm") };
}

/**
 * Arrival wall-clock at the destination, from a departure wall-clock + ELAPSED
 * duration, crossing `originTz` → `destTz`. `dayOffset` is the integer number of
 * calendar days the arrival date is past the departure date (1 = lands next day),
 * so the calendar/labels can show a red-eye correctly.
 */
export function arrivalLocal(
  date: string,
  startTime: string,
  durationMinutes: number,
  originTz: string,
  destTz: string
): { date: string; hhmm: string; dayOffset: number } {
  const arrive = localToInstant(date, startTime, originTz).plus({
    minutes: durationMinutes,
  });
  const local = instantToLocal(arrive, destTz);
  const dayOffset = Math.round(
    DateTime.fromISO(local.date).diff(DateTime.fromISO(date), "days").days
  );
  return { ...local, dayOffset };
}

/**
 * Localized short zone name for a tz at a given instant, e.g. "PST"/"PDT"/"EST".
 * DST-correct because it depends on the instant. Falls back to a GMT offset for
 * zones without a short name.
 */
export function zoneAbbrev(tz: string, instant: DateTime): string {
  return instant.setZone(tz).toFormat("ZZZZ");
}

/**
 * Resolve an item's single LOCAL tz (where it "happens") for non-movement
 * display and as the sequencer's per-item frame. Fallback chain:
 * destination → origin → trip home → system.
 */
export function itemLocalTz(
  item: Pick<ItineraryItem, "originTimezone" | "destinationTimezone">,
  homeTz: string | null | undefined
): string {
  return (
    item.destinationTimezone ??
    item.originTimezone ??
    homeTz ??
    systemTimezone()
  );
}

/**
 * The ORIGIN tz of an item (where startTime is measured). For non-movement items
 * origin == destination, so we fall through to the single local tz.
 */
export function itemOriginTz(
  item: Pick<ItineraryItem, "originTimezone" | "destinationTimezone">,
  homeTz: string | null | undefined
): string {
  return (
    item.originTimezone ??
    item.destinationTimezone ??
    homeTz ??
    systemTimezone()
  );
}

/** True when an item's two endpoints are in different timezones (cross-tz leg). */
export function isCrossTimezone(
  item: Pick<ItineraryItem, "originTimezone" | "destinationTimezone">
): boolean {
  return (
    item.originTimezone != null &&
    item.destinationTimezone != null &&
    item.originTimezone !== item.destinationTimezone
  );
}
