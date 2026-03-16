# Project Foxtrot: $0 Cost Reservation Integration

Last updated: 2026-03-15

> **Objective:** Integrate reservation booking into DondeAI recommendations at $0 cost using deep links, affiliate programs, and free API tiers. Every recommendation should answer "Where should I eat?" AND "How do I book a table?"

---

## Executive Summary

DondeAI recommends restaurants but stops short of the booking action. Users must leave the app to find reservation options. Project Foxtrot bridges this gap using $0 integration paths: deep links (Tier 1), free API tiers (Tier 2), and future partnerships (Tier 3). The initial launch targets 1,200-1,500 of DondeAI's 2,720 Chicago restaurants with at least one reservation/booking link.

**Cost: $0.00 for Tier 1 launch. $0.00/month for Tier 2 (free API tiers). Future affiliate revenue potential: $500-2,000/month at scale.**

---

## Platform Research

### Reservation Platforms in Chicago

| Platform | Est. Chicago Coverage | Restaurant Type | Fee Model | Deep Link Available |
|----------|----------------------|-----------------|-----------|-------------------|
| **OpenTable** | 800-1,000 | Mid-range to upscale, chains | $1-7.50/cover to restaurant | YES |
| **Resy** | 200-400 | Upscale, trendy, chef-driven | Per-cover to restaurant | YES |
| **Tock** | 50-100 | Fine dining, ticketed | Ticket/prepaid to restaurant | YES |
| **Yelp Reservations** | 500-700 | Broad range | Per-cover to restaurant | YES |
| **Google Reserve** | 300-500 | Via partner platforms | Free (requires RwG partner) | Via Google Maps |
| **SevenRooms** | 100-200 | Upscale, hospitality groups | SaaS to restaurant | Widget/redirect |

**Total addressable:** ~1,200-1,500 unique restaurants across all platforms (many overlap).
**Walk-in only:** ~1,000-1,500 restaurants (casual, counter-service, holes-in-wall).

### Deep Link Specifications

#### OpenTable
```
Base URL:  https://www.opentable.com/r/{restaurant-slug}
With params: ?restref={restaurant-id}&datetime={YYYY-MM-DDTHH:MM}&covers={N}&ref=dondeai

Parameters:
  restref    - OpenTable restaurant ID (numeric)
  datetime   - ISO datetime for reservation
  covers     - Party size (integer)
  ref        - Referral tracking (free to add)

Mobile:    Opens OpenTable app if installed (iOS Universal Links / Android App Links)
Fallback:  Opens mobile web if app not installed
```

**Discovery method:** OpenTable restaurant IDs can be found via:
1. OpenTable Affiliate API (free signup) -- returns structured data
2. URL pattern on opentable.com (restaurant slug in URL)
3. Google Places data sometimes includes OpenTable booking links

#### Resy
```
Base URL:  https://resy.com/cities/chi/{restaurant-slug}
With params: ?date={YYYY-MM-DD}&seats={N}

Parameters:
  date    - Reservation date
  seats   - Party size (integer)

Mobile:    Opens Resy app if installed
Fallback:  Opens mobile web booking interface

Slug format: lowercase, hyphenated restaurant name
  "Girl & The Goat" -> "girl-the-goat"
  "Alinea" -> "alinea"
```

**Discovery method:** Resy venue slugs match restaurant names. Validation via HTTP HEAD request (200 = exists, 404 = not on Resy).

#### Tock
```
Base URL:  https://www.exploretock.com/{restaurant-slug}

Parameters:  None in URL (date/party selected on Tock page)

Mobile:    Opens Tock app or mobile web
Fallback:  Always works as web URL

Slug format: lowercase, hyphenated
  "Alinea" -> "alinea"
  "Smyth" -> "smyth"
```

**Discovery method:** Tock slugs match restaurant names. Primarily fine dining. Validation via HTTP HEAD.

#### Yelp Reservations
```
Base URL:  https://www.yelp.com/reservations/{restaurant-slug}-chicago

Parameters:
  date     - Via URL fragment or Yelp handles internally
  covers   - Via Yelp's inline widget

Mobile:    Opens Yelp app reservation flow
Fallback:  Mobile web inline booking

Slug format: restaurant name + city, lowercase, hyphenated
  "Au Cheval Chicago" -> "au-cheval-chicago"
```

**Discovery method:** Yelp Fusion API (free, 5,000 calls/day) returns `reservation_url` if restaurant accepts Yelp reservations.

#### Phone / Walk-in Fallback
```
For restaurants not on any reservation platform:
  Tel link:  tel:{phone-number}
  Message:   "Walk-in recommended" or "Call for reservations"

DondeAI already has:
  restaurant.phone       - Phone number
  restaurant.website     - Restaurant website (may have own booking)
  deep_context.reservation_difficulty - "Easy", "Moderate", "Hard", "Impossible"
```

---

## Integration Architecture

### Phase 1: Database Schema

New table: `restaurant_reservations`

```sql
CREATE TABLE restaurant_reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID REFERENCES restaurants(id) NOT NULL,
  platform TEXT NOT NULL,          -- 'opentable', 'resy', 'tock', 'yelp', 'direct', 'phone'
  platform_id TEXT,                -- Platform-specific restaurant ID
  platform_slug TEXT,              -- URL slug on platform
  booking_url TEXT NOT NULL,       -- Full deep link URL
  url_template TEXT,               -- URL with {date}, {covers} placeholders
  is_verified BOOLEAN DEFAULT false,  -- HTTP HEAD validated
  last_verified_at TIMESTAMPTZ,
  priority INTEGER DEFAULT 50,     -- Display priority (lower = preferred)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(restaurant_id, platform)
);

-- Index for fast lookup
CREATE INDEX idx_reservations_restaurant ON restaurant_reservations(restaurant_id) WHERE is_active = true;

-- Priority order: direct (10) > resy (20) > tock (25) > opentable (30) > yelp (40) > phone (50)
```

### Phase 2: API Response Extension

Add `reservation_links` to the V11 API response:

```json
{
  "restaurant": { "...existing fields..." },
  "reservation_links": {
    "primary": {
      "platform": "resy",
      "url": "https://resy.com/cities/chi/girl-the-goat?date=2026-03-15&seats=2",
      "display_name": "Reserve on Resy",
      "supports_params": true
    },
    "alternatives": [
      {
        "platform": "opentable",
        "url": "https://www.opentable.com/r/girl-and-the-goat-chicago",
        "display_name": "Reserve on OpenTable",
        "supports_params": true
      }
    ],
    "fallback": {
      "type": "phone",
      "value": "(312) 492-6262",
      "display_name": "Call for reservations"
    },
    "reservation_difficulty": "Moderate",
    "booking_tip": "Book 2-3 weeks ahead for weekends"
  }
}
```

**Contract notes:**
- `reservation_links` is a NEW optional field (backward compatible)
- `primary` is the highest-priority platform for this restaurant
- `alternatives` lists other available platforms
- `fallback` is always present (phone or "walk-in recommended")
- `reservation_difficulty` already exists in `deep_context`
- `booking_tip` derived from `review_intelligence` or `reservation_difficulty`

### Phase 3: Deep Link Builder Module

New shared module: `_shared/reservation-links.ts`

```typescript
interface ReservationLink {
  platform: string;
  url: string;
  display_name: string;
  supports_params: boolean;
}

interface ReservationLinks {
  primary: ReservationLink | null;
  alternatives: ReservationLink[];
  fallback: { type: string; value: string; display_name: string };
  reservation_difficulty: string | null;
  booking_tip: string | null;
}

// Priority: direct > resy > tock > opentable > yelp > phone
function buildReservationLinks(
  restaurant: Restaurant,
  reservations: ReservationRow[],
  occasion?: string,
  partySize?: number,
  date?: string
): ReservationLinks
```

### Phase 4: Platform Coverage Enrichment Pipeline

New pipeline: `scripts/pipelines/reservation-enrichment.ts`

**Approach:**
1. For each restaurant, generate candidate slugs for each platform
2. Validate via HTTP HEAD request (200 = confirmed, 404 = not available)
3. Store confirmed platform + slug + URL in `restaurant_reservations`
4. Mark as verified with timestamp

**Validation strategy (all $0):**
```
OpenTable:  HEAD https://www.opentable.com/r/{slug} -> check for 200
Resy:       HEAD https://resy.com/cities/chi/{slug} -> check for 200
Tock:       HEAD https://www.exploretock.com/{slug} -> check for 200
Yelp:       Yelp Fusion API business match -> check reservation_url field
```

**Rate limiting:** 1 request/second per platform. Full scan of 2,720 restaurants takes ~45 min per platform.

**Re-verification schedule:** Monthly (restaurants change platforms).

---

## Implementation Plan

### Milestone 1: Schema + Deep Links (Week 1)
- [ ] Create `restaurant_reservations` migration
- [ ] Build `reservation-links.ts` module
- [ ] Implement slug generation logic per platform
- [ ] Add `reservation_links` to response builder
- [ ] Unit tests for URL generation

**Effort:** 1 day. **Cost:** $0. **Risk:** Low.

### Milestone 2: Platform Coverage Scan (Week 1-2)
- [ ] Build `reservation-enrichment.ts` pipeline
- [ ] Run validation scan for OpenTable (highest coverage)
- [ ] Run validation scan for Resy (highest value)
- [ ] Run validation scan for Tock (fine dining)
- [ ] Run validation scan for Yelp (via Fusion API)
- [ ] Populate `restaurant_reservations` table

**Effort:** 2 days. **Cost:** $0. **Risk:** Low (HTTP HEAD requests only).

### Milestone 3: API Integration (Week 2)
- [ ] Wire `reservation_links` into V11 response
- [ ] Add reservation data to response-builder-v9.ts
- [ ] Test with golden dataset (reservation links should not affect scoring)
- [ ] Deploy edge function update

**Effort:** 1 day. **Cost:** $0. **Risk:** Low (additive field, backward compatible).

### Milestone 4: Frontend Display (Week 2-3)
- [ ] "Reserve" button component in recommendation card
- [ ] Platform logo/icon display
- [ ] Reservation difficulty badge
- [ ] Booking tip display
- [ ] Mobile deep link handling (app open vs web)

**Effort:** 2 days. **Cost:** $0. **Risk:** Low (frontend-only changes).

### Milestone 5: Affiliate Setup (Week 3-4)
- [ ] Sign up for OpenTable affiliate program
- [ ] Add tracking parameters to OpenTable links
- [ ] Implement click tracking (which platform, which restaurant)
- [ ] Revenue reporting dashboard

**Effort:** 1 day. **Cost:** $0. **Revenue potential:** $0.25-1.00 per completed reservation.

---

## Revenue Model

### Affiliate Revenue Projections

| Scenario | Monthly Users | Reservation Clicks | Completed Bookings | Rev/Booking | Monthly Revenue |
|----------|--------------|--------------------|--------------------|-------------|-----------------|
| Launch | 1,000 | 300 | 50 | $0.50 | $25 |
| Growth | 10,000 | 3,000 | 500 | $0.50 | $250 |
| Scale | 100,000 | 30,000 | 5,000 | $0.50 | $2,500 |

**Assumptions:** 30% of users click a reservation link. ~15% of clicks convert to completed reservation. $0.50 avg affiliate revenue per completed booking (OpenTable range: $0.25-$1.00).

### Non-Revenue Value

Even without affiliate revenue, reservation integration delivers:
1. **Higher engagement:** Users complete the full journey within DondeAI ecosystem
2. **Competitive parity:** Yelp, Google Maps, and The Infatuation all offer booking
3. **Data signal:** Reservation clicks indicate user satisfaction (implicit positive feedback)
4. **Retention:** Users return because DondeAI is a complete solution

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Platform changes URL format | Low | Medium | Monthly re-verification scan |
| Platform blocks deep linking | Very Low | Medium | Multiple platform fallbacks |
| Restaurant leaves platform | Low | Low | Multi-platform coverage + phone fallback |
| Affiliate program terms change | Low | Low | Revenue is bonus, not dependency |
| Users confused by external redirect | Medium | Low | Clear "opens in [Platform]" UI copy |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Platform coverage | 1,200+ restaurants with at least 1 link | `restaurant_reservations` count |
| Reservation click rate | 20%+ of recommendations | Click tracking |
| User satisfaction | No increase in bounce rate | Analytics |
| Revenue (M3+) | $100+/month from affiliates | Affiliate dashboard |
| Data freshness | 95%+ links valid | Monthly re-verification |

---

## Team Assignment

| Task | Agent | Division |
|------|-------|----------|
| Research lead | `reservation-integration-specialist` | Integrations |
| Schema + migration | `db-reviewer` | Infrastructure |
| Pipeline development | `reservation-integration-specialist` | Integrations |
| API response integration | `bug-fixer` or COO | Quality |
| Frontend "Reserve" button | `frontend-builder` | Frontend |
| Testing | `continuous-tester` | Quality |
| Documentation | `update-docs` | Infrastructure |

---

## Appendix: Platform-Specific Notes

### OpenTable
- Largest platform by Chicago coverage
- Affiliate API provides structured restaurant search with IDs
- Revenue share is the most mature affiliate program in the space
- Restaurants pay $1-7.50 per seated diner (varies by plan)
- DondeAI affiliates earn a share of this fee

### Resy
- Preferred by upscale and chef-driven restaurants
- American Express owns Resy (acquired 2019)
- Strong Chicago presence: Girl & The Goat, Alinea (also Tock), Smyth, etc.
- Partner API available but requires business relationship
- Deep links work without API key

### Tock
- Chicago-born platform (founded by Nick Kokonas of Alinea)
- Specializes in ticketed/prepaid dining experiences
- Small but high-value restaurant set
- Deep links always work
- No formal affiliate program

### Yelp Reservations
- Integrated into Yelp business pages
- Powered by Yelp's own reservation system or partner (SeatMe)
- Coverage overlaps significantly with OpenTable
- Yelp Fusion API (free) can verify reservation availability

### Google Reserve (Reserve with Google)
- Booking directly from Google Search/Maps
- Powered by partner platforms (OpenTable, Resy, etc.)
- Not a direct integration path for DondeAI
- But DondeAI's Google Place IDs enable "Reserve" button attribution

---

**THE BOTTOM LINE:** Reservation integration is achievable at $0 cost using deep links to Resy, OpenTable, Tock, and Yelp. The first 1,200+ restaurants can have booking links within 2 weeks, turning DondeAI from a recommendation engine into a complete dining assistant.
