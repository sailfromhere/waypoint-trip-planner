// Shared display formatting helpers.

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
