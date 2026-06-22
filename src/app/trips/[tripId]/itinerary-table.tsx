"use client";

import {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
  type CSSProperties,
} from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
  type Row,
} from "@tanstack/react-table";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ItineraryItem } from "@/db/types";
import {
  useItineraryItems,
  useCreateItem,
  useUpdateItem,
  useDeleteItem,
  useAutoSchedule,
  useReorderItems,
  type ReorderChange,
} from "@/lib/hooks/use-itinerary";
import { sequenceDay, sequenceTrip, type ScheduleChange } from "@/lib/trip-state/sequence";
import { EditableCell } from "./editable-cell";
import { LocationCell } from "./location-cell";

const col = createColumnHelper<ItineraryItem>();

type LocationKind = "origin" | "destination";

function useColumns(
  tripId: string,
  onUpdate: (itemId: string, field: string, value: string | number | null) => void,
  onDelete: (itemId: string) => void,
  onPickLocation: (itemId: string, kind: LocationKind, name: string, lat: number, lng: number) => void,
  onTextLocation: (itemId: string, field: string, value: string | null) => void
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
              multiline
              placeholder="Untitled"
              onSave={(v) => onUpdate(row.original.id, "title", v)}
              className="font-medium min-h-[4.5rem] flex flex-col justify-center"
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
                    <LocationCell
                      tripId={tripId}
                      value={item.originName}
                      placeholder="origin"
                      onPick={(n, lat, lng) => onPickLocation(item.id, "origin", n, lat, lng)}
                      onText={(v) => onTextLocation(item.id, "originName", v)}
                    />
                  </div>
                  <div data-testid="drive-dest" className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400 shrink-0">To</span>
                    <LocationCell
                      tripId={tripId}
                      value={item.destinationName}
                      placeholder="destination"
                      onPick={(n, lat, lng) => onPickLocation(item.id, "destination", n, lat, lng)}
                      onText={(v) => onTextLocation(item.id, "destinationName", v)}
                    />
                  </div>
                </div>
              );
            }
            return (
              <LocationCell
                tripId={tripId}
                value={item.destinationName}
                placeholder="—"
                onPick={(n, lat, lng) => onPickLocation(item.id, "destination", n, lat, lng)}
                onText={(v) => onTextLocation(item.id, "destinationName", v)}
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
              multiline
              placeholder="—"
              onSave={(v) => onUpdate(row.original.id, "notes", v)}
              className="max-h-[4.5rem] overflow-y-auto thin-scroll"
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
    [tripId, onUpdate, onDelete, onPickLocation, onTextLocation]
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
      // Sort by sortOrder in render so an optimistic drag-reorder (which only
      // rewrites sortOrder in the cache, not the array position) shows the new
      // order in the same frame, before the refetch settles.
      items: [...groupItems].sort((a, b) => a.sortOrder - b.sortOrder),
    });
  }
  result.sort((a, b) => (a.date! < b.date! ? -1 : 1));

  const unscheduled = groups.get("__unscheduled__");
  if (unscheduled?.length) {
    result.push({
      date: null,
      label: "Unscheduled",
      items: [...unscheduled].sort((a, b) => a.sortOrder - b.sortOrder),
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

const UNSCHEDULED_KEY = "__unscheduled__";

// The bucket an item belongs to: its date, or the unscheduled sentinel. Used as
// the SortableContext / droppable id namespace and to detect cross-day drops.
function dayKeyOf(item: Pick<ItineraryItem, "date">): string {
  return item.date ?? UNSCHEDULED_KEY;
}

function GripDots() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden>
      <circle cx="3" cy="3" r="1.3" />
      <circle cx="7" cy="3" r="1.3" />
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="7" cy="8" r="1.3" />
      <circle cx="3" cy="13" r="1.3" />
      <circle cx="7" cy="13" r="1.3" />
    </svg>
  );
}

// A draggable itinerary row. The WHOLE row is the drag handle (a leading grip
// glyph just signals the affordance on hover). The active editors inside each
// cell stop pointer-down propagation, so dragging to select text in a cell
// won't start a row drag; everywhere else on the row begins one.
function SortableRow({
  row,
  selected,
  onSelect,
}: {
  row: Row<ItineraryItem>;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const item = row.original;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  // Distinguish a click (row-select) from a drag so the row doesn't select on
  // the pointerup that ends a drag. A sub-threshold jitter still counts a click.
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    // Never transition the actively-dragged row's transform — only the other
    // rows animate their shuffle (a transition on the active one lags the drag).
    transition: isDragging ? undefined : transition,
  };

  // Compose dnd-kit's pointer handler with our click-vs-drag tracking; ours runs
  // ALONGSIDE dnd's activation handler, never replacing it.
  const ls = (listeners ?? {}) as Record<string, (e: never) => void>;
  const { onPointerDown: dndPointerDown, ...otherListeners } = ls;

  return (
    <tr
      ref={setNodeRef}
      style={style}
      id={`item-${item.id}`}
      {...attributes}
      {...otherListeners}
      onPointerDown={(e) => {
        dndPointerDown?.(e as never);
        downPosRef.current = { x: e.clientX, y: e.clientY };
        draggedRef.current = false;
      }}
      onPointerMove={(e) => {
        if (!downPosRef.current) return;
        const dx = e.clientX - downPosRef.current.x;
        const dy = e.clientY - downPosRef.current.y;
        if (Math.hypot(dx, dy) > 6) draggedRef.current = true;
      }}
      onClick={() => {
        if (draggedRef.current) return;
        onSelect(item.id);
      }}
      className={`group/row border-b border-zinc-50 dark:border-zinc-800/50 last:border-0 cursor-grab active:cursor-grabbing transition-colors ${
        isDragging ? "opacity-30" : ""
      } ${
        selected
          ? "bg-blue-50 dark:bg-blue-900/20 ring-1 ring-inset ring-blue-200 dark:ring-blue-800"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
      }`}
    >
      {row.getVisibleCells().map((cell, i) => (
        <td
          key={cell.id}
          className="px-2 py-0.5 align-middle relative"
          // height:1px is the classic table trick: a td treats height as a
          // minimum and stretches to the row's natural height, so a child's
          // `h-full` resolves to the FULL row height — making the whole cell a
          // click target, not just the centered value.
          style={{ width: cell.column.getSize(), height: 1 }}
        >
          {/* Hover-revealed grip affordance on the first cell. Pointer-events
              off so it never intercepts clicks into the title editor. */}
          {i === 0 && (
            <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-zinc-300 dark:text-zinc-600 opacity-0 group-hover/row:opacity-100 transition-opacity">
              <GripDots />
            </span>
          )}
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

// Floating copy that tracks the pointer during a drag (no in-place ghost). A
// compact card rather than a full <tr>, which can't render outside a <table>.
function DragRowPreview({ item }: { item: ItineraryItem }) {
  const time = item.startTime
    ? /^(\d{1,2}):(\d{2})/.exec(String(item.startTime))
    : null;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white dark:bg-zinc-800 shadow-lg ring-1 ring-black/10 px-3 py-2 text-sm cursor-grabbing">
      <span className="text-zinc-300 dark:text-zinc-600">
        <GripDots />
      </span>
      <span className="font-medium text-zinc-700 dark:text-zinc-200 truncate max-w-[260px]">
        {item.title || "Untitled"}
      </span>
      {time && (
        <span className="text-xs text-zinc-400">
          {time[1].padStart(2, "0")}:{time[2]}
        </span>
      )}
    </div>
  );
}

function DayGroupTable({
  group,
  columns,
  onAddItem,
  onAutoSchedule,
  selectedItemId,
  onItemSelect,
  warning,
  isCrossDayTarget,
}: {
  group: DayGroup;
  columns: ColumnDef<ItineraryItem, unknown>[];
  onAddItem: (date: string | null) => void;
  onAutoSchedule?: () => void;
  selectedItemId: string | null;
  onItemSelect: (itemId: string) => void;
  warning?: DayWarning;
  // True while a row from ANOTHER day is hovering this day during a drag — used
  // to highlight the drop target (within-day shuffles show via row transforms).
  isCrossDayTarget?: boolean;
}) {
  const dayKey = group.date ?? UNSCHEDULED_KEY;
  const table = useReactTable({
    data: group.items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Stable per-item row ids so dnd identifies rows by item id (not array
    // index) and React moves the right DOM node when the order changes.
    getRowId: (row) => row.id,
  });
  // Drop target at the END of the day (the "+ Add item" footer) — lets a
  // cross-day drop append after the last row, which row targets can't express.
  const { setNodeRef: setEndRef, isOver: isEndOver } = useDroppable({
    id: `end:${dayKey}`,
  });
  const itemIds = useMemo(() => group.items.map((i) => i.id), [group.items]);

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

      <div
        className={`rounded-lg border bg-white dark:bg-zinc-900 overflow-hidden transition-colors ${
          isCrossDayTarget
            ? "border-blue-400 dark:border-blue-500 ring-1 ring-blue-300 dark:ring-blue-700"
            : "border-zinc-200 dark:border-zinc-800"
        }`}
      >
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
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              {table.getRowModel().rows.map((row) => (
                <SortableRow
                  key={row.id}
                  row={row}
                  selected={selectedItemId === row.original.id}
                  onSelect={onItemSelect}
                />
              ))}
            </SortableContext>
          </tbody>
        </table>
      </div>

      <div ref={setEndRef}>
        <button
          onClick={() => onAddItem(group.date)}
          className={`mt-1.5 text-xs transition-colors px-2 py-1 rounded ${
            isEndOver
              ? "text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-300 dark:ring-blue-700"
              : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          }`}
        >
          {isEndOver ? "↳ Drop to add to end of day" : "+ Add item"}
        </button>
      </div>
    </div>
  );
}

export function ItineraryTable({
  tripId,
  selectedItemId,
  onItemSelect,
  dayWarnings,
  drives,
  onLocationEdited,
}: {
  tripId: string;
  selectedItemId: string | null;
  onItemSelect: (itemId: string) => void;
  dayWarnings?: DayWarning[];
  drives?: { itemId: string; durationSeconds: number }[];
  // Fired when a location field is committed as PLAIN TEXT (no place picked) so
  // the parent can fall back to fuzzy geocoding (S7-5). A picked place already
  // carries exact coords and does NOT fire this.
  onLocationEdited?: (itemId: string) => void;
}) {
  const { data: items, isLoading } = useItineraryItems(tripId);
  const createItem = useCreateItem(tripId);
  const updateItem = useUpdateItem(tripId);
  const deleteItem = useDeleteItem(tripId);
  const autoSchedule = useAutoSchedule(tripId);
  const reorderItems = useReorderItems(tripId);
  const [newDateInput, setNewDateInput] = useState("");
  const [showNewDay, setShowNewDay] = useState(false);
  // Drag state: the item being dragged and which day the pointer is currently
  // over (for the cross-day drop highlight).
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overDayKey, setOverDayKey] = useState<string | null>(null);
  // Undo affordance for the deterministic fill (good-automatic + easy-manual).
  const [lastApplied, setLastApplied] = useState<ScheduleChange[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const driveSecondsById = useMemo(
    () => new Map((drives ?? []).map((d) => [d.itemId, d.durationSeconds])),
    [drives]
  );

  const itemsById = useMemo(
    () => new Map((items ?? []).map((i) => [i.id, i])),
    [items]
  );

  const sensors = useSensors(
    // 6px travel before a drag activates, so a plain click into a cell still
    // edits and doesn't get hijacked into a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const activeItem = activeId ? itemsById.get(activeId) ?? null : null;
  const activeSourceKey = activeItem ? dayKeyOf(activeItem) : null;

  // Resolve a drop target (`over`) to its day-key. `over` is either a row id or
  // an `end:<dayKey>` footer droppable.
  const resolveOverDayKey = useCallback(
    (overId: string | null): string | null => {
      if (!overId) return null;
      if (overId.startsWith("end:")) return overId.slice(4);
      const it = itemsById.get(overId);
      return it ? dayKeyOf(it) : null;
    },
    [itemsById]
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const handleDragOver = useCallback(
    (e: DragOverEvent) => {
      setOverDayKey(resolveOverDayKey(e.over ? String(e.over.id) : null));
    },
    [resolveOverDayKey]
  );

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const active = activeId;
      setActiveId(null);
      setOverDayKey(null);
      const overId = e.over ? String(e.over.id) : null;
      if (!active || !overId) return;

      const dragged = itemsById.get(active);
      if (!dragged) return;
      if (overId === active) return; // dropped on itself

      const all = items ?? [];
      const targetKey = resolveOverDayKey(overId);
      if (targetKey == null) return;
      const sourceKey = dayKeyOf(dragged);
      const newDate = targetKey === UNSCHEDULED_KEY ? null : targetKey;

      let ordered: ItineraryItem[];
      if (sourceKey === targetKey) {
        // Within-day: arrayMove on the day's sorted list.
        const list = all
          .filter((i) => dayKeyOf(i) === targetKey)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const oldIndex = list.findIndex((i) => i.id === active);
        const overIsEnd = overId.startsWith("end:");
        const newIndex = overIsEnd
          ? list.length - 1
          : list.findIndex((i) => i.id === overId);
        if (oldIndex < 0 || newIndex < 0) return;
        ordered = arrayMove(list, oldIndex, newIndex);
      } else {
        // Cross-day: insert the dragged item into the target day at the
        // hovered row's slot (or append for the end droppable).
        const list = all
          .filter((i) => dayKeyOf(i) === targetKey)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const overIsEnd = overId.startsWith("end:");
        const insertAt = overIsEnd
          ? list.length
          : Math.max(0, list.findIndex((i) => i.id === overId));
        ordered = [...list.slice(0, insertAt), dragged, ...list.slice(insertAt)];
      }

      // Minimal change set: only items whose sortOrder actually shifts, plus the
      // dragged item's date when it crossed days. Skipping no-ops avoids both
      // wasted PATCHes and re-stamping unrelated items' date provenance.
      const changes: ReorderChange[] = [];
      ordered.forEach((it, i) => {
        const dateChanged =
          it.id === active && (it.date ?? null) !== newDate;
        const sortChanged = it.sortOrder !== i;
        if (!dateChanged && !sortChanged) return;
        changes.push({
          itemId: it.id,
          sortOrder: i,
          ...(dateChanged ? { date: newDate } : {}),
        });
      });
      if (changes.length > 0) reorderItems.mutate(changes);
    },
    [activeId, items, itemsById, resolveOverDayKey, reorderItems]
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
  const locationEditedRef = useRef(onLocationEdited);
  useEffect(() => {
    updateRef.current = updateItem;
    deleteRef.current = deleteItem;
    locationEditedRef.current = onLocationEdited;
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

  // A place picked from the type-ahead: write name + exact coords together, all
  // user_provided (a deliberate human choice — protects the coords from fuzzy
  // re-geocoding, the whole point of picking). One PATCH so the cache updates
  // atomically.
  const handlePickLocation = useCallback(
    (itemId: string, kind: LocationKind, name: string, lat: number, lng: number) => {
      const data =
        kind === "origin"
          ? { originName: name, originLat: lat, originLng: lng }
          : { destinationName: name, destinationLat: lat, destinationLng: lng };
      updateRef.current.mutate({ itemId, data });
    },
    []
  );

  // A location committed as plain text (no pick): save the name, then let the
  // parent fall back to fuzzy geocoding for fresh coords (S7-5).
  const handleTextLocation = useCallback(
    (itemId: string, field: string, value: string | null) => {
      updateRef.current.mutate({ itemId, data: { [field]: value } });
      if (value) locationEditedRef.current?.(itemId);
    },
    []
  );

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

  const columns = useColumns(
    tripId,
    handleUpdate,
    handleDelete,
    handlePickLocation,
    handleTextLocation
  );
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setOverDayKey(null);
          }}
        >
          {groups.map((group) => {
            const key = group.date ?? UNSCHEDULED_KEY;
            return (
              <DayGroupTable
                key={key}
                group={group}
                columns={columns}
                onAddItem={handleAddItem}
                onAutoSchedule={() =>
                  applySchedule(sequenceDay(group.items, driveSecondsById))
                }
                selectedItemId={selectedItemId}
                onItemSelect={onItemSelect}
                warning={
                  group.date
                    ? dayWarnings?.find((w) => w.date === group.date)
                    : undefined
                }
                // Highlight only when a row from a DIFFERENT day hovers here.
                isCrossDayTarget={
                  overDayKey === key && activeSourceKey !== key
                }
              />
            );
          })}

          <DragOverlay dropAnimation={null}>
            {activeItem ? <DragRowPreview item={activeItem} /> : null}
          </DragOverlay>
        </DndContext>
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
