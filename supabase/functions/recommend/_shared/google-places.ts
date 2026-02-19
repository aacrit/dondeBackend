/**
 * Live Google Place Details fetch for recommendation responses.
 * Fetches fresh data at request time — never stored in DB (Google ToS compliance).
 */

export interface GooglePlaceData {
  name: string;
  address: string;
  phone: string | null;
  website: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  reviews: GoogleReviewData[];
  business_status: string | null; // Enhancement 20: OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY
}

export interface GoogleReviewData {
  rating: number;
  text: string;
}

// Enhancement 20: Added business_status to detect closed restaurants
const PLACE_DETAILS_FIELDS =
  "name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,reviews,business_status";

/**
 * Fetch fresh Google Place Details for a single restaurant.
 * Used at recommendation time for the chosen restaurant only.
 */
export async function fetchPlaceDetails(
  placeId: string
): Promise<GooglePlaceData | null> {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) {
    console.error("Missing GOOGLE_PLACES_API_KEY");
    return null;
  }

  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: PLACE_DETAILS_FIELDS,
      key: apiKey,
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );

    if (!res.ok) {
      console.error(`Google Places API error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const result = data.result;
    if (!result) return null;

    const reviews: GoogleReviewData[] = (result.reviews || [])
      .slice(0, 5)
      .map((r: { rating: number; text: string }) => ({
        rating: r.rating,
        text: (r.text || "").substring(0, 300),
      }));

    return {
      name: result.name || "",
      address: result.formatted_address || "",
      phone: result.formatted_phone_number || null,
      website: result.website || null,
      google_rating: result.rating || null,
      google_review_count: result.user_ratings_total || null,
      reviews,
      business_status: result.business_status || null,
    };
  } catch (err) {
    console.error(`Failed to fetch place details for ${placeId}:`, err);
    return null;
  }
}

/**
 * Build a review summary prompt snippet from fresh Google reviews.
 * Used to generate on-the-fly sentiment in the Claude recommendation prompt.
 */
export function formatReviewsForPrompt(reviews: GoogleReviewData[]): string {
  if (reviews.length === 0) return "No reviews available.";
  return reviews
    .map((r) => `${r.rating}/5: ${r.text}`)
    .join("\n");
}
