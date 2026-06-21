// ── Shared geo types ──

export interface LatLng {
  lat: number;
  lng: number;
}

// ── Routing ──

export interface RouteLeg {
  origin: LatLng;
  destination: LatLng;
  distanceMeters: number;
  durationSeconds: number;
  geometry?: GeoJSON.LineString;
}

export interface RouteResult {
  legs: RouteLeg[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
}

export interface RoutingProvider {
  getRoute(waypoints: LatLng[]): Promise<RouteResult>;
}

// ── Weather ──

export interface DailyForecast {
  date: string; // YYYY-MM-DD
  high: number; // °F
  low: number;
  precipitationChance: number; // 0-100
  summary: string;
}

export interface WeatherProvider {
  getForecast(location: LatLng, startDate: string, endDate: string): Promise<DailyForecast[]>;
}

// ── Lodging ──

export interface LodgingOption {
  name: string;
  location: LatLng;
  pricePerNightCents: number;
  currency: string;
  type: "hotel" | "motel" | "campground" | "cabin" | "airbnb" | "other";
  rating?: number;
  url?: string;
}

export interface LodgingProvider {
  search(location: LatLng, checkIn: string, checkOut: string, guests: number): Promise<LodgingOption[]>;
}
