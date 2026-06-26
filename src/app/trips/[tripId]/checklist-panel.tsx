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
  useChecklist,
  useCreateChecklistItem,
  useUpdateChecklistItem,
  useReorderChecklist,
  useDeleteChecklistItem,
  useInstantiateChecklist,
} from "@/lib/hooks/use-checklist";
import {
  useChecklistTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
} from "@/lib/hooks/use-checklist-templates";
import type { ChecklistInstance, ChecklistTemplate } from "@/db/types";
import { Button } from "@/components/ui/button";

// ── Shared small components ──

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
            : "border-zinc-300 dark:border-zinc-500"
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

// ── Checklist row ──

type DragProps = {
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  isDragging: boolean;
};

function ChecklistRow({
  item,
  onToggle,
  onUpdate,
  onDelete,
  onSaveToTemplate,
  drag,
  variant = "static",
}: {
  item: ChecklistInstance;
  onToggle: () => void;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  onSaveToTemplate?: () => void;
  drag?: DragProps;
  variant?: "sortable" | "static" | "overlay";
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const checked = item.done;
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  const commit = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== item.text) {
      onUpdate(trimmed);
    } else {
      setEditText(item.text);
    }
    setEditing(false);
  }, [editText, item.text, onUpdate]);

  const isOverlay = variant === "overlay";
  const isGhost = drag?.isDragging ?? false;

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
              setEditText(item.text);
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
            setEditText(item.text);
          }}
          className="flex-1 min-w-0"
        >
          <span
            className={`text-sm break-words whitespace-pre-wrap leading-relaxed cursor-text ${
              checked
                ? "line-through text-zinc-400 dark:text-zinc-500"
                : "text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {item.text}
          </span>
        </div>
      )}

      {!isOverlay && (
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onSaveToTemplate && !item.templateId && (
            <button
              onClick={onSaveToTemplate}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-zinc-400 hover:text-blue-500 transition-colors text-[11px] px-1 rounded"
              title="Save to templates"
            >
              ↑T
            </button>
          )}
          <button
            onClick={onDelete}
            onPointerDown={(e) => e.stopPropagation()}
            className="hover:text-red-500 text-zinc-400 transition-all text-base leading-none px-1 rounded"
            title="Delete"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function SortableChecklistRow(props: {
  item: ChecklistInstance;
  onToggle: () => void;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  onSaveToTemplate?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.item.id });

  const drag: DragProps = {
    setNodeRef,
    style: {
      transform: CSS.Transform.toString(transform),
      transition: isDragging ? undefined : transition,
    },
    attributes,
    listeners,
    isDragging,
  };

  return <ChecklistRow {...props} drag={drag} variant="sortable" />;
}

// ── Template management modal ──

function TemplateRow({
  template,
  onUpdate,
  onDelete,
}: {
  template: ChecklistTemplate;
  onUpdate: (data: { text?: string; category?: string }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(template.text);
  const [editCategory, setEditCategory] = useState(template.category ?? "");

  const commit = useCallback(() => {
    const trimmedText = editText.trim();
    const trimmedCat = editCategory.trim();
    const changes: { text?: string; category?: string } = {};
    if (trimmedText && trimmedText !== template.text) changes.text = trimmedText;
    if (trimmedCat !== (template.category ?? "")) changes.category = trimmedCat || undefined;
    if (Object.keys(changes).length > 0) onUpdate(changes);
    else {
      setEditText(template.text);
      setEditCategory(template.category ?? "");
    }
    setEditing(false);
  }, [editText, editCategory, template, onUpdate]);

  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
      {editing ? (
        <div className="flex-1 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <input
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setEditText(template.text);
                setEditCategory(template.category ?? "");
                setEditing(false);
              }
            }}
            autoFocus
            className="text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md px-2 py-1 outline-none focus:border-zinc-400"
          />
          <input
            value={editCategory}
            onChange={(e) => setEditCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setEditText(template.text);
                setEditCategory(template.category ?? "");
                setEditing(false);
              }
            }}
            placeholder="Category (optional)"
            className="text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md px-2 py-1 outline-none focus:border-zinc-400 text-zinc-500"
          />
          <div className="flex gap-1">
            <Button size="sm" onClick={commit}>
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditText(template.text);
                setEditCategory(template.category ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => {
              setEditing(true);
              setEditText(template.text);
              setEditCategory(template.category ?? "");
            }}
          >
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{template.text}</span>
            {template.category && (
              <span className="ml-2 text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-full">
                {template.category}
              </span>
            )}
          </div>
          <button
            onClick={onDelete}
            className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-500 text-zinc-400 transition-all text-base leading-none px-1 rounded"
            title="Delete template"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

function TemplateManager({ onClose }: { onClose: () => void }) {
  const { data: templates } = useChecklistTemplates();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const [input, setInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");

  const grouped = useMemo(() => {
    const sorted = [...(templates ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const groups = new Map<string, ChecklistTemplate[]>();
    for (const t of sorted) {
      const cat = t.category ?? "";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(t);
    }
    return groups;
  }, [templates]);

  const existingCategories = useMemo(
    () => [...new Set((templates ?? []).map((t) => t.category).filter(Boolean) as string[])].sort(),
    [templates]
  );

  const handleAdd = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    createTemplate.mutate({ text, category: categoryInput.trim() || undefined });
    setInput("");
  }, [input, categoryInput, createTemplate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 w-[420px] max-h-[70vh] flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Manage Templates
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="shrink-0 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex flex-col gap-1.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="New template item..."
              className="text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2.5 py-1.5 outline-none focus:border-zinc-400 placeholder:text-zinc-400"
            />
            <div className="flex gap-1.5 items-center">
              <input
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                placeholder="Category"
                list="template-categories"
                className="flex-1 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 outline-none focus:border-zinc-400 placeholder:text-zinc-400"
              />
              <datalist id="template-categories">
                {existingCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <Button size="sm" onClick={handleAdd} disabled={!input.trim()}>
                Add
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {(templates ?? []).length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-1.5">
              <span className="text-zinc-300 dark:text-zinc-600 text-2xl">📋</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                No templates yet
              </span>
            </div>
          )}
          {[...grouped.entries()].map(([category, items]) => (
            <div key={category || "__uncategorized"} className="mb-2">
              {category && (
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1 mt-1">
                  {category}
                </div>
              )}
              {items.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  onUpdate={(data) => updateTemplate.mutate({ id: t.id, data })}
                  onDelete={() => deleteTemplate.mutate(t.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main panel ──

export function ChecklistPanel({ tripId }: { tripId: string }) {
  const { data: items } = useChecklist(tripId);
  const createItem = useCreateChecklistItem(tripId);
  const updateItem = useUpdateChecklistItem(tripId);
  const reorderChecklist = useReorderChecklist(tripId);
  const deleteItem = useDeleteChecklistItem(tripId);
  const instantiate = useInstantiateChecklist(tripId);
  const createTemplate = useCreateTemplate();

  const [input, setInput] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showTemplateManager, setShowTemplateManager] = useState(false);

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
      createItem.mutate({ text: line });
    }
    setInput("");
  }, [input, createItem]);

  const pending = useMemo(
    () =>
      (items ?? [])
        .filter((t) => !t.done)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [items]
  );
  const completed = useMemo(
    () =>
      (items ?? [])
        .filter((t) => t.done)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [items]
  );

  const pendingByCategory = useMemo(() => {
    const groups = new Map<string, ChecklistInstance[]>();
    for (const item of pending) {
      const cat = item.category ?? "";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    }
    return groups;
  }, [pending]);

  const activeItem = useMemo(
    () => (items ?? []).find((t) => t.id === activeId) ?? null,
    [items, activeId]
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
      reorderChecklist.mutate(reordered.map((t) => t.id));
    },
    [pending, reorderChecklist]
  );

  const handleSaveToTemplate = useCallback(
    (item: ChecklistInstance) => {
      createTemplate.mutate({ text: item.text, category: item.category ?? undefined });
    },
    [createTemplate]
  );

  const hasCategories = pendingByCategory.size > 1 || (pendingByCategory.size === 1 && !pendingByCategory.has(""));

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
        <Button
          variant="quiet"
          size="sm"
          onClick={() => instantiate.mutate()}
          disabled={instantiate.isPending}
        >
          {instantiate.isPending ? "Loading..." : "Load from templates"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTemplateManager(true)}
        >
          Manage templates
        </Button>
        {instantiate.data && (
          <span className="text-[10px] text-zinc-400 ml-auto">
            {instantiate.data.created > 0
              ? `+${instantiate.data.created} added`
              : "All loaded"}
            {instantiate.data.skipped > 0 && `, ${instantiate.data.skipped} already present`}
          </span>
        )}
      </div>

      {/* Quick-add */}
      <div className="shrink-0 px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-start gap-2">
          <span className="shrink-0 mt-px text-zinc-300 dark:text-zinc-600 text-sm leading-relaxed">
            +
          </span>
          <AutoTextarea
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Add an item... (Enter to add)"
            className="flex-1 min-w-0 text-sm bg-transparent outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-700 dark:text-zinc-300 leading-relaxed"
          />
          {input.trim() && (
            <Button
              variant="quiet"
              size="sm"
              className="shrink-0 mt-0.5"
              onClick={handleSubmit}
            >
              Add
            </Button>
          )}
        </div>
      </div>

      {/* Checklist */}
      <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1">
        {pending.length === 0 && completed.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-1.5">
            <span className="text-zinc-300 dark:text-zinc-600 text-2xl">✅</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              Load from templates or add items
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
            {hasCategories
              ? [...pendingByCategory.entries()].map(([category, catItems]) => (
                  <div key={category || "__uncategorized"} className="mb-1">
                    {category && (
                      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1 mt-1">
                        {category}
                      </div>
                    )}
                    {catItems.map((item) => (
                      <SortableChecklistRow
                        key={item.id}
                        item={item}
                        onToggle={() =>
                          updateItem.mutate({ itemId: item.id, data: { done: true } })
                        }
                        onUpdate={(text) =>
                          updateItem.mutate({ itemId: item.id, data: { text } })
                        }
                        onDelete={() => deleteItem.mutate(item.id)}
                        onSaveToTemplate={() => handleSaveToTemplate(item)}
                      />
                    ))}
                  </div>
                ))
              : pending.map((item) => (
                  <SortableChecklistRow
                    key={item.id}
                    item={item}
                    onToggle={() =>
                      updateItem.mutate({ itemId: item.id, data: { done: true } })
                    }
                    onUpdate={(text) =>
                      updateItem.mutate({ itemId: item.id, data: { text } })
                    }
                    onDelete={() => deleteItem.mutate(item.id)}
                    onSaveToTemplate={() => handleSaveToTemplate(item)}
                  />
                ))}
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeItem ? (
              <ChecklistRow
                item={activeItem}
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
            {completed.map((item) => (
              <ChecklistRow
                key={item.id}
                item={item}
                onToggle={() =>
                  updateItem.mutate({
                    itemId: item.id,
                    data: { done: false },
                  })
                }
                onUpdate={(text) =>
                  updateItem.mutate({ itemId: item.id, data: { text } })
                }
                onDelete={() => deleteItem.mutate(item.id)}
              />
            ))}
          </>
        )}
      </div>

      {showTemplateManager && (
        <TemplateManager onClose={() => setShowTemplateManager(false)} />
      )}
    </div>
  );
}
