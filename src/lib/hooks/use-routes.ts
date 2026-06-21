"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { RoutesResponse } from "@/app/api/trips/[tripId]/routes/route";

export function useRoutes(tripId: string) {
  return useQuery<RoutesResponse>({
    queryKey: ["trips", tripId, "routes"],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/routes`);
      if (!res.ok) throw new Error("Failed to fetch routes");
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useGeocode(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      vars: { itemIds?: string[]; force?: boolean } | undefined = undefined
    ) => {
      const res = await fetch(`/api/trips/${tripId}/geocode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars ?? {}),
      });
      if (!res.ok) throw new Error("Failed to geocode");
      return res.json() as Promise<{
        geocoded: number;
        results: { id: string; lat: number; lng: number; displayName: string }[];
      }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips", tripId, "items"] });
      qc.invalidateQueries({ queryKey: ["trips", tripId, "routes"] });
    },
  });
}
