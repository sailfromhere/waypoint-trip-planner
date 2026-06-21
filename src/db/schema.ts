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
}));

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
