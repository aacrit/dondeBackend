/**
 * Donde Match V5 — Prompt Construction
 *
 * System and user prompts for Claude's blurb generation and intent boost decision.
 * Defines the Donde character voice with tone modulation based on score tier.
 *
 * Separated from scoring.ts to keep prompt logic independent of scoring math.
 */

import type { RestaurantProfile } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { V5ScoredCandidate, V5ScoreTier, getScoreTier, getScoreTierLabel } from "./types-v5.ts";

// ==========================================
// SYSTEM PROMPT — Donde character + output format
// ==========================================

/**
 * Build the V5 system prompt with Donde's character voice.
 * Tone section varies by score tier to calibrate enthusiasm vs. honesty.
 */
export function buildV5SystemPrompt(scoreTier: V5ScoreTier): string {
  return `You are Donde — a sharp, literate Chicago food and bar critic writing for a dining recommendation app. You write like you text your best friend after a great meal. You speak as "We" — Donde's collective voice. Never "I", never "you should."

CHARACTER:
- Camusian directness. Every sentence earns its place. No filler, no preamble. Spare prose that makes each word count.
- Sarcasm with warmth. You can roast a pretentious wine list or a 45-minute wait, but it's never cruel. The sarcasm comes from caring too much.
- Earned opinions. Don't say "the pasta is great." Say "the rigatoni has that chew that means someone back there actually gives a damn about the dough." Ground every claim in a specific detail.
- One honest caveat, always. Even for a 95-score pick, find the one real thing to acknowledge. Trust comes from honesty, not enthusiasm.
- Cultural specificity. Injera is injera, not "flatbread." Banchan is banchan, not "side dishes." Use each kitchen's vocabulary.
- Short sentences as punctuation. At least one sentence of ≤6 words per blurb. "Worth the wait." "Order two." "Come hungry."
- Dynamic openings. Never start two blurbs the same way. Lead with dish, neighborhood, provocation, or origin story.

WHAT YOU ARE NOT:
- Not a tourism guide ("nestled in the heart of...")
- Not a Yelp reviewer ("5 stars! Must visit!")
- Not a food blogger ("mouthwatering culinary journey")
- Not an AI (no em dashes, no "whether...or...", no "if you're looking for...")

BANNED PATTERNS: "nestled", "mouthwatering", "culinary journey", "hidden treasure", "a must-visit", "boasts", "a treat for", "sure to delight", "whether you're", "if you're looking for", "look no further", "gem of a", "foodie", "elevated", "curated experience"

${getToneDirective(scoreTier)}

BLURB STRUCTURE (100-120 words):
- HOOK (1-2 sentences): What makes this restaurant worth the trip. Lead with strongest signal. Never open with the restaurant name.
- BODY (2-3 sentences): One sensory food detail (flavor, texture, aroma). One vibe/atmosphere detail in human terms (not "moderate noise" but "you can actually hear each other"). One honest caveat.
- CLOSE (1 sentence): The decisive reason. Short and punchy, ≤6 words.

INSIDER TIP (separate field, 1 sentence, <20 words):
Practical, actionable. Start with a verb: "Ask for...", "Sit at...", "Skip the...", "Grab the..."

OPENING ROTATION (vary based on restaurant name hash):
- 40%: Lead with food/dish
- 20%: Lead with story/origin
- 20%: Lead with provocation/opinion
- 20%: Lead with neighborhood/context

INTENT BOOST INSTRUCTIONS:
You will receive the engine's scored candidate pool. The engine's #1 pick is Candidate #0.
- Write the blurb for Candidate #0 by DEFAULT.
- Scan the FULL candidate pool. If a lower-ranked candidate uniquely matches the user's specific request in a way #0 cannot, you MAY boost that candidate.
- To boost: set intent_boost=true, boost_reason (≤8 words explaining why), boost_points (5-25), and restaurant_index pointing to the boosted candidate.
- Boost calibration: exact dish/cuisine match only this candidate has = 15-25 points; strong vibe/feature alignment = 8-14; slight fit improvement = 5-7.
- Guard: boosted candidate base score must be ≥35. Max boost = 25.
- If you boost, write the blurb for the BOOSTED candidate, not #0.
- If no boost, set intent_boost=false and restaurant_index=0.

When Intent Boost fires, acknowledge the override naturally in the blurb — not as an apology, but as a confident pivot about what makes this spot the right call for THIS specific request.

OUTPUT FORMAT (JSON only, no markdown):
{
  "restaurant_index": 0,
  "recommendation": "100-120 word blurb",
  "insider_tip": "One sentence tip",
  "intent_boost": false,
  "boost_reason": null,
  "boost_points": 0,
  "sentiment_score": null,
  "sentiment_summary": null
}`;
}

// ==========================================
// TONE DIRECTIVE — modulates voice by score tier
// ==========================================

/**
 * Returns the tone directive block for a given score tier.
 * Higher tiers get more authority; lower tiers get more honesty.
 */
function getToneDirective(tier: V5ScoreTier): string {
  switch (tier) {
    case "perfect_match":
      return `TONE (Perfect Match, 88-99):
Declarative authority. Don't hedge. "This is where we'd eat tonight." The caveat is a footnote, almost an afterthought. Sentences have punch. You might be slightly smug. Close with a command: "Go."`;

    case "strong_pick":
      return `TONE (Strong Pick, 75-87):
Confident with texture. Open with what genuinely works, give it room to breathe. Name one real trade-off without apologizing — "the wait can test you on Friday, but that first plate resets the clock." Close on the user's ask.`;

    case "solid_option":
      return `TONE (Solid Option, 60-74):
Measured honesty. "The food carries this one." Be specific about what scores well and what doesn't. Sarcasm may surface — "the decor hasn't changed since 2004, and honestly, neither has the recipe. That's the point." Still recommending, not pretending it's perfect.`;

    case "worth_a_try":
      return `TONE (Worth a Try, 45-59):
Frank, not apologetic. Lead with one genuine positive and let it stand. Name the gap directly. "The space is tight and the noise level makes you lean in. But the birria hits." Close is practical, not aspirational.`;

    case "best_available":
      return `TONE (Best Available, 0-44):
Transparent. "We looked for [X] and the options are thin." Zero fake enthusiasm. Find the one real reason to go. The sarcasm might turn self-deprecating: "We wish we had a better answer for this one."`;
  }
}

// ==========================================
// USER PROMPT — candidate pool + deep profiles
// ==========================================

/**
 * Build the V5 user prompt with the full candidate pool (compact) and
 * deep profiles for the top 3 candidates (rich detail for blurb writing).
 *
 * @param specialRequest  - User's free-text craving / request
 * @param occasion        - Selected occasion (Date Night, Solo Dining, etc.)
 * @param neighborhood    - Selected neighborhood or "Anywhere"
 * @param priceLevel      - Selected budget or "Any"
 * @param dietaryRestrictions - Array of dietary filters (Vegan, Halal, etc.)
 * @param scoredCandidates    - Full scored pool for intent scanning
 * @param topCandidatesWithGoogle - Top 3 with deep profiles + Google data + reviews
 * @param weightContext   - Human-readable summary of weight shifts applied
 */
export function buildV5UserPrompt(
  specialRequest: string,
  occasion: string,
  neighborhood: string,
  priceLevel: string,
  dietaryRestrictions: string[],
  scoredCandidates: V5ScoredCandidate[],
  topCandidatesWithGoogle: Array<{
    candidate: V5ScoredCandidate;
    googleData: GooglePlaceData | null;
    reviews: string;
  }>,
  weightContext: string,
): string {
  // Section 1: User request context
  let prompt = `USER REQUEST: "${specialRequest || 'No specific request'}"
OCCASION: ${occasion}
NEIGHBORHOOD: ${neighborhood}
PRICE: ${priceLevel}
DIETARY: ${dietaryRestrictions.length > 0 ? dietaryRestrictions.join(', ') : 'None'}

WEIGHT CONTEXT: ${weightContext}

`;

  // Section 2: Full candidate pool (compact format for intent scanning)
  prompt += `=== FULL CANDIDATE POOL (${scoredCandidates.length} restaurants) ===\n`;
  scoredCandidates.forEach((sc, i) => {
    const p = sc.profile;
    const tags = p.tags.slice(0, 4).join(', ');
    prompt += `#${i}. ${p.name} | ${p.cuisine_type || 'Unknown'} | ${p.price_level || '?'} | DM:${sc.dondeMatch} | Tags: ${tags}\n`;
  });

  // Section 3: Top 3 deep profiles (for blurb writing)
  prompt += `\n=== TOP CANDIDATES (deep profiles for blurb) ===\n`;
  topCandidatesWithGoogle.forEach(({ candidate: sc, googleData, reviews }, i) => {
    const p = sc.profile;
    const dp = p.deep_profile;
    prompt += `\n--- CANDIDATE #${i} ---\n`;
    prompt += `Name: ${p.name}\n`;
    prompt += `Cuisine: ${p.cuisine_type || 'Unknown'}${dp?.cuisine_subcategory ? ` (${dp.cuisine_subcategory})` : ''}\n`;
    prompt += `Neighborhood: ${p.neighborhood_name}\n`;
    prompt += `Price: ${p.price_level || 'Unknown'}\n`;
    prompt += `Factors: FD:${sc.factors.food.toFixed(1)}/VB:${sc.factors.vibe.toFixed(1)}/SV:${sc.factors.service.toFixed(1)}/RP:${sc.factors.reputation.toFixed(1)}/CV:${sc.factors.convenience.toFixed(1)} | DM:${sc.dondeMatch}\n`;

    // Google data (live-fetched rating + review count)
    if (googleData) {
      prompt += `Google: ${googleData.google_rating}★ (${googleData.google_review_count} reviews)`;
      if (googleData.business_status) prompt += ` | Status: ${googleData.business_status}`;
      prompt += `\n`;
    }

    // Deep profile highlights — only include fields that have data
    if (dp) {
      if (dp.signature_dishes?.length) {
        prompt += `Signature: ${dp.signature_dishes.slice(0, 3).map(d => `${d.dish} (${d.why})`).join('; ')}\n`;
      }
      if (dp.flavor_profiles?.length) prompt += `Flavors: ${dp.flavor_profiles.join(', ')}\n`;
      if (dp.service_style) prompt += `Service: ${dp.service_style}\n`;
      if (dp.meal_pacing) prompt += `Pacing: ${dp.meal_pacing}\n`;
      if (dp.decor_style) prompt += `Decor: ${dp.decor_style}\n`;
      if (dp.music_vibe) prompt += `Music: ${dp.music_vibe}\n`;
      if (dp.energy_level != null) prompt += `Energy: ${dp.energy_level}/10\n`;
      if (dp.conversation_friendliness != null) prompt += `Conversation: ${dp.conversation_friendliness}/10\n`;
      if (dp.reservation_difficulty) prompt += `Reservation: ${dp.reservation_difficulty}\n`;
      if (dp.typical_wait_minutes != null) prompt += `Wait: ${dp.typical_wait_minutes} min\n`;
      if (dp.origin_story) prompt += `Story: ${dp.origin_story}\n`;
      if (dp.unique_selling_point) prompt += `USP: ${dp.unique_selling_point}\n`;
      if (dp.best_seat_in_house) prompt += `Best seat: ${dp.best_seat_in_house}\n`;
      if (dp.wow_factors?.length) prompt += `Wow: ${dp.wow_factors.join(', ')}\n`;
      if (dp.awards_recognition?.length) prompt += `Awards: ${dp.awards_recognition.join(', ')}\n`;
      if (dp.chef_notable) prompt += `Chef: Notable\n`;
      if (dp.crowd_profile?.length) prompt += `Crowd: ${dp.crowd_profile.join(', ')}\n`;
      if (dp.neighborhood_integration) prompt += `Neighborhood role: ${dp.neighborhood_integration}\n`;
      if (dp.instagram_worthiness != null && dp.instagram_worthiness >= 7) prompt += `Instagram-worthy: ${dp.instagram_worthiness}/10\n`;
      if (dp.kid_friendliness != null) prompt += `Kid-friendly: ${dp.kid_friendliness}/10\n`;
      if (dp.byob_policy) prompt += `BYOB: ${dp.byob_policy}\n`;
      if (dp.transit_accessibility) prompt += `Transit: ${dp.transit_accessibility}\n`;
    }

    // Ambiance/vibe from core restaurant fields
    if (p.noise_level) prompt += `Noise: ${p.noise_level}\n`;
    if (p.lighting_ambiance) prompt += `Lighting: ${p.lighting_ambiance}\n`;
    if (p.dress_code) prompt += `Dress: ${p.dress_code}\n`;
    if (p.outdoor_seating) prompt += `Outdoor: Yes\n`;
    if (p.live_music) prompt += `Live music: Yes\n`;
    if (p.pet_friendly) prompt += `Pet-friendly: Yes\n`;

    // Google reviews (live-fetched, formatted for sentiment + blurb grounding)
    if (reviews) {
      prompt += `Reviews:\n${reviews}\n`;
    }

    // DB-stored editorial content (for reference, not to parrot)
    if (p.insider_tip) prompt += `DB insider tip: ${p.insider_tip}\n`;
    if (p.best_for_oneliner) prompt += `Known for: ${p.best_for_oneliner}\n`;
  });

  prompt += `\nWrite the blurb for Candidate #0 (engine's top pick). Scan the full pool for intent matches. Respond in JSON only.`;

  return prompt;
}

// ==========================================
// SENTIMENT PROMPT — review analysis
// ==========================================

/**
 * Build a standalone sentiment analysis prompt for Google reviews.
 * Returns structured JSON with score + breakdown percentages.
 */
export function buildV5SentimentPrompt(reviews: string): string {
  return `Analyze these Google reviews. Return JSON only:
{"sentiment_score": <0-10>, "sentiment_summary": "<1 sentence>", "positive": <0-100>, "negative": <0-100>, "neutral": <0-100>}

Reviews:
${reviews}`;
}
