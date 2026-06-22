import { NextRequest, NextResponse } from "next/server";
import { geocoding } from "@/lib/integrations";

// Resolve a suggestion id (from /geocode/suggest) into concrete coordinates.
// Pairs with the same session token so Mapbox bills the suggest→retrieve as one
// search session.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const sessionToken = req.nextUrl.searchParams.get("session") ?? undefined;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const result = await geocoding.retrieve(id, { sessionToken });
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
