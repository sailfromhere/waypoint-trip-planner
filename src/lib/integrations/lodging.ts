import type { LatLng, LodgingOption, LodgingProvider } from "./types";

export class MockLodgingProvider implements LodgingProvider {
  async search(
    location: LatLng,
    _checkIn: string,
    _checkOut: string,
    _guests: number
  ): Promise<LodgingOption[]> {
    return [
      {
        name: "Mountain View Lodge (mock)",
        location: { lat: location.lat + 0.01, lng: location.lng + 0.01 },
        pricePerNightCents: 15000,
        currency: "USD",
        type: "hotel",
        rating: 4.2,
      },
      {
        name: "Riverside Campground (mock)",
        location: { lat: location.lat - 0.005, lng: location.lng + 0.008 },
        pricePerNightCents: 3500,
        currency: "USD",
        type: "campground",
        rating: 4.5,
      },
      {
        name: "Cozy Cabin Retreat (mock)",
        location: { lat: location.lat + 0.02, lng: location.lng - 0.01 },
        pricePerNightCents: 22000,
        currency: "USD",
        type: "cabin",
        rating: 4.7,
      },
    ];
  }
}
