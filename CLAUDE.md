# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: Phase 0–2 complete, Phase 3 next

Source-of-truth documents:
- `Waypoint_PRD_v1.md` — the product vision.
- `IMPROVEMENTS.md` — the **active** engineering backlog (open items) + living reference (stack, keystones, roadmap). **Read this before writing any code** and keep statuses updated as work lands. When an item is finished, MOVE its full entry to `IMPROVEMENTS_DONE.md` and leave a one-line stub in the "Closed" index at the bottom (keeps the active file lean; never summarize-away rationale).
- `IMPROVEMENTS_DONE.md` — verbatim archive of completed/decided/dropped items. The "Closed" index in `IMPROVEMENTS.md` points here; grep it for full detail.
- `TODO.md` — real-world setup the user must do (API keys, accounts). Things only the human can do go here; project work goes in `IMPROVEMENTS.md`.

## Commands

```bash
npm run dev          # Start dev server (requires DATABASE_URL in .env.local)
npm run build        # Production build
npm run lint         # ESLint
npm run db:generate  # Generate Drizzle migration from schema changes
npm run db:push      # Push schema directly to DB (dev shortcut, skips migration files)
npm run db:migrate   # Run generated migrations
npm run db:studio    # Open Drizzle Studio (DB browser)
npx tsc --noEmit     # Type-check without emitting
```

Copy `.env.local.example` to `.env.local` and fill in `DATABASE_URL` before running dev/db commands.

## Product in one line

Waypoint turns a vague travel idea ("maybe Alaska in 2028") into a practical, geography-aware, editable itinerary. The differentiators are **practicality and real geography**, not pretty output.

## Decided stack

Next.js (App Router) + TypeScript · Supabase (Postgres + auth + storage + RLS) · Drizzle ORM · Anthropic Claude API (`claude-opus-4-8` for planning reasoning, `claude-haiku-4-5` for mechanical work; tool-use + structured outputs) · MapLibre GL + MapTiler tiles · OSRM/OpenRouteService routing · Open-Meteo weather (no key) · TanStack Table + TanStack Query.

## Keystone architecture (do not violate)

These are decisions that are expensive or impossible to retrofit. They override convenience.

- **Central Trip State model.** Everything — AI planning, itinerary, map, packing, tasks, collaboration — reads from and writes to one Trip State. Build features as readers/writers of that state, not as siloed stores.
- **Provenance on every field.** Each data value carries its source: `ai_assumption | historical_estimate | user_provided | live_researched`. This is a core PRD principle and the enforcement hook for the invariant below.
- **Sacred-human-data invariant (tiered, revised 2026-06-20).** AI writes are classified per field by `fieldLockLevel()` in `src/lib/trip-state/guard.ts`: **hard** — a `Booked` item's facts (date/times/origin/destination/cost) are never AI-writable; **confirm** — `user_provided` fields and a Booked item's labels (title/notes/category) may be changed by AI *only via an explicit, opt-in approval* (the preview-then-commit diff IS the confirmation); **open** — everything else. Enforce in the *mechanism* (the accept path drops hard fields and only applies confirm fields that the human selected; the no-confirmation PATCH route hard-blocks anything not open). A confirmed AI edit to a `user_provided` field keeps it `user_provided`. Tests: `e2e/copilot-guard.spec.ts` (classification, mutation-proven) + `e2e/copilot-flow.spec.ts` (confirm-applies + hard-drops end-to-end).
- **Geography is grounded, never hallucinated.** Drive times/distances always come from the routing API — even in "Planning Mode." Never let the LLM invent distances or pacing.
- **AI is safe-empty.** On uncertainty, leave a field empty; never mis-fill.
- **External integrations behind interfaces** (`RoutingProvider`, `WeatherProvider`, `LodgingProvider`). Mock-vs-real is a single binding swap (free-tier/mock now → real APIs in Phase 8), never a rewrite.
- **AI mutates state via tools, proposing diffs.** AI Actions (optimize route, fill gaps, etc.) return previewable diffs the human approves — good-automatic plus easy-manual-override.

## Code architecture

### Data layer
- **`src/db/schema.ts`** — Drizzle schema: the Trip State tables (`trips`, `travelers`, `itineraryItems`). Every itinerary item carries a `fieldProvenance` JSONB column mapping field names to provenance types.
- **`src/db/types.ts`** — Inferred row/insert types, the `stampProvenance()` helper, and the `TrackableField` list (which fields carry provenance).
- **`src/db/index.ts`** — Lazy-initialized DB connection via Proxy (deferred until first query so builds don't fail without DATABASE_URL).
- **`drizzle.config.ts`** — Drizzle Kit config; loads `.env.local` via dotenv.

### API
- **`src/app/api/trips/`** — REST routes for Trip + ItineraryItem CRUD. The item PATCH route enforces the sacred-human-data invariant: AI sources (`ai_assumption`, `historical_estimate`, `live_researched`) cannot overwrite `user_provided` fields or modify `booked` items. Returns 409 with violation details.
- **`src/app/api/trips/[tripId]/plan/`** — AI planning routes (Phase 2). `POST /plan` takes a prompt, loads trip context + existing items, calls Claude Opus with tool-use, returns `{ items, reasoning }` without persisting. `POST /plan/accept` batch-inserts selected items with `ai_assumption` provenance.

### AI layer (Phase 2)
- **`src/lib/ai/planner.ts`** — Claude tool-use planning logic. Builds a system prompt from trip context + existing items, defines a `create_plan` tool for structured item generation, normalizes Claude's output into typed `ProposedItem[]`. Uses `claude-opus-4-8` model with `tool_choice: "any"`.

### Frontend (Phase 1 + 2)
- **`src/app/page.tsx`** — Trip list: create, view, delete trips.
- **`src/app/trips/[tripId]/`** — Trip workspace: `page.tsx` (shell), `trip-header.tsx` (editable metadata), `planning-panel.tsx` (AI copilot: prompt input, preview with checkboxes, accept/dismiss), `itinerary-table.tsx` (TanStack Table with day-grouped rows), `editable-cell.tsx` (generic inline-editable cell).
- **`src/lib/hooks/`** — TanStack Query hooks: `use-trips.ts` (trip CRUD + optimistic updates), `use-itinerary.ts` (item CRUD + optimistic updates), `use-planning.ts` (plan generation + accept mutations).
- **`src/app/providers.tsx`** — QueryClientProvider wrapper.

### Integrations
- **`src/lib/integrations/`** — Provider interfaces (`types.ts`) and implementations. Each provider has a mock and (where available) a real implementation. The binding point is `index.ts` — swap mock↔real by changing env vars (`ROUTING_PROVIDER`, `WEATHER_PROVIDER`).

## Working conventions

- Keep AI API keys and all secrets server-side (Next.js route handlers / server actions); never ship them to the client.
- Cost discipline: Opus only for genuine planning reasoning, Haiku for mechanical calls; cache Trip State context across calls.
- Keep the data model multi-traveler from day one even while auth is deferred (single local user) — see the auth open question in `IMPROVEMENTS.md`.
