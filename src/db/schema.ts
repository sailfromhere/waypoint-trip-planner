import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  date,
  time,
  jsonb,
  real,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Enums as const objects (Drizzle pgEnum is optional; const + check is simpler) ──

export const tripStatus = [
  "dreaming",
  "planning",
  "booked",
  "in_progress",
  "completed",
] as const;

export const travelerRole = ["owner", "editor", "viewer"] as const;

export const itemCategory = [
  "drive",
  "flight",
  "activity",
  "meal",
  "lodging",
  "transit",
  "rest",
  "other",
] as const;

export const confirmationStatus = [
  "idea",
  "planned",
  "booked",
  "completed",
] as const;

export const provenanceType = [
  "ai_assumption",
  "historical_estimate",
  "user_provided",
  "live_researched",
] as const;

// Packing requiredness as a priority badge. PRD's "always required" is captured
// separately by the `alwaysInclude` boolean (loads into every trip regardless of
// template); "template required" = requiredness "required" AND in a loaded template.
export const packingRequiredness = ["required", "recommended", "optional"] as const;

// ── Tables ──

export const trips = pgTable("trips", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: text("status", { enum: tripStatus }).notNull().default("dreaming"),
  budgetCents: integer("budget_cents"),
  currency: text("currency").notNull().default("USD"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const travelers = pgTable("travelers", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  role: text("role", { enum: travelerRole }).notNull().default("editor"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const itineraryItems = pgTable("itinerary_items", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  date: date("date"),
  startTime: time("start_time"),
  endTime: time("end_time"),
  durationMinutes: integer("duration_minutes"),

  originName: text("origin_name"),
  originLat: real("origin_lat"),
  originLng: real("origin_lng"),

  destinationName: text("destination_name"),
  destinationLat: real("destination_lat"),
  destinationLng: real("destination_lng"),

  category: text("category", { enum: itemCategory })
    .notNull()
    .default("other"),
  title: text("title").notNull(),
  notes: text("notes"),
  confirmationStatus: text("confirmation_status", {
    enum: confirmationStatus,
  })
    .notNull()
    .default("idea"),
  costCents: integer("cost_cents"),
  currency: text("currency").notNull().default("USD"),
  links: jsonb("links").$type<string[]>().default([]),
  sortOrder: integer("sort_order").notNull().default(0),

  // Per-field provenance: maps field name → provenance type.
  // E.g. { "costCents": "ai_assumption", "startTime": "user_provided" }
  fieldProvenance: jsonb("field_provenance")
    .$type<Record<string, (typeof provenanceType)[number]>>()
    .notNull()
    .default({}),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Planning turns: a persistent log of AI copilot interactions. Each row is one
// prompt → response. `actions` is a JSONB snapshot of the proposed PlanAction[]
// (see src/lib/ai/planner.ts); `acceptedActionIds` records which were applied.
export const planningTurns = pgTable("planning_turns", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  reasoning: text("reasoning").notNull().default(""),
  // The back-and-forth conversation for this turn (text-only, alternating
  // user/assistant). The first user message is `prompt`; refinements append.
  messages: jsonb("messages")
    .$type<{ role: "user" | "assistant"; content: string }[]>()
    .notNull()
    .default([]),
  actions: jsonb("actions").$type<unknown[]>().notNull().default([]),
  acceptedActionIds: jsonb("accepted_action_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const checklistTemplates = pgTable("checklist_templates", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  category: text("category"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const checklistInstances = pgTable("checklist_instances", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  templateId: text("template_id").references(() => checklistTemplates.id, {
    onDelete: "set null",
  }),
  text: text("text").notNull(),
  category: text("category"),
  done: boolean("done").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Packing system (Phase 5) ──
// Same repository → per-trip-instance, copy-on-instantiate pattern as the
// checklist (checklistTemplates/checklistInstances), extended with quantity,
// requiredness, shared/personal, and many-to-many template membership.

// Master gear repository (user-level, not per-trip).
export const packingItems = pgTable("packing_items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  requiredness: text("requiredness", { enum: packingRequiredness })
    .notNull()
    .default("recommended"),
  // "Always required" — instantiated into every trip regardless of template.
  alwaysInclude: boolean("always_include").notNull().default(false),
  // Group gear (one for the whole party) vs personal (each traveler brings own).
  shared: boolean("shared").notNull().default(false),
  defaultQuantity: integer("default_quantity").notNull().default(1),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Named template sets (e.g. Beach, Backpacking, Road Trip, Photography).
export const packingTemplates = pgTable("packing_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Join: a master item belongs to many templates (camera ∈ Photography + Road Trip).
export const packingItemTemplates = pgTable("packing_item_templates", {
  id: text("id").primaryKey(),
  packingItemId: text("packing_item_id")
    .notNull()
    .references(() => packingItems.id, { onDelete: "cascade" }),
  templateId: text("template_id")
    .notNull()
    .references(() => packingTemplates.id, { onDelete: "cascade" }),
});

// Per-trip packing list (copy-on-instantiate from the master repository).
export const packingListItems = pgTable("packing_list_items", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  // Nullable: ad-hoc per-trip items have no master source. set null so deleting
  // a master item doesn't drop an in-flight trip's packing entry.
  packingItemId: text("packing_item_id").references(() => packingItems.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  category: text("category"),
  requiredness: text("requiredness", { enum: packingRequiredness })
    .notNull()
    .default("recommended"),
  quantity: integer("quantity").notNull().default(1),
  shared: boolean("shared").notNull().default(false),
  // Modeled now; no traveler-picker UI yet (Phase 5b). set null so removing a
  // traveler doesn't drop the packing item.
  assignedTravelerId: text("assigned_traveler_id").references(
    () => travelers.id,
    { onDelete: "set null" }
  ),
  packed: boolean("packed").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tripTasks = pgTable("trip_tasks", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  done: boolean("done").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Relations ──

export const tripsRelations = relations(trips, ({ many }) => ({
  travelers: many(travelers),
  itineraryItems: many(itineraryItems),
  planningTurns: many(planningTurns),
  tripTasks: many(tripTasks),
  checklistInstances: many(checklistInstances),
  packingListItems: many(packingListItems),
}));

export const packingItemsRelations = relations(packingItems, ({ many }) => ({
  templates: many(packingItemTemplates),
  instances: many(packingListItems),
}));

export const packingTemplatesRelations = relations(
  packingTemplates,
  ({ many }) => ({
    items: many(packingItemTemplates),
  })
);

export const packingItemTemplatesRelations = relations(
  packingItemTemplates,
  ({ one }) => ({
    item: one(packingItems, {
      fields: [packingItemTemplates.packingItemId],
      references: [packingItems.id],
    }),
    template: one(packingTemplates, {
      fields: [packingItemTemplates.templateId],
      references: [packingTemplates.id],
    }),
  })
);

export const packingListItemsRelations = relations(
  packingListItems,
  ({ one }) => ({
    trip: one(trips, {
      fields: [packingListItems.tripId],
      references: [trips.id],
    }),
    masterItem: one(packingItems, {
      fields: [packingListItems.packingItemId],
      references: [packingItems.id],
    }),
    assignedTraveler: one(travelers, {
      fields: [packingListItems.assignedTravelerId],
      references: [travelers.id],
    }),
  })
);

export const planningTurnsRelations = relations(planningTurns, ({ one }) => ({
  trip: one(trips, { fields: [planningTurns.tripId], references: [trips.id] }),
}));

export const travelersRelations = relations(travelers, ({ one }) => ({
  trip: one(trips, { fields: [travelers.tripId], references: [trips.id] }),
}));

export const tripTasksRelations = relations(tripTasks, ({ one }) => ({
  trip: one(trips, { fields: [tripTasks.tripId], references: [trips.id] }),
}));

export const checklistTemplatesRelations = relations(
  checklistTemplates,
  ({ many }) => ({
    instances: many(checklistInstances),
  })
);

export const checklistInstancesRelations = relations(
  checklistInstances,
  ({ one }) => ({
    trip: one(trips, {
      fields: [checklistInstances.tripId],
      references: [trips.id],
    }),
    template: one(checklistTemplates, {
      fields: [checklistInstances.templateId],
      references: [checklistTemplates.id],
    }),
  })
);

export const itineraryItemsRelations = relations(
  itineraryItems,
  ({ one }) => ({
    trip: one(trips, {
      fields: [itineraryItems.tripId],
      references: [trips.id],
    }),
  })
);
