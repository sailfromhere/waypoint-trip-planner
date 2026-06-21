"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type CSSProperties,
} from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useTasks,
  useCreateTask,
  useUpdateTask,
  useReorderTasks,
  useDeleteTask,
} from "@/lib/hooks/use-tasks";
import type { TripTask } from "@/db/types";

function AutoTextarea({
  value,
  onChange,
  onSubmit,
  placeholder,
  className,
  autoFocus,
  onBlur,
  onEscape,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  onEscape?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "0";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
    }
  }, [autoFocus]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmit?.();
        }
        if (e.key === "Escape") onEscape?.();
      }}
      placeholder={placeholder}
      rows={1}
      className={`resize-none overflow-hidden ${className ?? ""}`}
    />
  );
}

function CheckCircle({ checked }: { checked: boolean }) {
  return (
    <span className="relative flex items-center justify-center w-[18px] h-[18px]">
      <span
        className={`block w-[16px] h-[16px] rounded-full border-2 transition-colors duration-200 ${
          checked
            ? "border-emerald-400 bg-emerald-400"
            : "border-zinc-300 dark:border-zinc-500 peer-hover:border-zinc-400 dark:peer-hover:border-zinc-400"
        }`}
      />
      {checked && (
        <svg
          className="absolute w-[10px] h-[10px] text-white"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 6.5L5 9L9.5 3.5" />
        </svg>
      )}
    </span>
  );
}

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
      <circle cx="3" cy="3" r="1.3" />
      <circle cx="7" cy="3" r="1.3" />
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="7" cy="8" r="1.3" />
      <circle cx="3" cy="13" r="1.3" />
      <circle cx="7" cy="13" r="1.3" />
    </svg>
  );
}

type DragProps = {
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  isDragging: boolean;
};

// Presentational row. Drag behaviour is injected via `drag` (only for the
// reorderable pending list); completed rows and the overlay render statically.
function TaskRow({
  task,
  onToggle,
  onUpdate,
  onDelete,
  drag,
  variant = "static",
}: {
  task: TripTask;
  onToggle: () => void;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  drag?: DragProps;
  variant?: "sortable" | "static" | "overlay";
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);
  // Read `task.done` directly — the toggle's optimistic cache write is
  // synchronous, so props reflect the new state immediately (no local mirror).
  const checked = task.done;
  // Distinguish a click (edit) from a drag: record pointer-down position, and if
  // the pointer travels past the drag threshold, suppress the click-to-edit that
  // fires on pointerup. A small jitter (< threshold) still counts as a click.
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  const commit = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== task.text) {
      onUpdate(trimmed);
    } else {
      setEditText(task.text);
    }
    setEditing(false);
  }, [editText, task.text, onUpdate]);

  const isOverlay = variant === "overlay";
  const isGhost = drag?.isDragging ?? false;

  // Compose dnd-kit's pointer handler with our own click-vs-drag tracking
  // (ours must run alongside, not replace, dnd-kit's activation handler).
  const listeners = (drag?.listeners ?? {}) as Record<string, (e: never) => void>;
  const { onPointerDown: dndPointerDown, ...otherListeners } = listeners;

  return (
    <div
      ref={drag?.setNodeRef}
      style={drag?.style}
      {...(drag?.attributes ?? {})}
      {...otherListeners}
      onPointerDown={(e) => {
        dndPointerDown?.(e as never);
        downPosRef.current = { x: e.clientX, y: e.clientY };
        draggedRef.current = false;
      }}
      onPointerMove={(e) => {
        if (!drag || !downPosRef.current) return;
        const dx = e.clientX - downPosRef.current.x;
        const dy = e.clientY - downPosRef.current.y;
        if (Math.hypot(dx, dy) > 6) draggedRef.current = true;
      }}
      className={`group flex items-center gap-1.5 pr-2 py-1.5 rounded-lg select-none transition-colors duration-150 ${
        isOverlay
          ? "bg-white dark:bg-zinc-800 shadow-lg ring-1 ring-black/5 cursor-grabbing"
          : isGhost
            ? "opacity-30"
            : `hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                drag ? "cursor-grab active:cursor-grabbing" : ""
              }`
      } ${checked && !isOverlay ? "opacity-40" : ""}`}
    >
      {/* Grip — drag affordance. Only present on draggable (pending) rows. */}
      <span
        className={`shrink-0 w-3 flex justify-center text-zinc-300 dark:text-zinc-600 transition-opacity ${
          isOverlay
            ? "opacity-70"
            : drag
              ? "opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing"
              : "opacity-0"
        }`}
      >
        {(drag || isOverlay) && <GripIcon />}
      </span>

      {/* Checkbox — stop propagation so it doesn't start a drag */}
      <label
        className="shrink-0 cursor-pointer"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="peer sr-only"
        />
        <CheckCircle checked={checked} />
      </label>

      {/* Text */}
      {editing ? (
        <div
          className="flex-1 min-w-0"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <AutoTextarea
            value={editText}
            onChange={setEditText}
            onSubmit={commit}
            onBlur={commit}
            onEscape={() => {
              setEditText(task.text);
              setEditing(false);
            }}
            autoFocus
            className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md px-2 py-1 outline-none focus:border-zinc-400 dark:focus:border-zinc-400 transition-colors"
          />
        </div>
      ) : (
        <div
          onClick={() => {
            if (draggedRef.current || isOverlay) return;
            setEditing(true);
            setEditText(task.text);
          }}
          className="flex-1 min-w-0"
        >
          {/* Inline span so the text-edit cursor shows only over the glyphs;
              the surrounding row area keeps the grab cursor. */}
          <span
            className={`text-sm break-words whitespace-pre-wrap leading-relaxed cursor-text ${
              checked
                ? "line-through text-zinc-400 dark:text-zinc-500"
                : "text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {task.text}
          </span>
        </div>
      )}

      {/* Delete — stop propagation so it doesn't start a drag */}
      {!isOverlay && (
        <button
          onClick={onDelete}
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-500 text-zinc-400 transition-all text-base leading-none px-1 rounded"
          title="Delete"
        >
          ×
        </button>
      )}
    </div>
  );
}

function SortableTaskRow(props: {
  task: TripTask;
  onToggle: () => void;
  onUpdate: (text: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.task.id });

  const drag: DragProps = {
    setNodeRef,
    style: {
      transform: CSS.Transform.toString(transform),
      // Never transition the actively-dragged item's transform — it must track
      // the pointer 1:1. Only the other rows animate their shuffle.
      transition: isDragging ? undefined : transition,
    },
    attributes,
    listeners,
    isDragging,
  };

  return <TaskRow {...props} drag={drag} variant="sortable" />;
}

export function TasksPanel({ tripId }: { tripId: string }) {
  const { data: tasks } = useTasks(tripId);
  const createTask = useCreateTask(tripId);
  const updateTask = useUpdateTask(tripId);
  const reorderTasks = useReorderTasks(tripId);
  const deleteTask = useDeleteTask(tripId);
  const [input, setInput] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleSubmit = useCallback(() => {
    const lines = input
      .split("\n")
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    for (const line of lines) {
      createTask.mutate(line);
    }
    setInput("");
  }, [input, createTask]);

  // Sort by sortOrder so optimistic reorder reflects immediately.
  const pending = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => !t.done)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [tasks]
  );
  const completed = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => t.done)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [tasks]
  );

  const activeTask = useMemo(
    () => (tasks ?? []).find((t) => t.id === activeId) ?? null,
    [tasks, activeId]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = pending.findIndex((t) => t.id === active.id);
      const newIndex = pending.findIndex((t) => t.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const reordered = arrayMove(pending, oldIndex, newIndex);
      reorderTasks.mutate(reordered.map((t) => t.id));
    },
    [pending, reorderTasks]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Quick-capture input */}
      <div className="shrink-0 px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-start gap-2">
          <span className="shrink-0 mt-px text-zinc-300 dark:text-zinc-600 text-sm leading-relaxed">
            +
          </span>
          <AutoTextarea
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Jot a reminder... (Enter to add, Shift+Enter for new line)"
            className="flex-1 min-w-0 text-sm bg-transparent outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-700 dark:text-zinc-300 leading-relaxed"
          />
          {input.trim() && (
            <button
              onClick={handleSubmit}
              className="shrink-0 mt-0.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
            >
              Add
            </button>
          )}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1">
        {pending.length === 0 && completed.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-1.5">
            <span className="text-zinc-300 dark:text-zinc-600 text-2xl">📝</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              Jot down things to remember
            </span>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext
            items={pending.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {pending.map((task) => (
              <SortableTaskRow
                key={task.id}
                task={task}
                onToggle={() =>
                  updateTask.mutate({ taskId: task.id, data: { done: true } })
                }
                onUpdate={(text) =>
                  updateTask.mutate({ taskId: task.id, data: { text } })
                }
                onDelete={() => deleteTask.mutate(task.id)}
              />
            ))}
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeTask ? (
              <TaskRow
                task={activeTask}
                variant="overlay"
                onToggle={() => {}}
                onUpdate={() => {}}
                onDelete={() => {}}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        {completed.length > 0 && (
          <>
            {pending.length > 0 && (
              <div className="border-t border-zinc-100 dark:border-zinc-800 mt-2 mb-1" />
            )}
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1">
              Done ({completed.length})
            </div>
            {completed.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={() =>
                  updateTask.mutate({
                    taskId: task.id,
                    data: { done: false },
                  })
                }
                onUpdate={(text) =>
                  updateTask.mutate({ taskId: task.id, data: { text } })
                }
                onDelete={() => deleteTask.mutate(task.id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
