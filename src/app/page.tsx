"use client";

import { useState } from "react";
import { useTrips, useCreateTrip, useDeleteTrip } from "@/lib/hooks/use-trips";
import Link from "next/link";

const STATUS_LABELS: Record<string, string> = {
  dreaming: "Dreaming",
  planning: "Planning",
  booked: "Booked",
  in_progress: "In Progress",
  completed: "Completed",
};

export default function Home() {
  const { data: trips, isLoading } = useTrips();
  const createTrip = useCreateTrip();
  const deleteTrip = useDeleteTrip();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    createTrip.mutate(
      { name: newName.trim() },
      {
        onSuccess: () => {
          setNewName("");
          setShowCreate(false);
        },
      }
    );
  }

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-zinc-950 font-sans">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold">Waypoint</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] px-4 py-2 text-sm font-medium hover:brightness-110 transition-all"
          >
            New Trip
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-6 flex gap-3 items-center bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4"
          >
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Trip name (e.g. Alaska 2028)"
              className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:focus:border-zinc-400"
              autoFocus
            />
            <button
              type="submit"
              disabled={createTrip.isPending}
              className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setNewName("");
              }}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
          </form>
        )}

        {isLoading ? (
          <div className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex flex-col gap-2"
              >
                <div className="skeleton h-5 w-48" />
                <div className="skeleton h-4 w-24" />
              </div>
            ))}
          </div>
        ) : !trips?.length ? (
          <div className="text-center py-20 flex flex-col items-center">
            <svg
              viewBox="0 0 24 24"
              className="w-10 h-10 mb-4 text-zinc-300 dark:text-zinc-600"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
            </svg>
            <p className="font-display text-xl font-semibold text-zinc-800 dark:text-zinc-100">
              Plot your first journey
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 mb-5">
              Turn a vague idea into a practical, geography-aware itinerary.
            </p>
            {!showCreate && (
              <button
                onClick={() => setShowCreate(true)}
                className="rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] px-4 py-2 text-sm font-medium hover:brightness-110 transition-all"
              >
                New Trip
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            {trips.map((trip) => (
              <Link
                key={trip.id}
                href={`/trips/${trip.id}`}
                className="group flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {trip.name}
                  </span>
                  <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="inline-flex items-center rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5">
                      {STATUS_LABELS[trip.status] ?? trip.status}
                    </span>
                    {trip.startDate && (
                      <span>
                        {trip.startDate}
                        {trip.endDate ? ` → ${trip.endDate}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    if (confirm(`Delete "${trip.name}"?`)) {
                      deleteTrip.mutate(trip.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 text-sm px-2 py-1 transition-all"
                >
                  Delete
                </button>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
