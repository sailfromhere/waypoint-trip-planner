import type { LatLng, RouteResult, RoutingProvider } from "./types";

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export class MockRoutingProvider implements RoutingProvider {
  async getRoute(waypoints: LatLng[]): Promise<RouteResult> {
    if (waypoints.length < 2) {
      return { legs: [], totalDistanceMeters: 0, totalDurationSeconds: 0 };
    }

    const legs = [];
    let totalDistance = 0;
    let totalDuration = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
      // Straight-line × 1.3 approximates road distance
      const straightLine = haversineMeters(waypoints[i], waypoints[i + 1]);
      const distanceMeters = Math.round(straightLine * 1.3);
      // Assume average 90 km/h (US highway driving)
      const durationSeconds = Math.round((distanceMeters / 90_000) * 3600);

      legs.push({
        origin: waypoints[i],
        destination: waypoints[i + 1],
        distanceMeters,
        durationSeconds,
      });
      totalDistance += distanceMeters;
      totalDuration += durationSeconds;
    }

    return {
      legs,
      totalDistanceMeters: totalDistance,
      totalDurationSeconds: totalDuration,
    };
  }
}

export class OsrmRoutingProvider implements RoutingProvider {
  constructor(private baseUrl = "https://router.project-osrm.org") {}

  async getRoute(waypoints: LatLng[]): Promise<RouteResult> {
    if (waypoints.length < 2) {
      return { legs: [], totalDistanceMeters: 0, totalDurationSeconds: 0 };
    }

    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    const url = `${this.baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`OSRM returned ${res.status}`);
    }

    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) {
      throw new Error("OSRM returned no routes");
    }

    const fullGeometry = route.geometry as GeoJSON.LineString | undefined;
    const legs = route.legs.map(
      (leg: { distance: number; duration: number }, i: number) => ({
        origin: waypoints[i],
        destination: waypoints[i + 1],
        distanceMeters: Math.round(leg.distance),
        durationSeconds: Math.round(leg.duration),
        geometry: fullGeometry && waypoints.length === 2 ? fullGeometry : undefined,
      })
    );

    return {
      legs,
      totalDistanceMeters: Math.round(route.distance),
      totalDurationSeconds: Math.round(route.duration),
    };
  }
}
