"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { PackingItem, PackingRequiredness } from "@/db/types";

// The master-items GET augments each row with its template membership.
export type PackingItemWithTemplates = PackingItem & { templateIds: string[] };

const ITEMS_KEY = ["packing-items"] as const;

type ItemFields = {
  name: string;
  category?: string | null;
  requiredness?: PackingRequiredness;
  alwaysInclude?: boolean;
  shared?: boolean;
  defaultQuantity?: number;
  notes?: string | null;
  templateIds?: string[];
};

export function usePackingItems() {
  return useQuery<PackingItemWithTemplates[]>({
    queryKey: ITEMS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/packing-items");
      if (!res.ok) throw new Error("Failed to fetch packing items");
      return res.json();
    },
  });
}

export function useCreatePackingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: ItemFields) => {
      const res = await fetch("/api/packing-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create packing item");
      return res.json() as Promise<PackingItemWithTemplates>;
    },
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: ITEMS_KEY });
      const prev = qc.getQueryData<PackingItemWithTemplates[]>(ITEMS_KEY);
      const optimistic: PackingItemWithTemplates = {
        id: `_optimistic_${Date.now()}`,
        name: data.name,
        category: data.category ?? null,
        requiredness: data.requiredness ?? "recommended",
        alwaysInclude: data.alwaysInclude ?? false,
        shared: data.shared ?? false,
        defaultQuantity: data.defaultQuantity ?? 1,
        notes: data.notes ?? null,
        sortOrder: prev?.length ?? 0,
        createdAt: new Date(),
        templateIds: data.templateIds ?? [],
      };
      qc.setQueryData(ITEMS_KEY, [...(prev ?? []), optimistic]);
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(ITEMS_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
    },
  });
}

export function useUpdatePackingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<ItemFields> & { sortOrder?: number };
    }) => {
      const res = await fetch(`/api/packing-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update packing item");
      return res.json() as Promise<PackingItemWithTemplates>;
    },
    onMutate: ({ id, data }) => {
      const prev = qc.getQueryData<PackingItemWithTemplates[]>(ITEMS_KEY);
      if (prev) {
        qc.setQueryData(
          ITEMS_KEY,
          prev.map((t) => (t.id === id ? { ...t, ...data } : t))
        );
      }
      qc.cancelQueries({ queryKey: ITEMS_KEY });
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(ITEMS_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
    },
  });
}

export function useReorderPackingItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((id, i) =>
          fetch(`/api/packing-items/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: i }),
          }).then((res) => {
            if (!res.ok) throw new Error("Failed to reorder packing items");
          })
        )
      );
    },
    onMutate: (orderedIds) => {
      const prev = qc.getQueryData<PackingItemWithTemplates[]>(ITEMS_KEY);
      if (prev) {
        const orderMap = new Map(orderedIds.map((id, i) => [id, i] as const));
        qc.setQueryData<PackingItemWithTemplates[]>(
          ITEMS_KEY,
          prev.map((t) =>
            orderMap.has(t.id) ? { ...t, sortOrder: orderMap.get(t.id)! } : t
          )
        );
      }
      qc.cancelQueries({ queryKey: ITEMS_KEY });
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(ITEMS_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
    },
  });
}

export function useDeletePackingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/packing-items/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete packing item");
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ITEMS_KEY });
      const prev = qc.getQueryData<PackingItemWithTemplates[]>(ITEMS_KEY);
      if (prev) {
        qc.setQueryData(
          ITEMS_KEY,
          prev.filter((t) => t.id !== id)
        );
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ITEMS_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
    },
  });
}
