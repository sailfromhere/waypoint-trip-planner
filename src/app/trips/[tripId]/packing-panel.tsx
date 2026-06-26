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
  usePacking,
  useCreatePackingListItem,
  useUpdatePackingListItem,
  useReorderPacking,
  useDeletePackingListItem,
  useInstantiatePacking,
} from "@/lib/hooks/use-packing";
import {
  usePackingItems,
  useCreatePackingItem,
  useUpdatePackingItem,
  useDeletePackingItem,
  type PackingItemWithTemplates,
} from "@/lib/hooks/use-packing-items";
import {
  usePackingTemplates,
  useCreatePackingTemplate,
  useUpdatePackingTemplate,
  useDeletePackingTemplate,
} from "@/lib/hooks/use-packing-templates";
import type {
  PackingListItem,
  PackingTemplate,
  PackingRequiredness,
} from "@/db/types";
import { Button } from "@/components/ui/button";

const REQUIREDNESS: PackingRequiredness[] = [
  "required",
  "recommended",
  "optional",
];

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

function RequirednessBadge({ level }: { level: PackingRequiredness }) {
  if (level === "recommended") return null; // default — no badge to reduce clutter
  const styles =
    level === "required"
      ? "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30"
      : "text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800";
  return (
    <span
      className={`shrink-0 text-[9px] uppercase tracking-wide px-1 py-0.5 rounded ${styles}`}
      title={level}
    >
      {level === "required" ? "req" : "opt"}
    </span>
  );
}

// ── Packing instance row ──

type DragProps = {
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  isDragging: boolean;
};

function PackingRow({
  item,
  onToggle,
  onRename,
  onSetQty,
  onToggleShared,
  onDelete,
  onSaveToRepo,
  drag,
  variant = "static",
}: {
  item: PackingListItem;
  onToggle: () => void;
  onRename: (name: string) => void;
  onSetQty: (qty: number) => void;
  onToggleShared: () => void;
  onDelete: () => void;
  onSaveToRepo?: () => void;
  drag?: DragProps;
  variant?: "sortable" | "static" | "overlay";
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const [editingQty, setEditingQty] = useState(false);
  const checked = item.packed;
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  const commit = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== item.name) onRename(trimmed);
    else setEditName(item.name);
    setEditing(false);
  }, [editName, item.name, onRename]);

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
        <div className="flex-1 min-w-0" onPointerDown={(e) => e.stopPropagation()}>
          <AutoTextarea
            value={editName}
            onChange={setEditName}
            onSubmit={commit}
            onBlur={commit}
            onEscape={() => {
              setEditName(item.name);
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
            setEditName(item.name);
          }}
          className="flex-1 min-w-0 flex items-center gap-1.5"
        >
          <span
            className={`text-sm break-words whitespace-pre-wrap leading-relaxed cursor-text ${
              checked
                ? "line-through text-zinc-400 dark:text-zinc-500"
                : "text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {item.name}
          </span>
          <RequirednessBadge level={item.requiredness} />
        </div>
      )}

      {/* Quantity */}
      {!isOverlay && editingQty ? (
        <input
          type="number"
          min={1}
          defaultValue={item.quantity}
          autoFocus
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isInteger(n) && n > 0 && n !== item.quantity) onSetQty(n);
            setEditingQty(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditingQty(false);
          }}
          className="shrink-0 w-11 text-xs bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 outline-none"
        />
      ) : (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => !isOverlay && setEditingQty(true)}
          className={`shrink-0 text-[11px] tabular-nums px-1 rounded transition-colors ${
            item.quantity > 1
              ? "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              : "text-transparent group-hover:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
          }`}
          title="Quantity"
        >
          ×{item.quantity}
        </button>
      )}

      {/* Shared vs personal */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => !isOverlay && onToggleShared()}
        className="shrink-0 text-xs w-5 text-center opacity-60 hover:opacity-100 transition-opacity"
        title={item.shared ? "Shared gear (group)" : "Personal item"}
      >
        {item.shared ? "👥" : "👤"}
      </button>

      {!isOverlay && (
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onSaveToRepo && !item.packingItemId && (
            <button
              onClick={onSaveToRepo}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-zinc-400 hover:text-blue-500 transition-colors text-[11px] px-1 rounded"
              title="Save to repository"
            >
              ↑
            </button>
          )}
          <button
            onClick={onDelete}
            onPointerDown={(e) => e.stopPropagation()}
            className="hover:text-red-500 text-zinc-400 transition-all text-base leading-none px-1 rounded"
            title="Remove from list"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function SortablePackingRow(props: {
  item: PackingListItem;
  onToggle: () => void;
  onRename: (name: string) => void;
  onSetQty: (qty: number) => void;
  onToggleShared: () => void;
  onDelete: () => void;
  onSaveToRepo?: () => void;
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

  return <PackingRow {...props} drag={drag} variant="sortable" />;
}

// ── Load-templates popover ──

function LoadTemplatesPopover({
  templates,
  onLoad,
  onClose,
  pending,
}: {
  templates: PackingTemplate[];
  onLoad: (templateIds: string[]) => void;
  onClose: () => void;
  pending: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  return (
    <div className="absolute top-full left-0 mt-1 z-20 w-60 bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 p-2">
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 px-1 pb-1.5">
        Always-required items load automatically.
      </div>
      {templates.length === 0 ? (
        <div className="text-xs text-zinc-400 px-1 py-2">
          No templates yet — create some in Manage repository.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
          {templates.map((t) => (
            <label
              key={t.id}
              className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(t.id)}
                onChange={(e) => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(t.id);
                    else next.delete(t.id);
                    return next;
                  });
                }}
                className="accent-zinc-600"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {t.name}
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="flex items-center justify-end gap-1.5 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onLoad([...selected])} disabled={pending}>
          {pending ? "Loading..." : "Load"}
        </Button>
      </div>
    </div>
  );
}

// ── Repository manager modal ──

type ItemFormValues = {
  name: string;
  category: string;
  requiredness: PackingRequiredness;
  defaultQuantity: number;
  alwaysInclude: boolean;
  shared: boolean;
  templateIds: string[];
};

const EMPTY_FORM: ItemFormValues = {
  name: "",
  category: "",
  requiredness: "recommended",
  defaultQuantity: 1,
  alwaysInclude: false,
  shared: false,
  templateIds: [],
};

function ItemForm({
  initial,
  templates,
  categories,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ItemFormValues;
  templates: PackingTemplate[];
  categories: string[];
  submitLabel: string;
  onSubmit: (v: ItemFormValues) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<ItemFormValues>(initial);

  const submit = () => {
    if (!v.name.trim()) return;
    onSubmit({ ...v, name: v.name.trim(), category: v.category.trim() });
  };

  return (
    <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
      <input
        value={v.name}
        onChange={(e) => setV({ ...v, name: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Item name..."
        autoFocus
        className="text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 outline-none focus:border-zinc-400"
      />
      <div className="flex gap-1.5">
        <input
          value={v.category}
          onChange={(e) => setV({ ...v, category: e.target.value })}
          placeholder="Category"
          list="packing-categories"
          className="flex-1 min-w-0 text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 outline-none focus:border-zinc-400"
        />
        <datalist id="packing-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <select
          value={v.requiredness}
          onChange={(e) =>
            setV({ ...v, requiredness: e.target.value as PackingRequiredness })
          }
          className="text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 py-1 outline-none focus:border-zinc-400 text-zinc-600 dark:text-zinc-300"
        >
          {REQUIREDNESS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          value={v.defaultQuantity}
          onChange={(e) =>
            setV({
              ...v,
              defaultQuantity: Math.max(1, parseInt(e.target.value, 10) || 1),
            })
          }
          title="Default quantity"
          className="w-12 text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 py-1 outline-none focus:border-zinc-400"
        />
      </div>
      <div className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400 px-0.5">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={v.alwaysInclude}
            onChange={(e) => setV({ ...v, alwaysInclude: e.target.checked })}
            className="accent-zinc-600"
          />
          Always required
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={v.shared}
            onChange={(e) => setV({ ...v, shared: e.target.checked })}
            className="accent-zinc-600"
          />
          Shared gear
        </label>
      </div>
      {templates.length > 0 && (
        <div className="flex flex-wrap gap-1 px-0.5">
          {templates.map((t) => {
            const on = v.templateIds.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() =>
                  setV({
                    ...v,
                    templateIds: on
                      ? v.templateIds.filter((id) => id !== t.id)
                      : [...v.templateIds, t.id],
                  })
                }
                className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                  on
                    ? "bg-blue-50 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:border-zinc-400"
                }`}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex gap-1.5">
        <Button size="sm" onClick={submit} disabled={!v.name.trim()}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function RepoItemRow({
  item,
  templates,
  categories,
  onUpdate,
  onDelete,
}: {
  item: PackingItemWithTemplates;
  templates: PackingTemplate[];
  categories: string[];
  onUpdate: (v: ItemFormValues) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <ItemForm
        initial={{
          name: item.name,
          category: item.category ?? "",
          requiredness: item.requiredness,
          defaultQuantity: item.defaultQuantity,
          alwaysInclude: item.alwaysInclude,
          shared: item.shared,
          templateIds: item.templateIds,
        }}
        templates={templates}
        categories={categories}
        submitLabel="Save"
        onSubmit={(v) => {
          onUpdate(v);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const templateNames = item.templateIds
    .map((id) => templates.find((t) => t.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
      <div
        className="flex-1 min-w-0 cursor-pointer flex items-center gap-1.5 flex-wrap"
        onClick={() => setEditing(true)}
      >
        <span className="text-sm text-zinc-700 dark:text-zinc-300">
          {item.name}
        </span>
        {item.defaultQuantity > 1 && (
          <span className="text-[10px] text-zinc-400 tabular-nums">
            ×{item.defaultQuantity}
          </span>
        )}
        <span className="text-xs opacity-50" title={item.shared ? "Shared" : "Personal"}>
          {item.shared ? "👥" : "👤"}
        </span>
        <RequirednessBadge level={item.requiredness} />
        {item.alwaysInclude && (
          <span className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30">
            always
          </span>
        )}
        {templateNames.map((n) => (
          <span
            key={n}
            className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-300"
          >
            {n}
          </span>
        ))}
      </div>
      <button
        onClick={onDelete}
        className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-500 text-zinc-400 transition-all text-base leading-none px-1 rounded"
        title="Delete item"
      >
        ×
      </button>
    </div>
  );
}

function RepositoryManager({ onClose }: { onClose: () => void }) {
  const { data: items } = usePackingItems();
  const { data: templates } = usePackingTemplates();
  const createItem = useCreatePackingItem();
  const updateItem = useUpdatePackingItem();
  const deleteItem = useDeletePackingItem();
  const createTemplate = useCreatePackingTemplate();
  const updateTemplate = useUpdatePackingTemplate();
  const deleteTemplate = useDeletePackingTemplate();

  const [showAdd, setShowAdd] = useState(false);
  const [newTemplate, setNewTemplate] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState("");

  const tpls = useMemo(
    () => [...(templates ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [templates]
  );

  const categories = useMemo(
    () =>
      [
        ...new Set(
          (items ?? []).map((i) => i.category).filter(Boolean) as string[]
        ),
      ].sort(),
    [items]
  );

  const grouped = useMemo(() => {
    const sorted = [...(items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const groups = new Map<string, PackingItemWithTemplates[]>();
    for (const it of sorted) {
      const cat = it.category ?? "";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(it);
    }
    return groups;
  }, [items]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 w-[480px] max-h-[78vh] flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Packing Repository
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Templates */}
        <div className="shrink-0 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">
            Templates
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {tpls.map((t) =>
              editingTemplateId === t.id ? (
                <input
                  key={t.id}
                  value={editingTemplateName}
                  autoFocus
                  onChange={(e) => setEditingTemplateName(e.target.value)}
                  onBlur={() => {
                    const name = editingTemplateName.trim();
                    if (name && name !== t.name)
                      updateTemplate.mutate({ id: t.id, data: { name } });
                    setEditingTemplateId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingTemplateId(null);
                  }}
                  className="text-xs bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-full px-2 py-0.5 outline-none w-24"
                />
              ) : (
                <span
                  key={t.id}
                  className="group flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                >
                  <button
                    onClick={() => {
                      setEditingTemplateId(t.id);
                      setEditingTemplateName(t.name);
                    }}
                    className="hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {t.name}
                  </button>
                  <button
                    onClick={() => deleteTemplate.mutate(t.id)}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-500 leading-none"
                    title="Delete template"
                  >
                    ×
                  </button>
                </span>
              )
            )}
            <input
              value={newTemplate}
              onChange={(e) => setNewTemplate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTemplate.trim()) {
                  createTemplate.mutate({ name: newTemplate.trim() });
                  setNewTemplate("");
                }
              }}
              placeholder="+ template"
              className="text-xs bg-transparent border border-dashed border-zinc-300 dark:border-zinc-600 rounded-full px-2 py-0.5 outline-none focus:border-zinc-400 w-24 placeholder:text-zinc-400"
            />
          </div>
        </div>

        {/* Add item */}
        <div className="shrink-0 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
          {showAdd ? (
            <ItemForm
              initial={EMPTY_FORM}
              templates={tpls}
              categories={categories}
              submitLabel="Add item"
              onSubmit={(v) => {
                createItem.mutate({
                  name: v.name,
                  category: v.category || undefined,
                  requiredness: v.requiredness,
                  defaultQuantity: v.defaultQuantity,
                  alwaysInclude: v.alwaysInclude,
                  shared: v.shared,
                  templateIds: v.templateIds,
                });
                setShowAdd(false);
              }}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <Button
              variant="dashed"
              size="sm"
              className="w-full"
              onClick={() => setShowAdd(true)}
            >
              + Add item to repository
            </Button>
          )}
        </div>

        {/* Items list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {(items ?? []).length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-1.5">
              <span className="text-zinc-300 dark:text-zinc-600 text-2xl">🎒</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                No gear in the repository yet
              </span>
            </div>
          )}
          {[...grouped.entries()].map(([category, catItems]) => (
            <div key={category || "__uncategorized"} className="mb-2">
              {category && (
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1 mt-1">
                  {category}
                </div>
              )}
              {catItems.map((it) => (
                <RepoItemRow
                  key={it.id}
                  item={it}
                  templates={tpls}
                  categories={categories}
                  onUpdate={(v) =>
                    updateItem.mutate({
                      id: it.id,
                      data: {
                        name: v.name,
                        category: v.category || null,
                        requiredness: v.requiredness,
                        defaultQuantity: v.defaultQuantity,
                        alwaysInclude: v.alwaysInclude,
                        shared: v.shared,
                        templateIds: v.templateIds,
                      },
                    })
                  }
                  onDelete={() => deleteItem.mutate(it.id)}
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

export function PackingPanel({ tripId }: { tripId: string }) {
  const { data: items } = usePacking(tripId);
  const { data: templates } = usePackingTemplates();
  const createItem = useCreatePackingListItem(tripId);
  const updateItem = useUpdatePackingListItem(tripId);
  const reorder = useReorderPacking(tripId);
  const deleteItem = useDeletePackingListItem(tripId);
  const instantiate = useInstantiatePacking(tripId);
  const createRepoItem = useCreatePackingItem();

  const [input, setInput] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showRepo, setShowRepo] = useState(false);
  const [showLoad, setShowLoad] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleSubmit = useCallback(() => {
    const lines = input
      .split("\n")
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    for (const line of lines) createItem.mutate({ name: line });
    setInput("");
  }, [input, createItem]);

  const unpacked = useMemo(
    () =>
      (items ?? [])
        .filter((t) => !t.packed)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [items]
  );
  const packed = useMemo(
    () =>
      (items ?? [])
        .filter((t) => t.packed)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [items]
  );

  const unpackedByCategory = useMemo(() => {
    const groups = new Map<string, PackingListItem[]>();
    for (const item of unpacked) {
      const cat = item.category ?? "";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    }
    return groups;
  }, [unpacked]);

  const activeItem = useMemo(
    () => (items ?? []).find((t) => t.id === activeId) ?? null,
    [items, activeId]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = unpacked.findIndex((t) => t.id === active.id);
      const newIndex = unpacked.findIndex((t) => t.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(unpacked, oldIndex, newIndex);
      reorder.mutate(reordered.map((t) => t.id));
    },
    [unpacked, reorder]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const hasCategories =
    unpackedByCategory.size > 1 ||
    (unpackedByCategory.size === 1 && !unpackedByCategory.has(""));

  const rowHandlers = (item: PackingListItem) => ({
    onToggle: () =>
      updateItem.mutate({ itemId: item.id, data: { packed: !item.packed } }),
    onRename: (name: string) =>
      updateItem.mutate({ itemId: item.id, data: { name } }),
    onSetQty: (quantity: number) =>
      updateItem.mutate({ itemId: item.id, data: { quantity } }),
    onToggleShared: () =>
      updateItem.mutate({ itemId: item.id, data: { shared: !item.shared } }),
    onDelete: () => deleteItem.mutate(item.id),
    onSaveToRepo: () =>
      createRepoItem.mutate({
        name: item.name,
        category: item.category ?? undefined,
        requiredness: item.requiredness,
        shared: item.shared,
        defaultQuantity: item.quantity,
      }),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 relative">
        <div className="relative">
          <Button
            variant="quiet"
            size="sm"
            onClick={() => setShowLoad((s) => !s)}
          >
            Load templates
          </Button>
          {showLoad && (
            <LoadTemplatesPopover
              templates={[...(templates ?? [])].sort(
                (a, b) => a.sortOrder - b.sortOrder
              )}
              pending={instantiate.isPending}
              onClose={() => setShowLoad(false)}
              onLoad={(ids) => {
                instantiate.mutate(ids);
                setShowLoad(false);
              }}
            />
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowRepo(true)}>
          Manage repository
        </Button>
        {instantiate.data && (
          <span className="text-[10px] text-zinc-400 ml-auto">
            {instantiate.data.created > 0
              ? `+${instantiate.data.created} added`
              : "All loaded"}
            {instantiate.data.skipped > 0 &&
              `, ${instantiate.data.skipped} already present`}
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

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1">
        {unpacked.length === 0 && packed.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-1.5">
            <span className="text-zinc-300 dark:text-zinc-600 text-2xl">🎒</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              Load templates or add items
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
            items={unpacked.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {hasCategories
              ? [...unpackedByCategory.entries()].map(([category, catItems]) => (
                  <div key={category || "__uncategorized"} className="mb-1">
                    {category && (
                      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1 mt-1">
                        {category}
                      </div>
                    )}
                    {catItems.map((item) => (
                      <SortablePackingRow
                        key={item.id}
                        item={item}
                        {...rowHandlers(item)}
                      />
                    ))}
                  </div>
                ))
              : unpacked.map((item) => (
                  <SortablePackingRow
                    key={item.id}
                    item={item}
                    {...rowHandlers(item)}
                  />
                ))}
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeItem ? (
              <PackingRow
                item={activeItem}
                variant="overlay"
                onToggle={() => {}}
                onRename={() => {}}
                onSetQty={() => {}}
                onToggleShared={() => {}}
                onDelete={() => {}}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        {packed.length > 0 && (
          <>
            {unpacked.length > 0 && (
              <div className="border-t border-zinc-100 dark:border-zinc-800 mt-2 mb-1" />
            )}
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1">
              Packed ({packed.length})
            </div>
            {packed.map((item) => (
              <PackingRow key={item.id} item={item} {...rowHandlers(item)} />
            ))}
          </>
        )}
      </div>

      {showRepo && <RepositoryManager onClose={() => setShowRepo(false)} />}
    </div>
  );
}
