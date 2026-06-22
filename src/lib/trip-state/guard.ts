import type { FieldProvenance, Provenance, TrackableField } from "@/db/types";

/**
 * Tiered sacred-data model (revised 2026-06-20).
 *
 * The old rule was binary: AI may NEVER touch user_provided / booked. Field use
 * showed that's too rigid — the user wants AI to still help with *labels*
 * (title/notes/category) even on booked items, and to edit their own typed
 * fields, as long as it's a deliberate, confirmed action. Only a booked item's
 * hard FACTS (when/where/cost) stay machine-locked.
 *
 * `fieldLockLevel(field, item)` →
 *   "hard"    — never AI-writable (booked item's factual fields). UI: 🔒 change manually.
 *   "confirm" — AI may propose, but the human must opt in (unchecked by default).
 *   "open"    — AI may change freely (default-checked).
 *
 * The confirmation IS the existing preview-then-commit diff: a "confirm" field
 * applies only because the user selected the action.
 */

// A booked item's factual fields — locked hard once booked, regardless of who
// authored them (you booked on these facts; AI must not silently move them).
const HARD_BOOKED_FIELDS = new Set<TrackableField>([
  "date",
  "startTime",
  "endTime",
  "originName",
  "originLat",
  "originLng",
  "destinationName",
  "destinationLat",
  "destinationLng",
  "costCents",
]);

export type LockLevel = "hard" | "confirm" | "open";

export function fieldLockLevel(
  field: string,
  item: { fieldProvenance: unknown; confirmationStatus: string }
): LockLevel {
  const prov = (item.fieldProvenance ?? {}) as FieldProvenance;
  if (item.confirmationStatus === "booked") {
    // Hard facts are locked; soft labels (title/notes/category/etc.) → confirm.
    return HARD_BOOKED_FIELDS.has(field as TrackableField) ? "hard" : "confirm";
  }
  // Non-booked: the human's own fields need confirmation — UNLESS the field is
  // currently EMPTY. An empty field holds no human data to protect, so it's
  // freely fillable (e.g. auto-schedule writing a blank startTime). This also
  // recovers items left with a stale `user_provided` stamp on a value the user
  // cleared under older code (before clearing dropped the provenance).
  if (prov[field as TrackableField] === "user_provided") {
    const v = (item as Record<string, unknown>)[field];
    return v == null || v === "" ? "open" : "confirm";
  }
  return "open";
}

export function fieldLockReason(field: string, level: LockLevel): string {
  if (level === "hard") return `${field}: booked — change manually`;
  if (level === "confirm") return `${field}: overrides your data — confirm`;
  return "";
}

// Deleting a whole item: booked → hard (remove manually); an item carrying any
// human-authored field → confirm; a fully-AI item → open.
export function deleteLockLevel(item: {
  fieldProvenance: unknown;
  confirmationStatus: string;
}): LockLevel {
  if (item.confirmationStatus === "booked") return "hard";
  const prov = (item.fieldProvenance ?? {}) as FieldProvenance;
  return Object.values(prov).includes("user_provided") ? "confirm" : "open";
}

/**
 * Hard guard for write paths WITHOUT a confirmation UI (the item PATCH route).
 * There's nobody to confirm, so anything not "open" is rejected — this keeps
 * the original strict behavior for direct AI writes. The plan/accept path does
 * NOT use this; it uses the tiered levels directly so "confirm" can apply.
 */
export function guardHumanData(
  existing: { fieldProvenance: unknown; confirmationStatus: string },
  updates: Record<string, unknown>,
  source: Provenance
): string[] {
  if (source === "user_provided") return [];

  const violations: string[] = [];
  for (const field of Object.keys(updates)) {
    const level = fieldLockLevel(field, existing);
    if (level !== "open") {
      violations.push(fieldLockReason(field, level));
    }
  }
  return violations;
}

/** Hard delete guard for paths without confirmation (parity with the above). */
export function guardDelete(
  existing: { fieldProvenance: unknown; confirmationStatus: string },
  source: Provenance
): string[] {
  if (source === "user_provided") return [];
  const level = deleteLockLevel(existing);
  if (level === "open") return [];
  return [
    level === "hard"
      ? `Item is booked and cannot be deleted by ${source} — remove manually`
      : `Item has your data; deletion needs confirmation`,
  ];
}
