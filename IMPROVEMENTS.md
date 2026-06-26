> Project/engineering work and design decisions. Actions the user must take in the real world go in TODO.md.

# Waypoint — Engineering Plan & Decisions

> **This file is the ACTIVE backlog only** (open items + living reference: stack, keystones, roadmap). Completed / decided / dropped items live in **`IMPROVEMENTS_DONE.md`** (full detail, verbatim). The **"Closed" index at the bottom** lists what's done with a one-line status + date — open the archive when a stub is relevant. When you finish an item here, MOVE its full entry to the archive and add a one-liner to the Closed index. (Triggered 2026-06-24 when this file passed ~280 lines / 35KB.)

## Build context (decided 2026-06-17)
- **Goal:** Working prototype (functional demo of the core loop; single-user OK early; deploy later).
- **Scope strategy:** Thin vertical slice first (the "spine"), then layer breadth.
- **External APIs:** Free tiers + mock first; swap to real behind an interface in Phase 8.

## Stack (Decided)
- Next.js (App Router) + TypeScript — single deployable, server-side AI calls.
- Supabase (Postgres + auth + storage + RLS) — free tier; powers collaboration later.
- Drizzle ORM — typed Trip State schema.
- Anthropic Claude API — `claude-opus-4-8` (planning reasoning), `claude-haiku-4-5` (mechanical). Tool-use + structured outputs to mutate Trip State.
- MapLibre GL + MapTiler free tiles; OSRM / OpenRouteService for routing; Open-Meteo for weather (no key).
- TanStack Table + TanStack Query for the editable workspace.

## Keystone architecture decisions (P0)
- **Central Trip State model** — everything reads/writes it (per PRD).
- **Provenance on every field** — `ai_assumption | historical_estimate | user_provided | live_researched`. Status: TBD schema detail. Core PRD principle + enforcement hook for the invariant below.
- **Sacred-human-data invariant** — AI actions must NEVER overwrite `user_provided` or `Booked` items. Enforced in the merge MECHANISM, not by convention. Test: failing fixture before the guard.
- **Integration interfaces** (`RoutingProvider`, `WeatherProvider`, `LodgingProvider`) — mock↔real is a binding swap.
- **Geography is grounded, never hallucinated** — route through the API even in Planning Mode.
- **AI safe-empty** — on uncertainty leave fields empty, never mis-fill.

## Build-out roadmap — START HERE next session (updated 2026-06-20)

**Where we are:** Phases 0–3 built; the Phase-4 *copilot revamp* (AI edits existing items via guarded tiered diffs, conversational refinement, persistent history) is built and tested; geography/geocoding is solid (Mapbox Search Box + query-cleaning + trim-cascade + cluster anchor + pick-nearest). Map UX bugs fixed; light typography pass done (20px). The app is a working single-user spine: vague idea → AI plan → editable itinerary → map with real drive times.

**Recommended order for the rest (confirm at session start; not yet started):**
1. **Phase 6 — Pre-Departure Tasks + quick-reminder inbox — DO THIS BEFORE PHASE 5 (recommended 2026-06-20).** *Rationale:* the low-friction quick-capture inbox is the simplest self-contained new module, delivers immediate value (the user has a real, captured prep checklist), and is the natural substrate that Phase 5 packing plugs into (promote "remember to pack X" → packing item). Building the inbox first means Phase 5 can wire into an existing surface rather than the reverse.
2. **Phase 5 — Packing System** — repository + templates + shared-gear; integrate the reminder→packing-item promotion + auto-check.
3. **Phase 4.5 — Calendar view + deep aesthetics** — **Calendar + deterministic schedule-sequencing BUILT (2026-06-21)** (FullCalendar v6 timed grid with drag/resize; `sequenceDay()` auto-fills start times from real drive legs). **Remaining: deep aesthetics pass** (typography scale, motion, FullCalendar theming, calendar layout width).
4. **Phase 4 remaining — AI Actions + planning quality** — optimize-route / fill-gaps / shorten-day diff actions; optimal-timing & crowd awareness; **AI-side** sensible meal placement (the *deterministic* start-time auto-fill is now done; AI meal-time insertion is still TBD). (Short copyable item refs already DONE.)
5. **Phase 7 — Collaboration**, then **Phase 8 — Live Research + Execution + polish** (incl. real swap of mocks, live/seasonal timing data, candidate-disambiguation geocoding UI).

**Per-phase "decide first" notes** live in each phase entry below and in the UX/quality backlog. The keystones (Central Trip State, tiered sacred-data, grounded geography, safe-empty, provider interfaces) still hold — build new modules as readers/writers of Trip State.

## Phased plan

### Part A — The Spine (vague idea → practical itinerary)
- **Phase 4 — Refinement Loop & AI Actions** — optimize route / fill gaps / shorten day / reduce budget / add stops / alternatives as diff-proposing tools; respect invariant; explained tradeoffs. *Success:* optimize reduces drive time without moving Booked items; preview diff before apply. — Status: TBD. **Now includes the sacred-data soft/hard redesign** (see Field feedback triage §2 below) — this changes a keystone, so design-first. **Also folds in the AI planning-quality items** (see "AI planning quality" below): short copyable item refs (fixes #1 silent-drop), optimal-timing/crowd awareness, and schedule sequencing (auto-fill start times + sensible meal placement).

> End of Part A = the working prototype demo.

### Phase 4.5 — UX polish & Calendar view (NEW, added 2026-06-20 from field feedback)
- **Aesthetics pass** — typography (larger base size, nicer font), spacing, smoother transitions/animations, overall feel. Light pass can land anytime; deep pass here. — Status: TBD (see triage §3). (Calendar shipped; deep aesthetics still outstanding.)
- Rationale: these are cross-cutting UX investments that make every later demo better; grouped so they aren't done piecemeal.

### Part B — Breadth
- **Phase 5 — Packing System** — Built 2026-06-21 (full detail in `IMPROVEMENTS_DONE.md`). Open sub-items (Phase 5b):
  - **Deferred sub-items (Phase 5b):** per-traveler assignment UI (needs a traveler manager — schema has `travelers` but NO UI today; only the AI planner reads them) · reminder→packing promotion bridge · requiredness-based smart defaults.
  - **Reminder→packing bridge — failure modes to solve before building it (user, 2026-06-21):** (1) **One reminder, many items** — a single reminder task is often a list ("bear spray, sunscreen, bug spray"), so a 1:1 promote is wrong; a reminder may map to N packing items, which breaks any naive "packed → reminder auto-checks" linkage (partial-packed state has no clean reminder representation). Needs either a split-on-promote step or accepting the link is reminder→many-items (one-way, no auto-check back). (2) **Names won't be exact matches** — promoted text uses different language/shorthand than repository items ("sunblock" vs "sunscreen"), so dedup/match-to-repository can't rely on string equality; would need fuzzy/AI matching or a manual pick-from-repo step. Both reasons the bridge is deferred, not skipped — revisit with these constraints in mind.
- **Phase 6 — Pre-Departure Tasks + Prep Reminders.** 6a (quick-capture inbox) + 6b (pre-departure checklist) Built 2026-06-21 (full detail in `IMPROVEMENTS_DONE.md`). Open follow-ups:
  - **6a polish — check/uncheck transition animation.** P2. Status: TBD. Currently checking a task instantly moves it to/from the "Done" section (no animation). Want a smooth transition — e.g. the checked item animates (fade/slide/strike-through sweep) before relocating, and the Done section slides in. Tricky because the item moves between two separately-rendered lists (pending ↔ completed); options: (a) a brief delay + CSS transition before the section move, (b) FLIP/layout animation via `framer-motion` (`AnimatePresence` + `layout`) wrapping both sections, (c) animate the strike-through + opacity in place, then reorder. Note: an earlier `setTimeout(150)` hack was removed because it just felt like lag — a real animation (not a blocking delay) is wanted.
    - **Future: Trip Type filtering for templates.** P2. Status: TBD. Umbrella above category — filter which templates apply by trip type (e.g. "day trip", "short multi-day", "long trip"). Free-text type names. Control at category level (set all "Cats" items to day+short+long) with per-item override (remove "find cat sitter" from day trip). Deferred — build global templates first, add trip-type filtering later. Also relevant to Phase 5 packing templates.
- **Phase 7 — Collaboration (thin)** — roles via RLS, comments, activity history, last-write-wins. *Success:* two accounts edit one trip; changes attributed in history. — Status: TBD
- **Phase 8 — Live Research + Execution + polish** — swap mocks for real free-tier APIs behind user-triggered toggle; execution view (today/next/drive time). **Also: live/seasonal timing data** to power optimal-timing suggestions (crowd calendars, holiday awareness, Old Faithful eruption predictions, sunrise/sunset) — see "AI planning quality". *Success:* toggle re-stamps `live_researched`; end-to-end demo. — Status: TBD

## Cross-cutting
- Cost: Opus for reasoning, Haiku for mechanical; cache Trip State context across calls.
- Tests not vacuous: failing fixture for the invariant before implementing the guard.
- Good-automatic + easy-manual override: AI proposes diffs, human approves.


## Field feedback & triage — session 7 (2026-06-21, evening)

Itinerary-table usability bugs/features from real use. Triaged by ROI into tiers (see below). All **Status: TBD** unless noted.


### Tier 2 — high value, more work
- **[S7-2] Add a range of dates at once.** P2, medium. Extend the add-day form with an optional end date; seed one item per day across the range. Reuses `handleAddDay`.
- **[S7-3] Delete a date, with item-handling.** P2, med-high. If the day has items, prompt: "Delete all" / "Move to unscheduled" / per-item checkboxes with select-all. Per-item = batch DELETE or batch `date:null` PATCH. Needs a modal.

### Tier 4 — defer (big, needs paid API / cross-cutting)
- **[S7-7] Pick from real flights to auto-fill origin/destination/duration.** P2/defer. Needs a flights API (Duffel/Amadeus/Aviationstack — mostly paid, key required). Flight duration can't come from OSRM (road routing). Fits "external integrations behind interfaces" + Phase 8 live research (a `FlightProvider`). Interim option: airport autocomplete + manual entry. API-key decision logged in TODO.md. **Now the main remaining cross-tz case — the tz plumbing (S7-TZ-1/2) is built and waiting for real flight legs.**


## UX feedback backlog (logged 2026-06-18, revisit at polish time)

### Table UX (Phase 1 polish)
- **Sorting** — click column header to sort; also a sort-order menu for multi-column/complex sorts. P1. Status: TBD
- **Smart "Add day" defaults** — should default based on trip context (e.g. next day after last item, or within trip date range), not today's date. Only default to today when the trip is blank. P2. Status: TBD
- **Notes column: single-line edit for multi-line content** — notes often contain multi-line text, but the inline edit renders as a single-line input, making it very hard to read or navigate the content. Should use a `<textarea>` (or expand to multi-line on focus) for fields that naturally contain long/multi-line values. P1. Status: TBD

### Security
- **[forward] Validate URL scheme if `links` become clickable** — P1 when built. The itinerary `links` jsonb field is NOT currently rendered as anchors. If/when it is, validate the scheme (block `javascript:`/`data:`) before putting a user value in `href` — an open XSS/redirect vector otherwise. Status: TBD (note for whoever renders links).

### AI Copilot UX (Phase 2 polish / Phase 4) — Copilot revamp (designed 2026-06-18)

- **Re-geocoding on item evolution** — As items evolve (e.g. "stay in West Yellowstone" at `idea` → specific hotel at `booked` with a user-edited name), the destination name changes but coordinates may be stale. Need a policy: re-geocode when `destinationName` changes? Only when provenance flips to `user_provided`? Show a "coordinates may be stale" indicator? Must not silently use wrong coordinates for routing. P1. Status: TBD

### AI planning quality (session 5, 2026-06-20) — from field use

- **Optimal timing & crowd/seasonal awareness.** AI should schedule POIs at their *best* time, not just any time. Field examples: it correctly suggested 5:30am wildlife viewing and checking Old Faithful's eruption prediction, but put Grand Prismatic at 3pm (best colors are ~12–2pm) and suggested entering the park at 8:30am on a **holiday weekend** when locals say arrive before 7:30am to beat entrance lines. Needs: (a) prompt-level guidance to consider golden-hour/midday-color/eruption windows and holiday/peak crowds; (b) eventually live/seasonal data (crowd calendars, eruption predictions, sunrise/sunset, holidays) — Phase 8 live research. P1. Phase 4 (reasoning/prompt) + Phase 8 (live data). Status: TBD.
- **Schedule sequencing: auto-fill start times + sensible meal placement.** Two halves. **(a) Deterministic auto-fill of start times — Built (2026-06-21)** as the Phase-4.5 sequencer (see `sequence.ts` above): a user-triggered "Auto-schedule" fills blank `startTime`/`endTime` from day-start + cumulative durations + REAL drive-item routed times, anchoring on existing/booked times. **(b) AI-side sensible meal placement — still TBD:** when the user asks the copilot to "add meals," it should insert them at sensible clock times in the right position (lunch ~12–1, dinner ~6–7), not appended at the bottom. That's a planner-prompt change (P1, Phase 4), distinct from the deterministic sequencer. (Note: drive times must still come from the routing API per the geography keystone.)

### Sequencing & ordering — session-6 questions (filed 2026-06-21, answered)

These came up once the deterministic sequencer shipped (order is now load-bearing: sequencing walks `sortOrder` within a day).

- **[D1] Mid-segment stops (e.g. "stop for lunch during a long drive").** P1, Status: TBD. Problem: a long drive is one item occupying a contiguous block, so the sequencer puts everything *after* the whole drive — lunch can't sit in the middle. **Answer/decision: model a mid-drive stop by SPLITTING the drive into two legs around the stop** (origin→stop, [stop activity], stop→dest), each routed independently so drive times stay grounded — this is consistent with the "each routed segment is a first-class item" keystone, and the sequencer already orders it correctly once split. The gap is making the split easy: (a) AI affordance — when the user says "stop for X on the way," the copilot proposes splitting the drive + inserting the stop at the split point; (b) a manual "split drive here / add stop" row action that creates the two legs (user picks the stop location; we re-route each half). Rejected alternative: "waypoints inside a single drive item" (sequencer interleaves intermediate stops) — more complex, fights the first-class-segment model.
- **[D2] Drag-reorder itinerary rows + AI insert-at-position.** P1. **(a) drag-reorder itinerary rows — Built (2026-06-21).** Whole-row dnd-kit drag (per the user's request — not a handle column), within a day AND across days (drop onto another day's rows, its end-zone footer, or to/from Unscheduled). One `DndContext` spans all day-groups; each day is a `SortableContext` + an `end:<dayKey>` droppable footer. New `useReorderItems` hook (synchronous optimistic `sortOrder`+`date` rewrite, minimal changed-only PATCHes, re-routes on settle). Booked items ARE draggable across days (a user drag is a `user_provided` edit the guard permits — decided 2026-06-21). Cell editors stop pointer-down propagation so drag-to-select text doesn't start a row drag (also fixes the line-164 "focus lost on drag-highlight" issue for the in-cell case). `getRowId` set to item id so dnd/React track rows by id. Tests: `e2e/drag-reorder.spec.ts` (within-day + cross-day, asserted via API state). **(b) AI insert-at-position — Status: TBD.** The planner's `create` action still appends; it should place new items sensibly. Mechanism: let the `revise_itinerary` tool specify an anchor (`after`/`before` a ref, or target date + relative position); the accept path computes a `sortOrder` between neighbors (and shifts siblings as needed). Pairs with [D1] (a split needs the meal inserted *between* the two legs) and the AI-meal-placement item above.
- **[D3] "Arrive N minutes before" an event (e.g. airport, reservation, trailhead).** P2, Status: TBD. Today handled by a manual "arrive at X" block with a timestamp. **Answer/decision: add an optional `arriveOffsetMinutes` (lead-time/buffer) field on an item** — the sequencer reserves that buffer immediately before the item's effective start, and the calendar renders it as a thin shaded "arrive by HH:MM" sliver extending the block (not a separate event). Cleaner than a manual block, and it's a property of the event (esp. booked items with a fixed start: flight 3pm → arrive-by 1:30). Note: the offset is **metadata, not a booked FACT**, so it stays editable even on booked items (it doesn't move the locked `startTime`). Could generalize to `bufferBeforeMinutes`/`bufferAfterMinutes` (e.g. "15 min to walk back to the car"). Decide field shape + calendar rendering at build.

### Future ideas (post-MVP, filed 2026-06-20)
- **Auto-fill transportation between consecutive POIs.** Once geolocation is solid, when two consecutive located items exist, auto-insert/annotate the leg between them with mode + time (e.g. "drive 25 min" / "walk 8 min") from the routing provider — pick mode by distance (walk under ~1km, else drive), times always from the routing API (geography keystone). Reduces manual drive-leg entry. P3 / future. Status: TBD. (User wants to build out the rest of the app first.)

### Geography / Map UX (Phase 3 follow-ups)
- **Progressive geocoding.** Nominatim is ~1 req/sec and server-side sequential; a large trip is a multi-second black hole with no feedback. Need incremental results + a progress indicator. P1. Status: TBD.

### Aesthetics & UX polish (Phase 4.5) — [#3], added 2026-06-20
- **Typography** — light pass **Built** (2026-06-20): `body` was overriding the loaded **Geist** font with Arial — fixed; line-height 1.55, font smoothing. Base size: **20px** (decided 2026-06-20). **Deep pass Built (2026-06-25):** Fraunces display serif for wordmark/trip/card/popup titles via `.font-display`; Geist keeps data/UI. **CJK companions (2026-06-25):** per-character fallback — titles → LXGW WenKai (霞鹜文楷), UI → Noto Sans SC. See `deep-aesthetics-field-guide.md`.
  - **Self-host LXGW WenKai — Built (2026-06-25).** Correction: the jsDelivr `lxgw-wenkai-webfont` package was ALREADY `unicode-range`-chunked (97 slices/weight), not an 8MB single file — runtime was already light. Self-hosted the **Regular** weight's chunked set (97 woff2 + its CSS) into `/public/fonts/wenkai/` (4.7MB on disk; browser fetches only ~7 chunks for typical text) and pointed `layout.tsx` at `/fonts/wenkai/lxgwwenkai-regular.css` — removes the CDN runtime dependency, keeps full coverage + chunked loading. Dropped the unused light/bold/mono weights. Noto Sans SC stays on Google (already sliced).
- **Overall feel** — spacing, color, hierarchy, empty states. **Built (2026-06-25)** as part of the deep-aesthetics pass: warm-paper empty states (Fraunces headline + glyph) on home + itinerary, `.skeleton` loading placeholders, accent CTAs.
- **App-wide COLOR SYSTEM pass — Built (2026-06-25).** Shipped the **Cartographic Field Guide** identity (warm paper+ink+trail-amber, Fraunces+Geist). Resolved the day-vs-category collision: **DAY owns hue everywhere; CATEGORY = monochrome icon (scheme #1)** — picked via two rendered HTML previews. Curated `DAY_COLORS`; killed the duplicate `CATEGORY_COLORS` + emoji/localStorage icon system → new `src/lib/trip-state/categories.tsx` SVG registry. Whole app re-skinned via a Tailwind `@theme` token-remap. Full detail + gotchas in project memory `deep-aesthetics-field-guide.md`. Deferred: dark-mode day-color fine-tuning, illustrative custom icon set, blue selection-highlight retone.
  <details><summary>original scope (for reference)</summary>The user wanted to deliberately design *all* the colors of the app, not piecemeal — one tokenized palette, a curated day palette + category distinction, light+dark both designed, applied across table/map/calendar/badges/panels.</details> Today colors are ad-hoc Tailwind zinc + per-feature accents: day-colors (`DAY_COLORS`, 10 hues — map + calendar), category badges (`CATEGORY_COLORS` in planning-panel: drive=blue, meal=orange, etc.), status, the blue selection highlight, amber warnings/confirm diffs. These palettes don't share a system and collide on the calendar (day-colored event blocks next to category-colored badges next to blue selection rings). Scope to decide: (1) a single tokenized palette (CSS custom properties / Tailwind theme) — semantic tokens (surface, border, text-muted, accent, warning, danger, selection) + a curated **day palette** and a **category palette** that are intentionally distinguishable from each other and color-blind-safe; (2) decide what carries color meaning — is it day, or category? (two color dimensions on one calendar block is confusing — pick one as the fill and the other as a thin accent/icon); (3) light + dark both designed, not just inverted; (4) apply across table, map markers, calendar, badges, panels. **Calendar chrome already recolored to zinc** (the FC blue default → app zinc, in `globals.css .waypoint-calendar`) as a stopgap; the full system replaces these one-offs.

### Calendar view (Phase 4.5) — [F1], added 2026-06-20
- **Calendar follow-ups (TBD):**
  - **Small-block handling, deeper.** P2. Current: short events show title-only. Want: (a) a hover popover with full title/time/location (FC `eventMouseEnter` + a styled tooltip — replaces relying on click); (b) consider finer `slotDuration` / a zoom control so dense days get vertical room; (c) overlap policy for concurrent events (`slotEventOverlap`, side-by-side vs stacked). See "small-duration" answer in the session-6 Q&A.
  - **"+N more" / all-day overflow UX.** P2. Status: **Built (2026-06-26)** — replaced the navigate-away in two parts:
    - *Week/Day all-day lane:* `views` config sets `timeGrid: { dayMaxEvents: false }` so ALL all-day events render; the lane is height-capped + scrollable via CSS (`.fc-timegrid .fc-daygrid-body` → `max-height:5.5rem; overflow-y:auto`). No "+N more", no navigate-away (Notion-style scrollable band).
    - *Month:* `moreLinkClick` opens a **body-portaled custom popover** (`MoreEventsPopover` in calendar-view.tsx, `.wp-morepop` in globals.css) listing the day's events — escapes the scrolling left-pane overflow that clipped FC's native popover. Built from our own items (day color + 24h time), not FC seg internals. Suppresses FC's native popover by returning a TRUTHY NON-STRING from `moreLinkClick` (FC: `if(!ret||ret==='popover')showPopover; else if(typeof ret==='string')navigate` → a truthy non-string hits neither branch). GOTCHA: `arg.date` is an FC marker date — read Y-M-D with UTC getters (`fcDayStr`), not local. Regression test: `e2e/calendar.spec.ts` "month +N more opens the custom popover without navigating away". Month `dayMaxEvents` kept at 4.
  - **Date-click drill-down navigation.** P2. Status: **Built (2026-06-26).** `navLinks` makes the day number (month) + day-of-week column header (week/day) clickable → Day view (FC default `zoomTo 'day'` → timeGridDay). Plus a `dateClick` handler: clicking the EMPTY area of a month day cell → that Week (`changeView("timeGridWeek", arg.dateStr)`, month-guarded). No conflict — FC's `isValidDateDownEl` excludes `a[data-navlink]`/`.fc-event`/`.fc-more-link`/`.fc-popover` from firing dateClick, so the day number → Day and an event → select still win. CSS: navlink dates get `cursor:pointer` + accent-on-hover; month day frames get a faint `cursor:pointer` hint (empty-cell→week was the user's pick over a week-number column / hover button, accepting low discoverability). Regression test: `e2e/calendar.spec.ts` "clicking a date drills into Day; empty month cell opens the Week".
  - **All-day → grid drag doesn't snap to the sequencer** (drops at the literal pixel time); fine for v1.
  - **Settings menu → 12h/24h clock toggle (+ other prefs).** P2, Status: TBD. The calendar clock is hard-coded to **24-hour** (`hour12:false`) for now (personal use, 2026-06-21). When a settings menu exists, make it user-adjustable (and a natural home for other per-user prefs: default calendar view, week-start day, category-icon overrides currently in localStorage, etc.).
  - **Full color system** — see the aesthetics "App-wide color system" item; calendar is the forcing function.

### Quick reminders / todo inbox (Phases 6 + 5 link) — [F2], added 2026-06-20
- Low-friction capture box to jot trip prep fast (real example list captured in the Phase 6 plan line). Each item: text, optional due/owner, done flag, optional category. **Packing link:** a "remember to pack X" reminder can be promoted to a Phase-5 packing-list entry and auto-checked when present in the list. Keeps everything in-app instead of a separate notes app. P1 within Phase 6. Status: TBD.

### Data model / schema evolution
- **Duration units** — current field is `durationMinutes` (integer). Need to support hours, mixed units (e.g. "1h 20m"), and multi-day stays. Options: store as minutes internally + display formatter, or add a `durationUnit` field. P2. Status: TBD
- **Custom categories** — user-defined categories beyond the fixed enum. Scoped at three levels: universal (user default), per-trip, or per-trip-template. Requires schema change (move from enum to a categories table or JSONB config). P2. Status: TBD

## Open questions (revisit before relevant phase)
- Auth in prototype: defer login (single local user) until Phase 7, or wire Supabase auth from Phase 0? (Leaning: defer; keep data model multi-traveler from the start.)
- Routing: OSRM public demo for prototype. Revisit self-hosting if rate limits become an issue. — Decided 2026-06-18.
- Attachment storage: Supabase storage vs defer. — TBD.

## Closed — full detail in `IMPROVEMENTS_DONE.md`

One-liners only; grep the archive for the full verbatim entry.

**Part A spine (phases)**
- Phase 0 — Foundations & Trip State — Built 2026-06-17
- Phase 1 — Manual Itinerary Workspace — Built 2026-06-18
- Phase 2 — AI Planning Copilot — Built 2026-06-18
- Phase 3 — Geography & Map — Built 2026-06-18
- Phase 3 hardening — bug fixes + Playwright smoke harness — Built 2026-06-18
- Phase 3 map polish round 2 — Built 2026-06-18
- Map — overlapping-route segment-level fanning — Built 2026-06-22
- Map — hover drive route → distance + time tooltip — Built 2026-06-22 (a.k.a. S15)
- Map — hover marker → title pill + route/marker de-confliction — Built 2026-06-22 (a.k.a. S16)

**Phase 4.5 — calendar + sequencing**
- [S8] auto-schedule re-flow + "fills then vanishes" — Built 2026-06-21
- [S8] drive-duration re-sync after location fix — Built 2026-06-21
- Schedule sequencing (deterministic auto-fill start times) — Built 2026-06-21
- Calendar view (FullCalendar v6 timed grid) + UX/Event refinements + font/scale theming — Built 2026-06-21

**Part B**
- Phase 5 — Packing System (4-table model, panel, smoke) — Built 2026-06-21 *(5b sub-items still open above)*
- Phase 6a — Prep Reminders quick-capture inbox + drag-reorder — Built 2026-06-21
- Phase 6b — Pre-Departure Checklist (template+instance) — Built 2026-06-21

**Cross-cutting**
- Repo published + README/.env.local.example — Built 2026-06-21
- API hardening (guard malformed `req.json()`) — Built 2026-06-21

**Sacred-data**
- Field feedback triage session 4 (NOW batch) + §2 soft/hard/confirm redesign — Built 2026-06-20

**Session 7/9/10 table batches**
- Session 10 follow-up batch (status clip, notes scroll, From/To, column resize/reorder) — Built 2026-06-22
- Session 9 table polish batch (drag overlay, grip removed, cell-alignment trio) — Built 2026-06-21
- Tier 1 cheap fixes ([S7-4] start-time, [S7-1], [S7-8] delete trip, [S7-6] duration, [S7-C2], [S7-C3]) — Built 2026-06-21
- [S7-5] auto-geocode on edit — Built 2026-06-21
- [S7-9] type-ahead location picker — Built 2026-06-21
- [S7-C1] "Completed" status clipping — Built s9/s10

**Table UX / Security / Copilot**
- Column customization (show/hide, reorder, resize) — Built s9/s10
- Schedule unscheduled items via cross-day drag — Built 2026-06-21
- Text-field focus-on-drag-highlight — Deferred (couldn't reproduce) 2026-06-21
- Add/delete friction polish (optimistic add, leftmost ✕, Untitled fallback) — Built 2026-06-22
- XSS hardening (`setDOMContent`) — Built s12
- AI Copilot revamp — edit existing items + history + conversational refine + multiline prompt — Built 2026-06-18
- [#1] AI silent-drop → short copyable refs (R1/R2) — Built 2026-06-20

**Geography / Map**
- Map popup redesign + reopen-bug fix + Safari hover-wobble fix — Built 2026-06-24
- Overlapping marker clustering (Supercluster + DOM markers) — Built 2026-06-22
- Place-name labels (#d) — Built 2026-06-22
- Smart fit-bounds (ignore long-haul legs) — Built 2026-06-22
- Drive routes persist (cache, no recompute-on-refresh) — Built 2026-06-22
- Map cosmetics batch (b/c/e) — Built 2026-06-22
- Trackpad zoom speed — Built 2026-06-20
- [#5] drive routes vanish on hide/show — Built 2026-06-20
- [#4] Fit button placement — Built 2026-06-20
- [#6] map blur deselects row — Built 2026-06-20
- [#7/#8] geocoding accuracy (Mapbox Search Box + clean/trim-cascade + pick-nearest) — Built+hardened 2026-06-20; candidate-UI Dropped 2026-06-22
- Click-row-to-locate — Decided: keep single-click-to-edit 2026-06-18
- Re-geocode on item evolution — Resolved 2026-06-22

**Aesthetics / Calendar (built sub-items)**
- Calendar font/scale zinc theming — Built 2026-06-21
- Calendar Event UX refinements (24h clock, line clamps) — Built 2026-06-21
- Motion pass — shared animation vocabulary (panel expand, diff apply, map marker/route fade, table row enter/exit) — Built 2026-06-25

**Timezone (S7-TZ)**
- [S7-TZ-1] Timezone foundation — derive + store per-endpoint tz — Built 2026-06-24
- [S7-TZ-2] Full tz-aware sequencing + calendar/table/map rendering — Built 2026-06-24

**Performance (S24, 2026-06-26 — see [[session24-perf-safari-scroll-prefetch]] in project memory)**
- Safari left-pane scroll jank — `content-visibility`/`contain` containment on day groups + calendar (`.wp-contain-block`) — Built 2026-06-26 (Step-2 FC `height=auto` reverted to keep bounded calendar; **OPEN: real-Safari re-test of Step-1-alone; next lever `stickyHeaderDates={false}`**)
- "Slow first trip open" diagnosis — confirmed Next-dev on-demand compile + cold cache, gone in prod build — Resolved 2026-06-26 (no code change needed)
- Hover-prefetch trip data + map chunk from trip list — Built 2026-06-26 (not yet browser-verified)
