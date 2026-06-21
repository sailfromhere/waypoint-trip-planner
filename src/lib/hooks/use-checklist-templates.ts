"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ChecklistTemplate } from "@/db/types";

const TEMPLATES_KEY = ["checklist-templates"] as const;

export function useChecklistTemplates() {
  return useQuery<ChecklistTemplate[]>({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => {
      const res = await fetch("/api/checklist-templates");
      if (!res.ok) throw new Error("Failed to fetch checklist templates");
      return res.json();
    },
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { text: string; category?: string }) => {
      const res = await fetch("/api/checklist-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create template");
      return res.json() as Promise<ChecklistTemplate>;
    },
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: TEMPLATES_KEY });
      const prev = qc.getQueryData<ChecklistTemplate[]>(TEMPLATES_KEY);
      const optimistic: ChecklistTemplate = {
        id: `_optimistic_${Date.now()}`,
        text: data.text,
        category: data.category ?? null,
        sortOrder: prev?.length ?? 0,
        createdAt: new Date(),
      };
      qc.setQueryData(TEMPLATES_KEY, [...(prev ?? []), optimistic]);
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(TEMPLATES_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { text?: string; category?: string; sortOrder?: number };
    }) => {
      const res = await fetch(`/api/checklist-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update template");
      return res.json() as Promise<ChecklistTemplate>;
    },
    onMutate: ({ id, data }) => {
      const prev = qc.getQueryData<ChecklistTemplate[]>(TEMPLATES_KEY);
      if (prev) {
        qc.setQueryData(
          TEMPLATES_KEY,
          prev.map((t) => (t.id === id ? { ...t, ...data } : t))
        );
      }
      qc.cancelQueries({ queryKey: TEMPLATES_KEY });
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(TEMPLATES_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useReorderTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((id, i) =>
          fetch(`/api/checklist-templates/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: i }),
          }).then((res) => {
            if (!res.ok) throw new Error("Failed to reorder templates");
          })
        )
      );
    },
    onMutate: (orderedIds) => {
      const prev = qc.getQueryData<ChecklistTemplate[]>(TEMPLATES_KEY);
      if (prev) {
        const orderMap = new Map(orderedIds.map((id, i) => [id, i] as const));
        qc.setQueryData<ChecklistTemplate[]>(
          TEMPLATES_KEY,
          prev.map((t) =>
            orderMap.has(t.id) ? { ...t, sortOrder: orderMap.get(t.id)! } : t
          )
        );
      }
      qc.cancelQueries({ queryKey: TEMPLATES_KEY });
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(TEMPLATES_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/checklist-templates/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete template");
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: TEMPLATES_KEY });
      const prev = qc.getQueryData<ChecklistTemplate[]>(TEMPLATES_KEY);
      if (prev) {
        qc.setQueryData(
          TEMPLATES_KEY,
          prev.filter((t) => t.id !== id)
        );
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(TEMPLATES_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}
