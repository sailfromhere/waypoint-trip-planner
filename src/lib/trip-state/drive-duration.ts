import type { FieldProvenance, ItineraryItem } from "@/db/types";

/**
 * Decide the `durationMinutes` to write for a drive from its REAL routed time
 * (geography keystone — drive times always come from the routing API, never
 * invented), or `null` to leave it alone. Pure so it can be unit-tested.
 *
 * Rules:
 *  - Only drives, only when the route produced a positive duration.
 *  - FILL a blank duration.
 *  - REFRESH a duration WE previously auto-derived (`historical_estimate`) when
 *    the routed time has changed — e.g. the user corrects a mis-geocoded
 *    location, the drive re-routes, and the stale auto-filled duration must
 *    follow. (Returns the value only when it actually differs, so the effect
 *    that calls this self-terminates and doesn't loop.)
 *  - NEVER touch a `user_provided` or `ai_assumption` PLANNED duration (a scenic
 *    drive planned at 60 min keeps 60 even if routed at 16 — the durationOf
 *    lesson). Those carry intent; only our own machine estimate tracks routing.
 */
export function autoDriveDuration(
  item: Pick<ItineraryItem, "category" | "durationMinutes" | "fieldProvenance">,
  routedSeconds: number | undefined
): number | null {
  if (item.category !== "drive") return null;
  if (!routedSeconds || routedSeconds <= 0) return null;

  const routedMin = Math.round(routedSeconds / 60);
  if (item.durationMinutes == null) return routedMin;

  const prov = (item.fieldProvenance ?? {}) as FieldProvenance;
  if (prov.durationMinutes === "historical_estimate" && item.durationMinutes !== routedMin) {
    return routedMin;
  }
  return null;
}
