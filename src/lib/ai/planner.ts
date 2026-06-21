import Anthropic from "@anthropic-ai/sdk";
import type { Trip, ItineraryItem } from "@/db/types";
import { itemCategory, confirmationStatus } from "@/db/schema";
import {
  fieldLockLevel,
  deleteLockLevel,
  fieldLockReason,
  type LockLevel,
} from "@/lib/trip-state/guard";

// Lazy so importing this module (e.g. in tests, or builds without a key) does
// not construct the client or require ANTHROPIC_API_KEY at import time.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

// ── Action model ────────────────────────────────────────────────────────────
// The copilot proposes a batch of previewable diffs. Three kinds:
//   create  — a brand-new item
//   update  — change fields on an existing item (a pure date/sortOrder change is
//             rendered as a "move/reorder" by the UI, but applied identically)
//   delete  — remove an existing item
// All update/delete actions are checked against the sacred-data guard at preview
// time (server-annotated `blocked`) and again at apply time.

export interface ProposedItem {
  date: string | null;
  title: string;
  category: (typeof itemCategory)[number];
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  originName: string | null;
  destinationName: string | null;
  notes: string | null;
  costCents: number | null;
  confirmationStatus: (typeof confirmationStatus)[number];
}

// Fields the AI may change on an existing item.
export interface ItemChanges {
  date?: string | null;
  title?: string;
  category?: (typeof itemCategory)[number];
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  originName?: string | null;
  destinationName?: string | null;
  notes?: string | null;
  costCents?: number | null;
  confirmationStatus?: (typeof confirmationStatus)[number];
  sortOrder?: number;
}

export interface CreateAction {
  type: "create";
  item: ProposedItem;
}

// Action-level lock: "blocked" = nothing in it can apply (every changed field
// is hard-locked, or a delete of a booked item); "confirm" = applies only on a
// deliberate opt-in; "open" = safe to apply.
export type ActionLock = "open" | "confirm" | "blocked";

export interface UpdateAction {
  type: "update";
  itemId: string;
  changes: ItemChanges;
  reason: string | null;
  // Server-annotated at preview time:
  before?: Record<string, unknown> | null;
  itemTitle?: string | null;
  fieldLocks?: Record<string, LockLevel>; // per changed field
  lockLevel?: ActionLock;
  hardReasons?: string[]; // fields that WON'T apply (shown always)
  confirmReasons?: string[]; // fields needing opt-in
}

export interface DeleteAction {
  type: "delete";
  itemId: string;
  reason: string | null;
  // Server-annotated at preview time:
  itemTitle?: string | null;
  lockLevel?: ActionLock;
  lockReason?: string | null;
}

export type PlanAction = CreateAction | UpdateAction | DeleteAction;

// Text-only conversation message (stored on the turn; powers refinement).
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PlanResult {
  reasoning: string;
  actions: PlanAction[];
  messages: ConversationMessage[];
  // Short refs the model used that didn't match any existing item — surfaced to
  // the user instead of silently dropped (the #1 "only changed some" cause).
  unmatchedRefs: string[];
}

// Short, copyable handles for existing items (e.g. "R1") — the model echoes
// these back reliably, unlike 21-char nanoids which it mis-transcribes.
function itemRef(index: number): string {
  return `R${index + 1}`;
}

export function buildRefMaps(items: ItineraryItem[]): {
  refToId: Map<string, string>;
  idToRef: Map<string, string>;
} {
  const refToId = new Map<string, string>();
  const idToRef = new Map<string, string>();
  items.forEach((item, i) => {
    const ref = itemRef(i);
    refToId.set(ref, item.id);
    idToRef.set(item.id, ref);
  });
  return { refToId, idToRef };
}

// ── Tool definition ──────────────────────────────────────────────────────────

const CHANGE_FIELDS = {
  date: { type: "string", description: "YYYY-MM-DD, or null to unschedule." },
  title: { type: "string" },
  category: { type: "string", enum: [...itemCategory] },
  startTime: { type: "string", description: "HH:MM (24h)." },
  endTime: { type: "string", description: "HH:MM (24h)." },
  durationMinutes: { type: "integer" },
  originName: { type: "string", description: "For drives: starting place." },
  destinationName: { type: "string", description: "Place name or address." },
  notes: { type: "string" },
  costCents: { type: "integer", description: "Cost in cents (5000 = $50)." },
  confirmationStatus: { type: "string", enum: [...confirmationStatus] },
} as const;

const REVISE_TOOL: Anthropic.Tool = {
  name: "revise_itinerary",
  description:
    "Propose changes to the trip itinerary as a batch of diffs. Use `creates` " +
    "for new items, `updates` to change existing items (including moving one to " +
    "a different day via `date` or reordering via `sortOrder`), and `deletes` to " +
    "remove items. Reference existing items by their short `ref` (e.g. R1, R2) " +
    "exactly as shown in the context. Leave fields empty/null when uncertain — " +
    "never guess. You MAY edit " +
    "labels (title/notes/category) and the user's own fields (the human confirms " +
    "every change), but NEVER change a (booked) item's facts: date, times, " +
    "origin/destination, or cost.",
  input_schema: {
    type: "object" as const,
    properties: {
      creates: {
        type: "array",
        description: "Brand-new items to add.",
        items: {
          type: "object",
          properties: {
            ...CHANGE_FIELDS,
            confirmationStatus: {
              type: "string",
              enum: [...confirmationStatus],
              description: "Default to 'idea' for AI-generated items.",
            },
          },
          required: ["title", "category"],
        },
      },
      updates: {
        type: "array",
        description:
          "Changes to existing items. Include only the fields you are changing.",
        items: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "Short ref of the existing item to change, e.g. R1.",
            },
            sortOrder: {
              type: "integer",
              description: "New position within its day (lower = earlier).",
            },
            reason: {
              type: "string",
              description: "Short why, shown to the user in the diff.",
            },
            ...CHANGE_FIELDS,
          },
          required: ["ref"],
        },
      },
      deletes: {
        type: "array",
        description: "Existing items to remove.",
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "Short ref, e.g. R1." },
            reason: {
              type: "string",
              description: "Short why, shown to the user in the diff.",
            },
          },
          required: ["ref"],
        },
      },
    },
  },
};

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(trip: Trip, existingItems: ItineraryItem[]): string {
  const lines = [
    "You are a practical travel planning assistant for the app Waypoint.",
    "Your job is to turn a vague or partial travel idea into a realistic, day-by-day itinerary, and to refine an existing one when asked.",
    "",
    "## Principles",
    "- PRACTICALITY over aesthetics: realistic pacing, real geography, achievable daily schedules.",
    "- Drive times and distances should reflect real-world geography (estimate conservatively; do not invent precise numbers).",
    "- If a day would exceed ~10 hours of activity + driving, split it or cut something.",
    "- Safe-empty: if you're uncertain about a field (cost, duration, time), LEAVE IT NULL. Never invent a number you don't have reasonable confidence in.",
    "- Before calling the revise_itinerary tool, briefly explain your reasoning: key tradeoffs, pacing logic, and why you chose this route/order. Then call the tool.",
    "- Default confirmationStatus to 'idea' for all AI-generated items.",
    "- For cost estimates: round to nearest $5-10. Leave null if truly unknown.",
    "- Include drive legs between locations as separate 'drive' category items with an originName and destinationName.",
    "- Consider lodging: where will the travelers sleep each night?",
    "",
    "## Editing existing items",
    "- To change an existing item, use `updates` with its short `ref` (e.g. R1) exactly as shown — do NOT create a duplicate.",
    "- To move an item to another day, set `date` (and optionally `sortOrder`) in an update.",
    "- To remove an item, use `deletes`.",
    "- EXHAUSTIVE: when the user asks to change 'all' / 'every' / 'each' item (e.g. translate every note), emit an update for EVERY matching item — do not stop after a few. It is fine to return many updates.",
    "- You MAY propose edits to labels (title, notes, category) and to the user's own fields when the request calls for it — the human reviews and confirms every change, so propose what's genuinely helpful.",
    "- HARD RULE — never propose changing a (booked) item's FACTS: its date, times, origin/destination, or cost. Those are locked; if the user wants them changed, say in your reasoning that they must edit those manually. You MAY still propose a booked item's title/notes/category.",
    "",
    "## Current trip context",
    `Name: ${trip.name}`,
    trip.description ? `Description: ${trip.description}` : null,
    trip.startDate ? `Dates: ${trip.startDate} → ${trip.endDate ?? "open-ended"}` : "Dates: not set",
    trip.budgetCents ? `Budget: $${(trip.budgetCents / 100).toFixed(0)} ${trip.currency}` : null,
    `Status: ${trip.status}`,
  ].filter(Boolean);

  if (existingItems.length > 0) {
    lines.push(
      "",
      "## Existing itinerary items",
      "Reference these by their short `ref` (e.g. R1) for updates/deletes. [user] marks human-authored fields; (booked) marks booked items (their facts are locked — labels still editable).",
      ""
    );
    existingItems.forEach((item, i) => {
      const prov = (item.fieldProvenance ?? {}) as Record<string, string>;
      const userFields = Object.keys(prov).filter(
        (k) => prov[k] === "user_provided"
      );
      const parts = [
        `${itemRef(i)}:`,
        item.date ?? "unscheduled",
        item.startTime ? `@${item.startTime}` : "",
        `[${item.category}]`,
        item.title,
        item.destinationName ? `at ${item.destinationName}` : "",
        `(${item.confirmationStatus})`,
        userFields.length ? `[user: ${userFields.join(", ")}]` : "",
      ].filter(Boolean);
      lines.push(`- ${parts.join(" ")}`);
    });
    lines.push(
      "",
      "Fill gaps and apply the user's requested changes. Add missing days, drive legs, meals, lodging; update or remove items as asked — but respect the sacred-data rule above."
    );
  }

  return lines.join("\n");
}

// ── Generation & refinement ───────────────────────────────────────────────────

// One revision round: send the conversation, get reasoning + actions back.
// Uses the two-turn pattern (Claude tends to reason first; if it didn't call
// the tool, force it). Pure of persistence — callers own the messages/DB.
async function runRevision(
  systemPrompt: string,
  conversation: ConversationMessage[],
  refToId: Map<string, string>
): Promise<{ reasoning: string; actions: PlanAction[]; unmatchedRefs: string[] }> {
  const messages: Anthropic.MessageParam[] = conversation.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const response = await getClient().messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    system: systemPrompt,
    tools: [REVISE_TOOL],
    tool_choice: { type: "auto" },
    messages,
  });

  let reasoning = "";
  let actions: PlanAction[] = [];
  let unmatchedRefs: string[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      reasoning += block.text;
    } else if (block.type === "tool_use" && block.name === "revise_itinerary") {
      ({ actions, unmatchedRefs } = parseActions(block.input, refToId));
    }
  }

  // Claude reasoned but didn't call the tool — force it.
  if (actions.length === 0 && reasoning.length > 0) {
    messages.push(
      { role: "assistant", content: response.content },
      {
        role: "user",
        content:
          "Great reasoning. Now call the revise_itinerary tool with the full set of changes.",
      }
    );

    const followUp = await getClient().messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      system: systemPrompt,
      tools: [REVISE_TOOL],
      tool_choice: { type: "any" },
      messages,
    });

    for (const block of followUp.content) {
      if (block.type === "tool_use" && block.name === "revise_itinerary") {
        ({ actions, unmatchedRefs } = parseActions(block.input, refToId));
      }
    }
  }

  return { reasoning, actions, unmatchedRefs };
}

export async function generatePlan(
  trip: Trip,
  existingItems: ItineraryItem[],
  prompt: string
): Promise<PlanResult> {
  const systemPrompt = buildSystemPrompt(trip, existingItems);
  const { refToId } = buildRefMaps(existingItems);

  const { reasoning, actions, unmatchedRefs } = await runRevision(
    systemPrompt,
    [{ role: "user", content: prompt }],
    refToId
  );

  return {
    reasoning,
    actions: annotateActions(actions, existingItems),
    unmatchedRefs,
    messages: [
      { role: "user", content: prompt },
      { role: "assistant", content: assistantContent(reasoning) },
    ],
  };
}

// Continue a planning conversation: the user gives feedback on the current
// (not-yet-applied) proposal; Claude returns a revised FULL proposal.
export async function refinePlan(
  trip: Trip,
  existingItems: ItineraryItem[],
  priorMessages: ConversationMessage[],
  currentActions: PlanAction[],
  feedback: string
): Promise<PlanResult> {
  const { refToId, idToRef } = buildRefMaps(existingItems);
  // The current proposal is volatile state → put it in the system prompt, so
  // the stored conversation stays clean text.
  const systemPrompt =
    buildSystemPrompt(trip, existingItems) +
    "\n\n## Current proposal (NOT yet applied — revise it per the user's latest message)\n" +
    serializeProposal(currentActions, idToRef) +
    "\n\nReturn the COMPLETE revised set of changes (not just the delta) via revise_itinerary. " +
    "Drop, add, or edit proposed items as the feedback requires. Still never change a booked item's facts.";

  const conversation: ConversationMessage[] = [
    ...priorMessages,
    { role: "user", content: feedback },
  ];

  const { reasoning, actions, unmatchedRefs } = await runRevision(
    systemPrompt,
    conversation,
    refToId
  );

  return {
    reasoning,
    actions: annotateActions(actions, existingItems),
    unmatchedRefs,
    messages: [
      ...priorMessages,
      { role: "user", content: feedback },
      { role: "assistant", content: assistantContent(reasoning) },
    ],
  };
}

// Anthropic rejects empty assistant text; keep a placeholder if Claude was terse.
function assistantContent(reasoning: string): string {
  return reasoning.trim() || "(updated the proposed changes)";
}

// Compact human/Claude-readable view of the current proposal for refinement.
// Existing items are shown by their short ref so the model can re-reference them.
function serializeProposal(
  actions: PlanAction[],
  idToRef: Map<string, string>
): string {
  if (actions.length === 0) return "(no changes proposed yet)";
  return actions
    .map((a, i) => {
      if (a.type === "create") {
        const it = a.item;
        return `${i}. CREATE [${it.category}] "${it.title}"${
          it.date ? ` on ${it.date}` : ""
        }${it.destinationName ? ` at ${it.destinationName}` : ""}`;
      }
      if (a.type === "delete") {
        return `${i}. DELETE ${idToRef.get(a.itemId) ?? a.itemId} "${a.itemTitle ?? ""}"`;
      }
      const fields = Object.entries(a.changes)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      return `${i}. UPDATE ${idToRef.get(a.itemId) ?? a.itemId} "${a.itemTitle ?? ""}" {${fields}}`;
    })
    .join("\n");
}

// ── Parsing & normalization ──────────────────────────────────────────────────

export function parseActions(
  input: unknown,
  refToId: Map<string, string>
): { actions: PlanAction[]; unmatchedRefs: string[] } {
  const raw = input as {
    creates?: Record<string, unknown>[];
    updates?: Record<string, unknown>[];
    deletes?: Record<string, unknown>[];
  };
  const actions: PlanAction[] = [];
  const unmatchedRefs: string[] = [];

  // Accept `ref` (new, short) and fall back to `itemId` (in case the model
  // echoes the raw id). Returns the real id, or records an unmatched ref.
  const resolve = (raw: Record<string, unknown>): string | null => {
    const ref = typeof raw.ref === "string" ? raw.ref.trim() : null;
    const legacyId = typeof raw.itemId === "string" ? raw.itemId : null;
    if (ref && refToId.has(ref)) return refToId.get(ref)!;
    // tolerate the model passing the raw id
    if (legacyId && [...refToId.values()].includes(legacyId)) return legacyId;
    const shown = ref ?? legacyId;
    if (shown) unmatchedRefs.push(shown);
    return null;
  };

  for (const c of raw.creates ?? []) {
    actions.push({ type: "create", item: normalizeItem(c) });
  }

  for (const u of raw.updates ?? []) {
    const itemId = resolve(u);
    if (!itemId) continue;
    const changes = normalizeChanges(u);
    if (Object.keys(changes).length === 0) continue;
    actions.push({
      type: "update",
      itemId,
      changes,
      reason: typeof u.reason === "string" ? u.reason : null,
    });
  }

  for (const d of raw.deletes ?? []) {
    const itemId = resolve(d);
    if (!itemId) continue;
    actions.push({
      type: "delete",
      itemId,
      reason: typeof d.reason === "string" ? d.reason : null,
    });
  }

  return { actions, unmatchedRefs };
}

function normalizeItem(raw: Record<string, unknown>): ProposedItem {
  return {
    date: typeof raw.date === "string" ? raw.date : null,
    title: String(raw.title ?? "Untitled"),
    category: itemCategory.includes(raw.category as (typeof itemCategory)[number])
      ? (raw.category as (typeof itemCategory)[number])
      : "other",
    startTime: typeof raw.startTime === "string" ? raw.startTime : null,
    endTime: typeof raw.endTime === "string" ? raw.endTime : null,
    durationMinutes:
      typeof raw.durationMinutes === "number" ? raw.durationMinutes : null,
    originName: typeof raw.originName === "string" ? raw.originName : null,
    destinationName:
      typeof raw.destinationName === "string" ? raw.destinationName : null,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    costCents: typeof raw.costCents === "number" ? Math.round(raw.costCents) : null,
    confirmationStatus: confirmationStatus.includes(
      raw.confirmationStatus as (typeof confirmationStatus)[number]
    )
      ? (raw.confirmationStatus as (typeof confirmationStatus)[number])
      : "idea",
  };
}

// Normalize an update: keep only fields actually present, coerced to types.
function normalizeChanges(raw: Record<string, unknown>): ItemChanges {
  const out: ItemChanges = {};
  if ("date" in raw)
    out.date = typeof raw.date === "string" ? raw.date : null;
  if (typeof raw.title === "string") out.title = raw.title;
  if (itemCategory.includes(raw.category as (typeof itemCategory)[number]))
    out.category = raw.category as (typeof itemCategory)[number];
  if ("startTime" in raw)
    out.startTime = typeof raw.startTime === "string" ? raw.startTime : null;
  if ("endTime" in raw)
    out.endTime = typeof raw.endTime === "string" ? raw.endTime : null;
  if ("durationMinutes" in raw)
    out.durationMinutes =
      typeof raw.durationMinutes === "number" ? raw.durationMinutes : null;
  if ("originName" in raw)
    out.originName = typeof raw.originName === "string" ? raw.originName : null;
  if ("destinationName" in raw)
    out.destinationName =
      typeof raw.destinationName === "string" ? raw.destinationName : null;
  if ("notes" in raw)
    out.notes = typeof raw.notes === "string" ? raw.notes : null;
  if ("costCents" in raw)
    out.costCents =
      typeof raw.costCents === "number" ? Math.round(raw.costCents) : null;
  if (
    confirmationStatus.includes(
      raw.confirmationStatus as (typeof confirmationStatus)[number]
    )
  )
    out.confirmationStatus =
      raw.confirmationStatus as (typeof confirmationStatus)[number];
  if (typeof raw.sortOrder === "number") out.sortOrder = raw.sortOrder;
  return out;
}

// ── Annotation: attach `before` snapshots + sacred-data `blocked` flags ────────
// Pure (no DB) — operates on the already-loaded existing items, so the preview
// shows the human exactly what would change and why something is locked.

export function annotateActions(
  actions: PlanAction[],
  existingItems: ItineraryItem[]
): PlanAction[] {
  const byId = new Map(existingItems.map((i) => [i.id, i]));

  return actions.map((action) => {
    if (action.type === "create") return action;

    const existing = byId.get(action.itemId);
    if (!existing) {
      return action.type === "delete"
        ? { ...action, itemTitle: null, lockLevel: "blocked" as ActionLock, lockReason: "Item no longer exists" }
        : { ...action, itemTitle: null, lockLevel: "blocked" as ActionLock, hardReasons: ["Item no longer exists"] };
    }

    if (action.type === "delete") {
      const level = deleteLockLevel(existing);
      const lockLevel: ActionLock = level === "hard" ? "blocked" : level;
      return {
        ...action,
        itemTitle: existing.title,
        lockLevel,
        lockReason:
          level === "hard"
            ? "Booked — remove manually"
            : level === "confirm"
              ? "Removes your item — confirm"
              : null,
      };
    }

    // update — evaluate each changed field's lock level
    const changeKeys = Object.keys(action.changes);
    const before: Record<string, unknown> = {};
    const fieldLocks: Record<string, LockLevel> = {};
    const hardReasons: string[] = [];
    const confirmReasons: string[] = [];
    let hasApplicable = false; // any non-hard field
    for (const k of changeKeys) {
      if (k !== "sortOrder") before[k] = (existing as Record<string, unknown>)[k] ?? null;
      const level = fieldLockLevel(k, existing);
      fieldLocks[k] = level;
      if (level === "hard") hardReasons.push(fieldLockReason(k, level));
      else {
        hasApplicable = true;
        if (level === "confirm") confirmReasons.push(fieldLockReason(k, level));
      }
    }
    const lockLevel: ActionLock = !hasApplicable
      ? "blocked"
      : confirmReasons.length > 0
        ? "confirm"
        : "open";
    return {
      ...action,
      itemTitle: existing.title,
      before,
      fieldLocks,
      lockLevel,
      hardReasons,
      confirmReasons,
    };
  });
}
