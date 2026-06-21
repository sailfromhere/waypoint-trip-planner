"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from "@tanstack/react-table";
import type { ItineraryItem } from "@/db/types";
import {
  useItineraryItems,
  useCreateItem,
  useUpdateItem,
  useDeleteItem,
  useAutoSchedule,
} from "@/lib/hooks/use-itinerary";
import { sequenceDay, sequenceTrip, type ScheduleChange } from "@/lib/trip-state/sequence";
import { EditableCell } from "./editable-cell";

const col = createColumnHelper<ItineraryItem>();

function useColumns(
  onUpdate: (itemId: string, field: string, value: string | number | null) => void,
  onDelete: (itemId: string) => void
): ColumnDef<ItineraryItem, unknown>[] {
  return useMemo(
    () =>
      [
        col.accessor("title", {
          header: "Title",
          size: 180,
          cell: ({ row, getValue }) => (
            <EditableCell
              value={getValue()}
              type="text"
              placeholder="Untitled"
              onSave={(v) => onUpdate(row.original.id, "title", v)}
              className="font-medium"
            />
          ),
        }),
        col.accessor("category", {
          header: "Category",
          size: 100,
          cell: ({ row, getValue }) => (
            <EditableCell
              value={getValue()}
              type="category"
              onSave={(v) => onUpdate(row.original.id, "category", v)}
            />
          ),
        }),
        col.accessor("startTime", {
          header: "Start",
          size: 90,
          cell: ({ row, getValue }) => (
            <EditableCell
              value={getValue()}
              type="time"
              placeholder="—"
              onSave={(v) => onUpdate(row.original.id, "startTime", v)}
            />
          ),
        }),
        col.accessor("durationMinutes", {
          header: "Duration",
          size: 70,
          cell: ({ row, getValue }) => (
            <EditableCell
              value={getValue()}
              type="number"
              placeholder="min"
              onSave={(v) => onUpdate(row.original.id, "durationMinutes", v)}
            />
          ),
        }),
        col.accessor("destinationName", {
          header: "Location",
          size: 160,
          cell: ({ row }) => {
            const item = row.original;
            // Drives have two endpoints — show separate From/To inputs that
            // write originName / destinationName directly (no "A → B" parsing).
            if (item.category === "drive") {
              return (
                <div className="flex flex-col gap-0.5" data-testid="drive-location">
                  <div data-testid="drive-origin" className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400 shrink-0">From</span>
                    <EditableCell
                      value={item.originName}
                      type="text"
                      placeholder="origin"
                      onSave={(v) => onUpdate(item.id, "originName", v)}
                    />
                  </div>
                  <div data-testid="drive-dest" className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400 shrink-0">To</span>
                    <EditableCell
                      value={item.destinationName}
                      type="text"
                      placeholder="destination"
                      onSave={(v) => onUpdate(item.id, "destinationName", v)}
                    />
                  </div>
                </div>
              );
            }
            return (
              <EditableCell
                value={item.destinationName}
                type="text"
                placeholder="—"
                onSave={(v) => onUpdate(item.id, "destinationName", v)}
              />
            );
          },
        }),
        col.accessor("confirmationStatus", {
          header: "Status",
          size: 90,
          cell: ({ row, getValue }) => (
            <EditableCell
              value={getValue()}
              type="status"
              onSave={(v) =>
                onUpdate(row.original.id, "confirmationStatus", v)
              }
            />
          ),
        }),
        col.accessor("costCents", {
          header: "Cost",
          size: 80,
          cell: ({ row, getValue }) => (
            <EditableCell
              value={getValue()}
              type="cost"
              placeholder="—"
              onSave={(v) => onUpdate(row.original.id, "costCents", v)}
            />
          ),
        }),
        col.accessor("notes", {
          header: "Notes",
          size: 200,
          cell: ({ row, getValue }) => (
            <EditableCell
              value={getValue()}
              type="text"
              placeholder="—"
              onSave={(v) => onUpdate(row.original.id, "notes", v)}
            />
          ),
        }),
        col.display({
          id: "actions",
          size: 40,
          cell: ({ row }) => (
            <button
              onClick={() => onDelete(row.original.id)}
              className="opacity-0 group-hover/row:opacity-100 text-zinc-400 hover:text-red-500 text-xs transition-opacity px-1"
              title="Delete item"
            >
              ✕
            </button>
          ),
        }),
      ] as ColumnDef<ItineraryItem, unknown>[],
    [onUpdate, onDelete]
  );
}

interface DayGroup {
  date: string | null;
  label: string;
  items: ItineraryItem[];
}

function groupByDate(items: ItineraryItem[]): DayGroup[] {
  const groups = new Map<string, ItineraryItem[]>();
  for (const item of items) {
    const key = item.date ?? "__unscheduled__";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const result: DayGroup[] = [];
  for (const [key, groupItems] of groups) {
    if (key === "__unscheduled__") continue;
    result.push({
      date: key,
      label: formatDate(key),
      items: groupItems,
    });
  }
  result.sort((a, b) => (a.date! < b.date! ? -1 : 1));

  const unscheduled = groups.get("__unscheduled__");
  if (unscheduled?.length) {
    result.push({
      date: null,
      label: "Unscheduled",
      items: unscheduled,
    });
  }

  return result;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface DayWarning {
  date: string;
  totalDriveSeconds: number;
  totalActivityMinutes: number;
  warnings: string[];
}

function DayGroupTable({
  group,
  columns,
  onAddItem,
  onAutoSchedule,
  selectedItemId,
  onItemSelect,
  warning,
}: {
  group: DayGroup;
  columns: ColumnDef<ItineraryItem, unknown>[];
  onAddItem: (date: string | null) => void;
  onAutoSchedule?: () => void;
  selectedItemId: string | null;
  onItemSelect: (itemId: string) => void;
  warning?: DayWarning;
}) {
  const table = useReactTable({
    data: group.items,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          {group.label}
          <span className="ml-2 text-zinc-400 dark:text-zinc-500 font-normal">
            ({group.items.length} {group.items.length === 1 ? "item" : "items"})
          </span>
          {warning && warning.warnings.length > 0 && (
            <span className="ml-2 text-amber-600 dark:text-amber-400 font-normal normal-case" title={warning.warnings.join("; ")}>
              ⚠ {warning.warnings[0]}
            </span>
          )}
        </h3>
        {onAutoSchedule && group.date && (
          <button
            onClick={onAutoSchedule}
            className="text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-0.5 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors normal-case"
            title="Fill in blank start times for this day (drive times from routing; your set times are kept)"
          >
            ⏱ Auto-schedule
          </button>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr
                key={hg.id}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="text-left text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1.5"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                id={`item-${row.original.id}`}
                onClick={() => onItemSelect(row.original.id)}
                className={`group/row border-b border-zinc-50 dark:border-zinc-800/50 last:border-0 cursor-pointer transition-colors ${
                  selectedItemId === row.original.id
                    ? "bg-blue-50 dark:bg-blue-900/20 ring-1 ring-inset ring-blue-200 dark:ring-blue-800"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                }`}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-2 py-0.5"
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={() => onAddItem(group.date)}
        className="mt-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors px-2 py-1"
      >
        + Add item
      </button>
    </div>
  );
}

export function ItineraryTable({
  tripId,
  selectedItemId,
  onItemSelect,
  dayWarnings,
  drives,
}: {
  tripId: string;
  selectedItemId: string | null;
  onItemSelect: (itemId: string) => void;
  dayWarnings?: DayWarning[];
  drives?: { itemId: string; durationSeconds: number }[];
}) {
  const { data: items, isLoading } = useItineraryItems(tripId);
  const createItem = useCreateItem(tripId);
  const updateItem = useUpdateItem(tripId);
  const deleteItem = useDeleteItem(tripId);
  const autoSchedule = useAutoSchedule(tripId);
  const [newDateInput, setNewDateInput] = useState("");
  const [showNewDay, setShowNewDay] = useState(false);
  // Undo affordance for the deterministic fill (good-automatic + easy-manual).
  const [lastApplied, setLastApplied] = useState<ScheduleChange[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const driveSecondsById = useMemo(
    () => new Map((drives ?? []).map((d) => [d.itemId, d.durationSeconds])),
    [drives]
  );

  const applySchedule = useCallback(
    (changes: ScheduleChange[]) => {
      if (changes.length === 0) {
        setLastApplied(null);
        setNotice("All start times are already set.");
        return;
      }
      autoSchedule.mutate(
        changes.map((c) => ({ itemId: c.itemId, startTime: c.startTime, endTime: c.endTime }))
      );
      setLastApplied(changes);
      setNotice(null);
    },
    [autoSchedule]
  );

  const handleUndoSchedule = useCallback(() => {
    if (!lastApplied) return;
    autoSchedule.mutate(
      lastApplied.map((c) => ({
        itemId: c.itemId,
        startTime: c.before.startTime,
        endTime: c.before.endTime,
      }))
    );
    setLastApplied(null);
  }, [lastApplied, autoSchedule]);

  // Keep mutation refs current without changing handler identity. Stable
  // handlers => stable column defs => cells are NOT remounted when the parent
  // re-renders (e.g. on row selection). The remount was what killed edit mode.
  // Refs are updated in an effect (not during render) and only read inside
  // event handlers, which run after commit — so they're always current.
  const updateRef = useRef(updateItem);
  const deleteRef = useRef(deleteItem);
  useEffect(() => {
    updateRef.current = updateItem;
    deleteRef.current = deleteItem;
  });

  const handleUpdate = useCallback(
    (itemId: string, field: string, value: string | number | null) => {
      updateRef.current.mutate({ itemId, data: { [field]: value } });
    },
    []
  );

  const handleDelete = useCallback((itemId: string) => {
    deleteRef.current.mutate(itemId);
  }, []);

  function handleAddItem(date: string | null) {
    const maxSort = (items ?? [])
      .filter((i) => i.date === date)
      .reduce((max, i) => Math.max(max, i.sortOrder), -1);

    createItem.mutate({
      title: "New item",
      date,
      sortOrder: maxSort + 1,
    });
  }

  function handleAddDay(e: React.FormEvent) {
    e.preventDefault();
    if (!newDateInput) return;
    createItem.mutate({
      title: "New item",
      date: newDateInput,
      sortOrder: 0,
    });
    setNewDateInput("");
    setShowNewDay(false);
  }

  const columns = useColumns(handleUpdate, handleDelete);
  const groups = useMemo(() => groupByDate(items ?? []), [items]);

  if (isLoading) {
    return (
      <p className="text-sm text-zinc-500 py-8">Loading itinerary...</p>
    );
  }

  return (
    <div>
      {(lastApplied || notice) && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 text-xs text-blue-700 dark:text-blue-300">
          {lastApplied ? (
            <>
              <span>
                Filled {lastApplied.length} start time
                {lastApplied.length === 1 ? "" : "s"}.
              </span>
              <button
                onClick={handleUndoSchedule}
                className="font-medium underline hover:no-underline"
              >
                Undo
              </button>
            </>
          ) : (
            <span>{notice}</span>
          )}
          <button
            onClick={() => {
              setLastApplied(null);
              setNotice(null);
            }}
            className="ml-auto text-blue-400 hover:text-blue-600 dark:hover:text-blue-200"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="text-center py-12 text-sm text-zinc-500">
          <p className="mb-4">No items yet. Add your first day to get started.</p>
        </div>
      ) : (
        groups.map((group) => (
          <DayGroupTable
            key={group.date ?? "__unscheduled__"}
            group={group}
            columns={columns}
            onAddItem={handleAddItem}
            onAutoSchedule={() =>
              applySchedule(sequenceDay(group.items, driveSecondsById))
            }
            selectedItemId={selectedItemId}
            onItemSelect={onItemSelect}
            warning={group.date ? dayWarnings?.find((w) => w.date === group.date) : undefined}
          />
        ))
      )}

      <div className="flex gap-2 mt-2">
        {showNewDay ? (
          <form onSubmit={handleAddDay} className="flex gap-2 items-center">
            <input
              type="date"
              value={newDateInput}
              onChange={(e) => setNewDateInput(e.target.value)}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
              autoFocus
            />
            <button
              type="submit"
              className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1.5 text-xs font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setShowNewDay(false)}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <button
              onClick={() => setShowNewDay(true)}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-1.5 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
            >
              + Add day
            </button>
            <button
              onClick={() => handleAddItem(null)}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-1.5 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
            >
              + Unscheduled item
            </button>
            {(items ?? []).some((i) => i.date) && (
              <button
                onClick={() =>
                  applySchedule(sequenceTrip(items ?? [], driveSecondsById))
                }
                className="ml-auto text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-1.5 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
                title="Fill blank start times across all days (kept: your times & booked items)"
              >
                ⏱ Auto-schedule all
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
