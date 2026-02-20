/**
 * Pipeline: Enrichment V2 — Deep Restaurant Profiles
 *
 * Two-pass enrichment using Claude + live Google reviews for 35 nuanced fields.
 * Creates/updates rows in restaurant_deep_profiles table.
 *
 * Pass 1: Structured classification (service style, flavor profiles, atmosphere, logistics)
 * Pass 2: Narrative enrichment (origin story, signature dishes, best seat, unique selling point)
 *
 * Google reviews are fetched live and used only for enrichment context — never stored (ToS compliant).
 *
 * Schedule: Weekly (Sunday 6am UTC)
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// --- Types ---

interface StructuredEnrichment {
  restaurants: Array<{
    id: string;
    flavor_profiles: string[];
    cuisine_subcategory: string | null;
    menu_depth: string | null;
    spice_level: string | null;
    dietary_depth: string | null;
    service_style: string | null;
    meal_pacing: string | null;
    reservation_difficulty: string | null;
    typical_wait_minutes: number | null;
    group_size_min: number | null;
    group_size_max: number | null;
    check_average_per_person: number | null;
    tipping_culture: string | null;
    kid_friendliness: number | null;
    music_vibe: string | null;
    decor_style: string | null;
    conversation_friendliness: number | null;
    energy_level: number | null;
    seating_options: string[];
    instagram_worthiness: number | null;
    seasonal_relevance: { summer: number; winter: number; spring: number; fall: number } | null;
    cultural_authenticity: number | null;
    crowd_profile: string[];
    neighborhood_integration: string | null;
    chef_notable: boolean;
    awards_recognition: string[];
    wow_factors: string[];
    date_progression: string | null;
    ideal_weather: string[];
    transit_accessibility: string | null;
    byob_policy: string | null;
    payment_notes: string | null;
    confidence: number;
  }>;
}

interface NarrativeEnrichment {
  restaurants: Array<{
    id: string;
    origin_story: string | null;
    signature_dishes: Array<{ dish: string; why: string }>;
    best_seat_in_house: string | null;
    unique_selling_point: string | null;
  }>;
}

// --- Google Reviews (live fetch, never stored) ---

async function fetchLiveReviews(placeId: string): Promise<string[]> {
  if (!GOOGLE_API_KEY || !placeId) return [];
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "reviews",
      key: GOOGLE_API_KEY,
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );
    const data = await res.json();
    const reviews = data?.result?.reviews || [];
    return reviews
      .slice(0, 5)
      .map((r: { text?: string }) => r.text || "")
      .filter((t: string) => t.length > 10);
  } catch {
    return [];
  }
}

// --- Pass 1: Structured Classification ---

function buildPass1Prompt(
  batch: Array<{
    id: string;
    name: string;
    address: string;
    price_level: string | null;
    cuisine_type: string | null;
    noise_level: string | null;
    tags: string;
    neighborhood: string;
    reviews: string;
  }>
): string {
  const restaurantList = batch
    .map((r) => {
      let entry = `Restaurant: ${r.name} (ID: ${r.id})
Address: ${r.address}
Price: ${r.price_level || "N/A"} | Cuisine: ${r.cuisine_type || "N/A"} | Noise: ${r.noise_level || "N/A"}
Tags: ${r.tags || "N/A"}
Neighborhood: ${r.neighborhood || "N/A"}`;
      if (r.reviews) {
        entry += `\nRecent diner reviews:\n${r.reviews}`;
      }
      return entry;
    })
    .join("\n\n---\n\n");

  return `You are a Chicago restaurant expert with deep local knowledge. Analyze each restaurant using ALL available data (name, address, cuisine, tags, neighborhood context, and especially diner reviews). Provide precise, nuanced enrichment.

CRITICAL RULES:
- Use reviews as your primary source of truth. They contain real details about atmosphere, service, dishes, and experience.
- If reviews don't mention something and you can't confidently infer it from the restaurant's type/location, return null.
- Scores (0-10) should use the full range. A 5 is average. Reserve 8+ for genuinely exceptional. Below 3 = notably poor.
- We'd rather have null than a wrong guess. Accuracy > completeness.

For each restaurant provide:

1. flavor_profiles: Array of 2-4 dominant flavor/cooking descriptors. Examples: "umami-forward", "charred", "herbaceous", "bright-acidic", "smoky", "rich-buttery", "delicate", "bold-spiced", "sweet-savory", "fermented", "citrus-forward", "earthy". Base on cuisine and any dish mentions in reviews.
2. cuisine_subcategory: More specific than cuisine_type. E.g., "Neapolitan Pizza", "Northern Italian", "Oaxacan", "Sichuan", "Izakaya", "Nashville Hot Chicken", "New American", "Farm-to-Table". null if generic.
3. menu_depth: "focused" (under 15 items), "moderate" (15-40), "extensive" (40+)
4. spice_level: "mild", "moderate", "hot", "volcanic" — overall menu heat level
5. dietary_depth: "token" (1-2 options), "solid" (dedicated section), "dedicated" (major focus/all-vegan etc.)
6. service_style: "Full Table Service", "Counter", "Omakase", "Family Style", "Buffet", "Tasting Menu", "Fast Casual", "Bar Service"
7. meal_pacing: "quick_bite" (<30min), "relaxed" (30-60min), "leisurely" (60-90min), "ceremonial" (90min+)
8. reservation_difficulty: "walk_in_friendly", "recommended", "required", "hard_to_get"
9. typical_wait_minutes: Expected wait without reservation on a busy night. null if walk-in easy.
10. group_size_min / group_size_max: Ideal group size range (e.g., min=2 max=6 for a cozy bistro, min=4 max=12 for a family-style spot)
11. check_average_per_person: Dollar amount for food+drink per person (e.g., 25, 45, 85, 150)
12. tipping_culture: "standard", "included", "counter_tip", "no_tip"
13. kid_friendliness: 0-10 (10=actively courts families with kids menu/highchairs/coloring, 0=definitively adults-only)
14. music_vibe: "curated-playlist", "live-jazz", "live-band", "DJ", "no-music", "ambient", "tv-sports"
15. decor_style: Short descriptor. E.g., "industrial-chic", "classic-white-tablecloth", "hole-in-wall-authentic", "instagram-modern", "retro-diner", "minimalist-japanese", "colorful-cantina", "cozy-tavern"
16. conversation_friendliness: 0-10 (0=can't hear yourself think, 10=whisper-quiet)
17. energy_level: 0-10 (0=sleepy/empty, 10=electric/packed-buzzing)
18. seating_options: Array from: "bar", "booth", "communal", "private_room", "patio", "chefs_counter", "standard_table", "counter", "rooftop"
19. instagram_worthiness: 0-10 (10=every dish is photogenic + stunning interior, 0=purely functional)
20. seasonal_relevance: Object with summer/winter/spring/fall scores 1-10. A rooftop = high summer, low winter. A cozy fireplace spot = high winter.
21. cultural_authenticity: 0-10 (10=run by people from the culture, traditional techniques, community pillar. 0=superficial appropriation)
22. crowd_profile: Array from: "young_professionals", "foodies", "date_night_couples", "families", "tourists", "students", "industry_crowd", "locals_only", "after_work", "late_night_crowd"
23. neighborhood_integration: "institution" (been there 10+ years), "newcomer" (<2 years), "hidden_local" (known only to regulars), "destination" (people travel for it), "tourist_draw"
24. chef_notable: true if chef has noteworthy background (former fine dining, James Beard, etc.)
25. awards_recognition: Array of specific awards/recognition. Empty if none known.
26. wow_factors: Array from: "open_kitchen", "rooftop_skyline_view", "tableside_preparation", "secret_entrance", "live_cooking_show", "river_view", "lake_view", "historic_building", "celebrity_chef", "unique_decor", "speakeasy_vibe", "garden_dining", "fireplace", "chef_interaction"
27. date_progression: "first_date", "casual_weeknight", "anniversary", "proposal_worthy"
28. ideal_weather: Array from: "warm_sunny", "mild_evening", "rainy_cozy", "cold_comfort", "any"
29. transit_accessibility: "L-accessible", "bus-accessible", "car-recommended", "walkable-strip", "rideshare-recommended"
30. byob_policy: "full_byob", "byob_wine_only", "corkage_fee", "no_byob", "full_bar"
31. payment_notes: "Cash only", "All cards accepted", or null
32. confidence: 0.0-1.0 — how confident you are in this enrichment overall (1.0 = reviews confirmed everything, 0.3 = mostly guessing from name/address)

Return ONLY valid JSON (no markdown):
{
  "restaurants": [
    {
      "id": "uuid",
      "flavor_profiles": ["umami-forward", "charred"],
      "cuisine_subcategory": "Neapolitan Pizza",
      ...all fields...
      "confidence": 0.75
    }
  ]
}

Restaurants to analyze:

${restaurantList}`;
}

// --- Pass 2: Narrative Enrichment ---

function buildPass2Prompt(
  batch: Array<{
    id: string;
    name: string;
    address: string;
    cuisine_type: string | null;
    neighborhood: string;
    reviews: string;
    tags: string;
  }>
): string {
  const restaurantList = batch
    .map((r) => {
      let entry = `Restaurant: ${r.name} (ID: ${r.id})
Address: ${r.address} | Cuisine: ${r.cuisine_type || "N/A"}
Neighborhood: ${r.neighborhood || "N/A"}
Tags: ${r.tags || "N/A"}`;
      if (r.reviews) {
        entry += `\nRecent diner reviews:\n${r.reviews}`;
      }
      return entry;
    })
    .join("\n\n---\n\n");

  return `You are a food writer and Chicago insider. For each restaurant, write as if you've been there 20 times and know the owner personally. Every detail MUST be grounded in the reviews and metadata provided — do NOT invent specifics you can't verify.

For each restaurant provide:

1. origin_story: 1-2 sentences about the people behind the restaurant. Their background, what drove them to open, cultural roots. If reviews mention family-owned, a specific chef, or a cultural background, use that. If you can't ground it, return null. Examples:
   - "Third-generation family from Puebla — the grandmother's mole recipe is still the backbone of the menu."
   - "Two Alinea alums who wanted to do tasting-menu quality at neighborhood prices."
   - null (when you can't verify anything)

2. signature_dishes: Array of 1-3 dishes this place is KNOWN for. Each has "dish" (name) and "why" (what makes it special, 10 words max). ONLY include dishes specifically mentioned or strongly implied in reviews. If no reviews available, return empty array.
   Examples: [{"dish": "The Smashburger", "why": "double-patty with caramelized onions, the draw"}]

3. best_seat_in_house: One sentence of specific, actionable seating advice. Ground in reviews or layout knowledge. If reviews mention a patio, bar, window, booth, counter — use that. If no info, return null.
   Examples:
   - "Grab a seat at the chef's counter — you'll watch them pull noodles to order."
   - "The back patio is the move on warm nights — quieter than inside."
   - null

4. unique_selling_point: One sentence — what makes this place irreplaceable. What can you get HERE that you can't get anywhere else in Chicago? If nothing truly unique, return null.
   Examples:
   - "The only place in Chicago doing hand-pulled Lanzhou noodles in-house."
   - "Full BYOB with no corkage fee and a menu that rivals spots charging three times the price."
   - null

Return ONLY valid JSON (no markdown):
{
  "restaurants": [
    {
      "id": "uuid",
      "origin_story": "...",
      "signature_dishes": [{"dish": "...", "why": "..."}],
      "best_seat_in_house": "...",
      "unique_selling_point": "..."
    }
  ]
}

Restaurants:

${restaurantList}`;
}

// --- Main ---

async function main() {
  console.log("=== Enrichment V2 Pipeline (Deep Profiles) ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Find restaurants without deep profiles
  const { data: existingProfiles, error: epErr } = await supabase
    .from("restaurant_deep_profiles")
    .select("restaurant_id");
  if (epErr) throw epErr;

  const enrichedIds = new Set(
    (existingProfiles || []).map((p) => p.restaurant_id)
  );

  // Get all active restaurants with their basic data
  const { data: restaurants, error: rErr } = await supabase
    .from("restaurants")
    .select("id, name, address, price_level, cuisine_type, noise_level, google_place_id, neighborhood_id")
    .eq("is_active", true)
    .not("noise_level", "is", null);
  if (rErr) throw rErr;

  // Get tags for context
  const { data: allTags, error: tErr } = await supabase
    .from("tags")
    .select("restaurant_id, tag_text");
  if (tErr) throw tErr;

  const tagsByRestaurant = new Map<string, string[]>();
  for (const t of allTags || []) {
    const existing = tagsByRestaurant.get(t.restaurant_id) || [];
    existing.push(t.tag_text);
    tagsByRestaurant.set(t.restaurant_id, existing);
  }

  // Get neighborhoods for context
  const { data: neighborhoods, error: nErr } = await supabase
    .from("neighborhoods")
    .select("id, name, description");
  if (nErr) throw nErr;

  const neighborhoodMap = new Map<string, { name: string; description: string | null }>();
  for (const n of neighborhoods || []) {
    neighborhoodMap.set(n.id, { name: n.name, description: n.description });
  }

  const needsEnrichment = (restaurants || []).filter((r) => !enrichedIds.has(r.id));

  if (needsEnrichment.length === 0) {
    console.log("All restaurants have deep profiles. Done.");
    return;
  }

  console.log(`Found ${needsEnrichment.length} restaurants needing deep profiles`);

  // Process in batches of 5 (smaller batches = richer per-restaurant context with reviews)
  await processBatches(needsEnrichment, 5, async (batch) => {
    // Fetch live Google reviews for enrichment context (not stored)
    const reviewPromises = batch.map((r) =>
      r.google_place_id ? fetchLiveReviews(r.google_place_id) : Promise.resolve([])
    );
    const reviewResults = await Promise.all(reviewPromises);

    const enrichmentBatch = batch.map((r, i) => {
      const nbh = r.neighborhood_id ? neighborhoodMap.get(r.neighborhood_id) : null;
      const tags = tagsByRestaurant.get(r.id) || [];
      const reviews = reviewResults[i];
      return {
        id: r.id,
        name: r.name,
        address: r.address,
        price_level: r.price_level,
        cuisine_type: r.cuisine_type,
        noise_level: r.noise_level,
        tags: tags.join(", "),
        neighborhood: nbh ? `${nbh.name}${nbh.description ? ` — ${nbh.description}` : ""}` : "N/A",
        reviews: reviews.length > 0
          ? reviews.map((rv, j) => `Review ${j + 1}: ${rv}`).join("\n")
          : "",
      };
    });

    // --- Pass 1: Structured Classification ---
    let structuredData: StructuredEnrichment | null = null;
    try {
      const pass1Prompt = buildPass1Prompt(enrichmentBatch);
      const pass1Response = await askClaude(pass1Prompt, {
        model: "claude-sonnet-4-6",
        maxTokens: 8192,
        temperature: 0.2,
      });
      structuredData = parseJsonResponse<StructuredEnrichment>(pass1Response);
    } catch (err) {
      console.error("Pass 1 failed for batch:", err);
    }

    // --- Pass 2: Narrative Enrichment ---
    let narrativeData: NarrativeEnrichment | null = null;
    try {
      const pass2Prompt = buildPass2Prompt(enrichmentBatch);
      const pass2Response = await askClaude(pass2Prompt, {
        model: "claude-sonnet-4-6",
        maxTokens: 4096,
        temperature: 0.4, // slightly more creative for narrative
      });
      narrativeData = parseJsonResponse<NarrativeEnrichment>(pass2Response);
    } catch (err) {
      console.error("Pass 2 failed for batch:", err);
    }

    // --- Merge and Upsert ---
    for (const r of batch) {
      const structured = structuredData?.restaurants.find(
        (s) => s.id === r.id
      );
      const narrative = narrativeData?.restaurants.find(
        (n) => n.id === r.id
      );

      if (!structured && !narrative) {
        console.warn(`  No enrichment data for ${r.name}, skipping`);
        continue;
      }

      const groupSizeRange = structured?.group_size_min != null && structured?.group_size_max != null
        ? `[${structured.group_size_min},${structured.group_size_max})`
        : null;

      const row = {
        restaurant_id: r.id,
        // Pass 1: Structured
        flavor_profiles: structured?.flavor_profiles || null,
        cuisine_subcategory: structured?.cuisine_subcategory || null,
        menu_depth: structured?.menu_depth || null,
        spice_level: structured?.spice_level || null,
        dietary_depth: structured?.dietary_depth || null,
        service_style: structured?.service_style || null,
        meal_pacing: structured?.meal_pacing || null,
        reservation_difficulty: structured?.reservation_difficulty || null,
        typical_wait_minutes: structured?.typical_wait_minutes || null,
        group_size_sweet_spot: groupSizeRange,
        check_average_per_person: structured?.check_average_per_person || null,
        tipping_culture: structured?.tipping_culture || null,
        kid_friendliness: structured?.kid_friendliness || null,
        music_vibe: structured?.music_vibe || null,
        decor_style: structured?.decor_style || null,
        conversation_friendliness: structured?.conversation_friendliness || null,
        energy_level: structured?.energy_level || null,
        seating_options: structured?.seating_options || null,
        instagram_worthiness: structured?.instagram_worthiness || null,
        seasonal_relevance: structured?.seasonal_relevance || null,
        cultural_authenticity: structured?.cultural_authenticity || null,
        crowd_profile: structured?.crowd_profile || null,
        neighborhood_integration: structured?.neighborhood_integration || null,
        chef_notable: structured?.chef_notable || false,
        awards_recognition: structured?.awards_recognition || null,
        wow_factors: structured?.wow_factors || null,
        date_progression: structured?.date_progression || null,
        ideal_weather: structured?.ideal_weather || null,
        transit_accessibility: structured?.transit_accessibility || null,
        byob_policy: structured?.byob_policy || null,
        payment_notes: structured?.payment_notes || null,
        // Pass 2: Narrative
        origin_story: narrative?.origin_story || null,
        signature_dishes: narrative?.signature_dishes || null,
        best_seat_in_house: narrative?.best_seat_in_house || null,
        unique_selling_point: narrative?.unique_selling_point || null,
        // Meta
        enriched_at: new Date().toISOString(),
        enrichment_version: 2,
        enrichment_confidence: structured?.confidence || null,
      };

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would upsert deep profile for ${r.name} (confidence: ${row.enrichment_confidence})`);
        continue;
      }

      const { error: upsertError } = await supabase
        .from("restaurant_deep_profiles")
        .upsert(row, { onConflict: "restaurant_id" });

      if (upsertError) {
        console.error(`  Failed to upsert deep profile for ${r.name}:`, upsertError);
      } else {
        console.log(`  Enriched: ${r.name} (confidence: ${row.enrichment_confidence})`);
      }
    }
  }, 2000); // 2s delay between batches for API rate limits

  console.log("Enrichment V2 pipeline complete.");
}

main().catch((err) => {
  console.error("Enrichment V2 pipeline failed:", err);
  process.exit(1);
});
