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
