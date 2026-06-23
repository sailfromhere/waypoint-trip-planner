import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type {
  trips,
  travelers,
  itineraryItems,
  planningTurns,
  tripTasks,
  checklistTemplates,
  checklistInstances,
  packingItems,
  packingTemplates,
  packingItemTemplates,
  packingListItems,
  provenanceType,
  packingRequiredness,
} from "./schema";

// ── Row types (what you get from a SELECT) ──

export type Trip = InferSelectModel<typeof trips>;
export type Traveler = InferSelectModel<typeof travelers>;
export type ItineraryItem = InferSelectModel<typeof itineraryItems>;
// A render-layer item carrying a stable client-side React identity (`_key`).
// On optimistic create the row gets a `temp-…` id that `onSuccess` swaps for the
// real server id; keying React off `_key` (set once at create and carried
// through the swap) keeps the row MOUNTED across that id change, so an
// in-progress title/location edit isn't destroyed. `_key` is never persisted.
export type ItineraryItemRow = ItineraryItem & { _key?: string };
export type PlanningTurn = InferSelectModel<typeof planningTurns>;
export type TripTask = InferSelectModel<typeof tripTasks>;
export type ChecklistTemplate = InferSelectModel<typeof checklistTemplates>;
export type ChecklistInstance = InferSelectModel<typeof checklistInstances>;
export type PackingItem = InferSelectModel<typeof packingItems>;
export type PackingTemplate = InferSelectModel<typeof packingTemplates>;
export type PackingItemTemplate = InferSelectModel<typeof packingItemTemplates>;
export type PackingListItem = InferSelectModel<typeof packingListItems>;

// ── Insert types (what you pass to an INSERT) ──

export type NewTrip = InferInsertModel<typeof trips>;
export type NewTraveler = InferInsertModel<typeof travelers>;
export type NewItineraryItem = InferInsertModel<typeof itineraryItems>;
export type NewPlanningTurn = InferInsertModel<typeof planningTurns>;
export type NewTripTask = InferInsertModel<typeof tripTasks>;
export type NewChecklistTemplate = InferInsertModel<typeof checklistTemplates>;
export type NewChecklistInstance = InferInsertModel<typeof checklistInstances>;
export type NewPackingItem = InferInsertModel<typeof packingItems>;
export type NewPackingTemplate = InferInsertModel<typeof packingTemplates>;
export type NewPackingItemTemplate = InferInsertModel<
  typeof packingItemTemplates
>;
export type NewPackingListItem = InferInsertModel<typeof packingListItems>;

export type PackingRequiredness = (typeof packingRequiredness)[number];

// ── Provenance ──

export type Provenance = (typeof provenanceType)[number];
export type FieldProvenance = Record<string, Provenance>;

// ── Trackable fields: the itinerary item fields that carry provenance ──

const TRACKABLE_FIELDS = [
  "date",
  "startTime",
  "endTime",
  "durationMinutes",
  "originName",
  "originLat",
  "originLng",
  "destinationName",
  "destinationLat",
  "destinationLng",
  "category",
  "title",
  "notes",
  "confirmationStatus",
  "costCents",
  "links",
] as const;

export type TrackableField = (typeof TRACKABLE_FIELDS)[number];

export function stampProvenance(
  fields: Partial<Record<TrackableField, unknown>>,
  source: Provenance
): FieldProvenance {
  const provenance: FieldProvenance = {};
  for (const key of TRACKABLE_FIELDS) {
    if (key in fields && fields[key] !== undefined) {
      provenance[key] = source;
    }
  }
  return provenance;
}
