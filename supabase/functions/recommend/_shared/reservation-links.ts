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

export interface ReservationLinks {
  primary: ReservationLink | null;
  alternatives: ReservationLink[];
  fallback: ReservationFallback;
  reservation_difficulty: string | null;
  booking_tip: string | null;
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
 */
export function buildReservationLinks(
  reservationRows: ReservationRow[],
  phone: string | null,
  website: string | null,
  reservationDifficulty: string | null,
  params?: { date?: string; covers?: number; time?: string },
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

  return {
    primary,
    alternatives,
    fallback,
    reservation_difficulty: reservationDifficulty,
    booking_tip: generateBookingTip(
      reservationDifficulty,
      primary?.platform || null,
    ),
  };
}
