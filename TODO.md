> Only user-actionable items (things Claude can't do). Project/engineering work goes in IMPROVEMENTS.md.

# Waypoint — Your Action Items

- [x] ~~Create an **Anthropic API key** (console.anthropic.com) and provide it (a gitignored `.env.local` is fine). Needed for Phase 2.~~
- [x] ~~Create a **Supabase** project (free tier) and provide the project URL + anon/service keys. Needed for Phase 0.~~
- [x] ~~**Rotate Supabase database password** — the password was exposed in conversation on 2026-06-18. Rotated and `.env.local` updated.~~
- [x] ~~**Add your Mapbox access token to `.env.local`.** Done — `MAPBOX_TOKEN` + `GEOCODING_PROVIDER=mapbox` set; `MapboxGeocodingProvider` (Search Box + proximity bias) wired and live-verified (Grand Prismatic & "Wheat Montana Bakery & Deli" now resolve correctly).~~ **Next time you have wrong coords: open the trip → "Re-map all"** to re-geocode with Mapbox (incl. the old Arizona/Texas items).
- [ ] *(Later)* **Explore Google Places/Geocoding cost & ROI** vs Mapbox (best POI accuracy, paid — needs billing). Revisit after living with Mapbox for a bit.
- [x] ~~Create a **MapTiler** free account + API key for nicer vector map tiles. Set `NEXT_PUBLIC_MAPTILER_KEY` in `.env.local`.~~ Done — integrated MapTiler `streets-v2` vector style; falls back to CartoDB raster if key is absent.
- [ ] **Restrict the MapTiler key to your allowed domain(s)/URLs** in the MapTiler account dashboard. It's a `NEXT_PUBLIC_` key (shipped to the browser by design — that's normal for map tiles), so the real protection is an origin allowlist, not secrecy. Do this before deploying publicly so the key can't be reused on other sites (it would burn your free-tier quota).
- [x] ~~Decide whether to self-host **OSRM** or use the public demo / OpenRouteService free key (routing). **Decision:** OSRM public demo server for prototype (rate-limited but fine for single-user dev).~~

_Open-Meteo (weather) needs no key._
