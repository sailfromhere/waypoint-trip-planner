"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cardEnterExit, staggerChildren, DURATION, EASE } from "@/lib/motion";
import {
  useGeneratePlan,
  useRefinePlan,
  useAcceptPlan,
  useTurns,
  type AcceptResult,
} from "@/lib/hooks/use-planning";
import type {
  PlanAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
  ConversationMessage,
} from "@/lib/ai/planner";
import type { PlanningTurn } from "@/db/types";
import { formatDurationMinutes } from "@/lib/format";
import { CategoryIcon, categoryLabel } from "@/lib/trip-state/categories";
import { Button } from "@/components/ui/button";

const FIELD_LABELS: Record<string, string> = {
  date: "Date",
  startTime: "Start",
  endTime: "End",
  durationMinutes: "Duration",
  originName: "From",
  destinationName: "Location",
  notes: "Notes",
  costCents: "Cost",
  category: "Category",
  title: "Title",
  confirmationStatus: "Status",
  sortOrder: "Order",
};

function formatTime(time: string | null): string {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function formatCost(cents: number | null): string {
  if (cents == null) return "";
  return `$${(cents / 100).toFixed(0)}`;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Render any tracked field value for the before→after diff.
function formatFieldValue(key: string, value: unknown): string {
  if (value == null || value === "") return "—";
  switch (key) {
    case "date":
      return formatDate(String(value));
    case "startTime":
    case "endTime":
      return formatTime(String(value));
    case "durationMinutes":
      return formatDurationMinutes(Number(value));
    case "costCents":
      return formatCost(Number(value));
    case "category":
      return categoryLabel(String(value));
    default:
      return String(value);
  }
}

// An update whose only changes are date/sortOrder is a "move/reorder".
function isMove(changes: Record<string, unknown>): boolean {
  const keys = Object.keys(changes);
  return keys.length > 0 && keys.every((k) => k === "date" || k === "sortOrder");
}

// Action-level lock: creates are always open; updates/deletes carry a lockLevel.
function actionLock(action: PlanAction): "open" | "confirm" | "blocked" {
  if (action.type === "create") return "open";
  return action.lockLevel ?? "open";
}
// Fully blocked = nothing in it can apply (not selectable).
function isBlocked(action: PlanAction): boolean {
  return actionLock(action) === "blocked";
}
// "open" diffs are safe to pre-select; "confirm" diffs need a deliberate opt-in.
function isAutoSelectable(action: PlanAction): boolean {
  return actionLock(action) === "open";
}

export function PlanningPanel({
  tripId,
  onItemsAccepted,
}: {
  tripId: string;
  onItemsAccepted?: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [refineInput, setRefineInput] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [active, setActive] = useState<{
    turnId: string;
    reasoning: string;
    actions: PlanAction[];
    messages: ConversationMessage[];
    unmatchedRefs?: string[];
  } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [acceptResult, setAcceptResult] = useState<AcceptResult | null>(null);

  const generatePlan = useGeneratePlan(tripId);
  const refinePlan = useRefinePlan(tripId);
  const acceptPlan = useAcceptPlan(tripId);
  const turns = useTurns(tripId);

  // Pre-select only the "open" diffs; "confirm" diffs (override your data /
  // edit a booked item's label) stay unchecked so applying them is deliberate.
  function selectActionable(acts: PlanAction[]) {
    const sel = new Set<number>();
    acts.forEach((a, i) => {
      if (isAutoSelectable(a)) sel.add(i);
    });
    setSelected(sel);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || generatePlan.isPending) return;

    setActive(null);
    setSelected(new Set());
    setRefineInput("");
    setAcceptResult(null);

    generatePlan.mutate(prompt.trim(), {
      onSuccess: (result) => {
        setActive(result);
        selectActionable(result.actions);
      },
    });
  }

  function handleRefine(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !refineInput.trim() || refinePlan.isPending) return;

    refinePlan.mutate(
      { turnId: active.turnId, message: refineInput.trim() },
      {
        onSuccess: (result) => {
          setActive(result);
          selectActionable(result.actions);
          setRefineInput("");
        },
      }
    );
  }

  function toggle(index: number) {
    if (!active || isBlocked(active.actions[index])) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectAll(on: boolean) {
    if (!active) return;
    if (!on) return setSelected(new Set());
    const sel = new Set<number>();
    active.actions.forEach((a, i) => {
      if (!isBlocked(a)) sel.add(i);
    });
    setSelected(sel);
  }

  function handleAccept() {
    if (!active || selected.size === 0) return;
    acceptPlan.mutate(
      { turnId: active.turnId, actionIndexes: [...selected] },
      {
        onSuccess: (res) => {
          setAcceptResult(res);
          setActive(null);
          setSelected(new Set());
          setPrompt("");
          onItemsAccepted?.();
        },
      }
    );
  }

  function handleDismiss() {
    setActive(null);
    setSelected(new Set());
  }

  const actions = active?.actions ?? [];
  const selectableCount = actions.filter((a) => !isBlocked(a)).length;
  const blockedCount = actions.length - selectableCount;
  const createCount = actions.filter((a) => a.type === "create").length;
  const updateCount = actions.filter((a) => a.type === "update").length;
  const deleteCount = actions.filter((a) => a.type === "delete").length;

  // History excludes the turn currently shown as a live preview.
  const historyTurns = (turns.data ?? []).filter((t) => t.id !== active?.turnId);

  return (
    <div className="mb-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-zinc-400 text-xs">{expanded ? "▼" : "▶"}</span>
          AI Planning Copilot
          {generatePlan.isPending && (
            <span className="text-xs text-zinc-400 animate-pulse">generating...</span>
          )}
        </span>
        {active && (
          <span className="text-xs text-zinc-400">{actions.length} changes proposed</span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3">
          {/* Prompt input */}
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(e);
              }}
              placeholder='Plan or refine... "5-day road trip from Seattle to Yellowstone" or "move the museum to day 3 and drop the Thai dinner"'
              rows={2}
              className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 placeholder:text-zinc-400 resize-y min-h-[2.5rem] max-h-48"
              disabled={generatePlan.isPending}
            />
            <Button
              type="submit"
              className="whitespace-nowrap"
              disabled={!prompt.trim() || generatePlan.isPending}
            >
              {generatePlan.isPending ? "Planning..." : "Plan"}
            </Button>
          </form>

          {/* Error */}
          {generatePlan.isError && (
            <div className="mt-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {generatePlan.error.message}
            </div>
          )}

          {/* Accept summary (after applying) */}
          {acceptResult && (
            <div className="mt-3 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-2 text-sm text-green-800 dark:text-green-300">
              Applied {acceptResult.appliedCount} change
              {acceptResult.appliedCount !== 1 ? "s" : ""}.
              {acceptResult.results.some((r) => r.status === "blocked") && (
                <span className="text-amber-700 dark:text-amber-400">
                  {" "}
                  Some were locked and skipped (booked or your own edits).
                </span>
              )}
            </div>
          )}

          {/* Conversation thread */}
          {active && active.messages.length > 0 && (
            <Conversation messages={active.messages} />
          )}
          {refinePlan.isError && (
            <div className="mt-2 text-xs text-red-600 dark:text-red-400">
              {refinePlan.error.message}
            </div>
          )}

          {/* Unmatched references — the AI named items we couldn't resolve */}
          {active && active.unmatchedRefs && active.unmatchedRefs.length > 0 && (
            <div className="mt-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              The AI referred to {active.unmatchedRefs.length} item
              {active.unmatchedRefs.length !== 1 ? "s" : ""} it couldn&apos;t match
              ({active.unmatchedRefs.join(", ")}) — those changes were skipped. Try
              rephrasing or refining.
            </div>
          )}

          {/* Proposed diffs */}
          <AnimatePresence>
          {active && actions.length > 0 && (
            <motion.div
              className="mt-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -6, transition: { duration: DURATION.fast, ease: EASE.exit } }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Proposed changes ({selected.size} selected
                  {blockedCount > 0 ? `, ${blockedCount} locked` : ""})
                  <span className="ml-2 normal-case font-normal text-zinc-400">
                    {[
                      createCount && `${createCount} new`,
                      updateCount && `${updateCount} edit`,
                      deleteCount && `${deleteCount} remove`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {selectableCount > 0 && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => selectAll(true)}
                    >
                      Select all
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => selectAll(false)}
                    >
                      Deselect all
                    </Button>
                  </div>
                )}
              </div>

              <motion.div
                className="space-y-1.5 max-h-[28rem] overflow-y-auto"
                variants={staggerChildren}
                initial="hidden"
                animate="visible"
              >
                {actions.map((action, index) => (
                  <ActionCard
                    key={index}
                    action={action}
                    selected={selected.has(index)}
                    onToggle={() => toggle(index)}
                  />
                ))}
              </motion.div>

              {/* Refine (conversational) */}
              <form onSubmit={handleRefine} className="flex gap-2 items-end mt-3">
                <input
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  placeholder='Ask for changes... "no Thai", "add a rest day", "bad knees — no long hikes"'
                  className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 placeholder:text-zinc-400"
                  disabled={refinePlan.isPending}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  className="whitespace-nowrap"
                  disabled={!refineInput.trim() || refinePlan.isPending}
                >
                  {refinePlan.isPending ? "Refining..." : "Refine"}
                </Button>
              </form>

              {/* Accept / Dismiss */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <Button
                  onClick={handleAccept}
                  disabled={selected.size === 0 || acceptPlan.isPending}
                >
                  {acceptPlan.isPending
                    ? "Applying..."
                    : `Apply ${selected.size} change${selected.size !== 1 ? "s" : ""}`}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleDismiss}
                  disabled={acceptPlan.isPending}
                >
                  Dismiss
                </Button>
                {acceptPlan.isError && (
                  <span className="text-sm text-red-600 dark:text-red-400 self-center ml-2">
                    {acceptPlan.error.message}
                  </span>
                )}
              </div>
            </motion.div>
          )}
          </AnimatePresence>

          {/* Empty result */}
          {active && actions.length === 0 && (
            <div className="mt-3 text-sm text-zinc-500">
              The AI didn&apos;t propose any changes. Try a more specific prompt.
            </div>
          )}

          {/* History thread */}
          {historyTurns.length > 0 && (
            <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => setHistoryExpanded(!historyExpanded)}
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                <span>{historyExpanded ? "▼" : "▶"}</span>
                History ({historyTurns.length} prompt
                {historyTurns.length !== 1 ? "s" : ""})
              </button>
              {historyExpanded && (
                <div className="mt-2 space-y-2">
                  {historyTurns.map((turn) => (
                    <HistoryEntry
                      key={turn.id}
                      turn={turn}
                      onReuse={() => setPrompt(turn.prompt)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Conversation thread (prompt + refinements) ────────────────────────────────

function Conversation({ messages }: { messages: ConversationMessage[] }) {
  return (
    <div className="mt-3 space-y-1.5">
      {messages.map((m, i) =>
        m.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-lg rounded-br-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1.5 text-sm">
              {m.content}
            </div>
          </div>
        ) : (
          <div key={i} className="flex">
            <div className="max-w-[90%] rounded-lg rounded-bl-sm bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {m.content}
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ── Diff card for a single proposed action ────────────────────────────────────

function ActionCard({
  action,
  selected,
  onToggle,
}: {
  action: PlanAction;
  selected: boolean;
  onToggle: () => void;
}) {
  const lock = actionLock(action);
  const blocked = lock === "blocked";
  const confirm = lock === "confirm";

  // Hard notes (won't apply — always shown) vs. confirm notes (opt-in).
  const hardNotes =
    action.type === "update"
      ? action.hardReasons ?? []
      : action.type === "delete" && blocked && action.lockReason
        ? [action.lockReason]
        : [];
  const confirmNotes =
    action.type === "update"
      ? action.confirmReasons ?? []
      : action.type === "delete" && confirm && action.lockReason
        ? [action.lockReason]
        : [];

  return (
    <motion.label
      variants={cardEnterExit}
      className={`flex items-start gap-2.5 rounded-md border px-3 py-2 transition-colors ${
        blocked
          ? "border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/10 cursor-not-allowed"
          : confirm
            ? `border-amber-300 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-900/10 cursor-pointer ${
                selected ? "" : "opacity-70"
              }`
            : selected
              ? "border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/30 cursor-pointer"
              : "border-zinc-200 dark:border-zinc-800 opacity-60 cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={blocked}
        onChange={onToggle}
        className="mt-0.5 rounded"
      />
      <div className="flex-1 min-w-0">
        {action.type === "create" && <CreateBody action={action} />}
        {action.type === "update" && <UpdateBody action={action} />}
        {action.type === "delete" && <DeleteBody action={action} />}
        {hardNotes.length > 0 && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            🔒 {hardNotes.join("; ")}
          </p>
        )}
        {confirmNotes.length > 0 && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            ⚠️ Confirm: {confirmNotes.join("; ")}
          </p>
        )}
      </div>
    </motion.label>
  );
}

function ActionBadge({ kind }: { kind: string }) {
  const styles: Record<string, string> = {
    new: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    edit: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    move: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    remove: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${styles[kind]}`}
    >
      {kind}
    </span>
  );
}

function CreateBody({ action }: { action: CreateAction }) {
  const item = action.item;
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <ActionBadge kind="new" />
        <span className="text-sm font-medium">{item.title}</span>
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          <CategoryIcon category={item.category} size={11} />
          {categoryLabel(item.category)}
        </span>
        {item.date && <span className="text-xs text-zinc-400">{formatDate(item.date)}</span>}
        {item.startTime && (
          <span className="text-xs text-zinc-400">{formatTime(item.startTime)}</span>
        )}
        {item.costCents != null && (
          <span className="text-xs text-zinc-400">{formatCost(item.costCents)}</span>
        )}
      </div>
      {item.destinationName && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          {item.originName ? `${item.originName} → ` : ""}
          {item.destinationName}
        </p>
      )}
      {item.notes && (
        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{item.notes}</p>
      )}
    </>
  );
}

function UpdateBody({ action }: { action: UpdateAction }) {
  const changes = action.changes as Record<string, unknown>;
  const before = (action.before ?? {}) as Record<string, unknown>;
  const move = isMove(changes);
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <ActionBadge kind={move ? "move" : "edit"} />
        <span className="text-sm font-medium">{action.itemTitle ?? "Item"}</span>
      </div>
      <div className="mt-1 space-y-0.5">
        {Object.keys(changes).map((key) => (
          <div key={key} className="text-xs text-zinc-500 dark:text-zinc-400">
            <span className="text-zinc-400">{FIELD_LABELS[key] ?? key}: </span>
            <span className="line-through text-zinc-400">
              {formatFieldValue(key, before[key])}
            </span>
            <span className="mx-1">→</span>
            <span className="text-zinc-700 dark:text-zinc-200 font-medium">
              {formatFieldValue(key, changes[key])}
            </span>
          </div>
        ))}
      </div>
      {action.reason && (
        <p className="text-xs text-zinc-400 mt-0.5 italic">{action.reason}</p>
      )}
    </>
  );
}

function DeleteBody({ action }: { action: DeleteAction }) {
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <ActionBadge kind="remove" />
        <span className="text-sm font-medium line-through text-zinc-500">
          {action.itemTitle ?? "Item"}
        </span>
      </div>
      {action.reason && (
        <p className="text-xs text-zinc-400 mt-0.5 italic">{action.reason}</p>
      )}
    </>
  );
}

// ── History entry (read-only, persisted) ──────────────────────────────────────

function HistoryEntry({
  turn,
  onReuse,
}: {
  turn: PlanningTurn;
  onReuse: () => void;
}) {
  const [open, setOpen] = useState(false);
  const actions = (turn.actions ?? []) as PlanAction[];
  const accepted = new Set(turn.acceptedActionIds ?? []);
  const when = new Date(turn.createdAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
      >
        <span className="text-zinc-400 text-xs mt-0.5">{open ? "▼" : "▶"}</span>
        <span className="flex-1 min-w-0">
          <span className="text-sm text-zinc-700 dark:text-zinc-200 line-clamp-2">
            {turn.prompt}
          </span>
          <span className="text-[11px] text-zinc-400 block mt-0.5">
            {when} · {accepted.size}/{actions.length} applied
          </span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-2">
          {turn.reasoning && (
            <div className="rounded bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {turn.reasoning}
            </div>
          )}
          <div className="space-y-1">
            {actions.map((action, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
              >
                <span
                  className={`text-[10px] px-1 py-0.5 rounded font-medium ${
                    accepted.has(String(i))
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
                  }`}
                >
                  {accepted.has(String(i)) ? "applied" : "skipped"}
                </span>
                <span className="truncate">{describeAction(action)}</span>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={onReuse}>
            Reuse this prompt
          </Button>
        </div>
      )}
    </div>
  );
}

function describeAction(action: PlanAction): string {
  if (action.type === "create") {
    return `+ ${action.item.title}`;
  }
  if (action.type === "delete") {
    return `− ${action.itemTitle ?? "item"}`;
  }
  const changes = action.changes as Record<string, unknown>;
  const fields = Object.keys(changes)
    .map((k) => FIELD_LABELS[k] ?? k)
    .join(", ");
  return `✎ ${action.itemTitle ?? "item"} (${fields})`;
}
