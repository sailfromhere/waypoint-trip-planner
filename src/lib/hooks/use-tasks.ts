"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { TripTask } from "@/db/types";

function taskKey(tripId: string) {
  return ["trips", tripId, "tasks"] as const;
}

export function useTasks(tripId: string) {
  return useQuery<TripTask[]>({
    queryKey: taskKey(tripId),
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/tasks`);
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
  });
}

export function useCreateTask(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(`/api/trips/${tripId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("Failed to create task");
      return res.json() as Promise<TripTask>;
    },
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: taskKey(tripId) });
      const prev = qc.getQueryData<TripTask[]>(taskKey(tripId));
      const optimistic: TripTask = {
        id: `_optimistic_${Date.now()}`,
        tripId,
        text,
        done: false,
        sortOrder: (prev?.length ?? 0),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      qc.setQueryData(taskKey(tripId), [...(prev ?? []), optimistic]);
      return { prev };
    },
    onError: (_err, _text, ctx) => {
      if (ctx?.prev) qc.setQueryData(taskKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: taskKey(tripId) });
    },
  });
}

export function useUpdateTask(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      data,
    }: {
      taskId: string;
      data: { text?: string; done?: boolean; sortOrder?: number };
    }) => {
      const res = await fetch(`/api/trips/${tripId}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update task");
      return res.json() as Promise<TripTask>;
    },
    onMutate: ({ taskId, data }) => {
      // Write the cache synchronously (before any await) so the UI updates in
      // the same tick — deferring it behind cancelQueries causes a visible flash.
      const prev = qc.getQueryData<TripTask[]>(taskKey(tripId));
      if (prev) {
        qc.setQueryData(
          taskKey(tripId),
          prev.map((t) => (t.id === taskId ? { ...t, ...data } : t))
        );
      }
      qc.cancelQueries({ queryKey: taskKey(tripId) });
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      if (ctx?.prev) qc.setQueryData(taskKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: taskKey(tripId) });
    },
  });
}

/**
 * Reorder tasks in one shot: optimistically rewrites every affected task's
 * sortOrder in a single cache update (so the list re-sorts instantly), then
 * persists each change and invalidates once. Avoids the per-item mutation
 * thrash that left the UI in the old order until a refetch.
 */
export function useReorderTasks(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((id, i) =>
          fetch(`/api/trips/${tripId}/tasks/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: i }),
          }).then((res) => {
            if (!res.ok) throw new Error("Failed to reorder tasks");
          })
        )
      );
    },
    onMutate: (orderedIds) => {
      // Synchronous cache write (before any await) so the new order shows in the
      // same frame dnd-kit ends the drag — a deferred write causes the flash.
      const prev = qc.getQueryData<TripTask[]>(taskKey(tripId));
      if (prev) {
        const orderMap = new Map(orderedIds.map((id, i) => [id, i] as const));
        qc.setQueryData<TripTask[]>(
          taskKey(tripId),
          prev.map((t) =>
            orderMap.has(t.id) ? { ...t, sortOrder: orderMap.get(t.id)! } : t
          )
        );
      }
      qc.cancelQueries({ queryKey: taskKey(tripId) });
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(taskKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: taskKey(tripId) });
    },
  });
}

export function useDeleteTask(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetch(`/api/trips/${tripId}/tasks/${taskId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete task");
    },
    onMutate: async (taskId) => {
      await qc.cancelQueries({ queryKey: taskKey(tripId) });
      const prev = qc.getQueryData<TripTask[]>(taskKey(tripId));
      if (prev) {
        qc.setQueryData(
          taskKey(tripId),
          prev.filter((t) => t.id !== taskId)
        );
      }
      return { prev };
    },
    onError: (_err, _taskId, ctx) => {
      if (ctx?.prev) qc.setQueryData(taskKey(tripId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: taskKey(tripId) });
    },
  });
}
