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

export function EditableCell({
  value,
  type,
  onSave,
  placeholder = "—",
  className = "",
  multiline = false,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(null);

  useEffect(() => {
    if (!editing || !inputRef.current) return;
    inputRef.current.focus();
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
    setEditing(false);
    const trimmed = draft.trim();

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

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
        className={`w-full cursor-text text-xs py-1 px-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 min-h-[1.5rem] ${
          !display ? "text-zinc-400" : ""
        } ${multiline ? "whitespace-pre-wrap break-words" : ""} ${className}`}
      >
        {display || placeholder}
      </div>
    );
  }

  if (multiline) {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder={placeholder}
        className={`w-full bg-transparent border-0 outline-none text-xs py-1 px-1 rounded ring-1 ring-zinc-300 dark:ring-zinc-600 focus:ring-zinc-500 resize-y ${className}`}
      />
    );
  }

  const inputType =
    type === "date" ? "date" : type === "time" ? "time" : "text";

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={inputType}
      value={draft}
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
