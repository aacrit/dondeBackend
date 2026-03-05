# DondeAI Engine Case Studies

Documented test scenarios with real results, root-cause analysis, and engine gaps.
These case studies serve as regression inputs — use them to verify engine behavior after changes.

---

## CS-001: After-Hours Dining (Try 1)

**Date:** 2026-02-27
**Query:** Late-night / after-hours dining
**Filters:** Open Now toggle ON

### Observed Behavior

- Engine returned a restaurant that closes at **10:00 PM**
- For an "after-hours" request, user expected places open past 11 PM or midnight
- Score appeared reasonable (mid-to-high match) despite the timing mismatch

### Expected Behavior

- Restaurants closing at 10 PM should be penalized or filtered out for after-hours queries
- Results should prioritize places open past 11 PM / midnight

### Verdict: **FAIL** — Timing mismatch not caught

---

## CS-002: After-Hours Dining (Try 2)

**Date:** 2026-02-27
**Query:** Late-night / after-hours dining (second attempt)
**Filters:** Open Now toggle ON

### Observed Behavior

- Again returned a restaurant that closes at **10:00 PM**
- Same pattern as CS-001 — engine does not distinguish between "open right now" and "open late"
- Two consecutive after-hours queries, two 10 PM closers

### Expected Behavior

- Same as CS-001: true late-night options (11 PM+ closing)

### Verdict: **FAIL** — Systematic, not a one-off

---

## Root Cause Analysis: After-Hours Gap

### The Problem

The engine has **no mechanism** to filter or score based on actual closing times. Two separate systems are involved, and neither addresses the gap:

### 1. `best_times` Tagging (Enrichment Phase)

**File:** `scripts/pipelines/enrichment.ts` (line 93)

```
15. best_times: Array of time-of-day labels when this restaurant shines.
    Options: "breakfast", "lunch", "dinner", "late_night", "brunch_weekend"
```

**Gap:** Claude assigns `best_times` based on **name, address, and price level only**. No operating hours data is provided. A restaurant could be tagged `["late_night"]` based on vibe (e.g., "it's a taqueria") even though it closes at 9:30 PM. Conversely, a fine-dining spot open until 1 AM might only get `["dinner"]`.

### 2. `open_now` Filter (Live Request Phase)

**File:** `supabase/functions/recommend/_shared/filter-pipeline-v5.ts` (lines 207-223)

```typescript
if (context.openNow && context.openNowData) {
  filtered = filtered.filter(r => {
    const status = context.openNowData!.get(r.id);
    return status !== false;  // Only checks: open RIGHT NOW
  });
}
```

**Gap:** This is a binary **present-moment** check. If the user searches at 9:30 PM, a restaurant closing at 10 PM passes the filter — it's technically "open now." But it's not what "after-hours dining" means.

### 3. Convenience Scoring

**File:** `supabase/functions/recommend/_shared/scoring-v3.ts` (lines 1126-1139)

```typescript
if (profile.best_times.includes(timeOfDay)) {
  score += 2.0;   // Bonus for matching time_of_day
} else if (profile.best_times.length <= 2) {
  score -= 2;     // Narrow-focus penalty
}
```

**Gap:** Scoring is entirely based on the `best_times` array — which is itself unreliable (see point 1). No actual closing-time data enters the scoring pipeline.

### 4. Dynamic Weights

**File:** `supabase/functions/recommend/_shared/weight-config-v5.ts` (lines 172-175)

```typescript
{ condition: { timeOfDay: "late_night" },
  deltas: { convenience: +0.08, vibe: +0.05 },
  label: "Late night: open late matters most" }
```

The label says "open late matters most" but the mechanism only boosts the Convenience weight — which itself relies on the unreliable `best_times` tag. The system describes intent it cannot deliver.

### What's Missing

| Data Available | Used in Scoring? | Gap |
|---|---|---|
| Google `opening_hours.weekday_text` (e.g., "Mon: 11am-10pm") | No | Never parsed for closing times |
| Google `opening_hours.periods` (structured hour blocks) | Not fetched | Would provide machine-readable closing times |
| Google `open_now` boolean | Yes (filter only) | Only tells "now," not "until when" |
| `best_times` enrichment tag | Yes (convenience score) | Assigned without actual hours data |

### Recommended Fixes

1. **Enrichment:** Pass Google `weekday_text` to Claude during enrichment so `best_times: ["late_night"]` is grounded in actual hours
2. **New field:** Store parsed `latest_closing_hour` (e.g., `22`, `24`, `2`) per restaurant
3. **Scoring:** For `time_of_day=late_night`, add a convenience penalty if `latest_closing_hour < 23`
4. **Filter:** For after-hours/late-night queries, hard-filter restaurants closing before 11 PM (when hour data is available)

---

## UI Issues Observed During Case Studies

### CS-UI-001: "Great Vibe" Signal Chip Redundant

**Date:** 2026-02-27
**Observation:** The "Great Vibe" chip appeared above the one-liner alongside the Google Rating chip. Since vibe is already embedded in the donde match score, this chip adds no new information and wastes card real estate.
**Fix:** Removed "Great Vibe" from signal chips. Vibe signal is reflected in the composite match score.

### CS-UI-002: Match Headline Styling Mismatch

**Date:** 2026-02-27
**Observation:** The match headline ("Why this spot...") was rendered in Playfair Display italic inside the name/tags row. This didn't match the clean structural voice used throughout the rest of the card.
**Fix:** Moved headline below the score mini (full-width within tier-glance). Restyled from emotional italic (Playfair) to structural medium (Inter sans-serif) to match the app's data-forward design language.

---

## How to Use These Case Studies

### Regression Testing

Run these queries against the engine and verify:

```
# CS-001 / CS-002: After-hours dining
POST /recommend
{
  "special_request": "late night dinner after hours",
  "time_of_day": "late_night",
  "open_now": true
}

# Verify: returned restaurant closing_hour >= 23
# Check: scoring_v5.convenience reflects actual late-night suitability
```

### Generating Similar Inputs

Use these patterns to create variants that probe the same gap:

| Variant | Query | Expected Closing |
|---|---|---|
| Late-night tacos | "late night tacos" | >= 11 PM |
| After-party food | "food after midnight" | >= 12 AM |
| Post-show dinner | "dinner after a show, around 11pm" | >= 11 PM |
| Late-night date | "late night date spot" | >= 11 PM |
| 2 AM cravings | "where can I eat at 2am" | >= 2 AM |
| Night owl brunch | "midnight breakfast" | >= 12 AM |

### Scoring Audit Template

For each result, capture:
- `restaurant.name`
- `restaurant.opening_hours.weekday_text` (actual closing time)
- `scoring_v5.convenience` (should correlate with actual late-night availability)
- `best_times` from restaurant profile (should be validated against real hours)
- `match_headline` (should not claim "late-night" if place closes at 10 PM)
