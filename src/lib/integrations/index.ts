import type { RoutingProvider, WeatherProvider, LodgingProvider } from "./types";
import type { GeocodingProvider } from "./geocoding";
import { MockRoutingProvider, OsrmRoutingProvider } from "./routing";
import { MockWeatherProvider, OpenMeteoWeatherProvider } from "./weather";
import { MockLodgingProvider } from "./lodging";
import {
  MockGeocodingProvider,
  NominatimGeocodingProvider,
  MapboxGeocodingProvider,
} from "./geocoding";

// ── The single binding swap point ──
// Change these to switch mock ↔ real. No other file needs to change.

function createRoutingProvider(): RoutingProvider {
  if (process.env.ROUTING_PROVIDER === "osrm") {
    return new OsrmRoutingProvider(process.env.OSRM_BASE_URL);
  }
  return new MockRoutingProvider();
}

function createWeatherProvider(): WeatherProvider {
  if (process.env.WEATHER_PROVIDER === "openmeteo") {
    return new OpenMeteoWeatherProvider();
  }
  return new MockWeatherProvider();
}

function createLodgingProvider(): LodgingProvider {
  return new MockLodgingProvider();
}

function createGeocodingProvider(): GeocodingProvider {
  if (process.env.GEOCODING_PROVIDER === "mapbox") {
    return new MapboxGeocodingProvider(process.env.MAPBOX_TOKEN);
  }
  if (process.env.GEOCODING_PROVIDER === "nominatim") {
    return new NominatimGeocodingProvider();
  }
  return new MockGeocodingProvider();
}

export const routing: RoutingProvider = createRoutingProvider();
export const weather: WeatherProvider = createWeatherProvider();
export const lodging: LodgingProvider = createLodgingProvider();
export const geocoding: GeocodingProvider = createGeocodingProvider();

export type { RoutingProvider, WeatherProvider, LodgingProvider } from "./types";
export type { LatLng, RouteResult, RouteLeg, DailyForecast, LodgingOption } from "./types";
export type { GeocodingProvider, GeocodingResult } from "./geocoding";
