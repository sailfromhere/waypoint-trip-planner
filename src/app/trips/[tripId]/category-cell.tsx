"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  CategoryIcon,
  categoryLabel,
  CATEGORY_KEYS,
} from "@/lib/trip-state/categories";
import type { ItineraryItem } from "@/db/types";
import { EditableCell } from "./editable-cell";

// Custom category menu — replaces the native <select> so we can show the icon
// set and match the app's styling. Positioned FIXED off the trigger rect so it
// escapes the day-table's `overflow-x-auto` clipping (a plain absolute popover
// gets cut off; see the calendar popover-clipping note in memory).
function CategoryMenu({
  anchor,
  current,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  current: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Position once at mount off the (stable) trigger rect: below it, flipping up
  // if it would overflow the viewport.
  const [pos] = useState<{ left: number; top: number }>(() => {
    const r = anchor.getBoundingClientRect();
    const menuH = 8 + CATEGORY_KEYS.length * 30;
    const top =
      r.bottom + 4 + menuH > window.innerHeight ? r.top - 4 - menuH : r.bottom + 4;
    return { left: r.left, top };
  });

  useEffect(() => {
    function onDoc(e: globalThis.MouseEvent) {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && !anchor.contains(t)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Close on scroll — the fixed menu doesn't track a scrolling anchor.
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      role="listbox"
      data-testid="category-menu"
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-50 w-40 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-1"
      style={{ left: pos.left, top: pos.top }}
    >
      {CATEGORY_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          role="option"
          aria-selected={key === current}
          onClick={(e) => {
            e.stopPropagation();
            onPick(key);
          }}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors ${
            key === current
              ? "bg-zinc-100 dark:bg-zinc-800 font-medium"
              : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
          }`}
        >
          <CategoryIcon
            category={key}
            size={14}
            className="shrink-0 text-zinc-600 dark:text-zinc-300"
          />
          {categoryLabel(key)}
        </button>
      ))}
    </div>
  );
}

// The merged Title + Category cell (render-match layout): a category icon chip
// on the left, then the editable title with a small uppercase category caption
// stacked beneath it. Clicking EITHER the chip or the caption opens the custom
// category menu. DAY owns hue (the day-group stripe); category = monochrome icon.
export function TitleCategoryCell({
  item,
  onUpdateTitle,
  onUpdateCategory,
}: {
  item: ItineraryItem;
  onUpdateTitle: (value: string | number | null) => void;
  onUpdateCategory: (value: string) => void;
}) {
  const chipRef = useRef<HTMLButtonElement>(null);
  // The open menu's anchor element, captured in the click handler (reading a ref
  // during render is disallowed by React Compiler) — null means closed.
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  // Stop pointerdown so the row's dnd-kit drag doesn't start from these controls.
  const stop = (e: ReactPointerEvent) => e.stopPropagation();
  const toggle = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setMenuAnchor((prev) => (prev ? null : chipRef.current));
  };

  return (
    <div className="flex items-center gap-2.5 py-1.5 pr-1">
      <button
        ref={chipRef}
        type="button"
        title="Change category"
        data-testid="category-trigger"
        onPointerDown={stop}
        onClick={toggle}
        className="shrink-0 grid place-items-center w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
      >
        <CategoryIcon
          category={item.category}
          size={15}
          className="text-zinc-600 dark:text-zinc-300"
        />
      </button>

      <div className="flex flex-col min-w-0 flex-1">
        <EditableCell
          value={item.title}
          type="text"
          multiline
          placeholder="Untitled"
          onSave={onUpdateTitle}
          className="font-medium"
        />
        <button
          type="button"
          data-testid="category-caption"
          onPointerDown={stop}
          onClick={toggle}
          className="self-start px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          {categoryLabel(item.category)}
        </button>
      </div>

      {menuAnchor && (
        <CategoryMenu
          anchor={menuAnchor}
          current={item.category}
          onPick={(v) => {
            onUpdateCategory(v);
            setMenuAnchor(null);
          }}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </div>
  );
}
