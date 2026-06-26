"use client";

import { useMemo, type CSSProperties } from "react";
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

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
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
  trip: { startDate: string | null; homeTimezone: string | null };
  selectedItemId: string | null;
  onItemSelect: (itemId: string) => void;
}) {
  const updateItem = useUpdateItem(tripId);

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
