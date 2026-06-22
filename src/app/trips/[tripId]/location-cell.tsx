"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import type { LocationSuggestion } from "@/lib/integrations";
import { autoGrow } from "./editable-cell";

interface LocationCellProps {
  tripId: string;
  value: string | null;
  placeholder?: string;
  // An exact place chosen from the dropdown: store name + coords together.
  onPick: (name: string, lat: number, lng: number) => void;
  // Free text typed and committed WITHOUT picking a candidate. The caller may
  // fall back to fuzzy geocoding (S7-5).
  onText: (name: string | null) => void;
  className?: string;
}

// New session token per suggest→retrieve session (Mapbox billing groups them).
function newSession() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function LocationCell({
  tripId,
  value,
  placeholder = "—",
  onPick,
  onText,
  className = "",
}: LocationCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [highlighted, setHighlighted] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionRef = useRef<string>("");
  // Set when a suggestion is being applied so the input's blur handler doesn't
  // also commit the stale typed text on top of the pick.
  const pickingRef = useRef(false);

  const original = value ?? "";

  const reposition = useCallback(() => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
  }, []);

  useLayoutEffect(() => {
    if (!editing) return;
    // Size the editor to its content so a long place name keeps its wrapped
    // multi-line layout instead of collapsing to a single line on focus.
    autoGrow(inputRef.current);
    reposition();
    // The left pane scrolls independently — capture scrolls anywhere so the
    // portal dropdown stays glued to the input (it lives on document.body).
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [editing, reposition]);

  // Debounced suggest as the user types.
  useEffect(() => {
    if (!editing) return;
    const q = draft.trim();
    const t = setTimeout(async () => {
      if (q.length < 2) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/trips/${tripId}/geocode/suggest?q=${encodeURIComponent(q)}&session=${sessionRef.current}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { suggestions: LocationSuggestion[] };
        setSuggestions(data.suggestions ?? []);
        setHighlighted(-1);
      } catch {
        /* network hiccup — leave prior suggestions */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [draft, editing, tripId]);

  function startEditing() {
    sessionRef.current = newSession();
    setDraft(original);
    setSuggestions([]);
    setHighlighted(-1);
    setEditing(true);
  }

  function close() {
    setEditing(false);
    setSuggestions([]);
    setHighlighted(-1);
  }

  function commitText() {
    const trimmed = draft.trim();
    if (trimmed !== original) onText(trimmed || null);
    close();
  }

  async function pick(s: LocationSuggestion) {
    pickingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/trips/${tripId}/geocode/retrieve?id=${encodeURIComponent(s.id)}&session=${sessionRef.current}`
      );
      if (res.ok) {
        const r = (await res.json()) as { lat: number; lng: number; displayName: string };
        onPick(s.name, r.lat, r.lng);
      } else {
        // Retrieve failed — keep the name as plain text so the user isn't stuck.
        onText(s.name);
      }
    } finally {
      setLoading(false);
      pickingRef.current = false;
      close();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Keep keystrokes inside the editor — the row is a dnd-kit draggable whose
    // KeyboardSensor starts a drag on Space/Enter (typing a space would lift the
    // whole row otherwise).
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, -1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted >= 0 && suggestions[highlighted]) {
        pick(suggestions[highlighted]);
      } else {
        commitText();
      }
    }
  }

  if (!editing) {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
        className={`w-full cursor-text text-xs py-1 px-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 h-full min-h-[1.5rem] flex items-center ${
          !original ? "text-zinc-400" : ""
        } ${className}`}
      >
        {original || placeholder}
      </div>
    );
  }

  const dropdown =
    rect &&
    createPortal(
      <div
        // Glued to the input via fixed positioning so the table's overflow-hidden
        // wrapper can't clip it.
        style={{
          position: "fixed",
          top: rect.bottom + 2,
          left: rect.left,
          width: Math.max(rect.width, 220),
          zIndex: 60,
        }}
        // Keep focus on the input so its blur doesn't fire before the pick click.
        onMouseDown={(e) => e.preventDefault()}
        className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden text-xs max-h-64 overflow-y-auto thin-scroll"
      >
        {loading && suggestions.length === 0 && (
          <div className="px-2.5 py-2 text-zinc-400">Searching…</div>
        )}
        {!loading && suggestions.length === 0 && draft.trim().length >= 2 && (
          <div className="px-2.5 py-2 text-zinc-400">
            No matches — Enter keeps “{draft.trim()}” as text
          </div>
        )}
        {suggestions.map((s, i) => (
          <button
            key={s.id}
            onClick={() => pick(s)}
            onMouseEnter={() => setHighlighted(i)}
            className={`block w-full text-left px-2.5 py-1.5 transition-colors ${
              i === highlighted
                ? "bg-blue-50 dark:bg-blue-900/30"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            }`}
          >
            <div className="font-medium text-zinc-700 dark:text-zinc-200">{s.name}</div>
            {s.context && (
              <div className="text-[10px] text-zinc-400 truncate">{s.context}</div>
            )}
          </button>
        ))}
      </div>,
      document.body
    );

  return (
    <>
      <textarea
        ref={inputRef}
        value={draft}
        rows={1}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setDraft(e.target.value);
          autoGrow(e.target);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // A suggestion click triggers blur first; pick() handles the commit.
          if (!pickingRef.current) commitText();
        }}
        placeholder={placeholder}
        className={`w-full bg-transparent border-0 outline-none text-xs py-1 px-1 rounded ring-1 ring-zinc-300 dark:ring-zinc-600 focus:ring-zinc-500 resize-none overflow-hidden ${className}`}
      />
      {dropdown}
    </>
  );
}
