import type { GooglePlaceSearchResult, GooglePlaceDetails } from "./types.js";

const API_KEY = () => {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("Missing GOOGLE_PLACES_API_KEY environment variable");
  return key;
};

export async function textSearch(
  query: string,
  location: { lat: number; lng: number },
  radius: number
): Promise<GooglePlaceSearchResult[]> {
  const params = new URLSearchParams({
    query,
    location: `${location.lat},${location.lng}`,
    radius: String(radius),
    key: API_KEY(),
  });

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`
  );
  const data = await res.json();
  return data.results || [];
}

export async function getPlaceDetails(
  placeId: string,
  fields = "name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,price_level,opening_hours,geometry,place_id"
): Promise<GooglePlaceDetails | null> {
  const params = new URLSearchParams({
    place_id: placeId,
    fields,
    key: API_KEY(),
  });

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?${params}`
  );
  const data = await res.json();
  return data.result || null;
}

export async function getPlaceReviews(
  placeId: string
): Promise<GooglePlaceDetails | null> {
  return getPlaceDetails(placeId, "reviews,name,place_id");
}
