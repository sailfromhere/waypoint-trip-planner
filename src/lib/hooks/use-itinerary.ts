"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ItineraryItem } from "@/db/types";

export function useItineraryItems(tripId: string) {
  return useQuery<ItineraryItem[]>({
    queryKey: ["trips", tripId, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/items`);
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
  });
}

export function useCreateItem(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/trips/${tripId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create item");
      return res.json() as Promise<ItineraryItem>;
    },
    // Optimistically append the row so it appears in the same frame the user
    // clicks "+ Add item" — a plain await-the-POST-then-invalidate (the old
    // behaviour) made adding feel ~1s laggy. The temp id is swapped for the
    // real server row in onSuccess, so the user never sees the placeholder id.
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: ["trips", tripId, "items"] });
      const prev = qc.getQueryData<ItineraryItem[]>(["trips", tripId, "items"]);
      const tempId = `temp-${crypto.randomUUID()}`;
      const now = new Date();
      const temp: ItineraryItem = {
        id: tempId,
        tripId,
        date: null,
        startTime: null,
        endTime: null,
        durationMinutes: null,
        originName: null,
        originLat: null,
        originLng: null,
        destinationName: null,
        destinationLat: null,
        destinationLng: null,
        category: "activity",
        title: "",
        notes: null,
        confirmationStatus: "idea",
        costCents: null,
        currency: "USD",
        links: [],
        sortOrder: 0,
        fieldProvenance: {},
        routeGeometry: null,
        routeDistanceMeters: null,
        routeDurationSeconds: null,
        routeSignature: null,
        createdAt: now,
        updatedAt: now,
        ...(data as Partial<ItineraryItem>),
      };
      if (prev) {
        qc.setQueryData<ItineraryItem[]>(
          ["trips", tripId, "items"],
          [...prev, temp]
        );
      }
      return { prev, tempId };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(["trips", tripId, "items"], ctx.prev);
    },
    onSuccess: (created, _data, ctx) => {
      // Swap the temp row for the authoritative server row in place (no
      // invalidate flash, no transient duplicate from the temp/real id pair).
      qc.setQueryData<ItineraryItem[]>(["trips", tripId, "items"], (cur) =>
        cur
          ? cur.map((item) => (item.id === ctx?.tempId ? created : item))
          : cur
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["trips", tripId, "items"] });
    },
  });
}

// Item fields that change what the routes API computes (it groups by date,
// orders by sortOrder, and routes drives between endpoint COORDS). When one of
// these changes we must also invalidate the routes query so OSRM re-routes —
// e.g. picking a drive's From/To fills coords, which should produce a routed
// duration (and feed the S7-6 auto-fill). Plain item edits (title/notes/etc.)
// skip this so we don't re-hit OSRM on every keystroke.
const ROUTING_FIELDS = new Set([
  "originLat",
  "originLng",
  "destinationLat",
  "destinationLng",
  "date",
  "sortOrder",
  "category",
]);

export function useUpdateItem(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      data,
    }: {
      itemId: string;
      data: Record<string, unknown>;
    }) => {
      const res = await fetch(`/api/trips/${tripId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update item");
      return res.json() as Promise<ItineraryItem>;
    },
    onMutate: async ({ itemId, data }) => {
      await qc.cancelQueries({ queryKey: ["trips", tripId, "items"] });
      const prev = qc.getQueryData<ItineraryItem[]>([
        "trips",
        tripId,
        "items",
      ]);
      if (prev) {
        // Mirror the server's provenance stamping in the optimistic cache so a
        // follow-on read (e.g. the sequencer's user-anchor check, or the next
        // auto-schedule) sees correct provenance immediately — not only after
        // the refetch settles. Clearing a field drops its provenance.
        const source = (data._provenance as string) ?? "user_provided";
        qc.setQueryData(
          ["trips", tripId, "items"],
          prev.map((item) => {
            if (item.id !== itemId) return item;
            const merged = { ...item, ...data } as Record<string, unknown>;
            delete merged._provenance;
            const prov = { ...(item.fieldProvenance ?? {}) } as Record<string, string>;
            for (const k of Object.keys(data)) {
              if (k === "_provenance" || k === "fieldProvenance") continue;
              const v = data[k];
              if (v === null || v === "") delete prov[k];
              else prov[k] = source;
            }
            merged.fieldProvenance = prov;
            return merged as unknown as ItineraryItem;
          })
        );
      }
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev)
        qc.setQueryData(["trips", tripId, "items"], ctx.prev);
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ["trips", tripId, "items"] });
      if (vars && Object.keys(vars.data).some((k) => ROUTING_FIELDS.has(k))) {
        qc.invalidateQueries({ queryKey: ["trips", tripId, "routes"] });
      }
    },
  });
}

// Batch time writes from the deterministic sequencer. Each change is a blank
// fill (or its inverse, for undo), so it goes out as `historical_estimate` —
// the strict PATCH guard lets it through because the fields are open. Applied
// as ONE optimistic cache write so the table/calendar update instantly.
export function useAutoSchedule(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      changes: { itemId: string; startTime: string | null; endTime: string | null }[]
    ) => {
      await Promise.all(
        changes.map((c) =>
          fetch(`/api/trips/${tripId}/items/${c.itemId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              startTime: c.startTime,
              endTime: c.endTime,
              _provenance: "historical_estimate",
            }),
          }).then((res) => {
            if (!res.ok) throw new Error("Failed to schedule item");
          })
        )
      );
    },
    onMutate: async (changes) => {
      await qc.cancelQueries({ queryKey: ["trips", tripId, "items"] });
      const prev = qc.getQueryData<ItineraryItem[]>(["trips", tripId, "items"]);
      if (prev) {
        const byId = new Map(changes.map((c) => [c.itemId, c]));
        qc.setQueryData(
          ["trips", tripId, "items"],
          prev.map((item) => {
            const c = byId.get(item.id);
            return c
              ? { ...item, startTime: c.startTime, endTime: c.endTime }
              : item;
          })
        );
      }
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(["trips", tripId, "items"], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["trips", tripId, "items"] });
    },
  });
}

// A drag-reorder change. `sortOrder` is always rewritten; `date` is present
// ONLY for the dragged item when it crosses into another day (or to/from
// Unscheduled, where `date` is null). Both go out as a plain user_provided
// PATCH — a deliberate human placement — so the guard lets them through even
// for booked items (moving your own booking is a human action).
export interface ReorderChange {
  itemId: string;
  sortOrder: number;
  date?: string | null;
}

// One-shot itinerary reorder: optimistically rewrites every affected item's
// sortOrder (and the dragged item's date) in a single synchronous cache write
// — so the new order shows in the same frame dnd-kit ends the drag — then
// persists each change and invalidates once. Mirrors useReorderTasks; a
// deferred write (behind an awaited cancelQueries) would flash.
export function useReorderItems(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (changes: ReorderChange[]) => {
      await Promise.all(
        changes.map((c) =>
          fetch(`/api/trips/${tripId}/items/${c.itemId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sortOrder: c.sortOrder,
              ...(c.date !== undefined ? { date: c.date } : {}),
            }),
          }).then((res) => {
            if (!res.ok) throw new Error("Failed to reorder item");
          })
        )
      );
    },
    onMutate: (changes) => {
      // Synchronous cache write (before any await) so the new order renders in
      // the same frame the drag ends — a deferred write causes a visible flash.
      const prev = qc.getQueryData<ItineraryItem[]>(["trips", tripId, "items"]);
      if (prev) {
        const byId = new Map(changes.map((c) => [c.itemId, c]));
        qc.setQueryData<ItineraryItem[]>(
          ["trips", tripId, "items"],
          prev.map((item) => {
            const c = byId.get(item.id);
            if (!c) return item;
            return {
              ...item,
              sortOrder: c.sortOrder,
              ...(c.date !== undefined ? { date: c.date } : {}),
            };
          })
        );
      }
      qc.cancelQueries({ queryKey: ["trips", tripId, "items"] });
      return { prev };
    },
    onError: (_err, _changes, ctx) => {
      if (ctx?.prev) qc.setQueryData(["trips", tripId, "items"], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["trips", tripId, "items"] });
      // Reordering changes drive adjacency (and a cross-day move re-groups
      // drives by date), so always re-route.
      qc.invalidateQueries({ queryKey: ["trips", tripId, "routes"] });
    },
  });
}

export function useDeleteItem(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/trips/${tripId}/items/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete item");
    },
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: ["trips", tripId, "items"] });
      const prev = qc.getQueryData<ItineraryItem[]>([
        "trips",
        tripId,
        "items",
      ]);
      if (prev) {
        qc.setQueryData(
          ["trips", tripId, "items"],
          prev.filter((item) => item.id !== itemId)
        );
      }
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev)
        qc.setQueryData(["trips", tripId, "items"], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["trips", tripId, "items"] });
    },
  });
}
