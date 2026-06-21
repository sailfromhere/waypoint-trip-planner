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
        qc.setQueryData(
          ["trips", tripId, "items"],
          prev.map((item) =>
            item.id === itemId ? { ...item, ...data } : item
          )
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
