"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { PackingTemplate } from "@/db/types";

const TEMPLATES_KEY = ["packing-templates"] as const;

export function usePackingTemplates() {
  return useQuery<PackingTemplate[]>({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => {
      const res = await fetch("/api/packing-templates");
      if (!res.ok) throw new Error("Failed to fetch packing templates");
      return res.json();
    },
  });
}

export function useCreatePackingTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await fetch("/api/packing-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create packing template");
      return res.json() as Promise<PackingTemplate>;
    },
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: TEMPLATES_KEY });
      const prev = qc.getQueryData<PackingTemplate[]>(TEMPLATES_KEY);
      const optimistic: PackingTemplate = {
        id: `_optimistic_${Date.now()}`,
        name: data.name,
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

export function useUpdatePackingTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { name?: string; sortOrder?: number };
    }) => {
      const res = await fetch(`/api/packing-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update packing template");
      return res.json() as Promise<PackingTemplate>;
    },
    onMutate: ({ id, data }) => {
      const prev = qc.getQueryData<PackingTemplate[]>(TEMPLATES_KEY);
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

export function useDeletePackingTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/packing-templates/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete packing template");
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: TEMPLATES_KEY });
      const prev = qc.getQueryData<PackingTemplate[]>(TEMPLATES_KEY);
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
