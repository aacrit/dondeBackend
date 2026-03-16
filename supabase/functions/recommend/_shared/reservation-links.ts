/**
 * Project Foxtrot — Reservation Link Builder
 *
 * Builds reservation deep links for restaurant recommendations.
 * Supports: Resy, OpenTable, Tock, Yelp, direct booking, phone fallback.
 *
 * Usage:
 *   const links = buildReservationLinks(restaurant, reservationRows, deepProfile);
 *   // Attach links.reservation_links to API response
 */

// ==========================================
// TYPES
// ==========================================

export interface ReservationRow {
  platform: string;
  platform_id: string | null;
  platform_slug: string | null;
  booking_url: string;
  url_template: string | null;
  priority: number;
  is_verified: boolean;
}

export interface ReservationLink {
  platform: string;
  url: string;
  display_name: string;
  supports_params: boolean;
}

export interface ReservationFallback {
  type: "phone" | "walk-in" | "website";
  value: string;
  display_name: string;
}

export interface AvailabilitySlot {
  time: string;       // "7:00 PM"
  type: string | null; // "Dining Room", "Bar", "Patio"
}

export interface ReservationLinks {
  primary: ReservationLink | null;
  alternatives: ReservationLink[];
  fallback: ReservationFallback;
  reservation_difficulty: string | null;
  booking_tip: string | null;
  availability: AvailabilitySlot[] | null; // Real-time slots (Resy)
}

// ==========================================
// PLATFORM DISPLAY NAMES
// ==========================================

const PLATFORM_DISPLAY: Record<string, string> = {
  resy: "Reserve on Resy",
  opentable: "Reserve on OpenTable",
  tock: "Reserve on Tock",
  yelp: "Reserve on Yelp",
  direct: "Book directly",
  phone: "Call for reservations",
};

// ==========================================
// SLUG GENERATORS (for future enrichment pipeline)
// ==========================================

/**
 * Generate a URL slug from a restaurant name.
 * "Girl & The Goat" → "girl-the-goat"
 * "Au Cheval" → "au-cheval"
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build a deep link URL for a specific platform using a template.
 * Substitutes {date}, {covers}, {time} placeholders.
 */
export function buildDeepLinkUrl(
  template: string,
  params?: { date?: string; covers?: number; time?: string }
): string {
  if (!params) return template;

  let url = template;
  if (params.date) url = url.replace("{date}", params.date);
  if (params.covers) url = url.replace("{covers}", String(params.covers));
  if (params.time) url = url.replace("{time}", params.time);

  // Remove unused placeholders
  url = url.replace(/[?&][^=]+=\{[^}]+\}/g, "");
  // Clean trailing ? or &
  url = url.replace(/[?&]$/, "");

  return url;
}

// ==========================================
// PLATFORM-SPECIFIC URL BUILDERS
// ==========================================

const PLATFORM_URL_BUILDERS: Record<string, (slug: string, id?: string | null) => { url: string; template: string }> = {
  resy: (slug: string) => ({
    url: `https://resy.com/cities/chi/${slug}`,
    template: `https://resy.com/cities/chi/${slug}?date={date}&seats={covers}`,
  }),
  opentable: (slug: string, id?: string | null) => ({
    url: id
      ? `https://www.opentable.com/r/${slug}?restref=${id}`
      : `https://www.opentable.com/r/${slug}`,
    template: id
      ? `https://www.opentable.com/r/${slug}?restref=${id}&datetime={date}T{time}&covers={covers}`
      : `https://www.opentable.com/r/${slug}?datetime={date}T{time}&covers={covers}`,
  }),
  tock: (slug: string) => ({
    url: `https://www.exploretock.com/${slug}`,
    template: `https://www.exploretock.com/${slug}`,
  }),
  yelp: (slug: string) => ({
    url: `https://www.yelp.com/reservations/${slug}-chicago`,
    template: `https://www.yelp.com/reservations/${slug}-chicago`,
  }),
};

// ==========================================
// BOOKING TIP GENERATOR
// ==========================================

function generateBookingTip(
  reservationDifficulty: string | null,
  platform: string | null,
): string | null {
  if (!reservationDifficulty) return null;

  const difficulty = reservationDifficulty.toLowerCase();
  if (difficulty === "required" || difficulty === "hard" || difficulty === "hard_to_get") {
    return "Book well in advance, especially for weekends.";
  }
  if (difficulty === "recommended") {
    return "Reservations recommended but walk-ins sometimes available.";
  }
  if (difficulty === "walk-in" || difficulty === "walk_in_friendly" || difficulty === "walk-in friendly") {
    return "Walk-in friendly, no reservation needed.";
  }

  return null;
}

// ==========================================
// RESY REAL-TIME AVAILABILITY (public client API, $0)
// ==========================================

const RESY_API_KEY = "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5";

/**
 * Check Resy real-time availability for a venue.
 * Uses Resy's public client API key (same as their website).
 * Returns up to 3 next available time slots.
 * Timeout: 2s (non-blocking, availability is a nice-to-have).
 */
export async function checkResyAvailability(
  resyVenueId: string,
  partySize = 2,
): Promise<AvailabilitySlot[]> {
  try {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch("https://api.resy.com/4/find", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `ResyAPI api_key="${RESY_API_KEY}"`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lat: 41.8781,
        long: -87.6298,
        day: today,
        party_size: partySize,
        venue_id: parseInt(resyVenueId, 10),
      }),
    });

    clearTimeout(timeout);
    if (!response.ok) return [];

    const data = await response.json();
    const venues = data?.results?.venues || [];
    if (venues.length === 0) return [];

    const slots = venues[0]?.slots || [];
    return slots.slice(0, 3).map((s: Record<string, unknown>) => {
      const start = (s.date as Record<string, string>)?.start || "";
      // Parse "2026-03-16 19:00:00" → "7:00 PM"
      let timeStr = "";
      if (start) {
        const timePart = start.split(" ")[1]; // "19:00:00"
        if (timePart) {
          const [h, m] = timePart.split(":");
          const hour = parseInt(h, 10);
          const ampm = hour >= 12 ? "PM" : "AM";
          const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
          timeStr = m === "00" ? `${h12} ${ampm}` : `${h12}:${m} ${ampm}`;
        }
      }
      const configType = (s.config as Record<string, string>)?.type || null;
      return { time: timeStr, type: configType };
    });
  } catch {
    return []; // Timeout or network error — availability is best-effort
  }
}

// ==========================================
// MAIN BUILDER
// ==========================================

/**
 * Build reservation links for a restaurant recommendation.
 *
 * @param reservationRows - Rows from restaurant_reservations table (already filtered by restaurant_id, is_active)
 * @param phone - Restaurant phone number (from Google Places or DB)
 * @param website - Restaurant website
 * @param reservationDifficulty - From deep_profile
 * @param params - Optional date/covers/time for parameterized deep links
 * @param googleReservable - Google Places "reservable" flag (Foxtrot: used as fallback booking tip)
 */
export function buildReservationLinks(
  reservationRows: ReservationRow[],
  phone: string | null,
  website: string | null,
  reservationDifficulty: string | null,
  params?: { date?: string; covers?: number; time?: string },
  googleReservable?: boolean | null,
): ReservationLinks {
  // Sort by priority (lower = better)
  const sorted = [...reservationRows].sort((a, b) => a.priority - b.priority);

  // Build links from DB rows
  const links: ReservationLink[] = sorted
    .filter((row) => row.platform !== "phone")
    .map((row) => {
      const url = row.url_template && params
        ? buildDeepLinkUrl(row.url_template, params)
        : row.booking_url;

      return {
        platform: row.platform,
        url,
        display_name: PLATFORM_DISPLAY[row.platform] || `Reserve on ${row.platform}`,
        supports_params: !!row.url_template,
      };
    });

  // Primary = highest priority link, alternatives = rest
  const primary = links.length > 0 ? links[0] : null;
  const alternatives = links.slice(1);

  // Fallback: phone > website > walk-in message
  let fallback: ReservationFallback;
  if (phone) {
    fallback = {
      type: "phone",
      value: phone,
      display_name: "Call for reservations",
    };
  } else if (website) {
    fallback = {
      type: "website",
      value: website,
      display_name: "Visit website",
    };
  } else {
    fallback = {
      type: "walk-in",
      value: "",
      display_name: "Walk-in recommended",
    };
  }

  // Foxtrot: When no platform links exist but Google says reservable,
  // provide a helpful booking tip indicating Google Reserve availability
  let bookingTip = generateBookingTip(
    reservationDifficulty,
    primary?.platform || null,
  );
  if (!primary && googleReservable === true && !bookingTip) {
    bookingTip = "Reservations available via Google";
  }

  return {
    primary,
    alternatives,
    fallback,
    reservation_difficulty: reservationDifficulty,
    booking_tip: bookingTip,
    availability: null, // Populated async by caller when Resy venue ID available
  };
}
