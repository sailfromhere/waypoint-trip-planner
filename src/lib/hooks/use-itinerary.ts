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
    onSuccess: () => {
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
