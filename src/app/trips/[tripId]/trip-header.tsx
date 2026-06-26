"use client";

import { useState } from "react";
import type { Trip } from "@/db/types";
import { tripStatus } from "@/db/schema";

const STATUS_LABELS: Record<string, string> = {
  dreaming: "Dreaming",
  planning: "Planning",
  booked: "Booked",
  in_progress: "In Progress",
  completed: "Completed",
};

export function TripHeader({
  trip,
  onUpdate,
  onDelete,
}: {
  trip: Trip;
  onUpdate: (data: Partial<Trip>) => void;
  onDelete?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(trip.name);
  const [description, setDescription] = useState(trip.description ?? "");
  const [startDate, setStartDate] = useState(trip.startDate ?? "");
  const [endDate, setEndDate] = useState(trip.endDate ?? "");

  function handleSave() {
    onUpdate({
      name: name.trim() || trip.name,
      description: description.trim() || null,
      startDate: startDate || null,
      endDate: endDate || null,
    });
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="mb-6 flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            {trip.name}
          </h2>
          {trip.description && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {trip.description}
            </p>
          )}
          <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            <select
              value={trip.status}
              onChange={(e) =>
                onUpdate({
                  status: e.target.value as Trip["status"],
                })
              }
              className="rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-1.5 py-0.5 text-xs outline-none"
            >
              {tripStatus.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s] ?? s}
                </option>
              ))}
            </select>
            {trip.startDate && (
              <span>
                {trip.startDate}
                {trip.endDate ? ` → ${trip.endDate}` : ""}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 underline"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="grid gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Trip name"
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
          autoFocus
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
        />
        <div className="flex gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
            />
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={handleSave}
          className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1.5 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
        >
          Save
        </button>
        <button
          onClick={() => setEditing(false)}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        {onDelete &&
          (confirmDelete ? (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-red-600 dark:text-red-400">
                Delete this trip and all its items?
              </span>
              <button
                onClick={onDelete}
                className="rounded-md bg-red-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="ml-auto text-xs text-red-500 hover:text-red-600 dark:hover:text-red-400 underline"
            >
              Delete trip
            </button>
          ))}
      </div>
    </div>
  );
}
