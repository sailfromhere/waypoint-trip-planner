"use client";

import { use, useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTrip, useUpdateTrip, useDeleteTrip } from "@/lib/hooks/use-trips";
import { useItineraryItems, useUpdateItem } from "@/lib/hooks/use-itinerary";
import { useRoutes, useGeocode } from "@/lib/hooks/use-routes";
import { useTasks } from "@/lib/hooks/use-tasks";
import { useChecklist } from "@/lib/hooks/use-checklist";
import { ItineraryTable, type DayWarning } from "./itinerary-table";
import { TripHeader } from "./trip-header";
import { PlanningPanel } from "./planning-panel";
import { TasksPanel } from "./tasks-panel";
import { ChecklistPanel } from "./checklist-panel";
import { PackingPanel } from "./packing-panel";
import { usePacking } from "@/lib/hooks/use-packing";
import { autoDriveDuration } from "@/lib/trip-state/drive-duration";

const TripMap = lazy(() =>
  import("./trip-map").then((mod) => ({ default: mod.TripMap }))
);

// Extracted so we can warm the chunk before the user expands the calendar
// (React.lazy dedupes the import promise, so this just preloads the bundle).
const importCalendarView = () => import("./calendar-view");
const CalendarView = lazy(() =>
  importCalendarView().then((mod) => ({ default: mod.CalendarView }))
);

const RIGHT_PANEL_TABS: { key: string; label: string; content: (tripId: string) => ReactNode }[] = [
  { key: "reminder", label: "Reminder", content: (tripId) => <TasksPanel tripId={tripId} /> },
  { key: "pre-departure", label: "Pre-Departure", content: (tripId) => <ChecklistPanel tripId={tripId} /> },
  { key: "packing", label: "Packing", content: (tripId) => <PackingPanel tripId={tripId} /> },
];

function computeDayWarnings(
  items: { date: string | null; category: string; durationMinutes: number | null }[],
  routes: { date: string; totalDurationSeconds: number }[]
): DayWarning[] {
  const warnings: DayWarning[] = [];
  const routeByDate = new Map(routes.map((r) => [r.date, r]));

  const byDay = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.date) continue;
    if (!byDay.has(item.date)) byDay.set(item.date, []);
    byDay.get(item.date)!.push(item);
  }

  for (const [date, dayItems] of byDay) {
    const route = routeByDate.get(date);
    const totalDriveSeconds = route?.totalDurationSeconds ?? 0;
    const totalActivityMinutes = dayItems
      .filter((i) => i.category !== "drive")
      .reduce((sum, i) => sum + (i.durationMinutes ?? 0), 0);

    const dayWarnings: string[] = [];
    const driveHours = totalDriveSeconds / 3600;
    const totalHours = driveHours + totalActivityMinutes / 60;

    if (driveHours > 8) {
      dayWarnings.push(`${driveHours.toFixed(1)}h driving`);
    }
    if (totalHours > 16) {
      dayWarnings.push(`${totalHours.toFixed(1)}h total scheduled`);
    }

    warnings.push({
      date,
      totalDriveSeconds,
      totalActivityMinutes,
      warnings: dayWarnings,
    });
  }

  return warnings;
}

export default function TripPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = use(params);
  const router = useRouter();
  const { data: trip, isLoading } = useTrip(tripId);
  const updateTrip = useUpdateTrip(tripId);
  const deleteTrip = useDeleteTrip();
  const { data: items } = useItineraryItems(tripId);
  const updateItem = useUpdateItem(tripId);
  const { data: routes } = useRoutes(tripId);
  const { data: tasks } = useTasks(tripId);
  const { data: checklistItems } = useChecklist(tripId);
  const { data: packingItems } = usePacking(tripId);
  const geocode = useGeocode(tripId);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [mapCollapsed, setMapCollapsed] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState(RIGHT_PANEL_TABS[0].key);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Warm the lazy calendar chunk shortly after the page settles so the first
  // expand is instant (no ~0.5s import delay). Hovering the toggle warms it too.
  useEffect(() => {
    const t = setTimeout(() => importCalendarView(), 1000);
    return () => clearTimeout(t);
  }, []);

  // Keep drive durations synced to the REAL routed time (geography keystone —
  // never invented). Fills blanks AND refreshes a previously auto-derived
  // (historical_estimate) duration when the route changes — e.g. correcting a
  // mis-geocoded location re-routes the drive, so the stale duration must
  // follow. A user/AI PLANNED duration is left untouched. See autoDriveDuration.
  useEffect(() => {
    if (!items || !routes?.drives?.length) return;
    const driveSecs = new Map(
      routes.drives.map((d) => [d.itemId, d.durationSeconds])
    );
    for (const it of items) {
      const next = autoDriveDuration(it, driveSecs.get(it.id));
      if (next == null) continue;
      updateItem.mutate({
        itemId: it.id,
        data: { durationMinutes: next, _provenance: "historical_estimate" },
      });
    }
  }, [items, routes, updateItem]);

  const dayWarnings = useMemo(
    () => computeDayWarnings(items ?? [], routes?.days ?? []),
    [items, routes]
  );

  const geocodedCount = useMemo(
    () => (items ?? []).filter((i) => i.destinationLat != null).length,
    [items]
  );

  const needsGeocoding = useMemo(
    () =>
      (items ?? []).filter(
        (i) => i.destinationName && i.destinationLat == null
      ).length,
    [items]
  );

  // S7-5: when a location is typed (not picked from the dropdown), the coords go
  // stale. Debounce a single-item force re-geocode so the map catches up without
  // the user hitting "Re-map all". Picks already carry exact coords and skip
  // this. force=true is needed because the item already has (now stale) coords;
  // user_provided coords stay sacred (the geocode route never touches them) —
  // which is also why a picked location won't be clobbered here.
  const geocodeMutateRef = useRef(geocode.mutate);
  useEffect(() => {
    geocodeMutateRef.current = geocode.mutate;
  });
  const geocodeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const handleLocationEdited = useCallback((itemId: string) => {
    const timers = geocodeTimers.current;
    const existing = timers.get(itemId);
    if (existing) clearTimeout(existing);
    timers.set(
      itemId,
      setTimeout(() => {
        timers.delete(itemId);
        geocodeMutateRef.current({ itemIds: [itemId], force: true });
      }, 700)
    );
  }, []);
  useEffect(() => {
    const timers = geocodeTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const handleItemSelect = useCallback((itemId: string) => {
    setSelectedItemId((prev) => (prev === itemId ? null : itemId));
    const el = document.getElementById(`item-${itemId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const handleMapItemSelect = useCallback((itemId: string | null) => {
    setSelectedItemId(itemId);
    if (!itemId) return;
    const el = document.getElementById(`item-${itemId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Loading...
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-sm text-zinc-500">Trip not found.</p>
        <Link
          href="/"
          className="text-sm text-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-200 underline"
        >
          Back to trips
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950 font-[family-name:var(--font-geist-sans)]">
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-3">
        <div className="max-w-full mx-auto flex items-center gap-4">
          <Link
            href="/"
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-sm"
          >
            ← Trips
          </Link>
          <span className="text-zinc-300 dark:text-zinc-700">/</span>
          <span className="text-sm font-medium truncate">{trip.name}</span>
          <div className="ml-auto flex items-center gap-2">
            {needsGeocoding > 0 && (
              <button
                onClick={() => geocode.mutate(undefined)}
                disabled={geocode.isPending}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded-md px-2.5 py-1 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors disabled:opacity-50"
              >
                {geocode.isPending
                  ? "Geocoding..."
                  : `Geocode ${needsGeocoding} item${needsGeocoding !== 1 ? "s" : ""}`}
              </button>
            )}
            {geocodedCount > 0 && (
              <>
                <span className="text-xs text-zinc-400">
                  {geocodedCount} mapped
                </span>
                <button
                  onClick={() => geocode.mutate({ force: true })}
                  disabled={geocode.isPending}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded-md px-2.5 py-1 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors disabled:opacity-50"
                  title="Re-fetch coordinates for all items (fixes stale/incorrect locations)"
                >
                  Re-map all
                </button>
              </>
            )}
            <button
              onClick={() => setMapCollapsed(!mapCollapsed)}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded-md px-2.5 py-1 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
              title={mapCollapsed ? "Show map" : "Hide map"}
            >
              {mapCollapsed ? "Show map" : "Hide map"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left panel: planning + table — scrolls independently */}
        <div
          // min-w-0: a flex item defaults to min-width:auto, which can override
          // max-w-[60%] and refuse to shrink below the inner table's content
          // width — Safari then squeezes the table's columns to fit instead of
          // letting its overflow-x-auto wrapper scroll (Chrome is more lenient).
          // min-w-0 lets the pane hold its allotted width so the table scrolls.
          className={`flex-1 min-w-0 overflow-y-auto px-6 pt-6 pb-48 ${mapCollapsed ? "" : "max-w-[60%]"}`}
        >
          <TripHeader
            trip={trip}
            onUpdate={(data) => updateTrip.mutate(data)}
            onDelete={() =>
              deleteTrip.mutate(tripId, {
                onSuccess: () => router.push("/"),
              })
            }
          />
          <PlanningPanel tripId={tripId} onItemsAccepted={() => geocode.mutate(undefined)} />

          <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <button
              onClick={() => setCalendarOpen((o) => !o)}
              onMouseEnter={() => importCalendarView()}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
                calendarOpen ? "rounded-t-lg" : "rounded-lg"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-zinc-400 text-xs">
                  {calendarOpen ? "▼" : "▶"}
                </span>
                Calendar
              </span>
            </button>
            {calendarOpen && (
              <div className="border-t border-zinc-200 dark:border-zinc-800 p-3">
                <Suspense
                  fallback={
                    <div className="py-12 text-center text-sm text-zinc-400">
                      Loading calendar...
                    </div>
                  }
                >
                  <CalendarView
                    tripId={tripId}
                    items={items ?? []}
                    trip={trip}
                    selectedItemId={selectedItemId}
                    onItemSelect={handleItemSelect}
                  />
                </Suspense>
              </div>
            )}
          </div>

          <ItineraryTable
            tripId={tripId}
            selectedItemId={selectedItemId}
            onItemSelect={handleItemSelect}
            dayWarnings={dayWarnings}
            drives={routes?.drives}
            onLocationEdited={handleLocationEdited}
          />
        </div>

        {/* Right panel: map (top) + tabbed panel (bottom) */}
        {!mapCollapsed && (
          <div className="w-[40%] min-w-[300px] border-l border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0">
            {/* Map section */}
            <div className="flex-[3] min-h-0 flex flex-col">
              <div className="shrink-0 flex items-center justify-between px-3 py-2 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Map
                </span>
                {geocode.isPending && (
                  <span className="text-xs text-zinc-400 animate-pulse">
                    Geocoding...
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center h-full text-sm text-zinc-400">
                      Loading map...
                    </div>
                  }
                >
                  <TripMap
                    items={items ?? []}
                    days={routes?.days ?? []}
                    drives={routes?.drives ?? []}
                    selectedItemId={selectedItemId}
                    onItemSelect={handleMapItemSelect}
                  />
                </Suspense>
              </div>
            </div>

            {/* Tabbed bottom panel */}
            <div className="flex-[2] min-h-0 flex flex-col border-t border-zinc-200 dark:border-zinc-800">
              <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                {RIGHT_PANEL_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveRightTab(tab.key)}
                    className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                      activeRightTab === tab.key
                        ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-medium"
                        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    }`}
                  >
                    {tab.label}
                    {tab.key === "reminder" && (tasks ?? []).filter((t) => !t.done).length > 0 && (
                      <span className="ml-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                        {(tasks ?? []).filter((t) => !t.done).length}
                      </span>
                    )}
                    {tab.key === "pre-departure" && (checklistItems ?? []).filter((t) => !t.done).length > 0 && (
                      <span className="ml-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                        {(checklistItems ?? []).filter((t) => !t.done).length}
                      </span>
                    )}
                    {tab.key === "packing" && (packingItems ?? []).filter((t) => !t.packed).length > 0 && (
                      <span className="ml-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                        {(packingItems ?? []).filter((t) => !t.packed).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-h-0 bg-white dark:bg-zinc-900">
                {RIGHT_PANEL_TABS.find((t) => t.key === activeRightTab)?.content(tripId)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
