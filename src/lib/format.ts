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
