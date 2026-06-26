"use client";

import {
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxon3Plugin from "@fullcalendar/luxon3";
import type {
  DayCellContentArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventMountArg,
} from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { DateTime } from "luxon";
import type { ItineraryItem } from "@/db/types";
import { useUpdateItem } from "@/lib/hooks/use-itinerary";
import { DAY_COLORS, buildDayColorMap } from "@/lib/trip-state/day-colors";
import { CategoryIcon } from "@/lib/trip-state/categories";
import { isUntitled, UNTITLED_LABEL, formatItemTimeLabel } from "@/lib/format";
import {
  localToInstant,
  instantToLocal,
  itemOriginTz,
  itemLocalTz,
  systemTimezone,
} from "@/lib/trip-state/tz";

// ── Local date/time helpers ──────────────────────────────────────────────────
// FullCalendar works in the browser's local time. Build event strings WITHOUT a
// timezone so FC reads them as local, and format Dates back with local getters
// (never toISOString — that shifts to UTC and lands items on the wrong day).

function hhmm(time: string | null): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

// FullCalendar hands callbacks a "marker" Date whose UTC fields encode the
// calendar-tz wall date (since we set `timeZone`). Read Y-M-D with UTC getters
// to recover the cell's YYYY-MM-DD (local getters would shift a day off-UTC).
function fcDayStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

// Month-view "+N more" → our own body-portaled popover (FC's native one clips
// against the scrolling left pane's overflow). Built from our own items, not FC
// seg internals, so it's stable and reuses our formatting helpers.
type MorePopItem = {
  id: string;
  title: string;
  color: string;
  category: string;
  timeLabel: string | null;
};
type MorePopoverData = {
  dateLabel: string;
  items: MorePopItem[];
  anchor: { left: number; top: number; bottom: number };
};

export function CalendarView({
  tripId,
  items,
  trip,
  selectedItemId,
  onItemSelect,
}: {
  tripId: string;
  items: ItineraryItem[];
  trip: { startDate: string | null; homeTimezone: string | null };
  selectedItemId: string | null;
  onItemSelect: (itemId: string) => void;
}) {
  const updateItem = useUpdateItem(tripId);
  const [morePopover, setMorePopover] = useState<MorePopoverData | null>(null);
  const calendarRef = useRef<FullCalendar | null>(null);

  // The grid runs in a single display tz (the trip home tz) so block geometry is
  // honest — real durations, real ordering, a cross-tz flight draws its ELAPSED
  // length, a red-eye rolls past midnight. Event LABELS show each item's own
  // local time (see formatItemTimeLabel). `gridTz` is the concrete IANA name we
  // also use to convert dropped instants back to wall-clock.
  const homeTz = trip.homeTimezone;
  const gridTz = homeTz ?? systemTimezone();

  const dayColors = useMemo(
    () => buildDayColorMap(items.map((i) => i.date)),
    [items]
  );

  const dated = useMemo(() => items.filter((i) => i.date), [items]);
  const undatedCount = items.length - dated.length;

  const events: EventInput[] = useMemo(() => {
    return dated.map((item) => {
      const start = hhmm(item.startTime);
      const color = dayColors.get(item.date!) ?? "#6b7280";
      const booked = item.confirmationStatus === "booked";

      if (!start) {
        // No time yet → all-day lane (solid filled block). Auto-schedule places it.
        return {
          id: item.id,
          title: item.title,
          start: item.date!,
          allDay: true,
          backgroundColor: color,
          borderColor: color,
          editable: !booked,
          extendedProps: { itemId: item.id, color, timeLabel: null, category: item.category },
        } satisfies EventInput;
      }

      // Build absolute UTC INSTANTS so block geometry is tz-correct on the home-tz
      // grid. startTime is wall-clock in the item's ORIGIN tz; the block end is
      // depart + ELAPSED duration (the planned Duration cell is the source of
      // truth), falling back to a stored endTime (in the DESTINATION tz) when
      // there's no duration. Using duration makes a red-eye roll past midnight.
      const originTz = itemOriginTz(item, homeTz);
      const departInstant = localToInstant(item.date!, start, originTz);
      let endInstant: DateTime | null = null;
      if (item.durationMinutes) {
        endInstant = departInstant.plus({ minutes: item.durationMinutes });
      } else {
        const end = hhmm(item.endTime);
        if (end) endInstant = localToInstant(item.date!, end, itemLocalTz(item, homeTz));
      }

      // Timed events render as a light-tint block + solid left color band (drawn
      // in eventContent/CSS), so the FC block itself is transparent. The day
      // color + the tz-aware local label travel in extendedProps.
      return {
        id: item.id,
        title: item.title,
        start: departInstant.toISO() ?? `${item.date!}T${start}:00`,
        end: endInstant?.toISO() ?? undefined,
        backgroundColor: "transparent",
        borderColor: "transparent",
        editable: !booked,
        extendedProps: {
          itemId: item.id,
          color,
          timeLabel: formatItemTimeLabel(item, homeTz),
          category: item.category,
        },
      } satisfies EventInput;
    });
  }, [dated, dayColors, homeTz]);

  function persist(itemId: string, data: Record<string, unknown>) {
    // A drag/resize is a deliberate human edit → default user_provided source.
    updateItem.mutate({ itemId, data });
  }

  function handleDrop(arg: EventDropArg | EventResizeDoneArg) {
    const itemId = arg.event.extendedProps.itemId as string;
    const s = arg.event.start;
    if (!s) return;
    // FC Dates are absolute instants; convert back through the relevant tz to get
    // the item's local wall-clock (not the browser's, which may differ from the
    // grid tz). Start lands in the item's ORIGIN tz; end (for a resize) in its
    // DESTINATION tz. Duration comes from the instant delta (already elapsed).
    const item = items.find((i) => i.id === itemId);
    const originTz = item ? itemOriginTz(item, homeTz) : gridTz;
    const destTz = item ? itemLocalTz(item, homeTz) : gridTz;
    const startLocal = instantToLocal(DateTime.fromJSDate(s), originTz);

    if (arg.event.allDay) {
      // Dropped into the all-day lane → unset the time, keep the day.
      persist(itemId, { date: startLocal.date, startTime: null, endTime: null });
      return;
    }
    const e = arg.event.end;
    persist(itemId, {
      date: startLocal.date,
      startTime: startLocal.hhmm,
      endTime: e ? instantToLocal(DateTime.fromJSDate(e), destTz).hhmm : null,
      durationMinutes: e ? minutesBetween(s, e) : null,
    });
  }

  function handleClick(arg: EventClickArg) {
    onItemSelect(arg.event.extendedProps.itemId as string);
  }

  // Month view only: tag each trip day's cell with FC-MANAGED classes (survive
  // re-render, unlike a manual dayCellDidMount DOM mutation) so CSS can paint a
  // padded top band in that day's color. `wp-band-N` selects the color.
  function getDayCellClasses(arg: DayCellContentArg): string[] {
    if (arg.view.type !== "dayGridMonth") return [];
    // arg.date is an FC MARKER date (we set timeZone) — read its Y-M-D with UTC
    // getters (fcDayStr), not local. Local getters shift a day off-UTC and the
    // band lands on the wrong cell (was: every band one day late west of UTC).
    const color = dayColors.get(fcDayStr(arg.date));
    if (!color) return [];
    return ["wp-has-band", `wp-band-${DAY_COLORS.indexOf(color)}`];
  }

  // Timed events are tinted at the BLOCK level (so the fill spans the full
  // duration); pass the day color in as a CSS var the block CSS reads.
  function handleEventDidMount(arg: EventMountArg) {
    const color = arg.event.extendedProps.color as string | undefined;
    if (color) arg.el.style.setProperty("--ev", color);
  }

  return (
    <div className="waypoint-calendar">
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin, luxon3Plugin]}
        timeZone={gridTz}
        initialView="timeGridWeek"
        initialDate={trip.startDate ?? undefined}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "timeGridDay,timeGridWeek,dayGridMonth",
        }}
        events={events}
        eventClick={handleClick}
        eventDrop={handleDrop}
        eventResize={handleDrop}
        // Clicking a DATE drills down: the day number (month) and day-of-week
        // column header (week/day) become navlinks → Day view (FC default
        // zoomTo 'day' → timeGridDay).
        navLinks
        // Clicking the EMPTY area of a month day cell → that week. Day numbers
        // (navlinks), events, "+N more", and popovers don't fire dateClick (FC's
        // isValidDateDownEl excludes them), so this never conflicts with the
        // navlink/day drill-down or event selection. dateStr is the unambiguous
        // ISO day (avoids passing FC's marker Date back into the API).
        dateClick={(arg) => {
          if (arg.view.type === "dayGridMonth") {
            calendarRef.current?.getApi().changeView("timeGridWeek", arg.dateStr);
          }
        }}
        editable
        droppable={false}
        nowIndicator
        allDaySlot
        // Per-view all-day handling: timegrid (week + day) shows ALL all-day
        // events — the lane is height-capped + scrollable in CSS (see
        // `.fc-scrollgrid-section-header .fc-daygrid-body` in globals.css), so
        // there's no "+N more" and no navigate-away. Month keeps a row cap.
        views={{
          timeGrid: { dayMaxEvents: false },
          dayGridMonth: { dayMaxEvents: 4 },
        }}
        moreLinkClick={(arg) => {
          // Only reached in Month now (timegrid no longer truncates). Open our
          // own body-portaled popover listing that day's events instead of
          // navigating away. Built from our items (not FC seg internals) so it
          // reuses our day color + tz-aware time formatting.
          const dateStr = fcDayStr(arg.date);
          const dayItems = dated
            .filter((i) => i.date === dateStr)
            .sort((a, b) => {
              const at = hhmm(a.startTime);
              const bt = hhmm(b.startTime);
              if (!at && bt) return -1; // all-day first
              if (at && !bt) return 1;
              if (!at && !bt) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
              return at!.localeCompare(bt!);
            });
          const target = arg.jsEvent.target as HTMLElement | null;
          const linkEl = target?.closest?.(".fc-more-link") as HTMLElement | null;
          const rect = linkEl?.getBoundingClientRect();
          const mouse = arg.jsEvent as MouseEvent;
          const anchor = rect
            ? { left: rect.left, top: rect.top, bottom: rect.bottom }
            : { left: mouse.clientX, top: mouse.clientY, bottom: mouse.clientY };
          setMorePopover({
            dateLabel: DateTime.fromISO(dateStr).toFormat("ccc, LLL d"),
            items: dayItems.map((i) => ({
              id: i.id,
              title: i.title,
              color: dayColors.get(i.date!) ?? "#6b7280",
              category: i.category || "other",
              // tz-aware label when meaningful (cross-tz / non-home stop);
              // otherwise the plain 24h start (matches the month cell's time).
              timeLabel: formatItemTimeLabel(i, homeTz) ?? hhmm(i.startTime),
            })),
            anchor,
          });
          // FC's MoreLinkContainer: `if (!ret || ret==='popover') showPopover;
          // else if (typeof ret==='string') navigate`. A TRUTHY NON-STRING hits
          // neither branch → FC shows nothing (no native pane-clipping popover,
          // no navigate-away), leaving only our portaled popover. The public
          // type is `MoreLinkAction | void`, hence the cast.
          return true as unknown as undefined;
        }}
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        scrollTime="06:00:00"
        slotDuration="00:30:00"
        slotLabelInterval="01:00:00"
        slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        displayEventEnd={false}
        eventContent={renderEventContent}
        eventDidMount={handleEventDidMount}
        dayCellClassNames={getDayCellClasses}
        eventMinHeight={16}
        height={760}
        eventClassNames={(arg) =>
          arg.event.extendedProps.itemId === selectedItemId
            ? ["ring-2", "ring-offset-1", "ring-[var(--accent)]"]
            : []
        }
      />
      {undatedCount > 0 && (
        <p className="mt-2 text-xs text-zinc-400">
          {undatedCount} unscheduled item{undatedCount === 1 ? "" : "s"} not
          shown (assign a date in the table to place them).
        </p>
      )}
      {morePopover && (
        <MoreEventsPopover
          data={morePopover}
          onSelect={(id) => {
            onItemSelect(id);
            setMorePopover(null);
          }}
          onClose={() => setMorePopover(null)}
        />
      )}
    </div>
  );
}

// Month "+N more" popover: a paper card portaled to <body> (escapes the
// scrolling pane that clipped FC's native popover) listing the day's events.
// Position is set by direct DOM mutation in a layout effect (NOT setState — the
// React Compiler lint forbids setState-in-effect), measuring after mount to
// clamp within the viewport and flip above the link if it would overflow.
function MoreEventsPopover({
  data,
  onSelect,
  onClose,
}: {
  data: MorePopoverData;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = data.anchor.left;
    let top = data.anchor.bottom + 4;
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (left < pad) left = pad;
    if (top + h > window.innerHeight - pad) {
      const above = data.anchor.top - h - 4;
      top = above > pad ? above : Math.max(pad, window.innerHeight - h - pad);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [data]);

  useEffect(() => {
    function onDocPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="wp-morepop"
      role="dialog"
      style={{
        left: data.anchor.left,
        top: data.anchor.bottom + 4,
        visibility: "hidden",
      }}
    >
      <div className="wp-morepop-head">{data.dateLabel}</div>
      <div className="wp-morepop-body">
        {data.items.map((it) => (
          <button
            key={it.id}
            type="button"
            className="wp-morepop-row"
            onClick={() => onSelect(it.id)}
          >
            <span
              className="wp-morepop-bar"
              style={{ backgroundColor: it.color }}
            />
            <CategoryIcon
              category={it.category}
              size={12}
              className="wp-morepop-icon shrink-0"
            />
            <span className="wp-morepop-title">{eventTitleNode(it.title)}</span>
            {it.timeLabel && (
              <span className="wp-morepop-time">{it.timeLabel}</span>
            )}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}

// Custom event content: render time + title as one block clamped to exactly
// `round(minutes / 30)` lines (a 30-min block = 1 line, 60 = 2, …). Clamping by
// LINE COUNT (not pixel height) means a too-long title ellipsizes on its last
// allowed line — we never show a half-cut line. <30-min blocks show title only.
// An empty title renders as a muted italic "Untitled" placeholder (matching the
// table + map), so an unnamed block is still legible instead of a blank event.
function eventTitleNode(title: string) {
  return isUntitled(title) ? (
    <span style={{ fontStyle: "italic", opacity: 0.55 }}>{UNTITLED_LABEL}</span>
  ) : (
    <>{title}</>
  );
}

function renderEventContent(arg: EventContentArg) {
  const { event, timeText, view } = arg;
  const color = (event.extendedProps.color as string) || "#6b7280";
  // Local tz-aware label (null for plain items in the home tz → fall back to FC's
  // grid-tz timeText so the common single-tz case is unchanged).
  const timeLabel = (event.extendedProps.timeLabel as string | null) ?? null;
  // Month view: Apple-style row — a left color band (= trip day) + title + muted
  // time. (Timegrid uses tinted blocks; month is a compact list.)
  const category = (event.extendedProps.category as string) || "other";
  if (view.type === "dayGridMonth" && !event.allDay) {
    const label = timeLabel ?? timeText;
    return (
      <div className="wp-evm">
        <span className="wp-evm-bar" style={{ backgroundColor: color }} />
        <CategoryIcon
          category={category}
          size={12}
          className="wp-evm-icon shrink-0 text-zinc-500 dark:text-zinc-400"
        />
        <span className="wp-evm-title">{eventTitleNode(event.title)}</span>
        {label && <span className="wp-evm-time">{label}</span>}
      </div>
    );
  }
  if (event.allDay) {
    return <div className="wp-ev-allday">{eventTitleNode(event.title)}</div>;
  }
  const start = event.start?.getTime();
  const end = event.end?.getTime();
  const durMin = start != null && end != null ? (end - start) / 60000 : 60;
  const short = durMin < 30;
  const lines = short ? 1 : Math.max(1, Math.round(durMin / 30));
  // Title only; the tint + left band live on the event BLOCK (see CSS), so this
  // inner element just line-clamps the text without its own height (which would
  // re-introduce mid-line clipping). A tz-aware label (cross-tz movement or a
  // non-home-tz stop) shows on its own muted line when the block has room.
  return (
    <div
      className={short ? "wp-ev" : "wp-ev wp-ev-timed"}
      style={{ "--wp-lines": lines } as CSSProperties}
    >
      {/* Category glyph only when there's room (≥30-min blocks); short blocks are
          title-only. DAY owns hue (block tint + left band); glyph is monochrome. */}
      {!short && (
        <CategoryIcon category={category} size={11} className="wp-ev-icon" />
      )}
      {eventTitleNode(event.title)}
      {timeLabel && !short && (
        <span
          style={{ display: "block", fontSize: "0.85em", opacity: 0.7 }}
        >
          {timeLabel}
        </span>
      )}
    </div>
  );
}
