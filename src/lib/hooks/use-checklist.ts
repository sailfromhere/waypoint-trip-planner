"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ChecklistInstance } from "@/db/types";

function checklistKey(tripId: string) {
  return ["trips", tripId, "checklist"] as const;
}

export function useChecklist(tripId: string) {
  return useQuery<ChecklistInstance[]>({
    queryKey: checklistKey(tripId),
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/checklist`);
      if (!res.ok) throw new Error("Failed to fetch checklist");
      return res.json();
    },
  });
}

export function useCreateChecklistItem(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { text: string; category?: string }) => {
      const res = await fetch(`/api/trips/${tripId}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create checklist item");
      return res.json() as Promise<ChecklistInstance>;
    },
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: checklistKey(tripId) });
      const prev = qc.getQueryData<ChecklistInstance[]>(checklistKey(tripId));
      const optimistic: ChecklistInstance = {
        id: `_optimistic_${Date.now()}`,
        tripId,
        templateId: null,
        text: data.text,
        category: data.category ?? null,
        done: false,
        sortOrder: prev?.length ?? 0,
        createdAt: new Date(),
      };
      qc.setQueryData(checklistKey(tripId), [...(prev ?? []), optimistic]);
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(checklistKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: checklistKey(tripId) });
    },
  });
}

export function useUpdateChecklistItem(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      data,
    }: {
      itemId: string;
      data: { text?: string; done?: boolean; sortOrder?: number; category?: string };
    }) => {
      const res = await fetch(`/api/trips/${tripId}/checklist/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update checklist item");
      return res.json() as Promise<ChecklistInstance>;
    },
    onMutate: ({ itemId, data }) => {
      const prev = qc.getQueryData<ChecklistInstance[]>(checklistKey(tripId));
      if (prev) {
        qc.setQueryData(
          checklistKey(tripId),
          prev.map((t) => (t.id === itemId ? { ...t, ...data } : t))
        );
      }
      qc.cancelQueries({ queryKey: checklistKey(tripId) });
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(checklistKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: checklistKey(tripId) });
    },
  });
}

export function useReorderChecklist(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((id, i) =>
          fetch(`/api/trips/${tripId}/checklist/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: i }),
          }).then((res) => {
            if (!res.ok) throw new Error("Failed to reorder checklist");
          })
        )
      );
    },
    onMutate: (orderedIds) => {
      const prev = qc.getQueryData<ChecklistInstance[]>(checklistKey(tripId));
      if (prev) {
        const orderMap = new Map(orderedIds.map((id, i) => [id, i] as const));
        qc.setQueryData<ChecklistInstance[]>(
          checklistKey(tripId),
          prev.map((t) =>
            orderMap.has(t.id) ? { ...t, sortOrder: orderMap.get(t.id)! } : t
          )
        );
      }
      qc.cancelQueries({ queryKey: checklistKey(tripId) });
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(checklistKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: checklistKey(tripId) });
    },
  });
}

export function useDeleteChecklistItem(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/trips/${tripId}/checklist/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete checklist item");
    },
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: checklistKey(tripId) });
      const prev = qc.getQueryData<ChecklistInstance[]>(checklistKey(tripId));
      if (prev) {
        qc.setQueryData(
          checklistKey(tripId),
          prev.filter((t) => t.id !== itemId)
        );
      }
      return { prev };
    },
    onError: (_err, _itemId, ctx) => {
      if (ctx?.prev) qc.setQueryData(checklistKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: checklistKey(tripId) });
    },
  });
}

export function useInstantiateChecklist(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/checklist/instantiate`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to load templates");
      return res.json() as Promise<{ created: number; skipped: number }>;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: checklistKey(tripId) });
    },
  });
}
