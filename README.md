# Waypoint

**From "I might want to go somewhere" to "I'm leaving tomorrow."**

Waypoint turns a vague travel idea (*"maybe Alaska in 2028"*) into a practical, geography-aware, editable itinerary. Unlike typical AI itinerary generators, it prioritizes **practicality and real geography** over pretty output — real drive times, realistic pacing, and the logistics an experienced traveler would actually think through.

> Status: working single-user prototype. The core loop is complete — vague idea → AI plan → editable itinerary → map with real drive times — plus packing, pre-departure checklists, and prep reminders.

## What it does

- **AI Planning Copilot** — describe a trip in plain language; Claude proposes a structured, day-by-day itinerary you preview and accept. Refine it conversationally ("no Thai", "bad knees — no long hikes"); the AI edits existing items as previewable diffs.
- **Editable itinerary workspace** — an Airtable-style table with inline editing, day grouping, statuses (idea → planned → booked → completed), and costs.
- **Real geography** — every drive leg's distance and time comes from a routing API (OSRM), never hallucinated. A synced MapLibre map shows routed drives, day-colored markers, and flags unrealistic days.
- **Packing system** — a reusable gear repository with trip-type templates (Beach, Backpacking, …), requiredness levels, quantities, and shared-vs-personal gear; instantiate a per-trip list and check items off.
- **Pre-departure checklist** — reusable templates (feed the cat, lock up, …) copied per-trip.
- **Prep reminders** — a low-friction quick-capture inbox for planning thoughts.

## Architecture keystones

A few decisions the whole app is built around:

- **Central Trip State** — every feature reads from and writes to one shared trip state, not siloed stores.
- **Provenance on every field** — each value is labeled `ai_assumption | historical_estimate | user_provided | live_researched`.
- **Sacred human data** — AI can never silently overwrite your work. A booked item's facts are hard-locked; your edits and a booked item's labels change only via explicit, opt-in approval (the preview-then-commit diff *is* the confirmation).
- **Grounded geography** — distances and times always come from the routing provider, even in planning mode.
- **Safe-empty AI** — on uncertainty, the AI leaves a field empty rather than mis-filling it.
- **Integrations behind interfaces** — routing/weather/lodging providers swap mock↔real via one env binding.

## Tech stack

Next.js (App Router) + TypeScript · Supabase (Postgres) · Drizzle ORM · Anthropic Claude API (`claude-opus-4-8` for planning, `claude-haiku-4-5` for mechanical work; tool-use) · MapLibre GL + MapTiler tiles · OSRM routing · Open-Meteo weather · TanStack Table + TanStack Query.

## Getting started

Requires Node.js and a Supabase Postgres database.

```bash
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run db:push                     # push the Drizzle schema to your database
npm run dev                         # http://localhost:3000
```

### Environment variables (`.env.local`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres connection string (use the **pooler** host) |
| `ANTHROPIC_API_KEY` | Claude API key — powers the planning copilot |
| `MAPBOX_TOKEN` | Mapbox token — geocoding (Search Box API) |
| `GEOCODING_PROVIDER` | `mapbox` (or `nominatim`) |
| `ROUTING_PROVIDER` | `osrm` |
| `OSRM_BASE_URL` | OSRM routing endpoint |
| `NEXT_PUBLIC_MAPTILER_KEY` | MapTiler key for vector tiles (optional; falls back to CartoDB raster) |

Secrets stay server-side and `.env.local` is gitignored. For deployment, set these in your host's dashboard.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # ESLint
npm run db:generate  # generate a Drizzle migration from schema changes
npm run db:push      # push schema directly to the DB (dev shortcut)
npm run db:studio    # Drizzle Studio (DB browser)
npm run test:e2e     # Playwright end-to-end tests
npx tsc --noEmit     # type-check
```

## Project layout

```
src/db/                Drizzle schema, types, lazy DB connection
src/app/api/           REST + AI planning route handlers (sacred-data guard lives here)
src/app/trips/         Trip workspace — itinerary table, map, packing, checklist, reminders
src/lib/ai/            Claude tool-use planning logic
src/lib/hooks/         TanStack Query hooks
src/lib/integrations/  Routing / weather / lodging providers (mock + real)
e2e/                   Playwright smoke tests
```

---

*Built as a prototype with [Claude Code](https://claude.com/claude-code).*
