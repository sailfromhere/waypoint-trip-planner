"use client";

import {
  memo,
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
  type ColumnSizingState,
  type OnChangeFn,
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
import { AnimatePresence, motion } from "framer-motion";
import { rowEnterExit } from "@/lib/motion";
import type { ItineraryItem, ItineraryItemRow } from "@/db/types";
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
import {
  formatItemTimeLabel,
  formatItemTzBadge,
  defaultNewDayDate,
} from "@/lib/format";
import { EditableCell } from "./editable-cell";
import { LocationCell } from "./location-cell";
import { buildDayColorMap } from "@/lib/trip-state/day-colors";
import { TitleCategoryCell } from "./category-cell";
import { Button } from "@/components/ui/button";

const col = createColumnHelper<ItineraryItem>();

type LocationKind = "origin" | "destination";

function useColumns(
  tripId: string,
  onUpdate: (itemId: string, field: string, value: string | number | null) => void,
  onDelete: (itemId: string) => void,
  onPickLocation: (itemId: string, kind: LocationKind, name: string, lat: number, lng: number) => void,
  onTextLocation: (itemId: string, field: string, value: string | null) => void,
  homeTimezone: string | null | undefined
): ColumnDef<ItineraryItem, unknown>[] {
  return useMemo(
    () =>
      [
        col.accessor("title", {
          header: "Title",
          size: 240,
          // Merged Title + Category: icon chip + title with an uppercase category
          // caption beneath (render-match layout). Category edits via a custom
          // menu opened by the chip or the caption.
          cell: ({ row }) => (
            <TitleCategoryCell
              item={row.original}
              onUpdateTitle={(v) => onUpdate(row.original.id, "title", v)}
              onUpdateCategory={(v) => onUpdate(row.original.id, "category", v)}
            />
          ),
        }),
        col.accessor("startTime", {
          header: "Start",
          size: 96,
          cell: ({ row, getValue }) => {
            const badge = formatItemTzBadge(row.original, homeTimezone);
            return (
              <EditableCell
                value={getValue()}
                type="time"
                placeholder="—"
                onSave={(v) => onUpdate(row.original.id, "startTime", v)}
                adornment={
                  badge ? (
                    <span
                      title={
                        formatItemTimeLabel(row.original, homeTimezone) ??
                        undefined
                      }
                      className="shrink-0 text-[9px] font-medium uppercase tracking-tight text-zinc-400 dark:text-zinc-500"
                    >
                      {badge}
                    </span>
                  ) : undefined
                }
              />
            );
          },
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
                    <span className="text-[10px] text-zinc-400 shrink-0 w-7 text-right">From</span>
                    <LocationCell
                      tripId={tripId}
                      value={item.originName}
                      placeholder="origin"
                      onPick={(n, lat, lng) => onPickLocation(item.id, "origin", n, lat, lng)}
                      onText={(v) => onTextLocation(item.id, "originName", v)}
                    />
                  </div>
                  <div data-testid="drive-dest" className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400 shrink-0 w-7 text-right">To</span>
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
          size: 125,
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
              multilineMaxClass="max-h-[4.5rem]"
              placeholder="—"
              onSave={(v) => onUpdate(row.original.id, "notes", v)}
              className="max-h-[4.5rem] overflow-y-auto thin-scroll"
            />
          ),
        }),
        col.display({
          id: "actions",
          size: 22,
          enableResizing: false,
          cell: ({ row }) => (
            <button
              onClick={() => onDelete(row.original.id)}
              className="opacity-0 group-hover/row:opacity-100 text-zinc-400 hover:text-red-500 text-xs px-1"
              title="Delete item"
            >
              ✕
            </button>
          ),
        }),
      ] as ColumnDef<ItineraryItem, unknown>[],
    [tripId, onUpdate, onDelete, onPickLocation, onTextLocation, homeTimezone]
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

// A draggable itinerary row. The WHOLE row is the drag handle — the cursor-grab
// affordance is the only signal needed (no grip glyph). The active editors inside
// each cell stop pointer-down propagation, so dragging to select text in a cell
// won't start a row drag; everywhere else on the row begins one.
// Memoized so a `routes` refetch (or any parent re-render that doesn't change
// THIS row) can't re-render the row — re-rendering the row re-renders its cells,
// and re-rendering a cell's controlled native <select> dismisses an open popup
// (the reported Category-dropdown bug). TanStack returns a referentially stable
// `row` while data + columns are unchanged, so the default shallow prop compare
// skips correctly; a real change to the item, columns (reorder/resize/show-hide),
// or selection produces a new `row`/`selected` and still re-renders.
const SortableRow = memo(function SortableRow({
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
    <motion.tr
      ref={setNodeRef}
      style={style}
      id={`item-${item.id}`}
      // Opacity-only enter/exit (see rowEnterExit). NO `layout`/`y`: the inline
      // `style.transform` above belongs to dnd-kit's drag-shuffle and framer must
      // not take ownership of transform.
      variants={rowEnterExit}
      initial="hidden"
      animate="visible"
      exit="exit"
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
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          className={`${
            cell.column.id === "actions"
              ? "px-0 text-center"
              : cell.column.id === "title"
              ? "pl-0 pr-2"
              : "px-2"
          } py-0.5 align-middle relative`}
          // height:1px is the classic table trick: a td treats height as a
          // minimum and stretches to the row's natural height, so a child's
          // `h-full` resolves to the FULL row height — making the whole cell a
          // click target, not just the centered value.
          style={{ width: cell.column.getSize(), height: 1 }}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </motion.tr>
  );
});

// Floating copy that tracks the pointer during a drag (no in-place ghost). A
// faithful full-row render: a one-row mini-table reusing the SAME column defs,
// sized to the source row's measured width, so it looks like the actual row
// being physically lifted (a <tr> can't render outside a <table>, but a whole
// <table> can live inside the DragOverlay div). The reused cells render in
// display mode and the row height matches automatically.
function DragRowPreview({
  item,
  columns,
  columnOrder,
  columnVisibility,
  columnSizing,
  width,
}: {
  item: ItineraryItem;
  columns: ColumnDef<ItineraryItem, unknown>[];
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  columnSizing: ColumnSizingState;
  width?: number;
}) {
  const table = useReactTable({
    data: useMemo(() => [item], [item]),
    columns,
    state: { columnOrder, columnVisibility, columnSizing },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });
  const row = table.getRowModel().rows[0];
  return (
    <table
      style={{ width }}
      className="w-full table-fixed border-collapse bg-white dark:bg-zinc-900 rounded-lg shadow-2xl ring-1 ring-black/10 cursor-grabbing"
    >
      <tbody>
        <tr>
          {row.getVisibleCells().map((cell) => (
            <td
              key={cell.id}
              className={`${
                cell.column.id === "actions"
                  ? "px-0 text-center"
                  : cell.column.id === "title"
                  ? "pl-0 pr-2"
                  : "px-2"
              } py-0.5 align-middle`}
              style={{ width: cell.column.getSize(), height: 1 }}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

// Column customization (show/hide + reorder). The "actions" delete column is a
// control, not data — it's pinned last and excluded from the menu. Title is
// non-hideable (it drives the row height via its min-height).
type ColumnMeta = { id: string; label: string; fixed?: boolean };
const ITINERARY_COLUMNS: ColumnMeta[] = [
  { id: "title", label: "Title", fixed: true },
  { id: "startTime", label: "Start" },
  { id: "durationMinutes", label: "Duration" },
  { id: "destinationName", label: "Location" },
  { id: "confirmationStatus", label: "Status" },
  { id: "costCents", label: "Cost" },
  { id: "notes", label: "Notes" },
];
const DEFAULT_COLUMN_ORDER = ITINERARY_COLUMNS.map((c) => c.id);
const COLUMN_PREFS_KEY = "waypoint-itinerary-columns";

function ColumnsMenuRow({
  col,
  visible,
  onToggle,
}: {
  col: ColumnMeta;
  visible: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: col.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-1.5 py-1.5 rounded ${
        isDragging ? "bg-zinc-100 dark:bg-zinc-800 opacity-80" : ""
      }`}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-zinc-300 dark:text-zinc-600 select-none leading-none"
        title="Drag to reorder"
      >
        ⠿
      </span>
      <label className="flex items-center gap-2 flex-1 cursor-pointer text-xs">
        <input
          type="checkbox"
          checked={visible}
          disabled={col.fixed}
          onChange={onToggle}
          className="accent-zinc-700 dark:accent-zinc-300"
        />
        <span className={col.fixed ? "text-zinc-400" : ""}>
          {col.label}
          {col.fixed ? " · always shown" : ""}
        </span>
      </label>
    </div>
  );
}

// Toolbar dropdown to show/hide and reorder columns. Uses its OWN DndContext for
// the sortable list — rendered above the row DndContext so the two never nest.
function ColumnsMenu({
  order,
  visibility,
  onOrderChange,
  onVisibilityChange,
  openUp = false,
}: {
  order: string[];
  visibility: Record<string, boolean>;
  onOrderChange: (o: string[]) => void;
  onVisibilityChange: (v: Record<string, boolean>) => void;
  // Open the dropdown ABOVE the button (it lives in the bottom toolbar).
  openUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );
  const metaById = useMemo(
    () => new Map(ITINERARY_COLUMNS.map((c) => [c.id, c])),
    []
  );
  const ordered = useMemo(
    () => order.map((id) => metaById.get(id)).filter(Boolean) as ColumnMeta[],
    [order, metaById]
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const hiddenCount = ITINERARY_COLUMNS.filter(
    (c) => !c.fixed && visibility[c.id] === false
  ).length;

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onOrderChange(arrayMove(order, oldIndex, newIndex));
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="quiet"
        size="sm"
        icon="⚙"
        onClick={() => setOpen((o) => !o)}
        title="Show, hide, and reorder columns"
      >
        Columns{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
      </Button>
      {open && (
        <div
          className={`absolute right-0 z-50 w-60 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-1.5 ${
            openUp ? "bottom-full mb-1" : "mt-1"
          }`}
        >
          <p className="px-1.5 py-1 text-[10px] uppercase tracking-wide text-zinc-400">
            Drag to reorder · toggle to show/hide
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {ordered.map((c) => (
                <ColumnsMenuRow
                  key={c.id}
                  col={c}
                  visible={visibility[c.id] !== false}
                  onToggle={() =>
                    onVisibilityChange({
                      ...visibility,
                      [c.id]: visibility[c.id] === false,
                    })
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}

function DayGroupTable({
  group,
  dayColor,
  columns,
  columnOrder,
  columnVisibility,
  columnSizing,
  onColumnSizingChange,
  headerDrag,
  onAddItem,
  onAutoSchedule,
  selectedItemId,
  onItemSelect,
  warning,
  isCrossDayTarget,
}: {
  group: DayGroup;
  dayColor?: string;
  columns: ColumnDef<ItineraryItem, unknown>[];
  // Shared across every day-table so all groups show the same columns in the
  // same order ("actions" is pinned first/leftmost by the parent).
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  columnSizing: ColumnSizingState;
  onColumnSizingChange: OnChangeFn<ColumnSizingState>;
  // Native HTML5 header drag-reorder wiring (shared across all day-theads).
  headerDrag: {
    overId: string | null;
    onDragStart: (id: string) => void;
    onDragOver: (id: string) => void;
    onDragEnd: () => void;
    onDrop: (id: string) => void;
  };
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
    state: { columnOrder, columnVisibility, columnSizing },
    onColumnSizingChange,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    // Use the stable client `_key` (falling back to the item id) as the row id,
    // so it survives the optimistic-create temp→real id swap. This id flows into
    // each cell's id and thus every `<td key={cell.id}>` — keying off `_key`
    // keeps the cells (and any open editor) MOUNTED across the swap. dnd still
    // identifies rows by the real item id (useSortable / SortableContext below).
    getRowId: (row) => (row as ItineraryItemRow)._key ?? row.id,
  });
  // Drop target at the END of the day (the "+ Add item" footer) — lets a
  // cross-day drop append after the last row, which row targets can't express.
  const { setNodeRef: setEndRef, isOver: isEndOver } = useDroppable({
    id: `end:${dayKey}`,
  });
  const itemIds = useMemo(() => group.items.map((i) => i.id), [group.items]);

  return (
    <div className="mb-6 wp-contain-block">
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          {dayColor && (
            <span
              className="inline-block w-2 h-2 rounded-[2px] shrink-0"
              style={{ background: dayColor }}
            />
          )}
          {group.label}
          <span className="text-zinc-400 dark:text-zinc-500 font-normal normal-case">
            ({group.items.length} {group.items.length === 1 ? "item" : "items"})
          </span>
          {warning && warning.warnings.length > 0 && (
            <span className="ml-2 text-amber-600 dark:text-amber-400 font-normal normal-case" title={warning.warnings.join("; ")}>
              ⚠ {warning.warnings[0]}
            </span>
          )}
        </h3>
        {onAutoSchedule && group.date && (
          <Button
            variant="quiet"
            size="sm"
            icon="⏱"
            onClick={onAutoSchedule}
            className="normal-case"
            title="Fill in blank start times for this day (drive times from routing; your set times are kept)"
          >
            Auto-schedule
          </Button>
        )}
      </div>

      <div
        // overflow-x-auto (not overflow-hidden): at narrow split-pane widths the
        // table scrolls horizontally instead of crushing columns (which clipped
        // the "Completed" status). The table keeps a min width = sum of column
        // sizes so columns hold their natural widths.
        className={`rounded-lg border bg-white dark:bg-zinc-900 overflow-x-auto transition-colors ${
          isCrossDayTarget
            ? "border-blue-400 dark:border-blue-500 ring-1 ring-blue-300 dark:ring-blue-700"
            : "border-zinc-200 dark:border-zinc-800"
        }`}
        // Day-colored left stripe (matches the map ring / calendar band): a thick
        // left border in this day's hue. Yields to the cross-day drop highlight.
        style={
          !isCrossDayTarget && dayColor
            ? { borderLeftColor: dayColor, borderLeftWidth: 4 }
            : undefined
        }
      >
        <table
          // table-fixed so column widths are honored EXACTLY (auto-layout sizes
          // to content and ignores the resize/size hints — which both hid resizes
          // and let the Status select get crushed).
          // Width = the EXACT sum of the (possibly-resized) column widths, in px,
          // with NO percentage anywhere (no w-full, no minWidth:100%). Any
          // percentage gives table-fixed slack to redistribute — and Safari
          // clamps the table toward that % and squeezes the other columns when one
          // is resized (Chrome overflows instead). With table-width == Σ column
          // widths there is zero slack, so it always overflows+scrolls and a
          // squeeze is impossible in any engine. Trade-off: on a screen wide
          // enough that the table is narrower than the pane, there's empty space
          // to the right (left-aligned) — acceptable vs. the squeeze.
          className="table-fixed border-collapse"
          style={{ width: table.getTotalSize() }}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr
                key={hg.id}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                {hg.headers.map((header) => {
                  const colId = header.column.id;
                  const reorderable = colId !== "actions";
                  const isOver =
                    headerDrag.overId === colId && reorderable;
                  return (
                    <th
                      key={header.id}
                      className={`relative text-left text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1.5 border-r border-zinc-100 dark:border-zinc-800 last:border-r-0 ${
                        isOver
                          ? "border-l-2 border-blue-400 dark:border-blue-500"
                          : ""
                      }`}
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder ? null : reorderable ? (
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            headerDrag.onDragStart(colId);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            headerDrag.onDragOver(colId);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            headerDrag.onDrop(colId);
                          }}
                          onDragEnd={headerDrag.onDragEnd}
                          className="cursor-grab active:cursor-grabbing select-none inline-block"
                          title="Drag to reorder column"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                        </span>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )
                      )}
                      {header.column.getCanResize() && (
                        // Wide invisible hit area; inner div is the thin visual.
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={() => header.column.resetSize()}
                          className="group absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none"
                          title="Drag to resize · double-click to reset"
                        >
                          <div
                            className={`absolute right-0 top-0 h-full w-px transition-colors ${
                              header.column.getIsResizing()
                                ? "bg-blue-400 dark:bg-blue-500"
                                : "group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500"
                            }`}
                          />
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              {/* initial={false} → existing rows don't fade on first load; only
                  newly added rows animate in and deleted rows fade out. Exit is
                  propagated to the memoized SortableRow's motion.tr via framer's
                  PresenceContext. */}
              <AnimatePresence initial={false}>
                {table.getRowModel().rows.map((row) => (
                  <SortableRow
                    // Key off the stable client `_key` (not the item id) so the
                    // row stays mounted when an optimistic create's temp id is
                    // swapped for the real server id — otherwise the row remounts
                    // and an in-progress title/location edit is lost. dnd/server
                    // ops keep using the real id (getRowId / useSortable below).
                    key={(row.original as ItineraryItemRow)._key ?? row.original.id}
                    row={row}
                    selected={selectedItemId === row.original.id}
                    onSelect={onItemSelect}
                  />
                ))}
              </AnimatePresence>
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
  homeTimezone,
  onLocationEdited,
}: {
  tripId: string;
  selectedItemId: string | null;
  onItemSelect: (itemId: string) => void;
  dayWarnings?: DayWarning[];
  drives?: { itemId: string; durationSeconds: number }[];
  // Trip-level fallback tz for the sequencer (per-item tz on the rows wins).
  homeTimezone?: string | null;
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
  // The dragged row's pixel width, measured on drag start, so the faithful
  // DragOverlay row matches the source (its columns are w-full % of this).
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // Undo affordance for the deterministic fill (good-automatic + easy-manual).
  const [lastApplied, setLastApplied] = useState<ScheduleChange[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Column show/hide + order + widths, persisted per-browser. Shared by every
  // day-table so all groups stay in lockstep.
  const [columnOrder, setColumnOrder] = useState<string[]>(DEFAULT_COLUMN_ORDER);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  // `prefsRef` always holds the latest three so persistence never reads a stale
  // closure (we update it synchronously inside each setter, not in an effect).
  const prefsRef = useRef<{
    order: string[];
    visibility: Record<string, boolean>;
    sizing: ColumnSizingState;
  }>({ order: DEFAULT_COLUMN_ORDER, visibility: {}, sizing: {} });
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Persist ONLY from user actions (never a mount effect — that races the load
  // effect under StrictMode's double-invoke and clobbers saved prefs with
  // defaults). Resize fires continuously, so its writes are debounced.
  const persistNow = useCallback(() => {
    try {
      localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(prefsRef.current));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, []);
  const persistSoon = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(persistNow, 250);
  }, [persistNow]);

  // Load saved prefs once. Reconcile with the KNOWN columns: keep the user's
  // order for ones that still exist, append any newly-added columns, drop
  // unknown ones — so a future column-set change never silently loses a column.
  // A one-time hydrate-from-storage MUST be an effect (not a lazy useState
  // initializer): localStorage is unavailable during SSR, and reading it in the
  // initializer would diverge from the server HTML and break hydration. The
  // set-state-in-effect rule is disabled for exactly these intentional one-shot
  // hydration writes (deps [] — they run once, not on a render-derived value).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLUMN_PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        order?: unknown;
        visibility?: unknown;
        sizing?: unknown;
      };
      if (Array.isArray(parsed.order)) {
        const known = new Set(DEFAULT_COLUMN_ORDER);
        const order = (parsed.order as string[]).filter((id) => known.has(id));
        for (const id of DEFAULT_COLUMN_ORDER)
          if (!order.includes(id)) order.push(id);
        prefsRef.current.order = order;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setColumnOrder(order);
      }
      if (parsed.visibility && typeof parsed.visibility === "object") {
        prefsRef.current.visibility = parsed.visibility as Record<string, boolean>;
        setColumnVisibility(parsed.visibility as Record<string, boolean>);
      }
      if (parsed.sizing && typeof parsed.sizing === "object") {
        prefsRef.current.sizing = parsed.sizing as ColumnSizingState;
        setColumnSizing(parsed.sizing as ColumnSizingState);
      }
    } catch {
      /* corrupt prefs — fall back to defaults */
    }
  }, []);

  const handleColumnOrderChange = useCallback(
    (order: string[]) => {
      setColumnOrder(order);
      prefsRef.current = { ...prefsRef.current, order };
      persistNow();
    },
    [persistNow]
  );
  const handleColumnVisibilityChange = useCallback(
    (visibility: Record<string, boolean>) => {
      setColumnVisibility(visibility);
      prefsRef.current = { ...prefsRef.current, visibility };
      persistNow();
    },
    [persistNow]
  );
  const handleColumnSizingChange = useCallback<OnChangeFn<ColumnSizingState>>(
    (updater) => {
      setColumnSizing((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        prefsRef.current = { ...prefsRef.current, sizing: next };
        return next;
      });
      persistSoon();
    },
    [persistSoon]
  );

  // Native HTML5 header drag-reorder (deliberately separate from the dnd-kit row
  // drag — a <th> isn't a registered row draggable, so the two never conflict and
  // we avoid nesting a second DndContext). The dragged id lives in a ref; the
  // hovered id is state for the drop cue.
  const headerDragId = useRef<string | null>(null);
  const [headerOverId, setHeaderOverId] = useState<string | null>(null);
  const onHeaderDragStart = useCallback((id: string) => {
    headerDragId.current = id;
  }, []);
  const onHeaderDragOver = useCallback(
    (id: string) => setHeaderOverId((cur) => (cur === id ? cur : id)),
    []
  );
  const onHeaderDragEnd = useCallback(() => {
    headerDragId.current = null;
    setHeaderOverId(null);
  }, []);
  const onHeaderDrop = useCallback(
    (targetId: string) => {
      const src = headerDragId.current;
      headerDragId.current = null;
      setHeaderOverId(null);
      if (!src || src === targetId) return;
      setColumnOrder((order) => {
        const from = order.indexOf(src);
        const to = order.indexOf(targetId);
        if (from < 0 || to < 0) return order;
        const next = [...order];
        next.splice(from, 1);
        next.splice(to, 0, src);
        prefsRef.current = { ...prefsRef.current, order: next };
        persistNow();
        return next;
      });
    },
    [persistNow]
  );
  const headerDrag = useMemo(
    () => ({
      overId: headerOverId,
      onDragStart: onHeaderDragStart,
      onDragOver: onHeaderDragOver,
      onDragEnd: onHeaderDragEnd,
      onDrop: onHeaderDrop,
    }),
    [headerOverId, onHeaderDragStart, onHeaderDragOver, onHeaderDragEnd, onHeaderDrop]
  );

  // TanStack wants the full leaf-id order including the pinned "actions"
  // control. It's pinned FIRST (leftmost) so the delete ✕ is reachable without
  // scrolling the now-wide table all the way right.
  const tableColumnOrder = useMemo(
    () => ["actions", ...columnOrder],
    [columnOrder]
  );

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
    const id = String(e.active.id);
    setActiveId(id);
    const el = document.getElementById(`item-${id}`);
    setDragWidth(el ? el.getBoundingClientRect().width : null);
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
      setDragWidth(null);
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
      title: "",
      category: "activity",
      date,
      sortOrder: maxSort + 1,
    });
  }

  function handleAddDay(e: React.FormEvent) {
    e.preventDefault();
    if (!newDateInput) return;
    createItem.mutate({
      title: "",
      category: "activity",
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
    handleTextLocation,
    homeTimezone
  );
  const groups = useMemo(() => groupByDate(items ?? []), [items]);
  // Day → hue (matches map + calendar) so each day-group header carries its color.
  const dayColors = useMemo(
    () => buildDayColorMap((items ?? []).map((i) => i.date)),
    [items]
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[0, 1].map((g) => (
          <div key={g} className="space-y-2">
            <div className="skeleton h-3 w-32" />
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {[0, 1, 2].map((r) => (
                <div key={r} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="skeleton h-4 w-4 rounded-full shrink-0" />
                  <div className="skeleton h-4 flex-1" />
                  <div className="skeleton h-4 w-16 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
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
        <div className="text-center py-12 flex flex-col items-center">
          <svg
            viewBox="0 0 24 24"
            className="w-9 h-9 mb-3 text-zinc-300 dark:text-zinc-600"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
            <path d="M9 3v15M15 6v15" />
          </svg>
          <p className="font-display text-lg font-semibold text-zinc-700 dark:text-zinc-200">
            No stops yet
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Add a day below, or ask the AI copilot to draft an itinerary.
          </p>
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
            setDragWidth(null);
          }}
        >
          {groups.map((group) => {
            const key = group.date ?? UNSCHEDULED_KEY;
            return (
              <DayGroupTable
                key={key}
                group={group}
                dayColor={group.date ? dayColors.get(group.date) : undefined}
                columns={columns}
                columnOrder={tableColumnOrder}
                columnVisibility={columnVisibility}
                columnSizing={columnSizing}
                onColumnSizingChange={handleColumnSizingChange}
                headerDrag={headerDrag}
                onAddItem={handleAddItem}
                onAutoSchedule={() =>
                  applySchedule(
                    sequenceDay(group.items, driveSecondsById, {
                      homeTimezone,
                    })
                  )
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
            {activeItem ? (
              <DragRowPreview
                item={activeItem}
                columns={columns}
                columnOrder={tableColumnOrder}
                columnVisibility={columnVisibility}
                columnSizing={columnSizing}
                width={dragWidth ?? undefined}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <div className="flex items-center gap-2 mt-2">
        {showNewDay ? (
          <form onSubmit={handleAddDay} className="flex gap-2 items-center">
            <input
              type="date"
              value={newDateInput}
              onChange={(e) => setNewDateInput(e.target.value)}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
              autoFocus
            />
            <Button type="submit">Add</Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowNewDay(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <Button
              variant="dashed"
              size="sm"
              onClick={() => {
                setNewDateInput(defaultNewDayDate(items ?? []));
                setShowNewDay(true);
              }}
            >
              + Add day
            </Button>
            <Button
              variant="dashed"
              size="sm"
              onClick={() => handleAddItem(null)}
            >
              + Unscheduled item
            </Button>
            {(items ?? []).some((i) => i.date) && (
              <Button
                variant="quiet"
                size="sm"
                icon="⏱"
                className="ml-auto"
                onClick={() =>
                  applySchedule(
                    sequenceTrip(items ?? [], driveSecondsById, {
                      homeTimezone,
                    })
                  )
                }
                title="Fill blank start times across all days (kept: your times & booked items)"
              >
                Auto-schedule all
              </Button>
            )}
            {groups.length > 0 && (
              <div
                className={
                  (items ?? []).some((i) => i.date) ? undefined : "ml-auto"
                }
              >
                <ColumnsMenu
                  openUp
                  order={columnOrder}
                  visibility={columnVisibility}
                  onOrderChange={handleColumnOrderChange}
                  onVisibilityChange={handleColumnVisibilityChange}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
