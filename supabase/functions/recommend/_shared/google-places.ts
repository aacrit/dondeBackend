/**
 * Live Google Place Details fetch for recommendation responses.
 * Fetches fresh data at request time — never stored in DB (Google ToS compliance).
 */

// ==========================================
// Google API Call Counter (per-request)
// ==========================================
let _googleDetailCalls = 0;
let _googlePhotoRefs = 0;

export interface GoogleCallStats {
  detail_calls: number;
  photo_refs: number;
  estimated_cost_usd: number;
}

/** Get current Google API call stats for this request cycle. */
export function getGoogleCallStats(): GoogleCallStats {
  // Place Details: $0.005/call, Place Photo: $0.007/call (when frontend loads the URL)
  const cost = _googleDetailCalls * 0.005 + _googlePhotoRefs * 0.007;
  return {
    detail_calls: _googleDetailCalls,
    photo_refs: _googlePhotoRefs,
    estimated_cost_usd: Math.round(cost * 1000) / 1000,
  };
}

/** Reset counters at the start of each request. */
export function resetGoogleCallStats(): void {
  _googleDetailCalls = 0;
  _googlePhotoRefs = 0;
}

export interface GooglePlaceData {
  name: string;
  address: string;
  phone: string | null;
  website: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  reviews: GoogleReviewData[];
  business_status: string | null; // Enhancement 20: OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY
  photo_urls: string[];
  opening_hours: {
    open_now: boolean | null;
    weekday_text: string[] | null;
  } | null;
  // Foxtrot: Additional fields from Places API (already included in Atmosphere pricing tier)
  reservable: boolean | null;
  serves_brunch: boolean | null;
  serves_vegetarian_food: boolean | null;
  dine_in: boolean | null;
  takeout: boolean | null;
  delivery: boolean | null;
}

export interface GoogleReviewData {
  rating: number;
  text: string;
}

// Enhancement 20: Added business_status to detect closed restaurants
// Cost note: Basic (name,address,business_status) = $0, Contact (phone,website) = $0.003, Atmosphere (rest) = $0.005
// Foxtrot: Added reservable, serves_brunch, serves_vegetarian_food, dine_in, takeout, delivery
// These are already included in the Atmosphere pricing tier ($0.005/call) — no additional cost
const PLACE_DETAILS_FIELDS =
  "name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,reviews,business_status,photos,opening_hours,current_opening_hours,reservable,serves_brunch,serves_vegetarian_food,dine_in,takeout,delivery";

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
    _googleDetailCalls++;

    const params = new URLSearchParams({
      place_id: placeId,
      fields: PLACE_DETAILS_FIELDS,
      key: apiKey,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let res: Response;
    try {
      res = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?${params}`,
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      console.error(`Google Places API error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (data.status && data.status !== "OK") {
      console.error(`Google Places API status: ${data.status}`, data.error_message || '');
      return null;
    }
    const result = data.result;
    if (!result) return null;

    const reviews: GoogleReviewData[] = (result.reviews || [])
      .slice(0, 5)
      .map((r: { rating: number; text: string }) => ({
        rating: r.rating,
        text: Array.from(r.text || "").slice(0, 300).join(""),
      }));

    // Extract photo URLs (max 5, 800px wide)
    const photoRefs: string[] = (result.photos || [])
      .slice(0, 5)
      .map((p: { photo_reference: string }) => p.photo_reference)
      .filter(Boolean)
      .map((ref: string) =>
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${apiKey}`
      );

    // Track photo refs — each URL will cost $0.007 when the frontend loads it
    _googlePhotoRefs += photoRefs.length;

    // Prefer current_opening_hours for live open_now accuracy
    const hours = result.current_opening_hours || result.opening_hours;
    const openingHours = hours
      ? {
          open_now: hours.open_now ?? null,
          weekday_text: hours.weekday_text || null,
        }
      : null;

    return {
      name: result.name || "",
      address: result.formatted_address || "",
      phone: result.formatted_phone_number || null,
      website: result.website || null,
      google_rating: result.rating || null,
      google_review_count: result.user_ratings_total || null,
      reviews,
      business_status: result.business_status || null,
      photo_urls: photoRefs,
      opening_hours: openingHours,
      // Foxtrot: Additional fields (already in Atmosphere tier, no extra cost)
      reservable: result.reservable ?? null,
      serves_brunch: result.serves_brunch ?? null,
      serves_vegetarian_food: result.serves_vegetarian_food ?? null,
      dine_in: result.dine_in ?? null,
      takeout: result.takeout ?? null,
      delivery: result.delivery ?? null,
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
