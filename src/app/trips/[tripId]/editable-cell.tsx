"use client";

import { useState, useRef, useEffect } from "react";
import { itemCategory, confirmationStatus } from "@/db/schema";

const CATEGORY_LABELS: Record<string, string> = {
  drive: "Drive",
  flight: "Flight",
  activity: "Activity",
  meal: "Meal",
  lodging: "Lodging",
  transit: "Transit",
  rest: "Rest",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  idea: "Idea",
  planned: "Planned",
  booked: "Booked",
  completed: "Completed",
};

type CellType = "text" | "date" | "time" | "number" | "category" | "status" | "cost";

interface EditableCellProps {
  value: string | number | null;
  type: CellType;
  onSave: (value: string | number | null) => void;
  placeholder?: string;
  className?: string;
  // Render the editor as a <textarea> for fields that hold multi-line content
  // (title, notes). The read view wraps + preserves newlines.
  multiline?: boolean;
  // For a capped multi-line field (Notes): a max-height utility class applied to
  // the EDITOR textarea so it scrolls *itself* when content overflows (a focused
  // textarea with overflow:hidden swallows the wheel and won't scroll the
  // ancestor). Title leaves this empty → grows unbounded.
  multilineMaxClass?: string;
}

// Postgres `time` comes back as "HH:MM:SS". A native <input type="time"> with no
// `step` attribute REJECTS a seconds-bearing value and renders blank — that was
// the "start time disappears" bug. Normalize to 24h "HH:MM" for both the input
// and the read-only display.
function toHHMM(v: string | number | null): string {
  if (v == null) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

// Size a textarea to its content so a multi-line editor doesn't collapse to a
// fixed row count (and so a short value stays ~1 line, vertically centered by
// the wrapper). border-box means scrollHeight already includes padding.
export function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export function EditableCell({
  value,
  type,
  onSave,
  placeholder = "—",
  className = "",
  multiline = false,
  multilineMaxClass = "",
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(null);

  useEffect(() => {
    if (!editing || !inputRef.current) return;
    inputRef.current.focus();
    // Size the multi-line editor to its content on open (so it matches the read
    // view's height/centering instead of springing to a fixed 3 rows).
    if (multiline && inputRef.current instanceof HTMLTextAreaElement) {
      autoGrow(inputRef.current);
    }
    // .select() throws InvalidStateError on date/time inputs, and selecting all
    // of a long multi-line value is unwanted — only select single-line text-like
    // inputs.
    if (
      inputRef.current instanceof HTMLInputElement &&
      !multiline &&
      type !== "time" &&
      type !== "date"
    ) {
      inputRef.current.select();
    }
  }, [editing, multiline, type]);

  // The current value expressed the same way `draft` is, so commit can detect a
  // genuine no-op (and skip the write).
  function currentString(): string {
    if (type === "time") return toHHMM(value);
    if (type === "cost" && value != null) return (Number(value) / 100).toFixed(2);
    return String(value ?? "");
  }

  function startEditing() {
    setDraft(currentString());
    setEditing(true);
  }

  function commit() {
    // Read the LIVE DOM value, not `draft`. Single-line inputs are uncontrolled
    // (defaultValue) because a controlled <input type="time"/"date"> is rejected
    // mid-entry by WebKit/Safari (it only fires onChange on a *complete* value,
    // so the controlled empty value keeps wiping partial entry → the time
    // "goes away"). The DOM value is authoritative across browsers.
    const live =
      inputRef.current && !(inputRef.current instanceof HTMLSelectElement)
        ? inputRef.current.value
        : draft;
    setEditing(false);
    const trimmed = live.trim();

    if (trimmed === currentString()) return;

    if (!trimmed) {
      onSave(null);
      return;
    }

    if (type === "number" || type === "cost") {
      const num =
        type === "cost"
          ? Math.round(parseFloat(trimmed) * 100)
          : parseInt(trimmed, 10);
      if (!isNaN(num)) onSave(num);
    } else {
      onSave(trimmed);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Keep keystrokes inside the editor — the row is a dnd-kit draggable whose
    // KeyboardSensor starts a drag on Space/Enter. Without this, typing a space
    // (or Enter) in a cell bubbles up and lifts the whole row.
    e.stopPropagation();
    if (e.key === "Escape") {
      setDraft(currentString());
      setEditing(false);
      return;
    }
    if (e.key === "Enter") {
      if (multiline) {
        // Cmd/Ctrl+Enter commits; plain Enter inserts a newline (textarea default).
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          commit();
        }
      } else {
        e.preventDefault();
        commit();
      }
    }
  }

  // Dropdowns for category and status
  if (type === "category" || type === "status") {
    const options = type === "category" ? itemCategory : confirmationStatus;
    const labels = type === "category" ? CATEGORY_LABELS : STATUS_LABELS;
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        value={String(value ?? "")}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          onSave(e.target.value);
        }}
        className={`w-full bg-transparent border-0 outline-none text-xs py-1 cursor-pointer ${className}`}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labels[opt] ?? opt}
          </option>
        ))}
      </select>
    );
  }

  if (!editing) {
    let display = type === "time" ? toHHMM(value) : String(value ?? "");
    if (type === "cost" && value != null) {
      display = `$${(Number(value) / 100).toFixed(2)}`;
    }

    // h-full makes the whole (tall) cell clickable, not just a thin strip.
    const base = `w-full cursor-text text-xs py-1 px-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 h-full min-h-[1.5rem] ${
      !display ? "text-zinc-400" : ""
    }`;

    if (multiline) {
      return (
        <div
          onClick={(e) => {
            e.stopPropagation();
            startEditing();
          }}
          className={`${base} flex flex-col ${className}`}
        >
          {/* `my-auto` centers the value vertically when there's free space, but
              collapses to 0 (top-anchored + scrollable) when content overflows a
              capped cell — sidesteps the flex `justify-center` overflow top-clip
              bug. Matches the editor's centering below. */}
          <div className="my-auto whitespace-pre-wrap break-words">
            {display || placeholder}
          </div>
        </div>
      );
    }

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
        className={`${base} flex items-center ${className}`}
      >
        {display || placeholder}
      </div>
    );
  }

  if (multiline) {
    // Wrapper carries the height constraint (min-h for title / max-h+scroll for
    // notes, via `className`) and centers the auto-grown textarea with `my-auto`
    // — so the editor's vertical alignment + row height match the read view.
    return (
      <div className={`flex flex-col ${className}`}>
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          rows={1}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            setDraft(e.target.value);
            autoGrow(e.target);
          }}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          // overflow-y-auto + a per-field max-height (notes) lets the textarea
          // scroll ITSELF when focused; autoGrow sets height=scrollHeight but the
          // CSS max-height caps the render. Title has no cap → grows unbounded
          // (the scrollbar never appears).
          className={`w-full my-auto bg-transparent border-0 outline-none text-xs py-1 px-1 rounded ring-1 ring-zinc-300 dark:ring-zinc-600 focus:ring-zinc-500 resize-none overflow-y-auto ${multilineMaxClass}`}
        />
      </div>
    );
  }

  const inputType =
    type === "date" ? "date" : type === "time" ? "time" : "text";

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={inputType}
      onPointerDown={(e) => e.stopPropagation()}
      // UNCONTROLLED (defaultValue, not value): a controlled time/date input is
      // wiped mid-entry by Safari/WebKit. The native control owns the value
      // during editing; commit() reads it from the DOM. The read→edit toggle
      // remounts a fresh input each session, so defaultValue is always current
      // (and a background refetch can't remount-and-wipe an in-progress edit).
      defaultValue={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      inputMode={type === "number" || type === "cost" ? "decimal" : undefined}
      placeholder={placeholder}
      className={`w-full bg-transparent border-0 outline-none text-xs py-1 px-1 rounded ring-1 ring-zinc-300 dark:ring-zinc-600 focus:ring-zinc-500 ${className}`}
    />
  );
}
