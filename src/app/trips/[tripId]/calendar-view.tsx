"use client";

import { useMemo, type CSSProperties } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  DayCellContentArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventMountArg,
} from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import type { ItineraryItem } from "@/db/types";
import { useUpdateItem } from "@/lib/hooks/use-itinerary";
import { DAY_COLORS, buildDayColorMap } from "@/lib/trip-state/day-colors";
import { isUntitled, UNTITLED_LABEL } from "@/lib/format";

// ── Local date/time helpers ──────────────────────────────────────────────────
// FullCalendar works in the browser's local time. Build event strings WITHOUT a
// timezone so FC reads them as local, and format Dates back with local getters
// (never toISOString — that shifts to UTC and lands items on the wrong day).

function hhmm(time: string | null): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

export function CalendarView({
  tripId,
  items,
  trip,
  selectedItemId,
  onItemSelect,
}: {
  tripId: string;
  items: ItineraryItem[];
  trip: { startDate: string | null };
  selectedItemId: string | null;
  onItemSelect: (itemId: string) => void;
}) {
  const updateItem = useUpdateItem(tripId);

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
          extendedProps: { itemId: item.id, color },
        } satisfies EventInput;
      }

      // Prefer the PLANNED duration for the block end (the table's Duration cell
      // is what the user edits; a stale stored endTime must not win). Fall back
      // to an explicit endTime only when there's no duration.
      const end = item.durationMinutes
        ? addMinutes(start, item.durationMinutes)
        : (hhmm(item.endTime) ?? null);

      // Timed events render as a light-tint block + solid left color band (drawn
      // in eventContent/CSS), so the FC block itself is transparent. The day
      // color travels in extendedProps.
      return {
        id: item.id,
        title: item.title,
        start: `${item.date!}T${start}:00`,
        end: end ? `${item.date!}T${end}:00` : undefined,
        backgroundColor: "transparent",
        borderColor: "transparent",
        editable: !booked,
        extendedProps: { itemId: item.id, color },
      } satisfies EventInput;
    });
  }, [dated, dayColors]);

  function persist(itemId: string, data: Record<string, unknown>) {
    // A drag/resize is a deliberate human edit → default user_provided source.
    updateItem.mutate({ itemId, data });
  }

  function handleDrop(arg: EventDropArg | EventResizeDoneArg) {
    const itemId = arg.event.extendedProps.itemId as string;
    const s = arg.event.start;
    if (!s) return;
    if (arg.event.allDay) {
      // Dropped into the all-day lane → unset the time, keep the day.
      persist(itemId, { date: fmtDate(s), startTime: null, endTime: null });
      return;
    }
    const e = arg.event.end;
    persist(itemId, {
      date: fmtDate(s),
      startTime: fmtTime(s),
      endTime: e ? fmtTime(e) : null,
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
    const color = dayColors.get(fmtDate(arg.date));
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
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
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
        editable
        droppable={false}
        nowIndicator
        allDaySlot
        dayMaxEvents={2}
        moreLinkClick={(arg) =>
          // In month/week, navigate to the day (the popover would clip against
          // the scrolling pane / map). In Day view there's nowhere to navigate,
          // and the single full-width column leaves room — show the popover.
          arg.view.type === "timeGridDay" ? "popover" : "day"
        }
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
            ? ["ring-2", "ring-offset-1", "ring-zinc-900", "dark:ring-white"]
            : []
        }
      />
      {undatedCount > 0 && (
        <p className="mt-2 text-xs text-zinc-400">
          {undatedCount} unscheduled item{undatedCount === 1 ? "" : "s"} not
          shown (assign a date in the table to place them).
        </p>
      )}
    </div>
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
  // Month view: Apple-style row — a left color band (= trip day) + title + muted
  // time. (Timegrid uses tinted blocks; month is a compact list.)
  if (view.type === "dayGridMonth" && !event.allDay) {
    return (
      <div className="wp-evm">
        <span className="wp-evm-bar" style={{ backgroundColor: color }} />
        <span className="wp-evm-title">{eventTitleNode(event.title)}</span>
        {timeText && <span className="wp-evm-time">{timeText}</span>}
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
  // re-introduce mid-line clipping).
  return (
    <div
      className={short ? "wp-ev" : "wp-ev wp-ev-timed"}
      style={{ "--wp-lines": lines } as CSSProperties}
    >
      {eventTitleNode(event.title)}
    </div>
  );
}

function addMinutes(hhmmStr: string, mins: number): string {
  const [h, m] = hhmmStr.split(":").map(Number);
  const total = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60
  ).padStart(2, "0")}`;
}
