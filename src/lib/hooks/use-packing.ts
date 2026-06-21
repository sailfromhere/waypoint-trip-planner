"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { PackingListItem, PackingRequiredness } from "@/db/types";

function packingKey(tripId: string) {
  return ["trips", tripId, "packing"] as const;
}

type CreateFields = {
  name: string;
  category?: string | null;
  requiredness?: PackingRequiredness;
  quantity?: number;
  shared?: boolean;
  packingItemId?: string;
  assignedTravelerId?: string;
};

type UpdateFields = {
  name?: string;
  packed?: boolean;
  sortOrder?: number;
  category?: string | null;
  requiredness?: PackingRequiredness;
  quantity?: number;
  shared?: boolean;
  assignedTravelerId?: string | null;
};

export function usePacking(tripId: string) {
  return useQuery<PackingListItem[]>({
    queryKey: packingKey(tripId),
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/packing`);
      if (!res.ok) throw new Error("Failed to fetch packing list");
      return res.json();
    },
  });
}

export function useCreatePackingListItem(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateFields) => {
      const res = await fetch(`/api/trips/${tripId}/packing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create packing item");
      return res.json() as Promise<PackingListItem>;
    },
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: packingKey(tripId) });
      const prev = qc.getQueryData<PackingListItem[]>(packingKey(tripId));
      const optimistic: PackingListItem = {
        id: `_optimistic_${Date.now()}`,
        tripId,
        packingItemId: data.packingItemId ?? null,
        name: data.name,
        category: data.category ?? null,
        requiredness: data.requiredness ?? "recommended",
        quantity: data.quantity ?? 1,
        shared: data.shared ?? false,
        assignedTravelerId: data.assignedTravelerId ?? null,
        packed: false,
        sortOrder: prev?.length ?? 0,
        createdAt: new Date(),
      };
      qc.setQueryData(packingKey(tripId), [...(prev ?? []), optimistic]);
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(packingKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: packingKey(tripId) });
    },
  });
}

export function useUpdatePackingListItem(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      data,
    }: {
      itemId: string;
      data: UpdateFields;
    }) => {
      const res = await fetch(`/api/trips/${tripId}/packing/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update packing item");
      return res.json() as Promise<PackingListItem>;
    },
    onMutate: ({ itemId, data }) => {
      const prev = qc.getQueryData<PackingListItem[]>(packingKey(tripId));
      if (prev) {
        qc.setQueryData(
          packingKey(tripId),
          prev.map((t) => (t.id === itemId ? { ...t, ...data } : t))
        );
      }
      qc.cancelQueries({ queryKey: packingKey(tripId) });
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(packingKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: packingKey(tripId) });
    },
  });
}

export function useReorderPacking(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((id, i) =>
          fetch(`/api/trips/${tripId}/packing/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: i }),
          }).then((res) => {
            if (!res.ok) throw new Error("Failed to reorder packing list");
          })
        )
      );
    },
    onMutate: (orderedIds) => {
      const prev = qc.getQueryData<PackingListItem[]>(packingKey(tripId));
      if (prev) {
        const orderMap = new Map(orderedIds.map((id, i) => [id, i] as const));
        qc.setQueryData<PackingListItem[]>(
          packingKey(tripId),
          prev.map((t) =>
            orderMap.has(t.id) ? { ...t, sortOrder: orderMap.get(t.id)! } : t
          )
        );
      }
      qc.cancelQueries({ queryKey: packingKey(tripId) });
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(packingKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: packingKey(tripId) });
    },
  });
}

export function useDeletePackingListItem(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/trips/${tripId}/packing/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete packing item");
    },
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: packingKey(tripId) });
      const prev = qc.getQueryData<PackingListItem[]>(packingKey(tripId));
      if (prev) {
        qc.setQueryData(
          packingKey(tripId),
          prev.filter((t) => t.id !== itemId)
        );
      }
      return { prev };
    },
    onError: (_err, _itemId, ctx) => {
      if (ctx?.prev) qc.setQueryData(packingKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: packingKey(tripId) });
    },
  });
}

export function useInstantiatePacking(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (templateIds: string[]) => {
      const res = await fetch(`/api/trips/${tripId}/packing/instantiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateIds }),
      });
      if (!res.ok) throw new Error("Failed to load packing templates");
      return res.json() as Promise<{ created: number; skipped: number }>;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: packingKey(tripId) });
    },
  });
}
