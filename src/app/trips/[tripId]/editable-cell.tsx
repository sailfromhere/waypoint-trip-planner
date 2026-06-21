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
}

export function EditableCell({
  value,
  type,
  onSave,
  placeholder = "—",
  className = "",
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();

    if (trimmed === String(value ?? "")) return;

    if (!trimmed) {
      onSave(null);
      return;
    }

    if (type === "number" || type === "cost") {
      const num = type === "cost" ? Math.round(parseFloat(trimmed) * 100) : parseInt(trimmed, 10);
      if (!isNaN(num)) onSave(num);
    } else {
      onSave(trimmed);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setDraft(String(value ?? ""));
      setEditing(false);
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
    let display = String(value ?? "");
    if (type === "cost" && value != null) {
      display = `$${(Number(value) / 100).toFixed(2)}`;
    }

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          setDraft(type === "cost" && value != null ? (Number(value) / 100).toFixed(2) : String(value ?? ""));
          setEditing(true);
        }}
        className={`w-full cursor-text text-xs py-1 px-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 min-h-[1.5rem] ${
          !value ? "text-zinc-400" : ""
        } ${className}`}
      >
        {display || placeholder}
      </div>
    );
  }

  const inputType = type === "date" ? "date" : type === "time" ? "time" : type === "number" || type === "cost" ? "text" : "text";

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
