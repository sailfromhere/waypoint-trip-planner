declare module "tz-lookup" {
  /** Returns the IANA timezone name for a lat/lng (e.g. "America/New_York"). */
  export default function tzLookup(lat: number, lng: number): string;
}
