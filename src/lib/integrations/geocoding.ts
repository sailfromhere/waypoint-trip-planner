import type { LatLng } from "./types";

export interface GeocodingResult {
  lat: number;
  lng: number;
  displayName: string;
}

// Optional bias: nudge results toward where the trip already is, so an
// ambiguous establishment name resolves near the rest of the itinerary instead
// of in the wrong state/country.
export interface GeocodeOptions {
  proximity?: { lat: number; lng: number };
}

export interface GeocodingProvider {
  geocode(query: string, options?: GeocodeOptions): Promise<GeocodingResult | null>;
}

/**
 * Normalize a place name before geocoding. Real itinerary names carry noise that
 * sends geocoders to the wrong continent (empirically: "Old Faithful / Upper
 * Geyser Basin, Yellowstone NP" → Illinois; "(Grand Prismatic)" → New York).
 * Rules (validated against Mapbox Search Box):
 *  - drop parentheticals (alternate names confuse the matcher)
 *  - on "A / B" keep the primary name A, re-appending the trailing region
 * NOTE: deliberately NOT expanding "NP"→"National Park" — that made names like
 * "...Inn Dining Room, Yellowstone NP" match Mt Rainier's real "National Park
 * Inn Dining Room". The region token + proximity bias already disambiguate.
 */
export function cleanGeocodeQuery(raw: string): string {
  let t = raw
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.includes("/")) {
    const region = t.includes(",") ? t.slice(t.lastIndexOf(",")) : "";
    t = t.split("/")[0].trim().replace(/,+$/, "") + region;
  }
  return t.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
}

/**
 * Ordered query candidates, most-specific → least. Mapbox Search Box does best
 * with a short primary POI name; extra qualifiers/commas make it fuzzy-match the
 * wrong token ("Mammoth Terrace Grill, Mammoth Hot Springs, Yellowstone NP" →
 * Nepal; "Old Faithful Inn Dining Room" → Utah). So we also try the primary
 * comma-segment and progressively word-trimmed versions, and pick whichever
 * lands nearest the trip (see the provider).
 */
export function candidateQueries(raw: string): string[] {
  const cleaned = cleanGeocodeQuery(raw);
  const out = [cleaned];
  const primary = cleaned.split(",")[0].trim();
  if (primary && !out.includes(primary)) out.push(primary);
  const words = primary.split(/\s+/);
  for (let n = words.length - 1; n >= 2; n--) {
    const w = words.slice(0, n).join(" ");
    if (!out.includes(w)) out.push(w);
  }
  return out.slice(0, 4); // cap candidates → bounded API calls
}

export class MockGeocodingProvider implements GeocodingProvider {
  async geocode(query: string): Promise<GeocodingResult | null> {
    const hash = Array.from(query).reduce((h, c) => h * 31 + c.charCodeAt(0), 0);
    return {
      lat: 35 + (Math.abs(hash) % 1500) / 100,
      lng: -120 + (Math.abs(hash >> 8) % 3000) / 100,
      displayName: query,
    };
  }
}

export class NominatimGeocodingProvider implements GeocodingProvider {
  private lastRequestTime = 0;

  async geocode(query: string, options?: GeocodeOptions): Promise<GeocodingResult | null> {
    // Nominatim requires max 1 request per second
    const now = Date.now();
    const wait = Math.max(0, 1000 - (now - this.lastRequestTime));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestTime = Date.now();

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", cleanGeocodeQuery(query));
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    // Soft bias: prefer (but don't restrict to) a box around the proximity point.
    if (options?.proximity) {
      const { lat, lng } = options.proximity;
      const d = 1.5;
      url.searchParams.set("viewbox", `${lng - d},${lat - d},${lng + d},${lat + d}`);
    }

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Waypoint-TripPlanner/0.1" },
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.length) return null;

    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    };
  }
}

// Mapbox Search Box forward (`/search/searchbox/v1/forward`) — POI/business
// aware (unlike the address-centric Geocoding v6, which fuzzy-matches business
// names to the wrong place). Proximity-biased. Needs MAPBOX_TOKEN.
export class MapboxGeocodingProvider implements GeocodingProvider {
  // Accept a result within ~2.5° (~170mi) of the trip anchor as "near enough";
  // otherwise keep trimming the query looking for a closer match.
  private static NEAR_DEG = 2.5;

  constructor(private token: string | undefined) {}

  private async search(
    q: string,
    options?: GeocodeOptions
  ): Promise<GeocodingResult | null> {
    if (!this.token) return null;
    const url = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
    url.searchParams.set("q", q);
    url.searchParams.set("access_token", this.token);
    url.searchParams.set("limit", "1");
    if (options?.proximity) {
      url.searchParams.set(
        "proximity",
        `${options.proximity.lng},${options.proximity.lat}`
      );
    }
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const feature = (await res.json()).features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    const [lng, lat] = coords as [number, number];
    return {
      lat,
      lng,
      displayName: feature.properties?.full_address ?? feature.properties?.name ?? q,
    };
  }

  async geocode(query: string, options?: GeocodeOptions): Promise<GeocodingResult | null> {
    if (!this.token) return null;
    const prox = options?.proximity;
    const candidates = candidateQueries(query);

    // No anchor to judge by → take the most-specific match.
    if (!prox) {
      for (const c of candidates) {
        const r = await this.search(c, options);
        if (r) return r;
      }
      return null;
    }

    // With an anchor: geocode all candidates and pick the one NEAREST the trip.
    // (Picking the first within-threshold hit was wrong: "Cooke City, MT" matched
    // a vacation rental 1° off while the closer "Cooke City" was the real town.)
    let firstHit: GeocodingResult | null = null;
    let best: GeocodingResult | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const r = await this.search(c, options);
      if (!r) continue;
      if (!firstHit) firstHit = r;
      const d = Math.hypot(r.lat - prox.lat, r.lng - prox.lng);
      if (d <= MapboxGeocodingProvider.NEAR_DEG && d < bestDist) {
        best = r;
        bestDist = d;
      }
    }
    // Nearest near-the-trip match, else best-effort most-specific hit.
    return best ?? firstHit;
  }
}
