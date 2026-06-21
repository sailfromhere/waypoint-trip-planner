"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlanAction, PlanResult } from "@/lib/ai/planner";
import type { PlanningTurn } from "@/db/types";

export interface PlanResponse extends PlanResult {
  turnId: string;
}

export interface AcceptResult {
  results: {
    index: number;
    type: PlanAction["type"];
    status: "applied" | "blocked" | "error";
    itemId?: string;
    violations?: string[];
    message?: string;
  }[];
  acceptedActionIds: string[];
  appliedCount: number;
}

export function useGeneratePlan(tripId: string) {
  const qc = useQueryClient();
  return useMutation<PlanResponse, Error, string>({
    mutationFn: async (prompt) => {
      const res = await fetch(`/api/trips/${tripId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Planning failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips", tripId, "turns"] });
    },
  });
}

export function useRefinePlan(tripId: string) {
  const qc = useQueryClient();
  return useMutation<PlanResponse, Error, { turnId: string; message: string }>({
    mutationFn: async ({ turnId, message }) => {
      const res = await fetch(`/api/trips/${tripId}/plan/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId, message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Refinement failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips", tripId, "turns"] });
    },
  });
}

export function useAcceptPlan(tripId: string) {
  const qc = useQueryClient();
  return useMutation<
    AcceptResult,
    Error,
    { turnId: string; actionIndexes: number[] }
  >({
    mutationFn: async ({ turnId, actionIndexes }) => {
      const res = await fetch(`/api/trips/${tripId}/plan/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId, actionIndexes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to accept plan");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips", tripId, "items"] });
      qc.invalidateQueries({ queryKey: ["trips", tripId, "turns"] });
    },
  });
}

export function useTurns(tripId: string) {
  return useQuery<PlanningTurn[]>({
    queryKey: ["trips", tripId, "turns"],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/plan/turns`);
      if (!res.ok) throw new Error("Failed to load planning history");
      return res.json();
    },
  });
}
