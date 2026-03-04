/**
 * Donde Match V5 — Deterministic-First Intent Classifier with Claude Fallback
 *
 * The core of V5's intent understanding. Uses dictionaries from scoring.ts for
 * deterministic matching (~80% of requests) and falls back to Claude for
 * ambiguous inputs (~15%). Returns null for empty/trivial inputs (~5%).
 *
 * Classification tiers:
 *   Tier 1 (Deterministic): Tokenize → scan CUISINE_KEYWORDS, TAG_KEYWORDS,
 *     INTENT_MAP → derive all IntentClassificationV2 fields → compute confidence.
 *     Handles clear inputs at zero cost and zero latency.
 *
 *   Tier 2 (Claude Fallback): When confidence is "low" (fewer than 2 distinct
 *     signals AND input is >3 words), call Claude with the INTENT_SYSTEM_PROMPT_V2
 *     pattern for nuanced understanding. ~200ms, ~$0.0002/call.
 *
 *   Tier 3 (Skip): Empty or <3 char inputs return null immediately.
 */

import { CUISINE_KEYWORDS, TAG_KEYWORDS, INTENT_MAP } from "./scoring.ts";
import type { IntentClassificationV2, IntentConfidence } from "./intent-classifier.ts";
import { callClaude, parseClaudeJson } from "./claude.ts";

// ---------------------------------------------------------------------------
// Word lists for deterministic signal extraction
// ---------------------------------------------------------------------------

/** Flavor descriptors — matched against tokenized input */
const FLAVOR_WORDS: string[] = [
  "smoky", "spicy", "fresh", "rich", "sweet", "tangy", "earthy", "savory",
  "umami", "bright", "crispy", "charred", "herbaceous", "creamy", "bold",
  "delicate", "fermented",
];

/** Ambiance/vibe descriptors */
const VIBE_WORDS: string[] = [
  "intimate", "lively", "cozy", "elegant", "casual", "buzzing", "chill",
  "refined", "rustic", "modern", "industrial", "classic", "funky", "warm",
  "minimalist",
];

/** Practical constraint trigger words mapped to constraint labels */
const CONSTRAINT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /budget|cheap|affordable|value|inexpensive|under \$|low.?cost/, label: "budget_conscious" },
  { pattern: /walk.?in|no reservat/, label: "walk_in" },
  { pattern: /byob/, label: "byob" },
  { pattern: /cash only|cash/, label: "cash_only" },
  { pattern: /parking|drive/, label: "parking_needed" },
  { pattern: /outdoor|patio|outside|terrace|al fresco/, label: "outdoor_preferred" },
  { pattern: /pet|dog/, label: "pet_friendly" },
  { pattern: /gluten.?free|celiac/, label: "gluten_free" },
  { pattern: /vegan|plant.?based/, label: "vegan" },
  { pattern: /vegetarian/, label: "vegetarian" },
  { pattern: /halal/, label: "halal" },
  { pattern: /kosher/, label: "kosher" },
  { pattern: /wheelchair|accessible|accessibility/, label: "accessibility" },
  { pattern: /quiet|peaceful|calm/, label: "quiet_environment" },
  { pattern: /private|semi.?private/, label: "private_dining" },
];

/** Emotional intent detection — order matters (first match wins) */
const EMOTIONAL_INTENT_PATTERNS: Array<{ intent: string; pattern: RegExp }> = [
  { intent: "impress", pattern: /impress|wow|blow.?them.?away|blow.?away|make.?impression/ },
  { intent: "celebrate", pattern: /celebrat|celebration|birthday|anniversary|graduation|engagement|milestone|promotion/ },
  { intent: "indulge", pattern: /treat|indulge|splurge|pamper|luxury|spoil|self.?care/ },
  { intent: "explore", pattern: /\bnew\b|try|adventure|explore|discover|never.?been|something new|different|unique/ },
  { intent: "comfort", pattern: /cozy|comfortable|familiar|home|soul|nostalgia|homey|comforting/ },
  // "casual" is the default — no pattern needed
];

/** Date type detection */
const DATE_TYPE_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: "first_date", pattern: /first date|new date|just started dating/ },
  { type: "anniversary", pattern: /anniversary/ },
  { type: "casual_weeknight", pattern: /weeknight|casual date|quick date|tuesday|wednesday|thursday/ },
];

/** Group size detection */
const GROUP_SIZE_PATTERNS: Array<{ size: string; pattern: RegExp }> = [
  { size: "solo", pattern: /\bsolo\b|\balone\b|by myself|just me|one person|table for one/ },
  { size: "couple", pattern: /\bcouple\b|two of us|\btwo\b|partner|girlfriend|boyfriend|wife|husband|\bdate\b/ },
  { size: "large_group", pattern: /large group|big group|party of \d+|group of \d+|big party|table for ([6-9]|1[0-9]|2[0-9])|dinner for ([6-9]|1[0-9]|2[0-9])|\b([6-9]|1[0-9]|20)\b.*(people|friends|group)/ },
  { size: "small_group", pattern: /\bgroup\b|\bcrew\b|\bfriends\b|small group|\b[3-5]\b.*(people|friends|group)/ },
];

/** Spontaneity detection */
const SPONTANEOUS_WORDS = /tonight|\bright now\b|walk.?in|last.?minute|spontaneous|asap|no wait|open now/;
const PLANNED_WORDS = /reservation|book|reserve|next week|next month|plan|planning|schedule/;

// ---------------------------------------------------------------------------
// System prompt for Claude fallback (mirrors intent-classifier.ts V2 pattern)
// ---------------------------------------------------------------------------

const INTENT_SYSTEM_PROMPT_V2 = `You classify restaurant search intent for a Chicago dining recommendation app. Given a user's request, extract structured search criteria.

Available cuisines: Mexican, American, Italian, Japanese, Thai, Chinese, Korean, French, Seafood, Steak, Mediterranean, Vietnamese, Indian, Ethiopian, Peruvian, Brazilian, Brunch, Vegan, Cocktail Bar, Coffee/Cafe, Polish, Puerto Rican, Southern/Soul Food, Middle Eastern, Greek, Fusion, BBQ, Brewery/Beer Bar, Caribbean/Jamaican, Filipino, Nepalese/Tibetan, Colombian, West African, Sichuan, Cuban, Taiwanese, Persian, German, Hawaiian, Venezuelan, Ukrainian, Ecuadorian, Salvadoran, Argentine, Moroccan, Pakistani, Cambodian, Laotian, Irish, Spanish, Yemeni, East African, Malaysian, Georgian, Central Asian

Available tags: byob, rooftop, outdoor patio, hidden gem, late night, craft cocktails, craft beer, live music, farm-to-table, scenic view, romantic, trendy, quiet, great value, brunch spot, waterfront, vegan friendly, gluten free, lively atmosphere

Available features: outdoor_seating, live_music, pet_friendly

Available flavors: smoky, spicy, fresh, rich, sweet, tangy, earthy, savory, umami, bright, crispy, charred, herbaceous, creamy, bold, delicate, fermented

Available vibe keywords: intimate, lively, cozy, elegant, casual, buzzing, chill, refined, rustic, modern, industrial, classic, funky, warm, minimalist

Rules:
- cuisine_importance "high": user clearly wants a specific cuisine
- cuisine_importance "medium": implied cuisine preference
- cuisine_importance "low": request is about vibe, occasion, or location only
- Only include tags/features/flavors/vibes that are clearly implied by the request
- emotional_intent: "impress", "comfort", "explore", "celebrate", "casual", "indulge"
- date_type: "first_date", "anniversary", "casual_weeknight", null
- group_size_hint: "solo", "couple", "small_group", "large_group", null
- spontaneity: "spontaneous", "planned", "unknown"

Confidence scoring:
- confidence.cuisine: "high" if specific food/cuisine named, "medium" if implied, "low" if none
- confidence.vibe: "high" if vibe words used, "medium" if occasion implies vibe, "low" if none
- confidence.occasion: "high" if occasion clear, "medium" if implied, "low" if ambiguous
- confidence.constraints: "high" if constraints named, "medium" if implied, "low" if none
- confidence.overall: "high" if detailed, "medium" if moderate, "low" if vague

Respond ONLY in JSON (no markdown, no explanation):
{"target_cuisines":[],"target_tags":[],"target_features":[],"cuisine_importance":"low","flavor_preferences":[],"vibe_keywords":[],"practical_constraints":[],"emotional_intent":"casual","date_type":null,"group_size_hint":null,"spontaneity":"unknown","confidence":{"cuisine":"low","vibe":"low","occasion":"low","constraints":"low","overall":"low"}}`;

// ---------------------------------------------------------------------------
// Tokenizer — produces unigrams, bigrams, and trigrams
// ---------------------------------------------------------------------------

/**
 * Tokenize input into single words, bigrams, and trigrams.
 * All tokens are lowercased and trimmed. Words shorter than 2 chars are dropped.
 */
function tokenize(input: string): string[] {
  const lower = input.toLowerCase().trim();
  const words = lower.split(/\s+/).filter((w) => w.length > 1);
  const tokens: string[] = [...words];

  // Bigrams
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(`${words[i]} ${words[i + 1]}`);
  }

  // Trigrams
  for (let i = 0; i < words.length - 2; i++) {
    tokens.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Tier 2 — Claude Fallback
// ---------------------------------------------------------------------------

/**
 * Call Claude to classify ambiguous input. Uses low temperature and tight
 * token budget for fast, deterministic responses.
 * Returns null if Claude fails or returns invalid data.
 */
async function classifyWithClaude(
  specialRequest: string,
  occasion: string,
): Promise<IntentClassificationV2 | null> {
  try {
    const userPrompt = occasion && occasion !== "Any"
      ? `Classify: "${specialRequest}" (occasion: ${occasion})`
      : `Classify: "${specialRequest}"`;

    const response = await callClaude(userPrompt, INTENT_SYSTEM_PROMPT_V2, {
      maxTokens: 200,
      temperature: 0.1,
    });

    const parsed = parseClaudeJson<IntentClassificationV2>(response);

    // Validate structure — ensure all required fields exist with safe defaults
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.target_cuisines)) parsed.target_cuisines = [];
    if (!Array.isArray(parsed.target_tags)) parsed.target_tags = [];
    if (!Array.isArray(parsed.target_features)) parsed.target_features = [];
    if (!["high", "medium", "low"].includes(parsed.cuisine_importance)) {
      parsed.cuisine_importance = "low";
    }
    if (!Array.isArray(parsed.flavor_preferences)) parsed.flavor_preferences = [];
    if (!Array.isArray(parsed.vibe_keywords)) parsed.vibe_keywords = [];
    if (!Array.isArray(parsed.practical_constraints)) parsed.practical_constraints = [];
    if (!parsed.emotional_intent || typeof parsed.emotional_intent !== "string") {
      parsed.emotional_intent = "casual";
    }
    if (parsed.date_type && typeof parsed.date_type !== "string") parsed.date_type = null;
    if (parsed.group_size_hint && typeof parsed.group_size_hint !== "string") {
      parsed.group_size_hint = null;
    }
    if (!["planned", "spontaneous", "unknown"].includes(parsed.spontaneity)) {
      parsed.spontaneity = "unknown";
    }

    // Validate confidence sub-object
    const validLevels = ["high", "medium", "low"];
    if (parsed.confidence && typeof parsed.confidence === "object") {
      if (!validLevels.includes(parsed.confidence.cuisine)) parsed.confidence.cuisine = "low";
      if (!validLevels.includes(parsed.confidence.vibe)) parsed.confidence.vibe = "low";
      if (!validLevels.includes(parsed.confidence.occasion)) parsed.confidence.occasion = "low";
      if (!validLevels.includes(parsed.confidence.constraints)) parsed.confidence.constraints = "low";
      if (!validLevels.includes(parsed.confidence.overall)) parsed.confidence.overall = "low";
    } else {
      // Infer confidence from signal presence
      parsed.confidence = {
        cuisine: parsed.target_cuisines.length > 0
          ? (parsed.cuisine_importance === "high" ? "high" : "medium")
          : "low",
        vibe: parsed.vibe_keywords.length > 0 ? "high" : (parsed.target_tags.length > 0 ? "medium" : "low"),
        occasion: parsed.emotional_intent !== "casual" || parsed.date_type
          ? "high"
          : (parsed.group_size_hint ? "medium" : "low"),
        constraints: parsed.practical_constraints.length > 0
          ? "high"
          : (parsed.spontaneity !== "unknown" ? "medium" : "low"),
        overall: "medium", // Claude was needed, so input was ambiguous
      };
    }

    return parsed;
  } catch (err) {
    console.warn("[V5 Intent] Claude fallback failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tier 1 — Deterministic Classification
// ---------------------------------------------------------------------------

/**
 * V5 Deterministic Intent Classifier with Claude Fallback.
 *
 * Returns the classified intent and which classification path was used:
 * - "deterministic": resolved via dictionary matching (zero cost)
 * - "claude": fell back to Claude API for ambiguous inputs
 * - "skip": input was empty or too short to classify
 *
 * @param specialRequest - The user's free-text craving/request
 * @param occasion - The selected occasion context (e.g. "Date Night", "Any")
 */
export async function classifyIntentV5(
  specialRequest: string,
  occasion: string,
): Promise<{
  intent: IntentClassificationV2 | null;
  classificationPath: "deterministic" | "claude" | "skip";
}> {
  // -----------------------------------------------------------------------
  // Tier 3 — Skip: empty or trivially short inputs
  // -----------------------------------------------------------------------
  if (!specialRequest || specialRequest.trim().length < 3) {
    return { intent: null, classificationPath: "skip" };
  }

  const input = specialRequest.toLowerCase().trim();
  const tokens = tokenize(input);
  const words = input.split(/\s+/).filter((w) => w.length > 1);

  // -----------------------------------------------------------------------
  // Step 1: Scan CUISINE_KEYWORDS → target_cuisines + cuisine_importance
  // -----------------------------------------------------------------------
  const matchedCuisines = new Set<string>();
  let cuisineKeywordMatchCount = 0;
  let hasExactCuisineName = false;
  const matchedKeywordStrings: string[] = [];  // V6: track matched keywords for dish detection

  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      // Check if any token matches OR if input contains the keyword as substring
      if (tokens.includes(kwLower) || input.includes(kwLower)) {
        matchedCuisines.add(cuisine);
        cuisineKeywordMatchCount++;
        matchedKeywordStrings.push(kwLower);  // V6
        // Check if this is the exact cuisine name (e.g., "mexican", "italian")
        if (kwLower === cuisine.toLowerCase()) {
          hasExactCuisineName = true;
        }
        break; // One match per cuisine is sufficient
      }
    }
  }

  const targetCuisines = Array.from(matchedCuisines);

  // V6: Detect dish-level intent.
  // If the matched keyword is a food item (not the exact cuisine name), the user is asking
  // for a specific dish/food, not just a cuisine category.
  // e.g., "tandoori" (matched Indian, but "tandoori" ≠ "Indian") → dish-level
  //        "butter chicken" → dish-level
  //        "indian" (exact cuisine name) → NOT dish-level
  const cuisineNamesLower = new Set(
    Object.keys(CUISINE_KEYWORDS).map((c) => c.toLowerCase()),
  );
  // V9: Exclude non-dish words from triggering dish-level intent.
  // These are meal periods, drink categories, and venue-type words that
  // appear in CUISINE_KEYWORDS but don't represent specific dishes.
  // Without this, "dark moody cocktails" → dish_level_intent = true.
  const NON_DISH_WORDS = new Set([
    // Meal periods
    "dinner", "lunch", "breakfast", "brunch", "supper", "meal",
    "late night", "happy hour", "dessert",
    // Drink / bar category words (map to Cocktail Bar / Brewery)
    "cocktail", "cocktails", "cocktail bar", "cocktail lounge",
    "speakeasy", "mixology", "whiskey", "bourbon", "mezcal",
    "martini", "mojito", "old fashioned", "aperol", "absinthe",
    "beer", "craft beer", "brewery",
    "wine", "wine bar", "sake", "sake bar",
    // Venue-type words
    "cafe", "coffee", "diner", "bistro", "pub",
  ]);
  const matchedFoodItems = matchedKeywordStrings.filter(
    (kw) => !cuisineNamesLower.has(kw) && !NON_DISH_WORDS.has(kw),
  );
  const dishLevelIntent: string | null =
    matchedFoodItems.length > 0 ? input : null;

  // V6: cuisine_importance — any CUISINE_KEYWORDS match → "high"
  // Previously: 1 match → "medium" which caused the cuisine hard filter to NOT fire,
  // meaning "tandoori chicken" competed against ALL 2000 restaurants.
  // A CUISINE_KEYWORDS match is definitively food-related, so it warrants "high" importance.
  let cuisineImportance: "high" | "medium" | "low";
  if (cuisineKeywordMatchCount >= 1) {
    cuisineImportance = "high";
  } else {
    cuisineImportance = "low";
  }

  // -----------------------------------------------------------------------
  // Step 2: Scan TAG_KEYWORDS → target_tags
  // -----------------------------------------------------------------------
  const matchedTags = new Set<string>();

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (tokens.includes(kwLower) || input.includes(kwLower)) {
        matchedTags.add(tag);
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Step 3: Scan INTENT_MAP → accumulate signals → merge into result
  // -----------------------------------------------------------------------
  const intentMapCuisines = new Set<string>();
  const intentMapTags = new Set<string>();
  const targetFeatures: string[] = [];
  let intentMapMatchCount = 0;

  // Step 3a: Pre-scan full input for multi-word INTENT_MAP phrases.
  // This catches phrases like "korean fried chicken", "soup dumplings",
  // "bottomless brunch" that tokenization might split incorrectly or miss.
  const matchedPhrases = new Set<string>();
  for (const [phrase, signal] of Object.entries(INTENT_MAP)) {
    if (phrase.includes(" ") && input.includes(phrase)) {
      matchedPhrases.add(phrase);
      intentMapMatchCount++;
      if (signal.cuisines) {
        for (const c of signal.cuisines) {
          if (!matchedCuisines.has(c)) {
            intentMapCuisines.add(c);
          }
        }
      }
      if (signal.tags) {
        for (const t of signal.tags) {
          if (!matchedTags.has(t)) {
            intentMapTags.add(t);
          }
        }
      }
      if (signal.features) {
        for (const f of signal.features as string[]) {
          if (!targetFeatures.includes(f)) {
            targetFeatures.push(f);
          }
        }
      }
    }
  }

  // Step 3b: Token-level INTENT_MAP scanning (for unigram/bigram/trigram matches)
  for (const token of tokens) {
    if (matchedPhrases.has(token)) continue; // Already matched as a phrase
    const signal = INTENT_MAP[token];
    if (signal) {
      intentMapMatchCount++;
      if (signal.cuisines) {
        for (const c of signal.cuisines) {
          if (!matchedCuisines.has(c)) {
            intentMapCuisines.add(c);
          }
        }
      }
      if (signal.tags) {
        for (const t of signal.tags) {
          if (!matchedTags.has(t)) {
            intentMapTags.add(t);
          }
        }
      }
      if (signal.features) {
        for (const f of signal.features as string[]) {
          if (!targetFeatures.includes(f)) {
            targetFeatures.push(f);
          }
        }
      }
    }
  }

  // Merge intent map finds into primary arrays
  for (const c of intentMapCuisines) targetCuisines.push(c);
  for (const t of intentMapTags) matchedTags.add(t);

  // Step 3c: Negation detection — remove signals preceded by negation words.
  // Handles "not too loud", "no spicy", "without crowds", "don't want lively"
  const NEGATION_PATTERN = /\b(?:not|no|without|don'?t want|avoid|skip|never)\s+(\w+)/gi;
  const negatedWords = new Set<string>();
  let negMatch;
  while ((negMatch = NEGATION_PATTERN.exec(input)) !== null) {
    negatedWords.add(negMatch[1].toLowerCase());
  }

  // If negated words triggered any tags, remove those tags
  if (negatedWords.size > 0) {
    for (const negWord of negatedWords) {
      for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
        if (keywords.some((kw) => kw.toLowerCase().includes(negWord))) {
          matchedTags.delete(tag);
        }
      }
    }
  }

  const targetTags = Array.from(matchedTags);

  // Update cuisine importance if intent map brought in cuisine signals
  // V6.1: Upgrade to "high" when INTENT_MAP match includes cuisine signals from a
  // specific dish/food term (e.g., "soup dumplings" → Chinese should be "high").
  // This ensures the cuisine hard filter fires for all dish-level queries.
  if (cuisineImportance === "low" && intentMapCuisines.size > 0) {
    cuisineImportance = "high";
  }

  // -----------------------------------------------------------------------
  // Step 4: Derive flavor_preferences
  // -----------------------------------------------------------------------
  const flavorPreferences: string[] = [];
  for (const flavor of FLAVOR_WORDS) {
    if (input.includes(flavor)) {
      flavorPreferences.push(flavor);
    }
  }

  // -----------------------------------------------------------------------
  // Step 5: Derive vibe_keywords
  // -----------------------------------------------------------------------
  const vibeKeywords: string[] = [];
  for (const vibe of VIBE_WORDS) {
    if (input.includes(vibe)) {
      vibeKeywords.push(vibe);
    }
  }

  // -----------------------------------------------------------------------
  // Step 6: Derive practical_constraints
  // -----------------------------------------------------------------------
  const practicalConstraints: string[] = [];
  for (const { pattern, label } of CONSTRAINT_PATTERNS) {
    if (pattern.test(input)) {
      practicalConstraints.push(label);
    }
  }

  // -----------------------------------------------------------------------
  // Step 7: Derive emotional_intent from occasion + signal words
  // -----------------------------------------------------------------------
  let emotionalIntent = "casual";

  // Check input text first
  for (const { intent, pattern } of EMOTIONAL_INTENT_PATTERNS) {
    if (pattern.test(input)) {
      emotionalIntent = intent;
      break;
    }
  }

  // V8.6: Open-ended pattern detection — "surprise me", "dealer's choice", etc.
  // Routes to emotional_intent="explore" which triggers Rule 6 (Adventure/Treat).
  const OPEN_ENDED_PATTERN = /surprise|dealer.?s?\s*choice|anything|whatever|feed me|chef.?s?\s*choice|you\s*pick|random/;
  if (emotionalIntent === "casual" && OPEN_ENDED_PATTERN.test(input)) {
    emotionalIntent = "explore";
  }

  // If still casual, check the occasion for additional context
  if (emotionalIntent === "casual" && occasion) {
    const occasionLower = occasion.toLowerCase();
    if (occasionLower.includes("special")) emotionalIntent = "celebrate";
    else if (occasionLower.includes("adventure")) emotionalIntent = "explore";
    else if (occasionLower.includes("treat")) emotionalIntent = "indulge";
    else if (occasionLower === "date night") emotionalIntent = "impress";
  }

  // -----------------------------------------------------------------------
  // Step 8: Derive date_type
  // -----------------------------------------------------------------------
  let dateType: string | null = null;
  for (const { type, pattern } of DATE_TYPE_PATTERNS) {
    if (pattern.test(input)) {
      dateType = type;
      break;
    }
  }
  // Infer from occasion if not explicitly stated
  if (!dateType && occasion === "Date Night") {
    dateType = "casual_weeknight";
  }

  // -----------------------------------------------------------------------
  // Step 9: Derive group_size_hint
  // -----------------------------------------------------------------------
  let groupSizeHint: string | null = null;
  for (const { size, pattern } of GROUP_SIZE_PATTERNS) {
    if (pattern.test(input)) {
      groupSizeHint = size;
      break;
    }
  }
  // Infer from occasion
  if (!groupSizeHint) {
    if (occasion === "Solo Dining") groupSizeHint = "solo";
    else if (occasion === "Date Night") groupSizeHint = "couple";
    else if (occasion === "Group Hangout") groupSizeHint = "small_group";
  }

  // -----------------------------------------------------------------------
  // Step 10: Derive spontaneity
  // -----------------------------------------------------------------------
  let spontaneity: "planned" | "spontaneous" | "unknown" = "unknown";
  if (SPONTANEOUS_WORDS.test(input)) {
    spontaneity = "spontaneous";
  } else if (PLANNED_WORDS.test(input)) {
    spontaneity = "planned";
  }

  // -----------------------------------------------------------------------
  // Step 11: Compute confidence
  // -----------------------------------------------------------------------

  // Count total distinct signals
  let signalCount = 0;
  if (matchedCuisines.size > 0) signalCount += matchedCuisines.size;
  if (matchedTags.size > 0) signalCount += matchedTags.size;
  if (intentMapMatchCount > 0) signalCount += intentMapMatchCount;
  if (flavorPreferences.length > 0) signalCount += flavorPreferences.length;
  if (vibeKeywords.length > 0) signalCount += vibeKeywords.length;
  if (practicalConstraints.length > 0) signalCount += practicalConstraints.length;

  // Overall confidence based on total signal count
  let overallConfidence: "high" | "medium" | "low";
  if (signalCount >= 4) {
    overallConfidence = "high";
  } else if (signalCount >= 2) {
    overallConfidence = "medium";
  } else if (words.length > 3) {
    // <2 signals AND input >3 words → "low" (route to Claude)
    overallConfidence = "low";
  } else {
    // <2 signals AND input <=3 words → "medium" (short inputs are often clear)
    overallConfidence = "medium";
  }

  // -----------------------------------------------------------------------
  // Tier 2 — Claude Fallback: route ambiguous inputs to Claude
  // -----------------------------------------------------------------------
  if (overallConfidence === "low") {
    console.log(
      `[V5 Intent] Low confidence for "${specialRequest}" (${words.length} words, ${signalCount} signals) — routing to Claude`,
    );

    const claudeResult = await classifyWithClaude(specialRequest, occasion);
    if (claudeResult) {
      return { intent: claudeResult, classificationPath: "claude" };
    }

    // If Claude fails, fall through to deterministic result with what we have
    console.warn("[V5 Intent] Claude fallback returned null, using deterministic result");
  }

  // -----------------------------------------------------------------------
  // Build per-signal confidence (IntentConfidence)
  // -----------------------------------------------------------------------
  const cuisineConfidence: "high" | "medium" | "low" =
    hasExactCuisineName || cuisineKeywordMatchCount >= 3
      ? "high"
      : cuisineKeywordMatchCount >= 1 || intentMapCuisines.size > 0
        ? "medium"
        : "low";

  const vibeConfidence: "high" | "medium" | "low" =
    vibeKeywords.length >= 2
      ? "high"
      : vibeKeywords.length === 1 || targetTags.some((t) =>
          ["romantic", "quiet", "trendy", "lively atmosphere"].includes(t))
        ? "medium"
        : "low";

  const occasionConfidence: "high" | "medium" | "low" =
    emotionalIntent !== "casual" || dateType !== null
      ? "high"
      : groupSizeHint !== null
        ? "medium"
        : "low";

  const constraintsConfidence: "high" | "medium" | "low" =
    practicalConstraints.length > 0
      ? "high"
      : spontaneity !== "unknown"
        ? "medium"
        : "low";

  const confidence: IntentConfidence = {
    cuisine: cuisineConfidence,
    vibe: vibeConfidence,
    occasion: occasionConfidence,
    constraints: constraintsConfidence,
    overall: overallConfidence,
  };

  // -----------------------------------------------------------------------
  // Build the final IntentClassificationV2 result
  // -----------------------------------------------------------------------
  const result: IntentClassificationV2 = {
    target_cuisines: targetCuisines,
    target_tags: targetTags,
    target_features: targetFeatures,
    cuisine_importance: cuisineImportance,
    flavor_preferences: flavorPreferences,
    vibe_keywords: vibeKeywords,
    practical_constraints: practicalConstraints,
    emotional_intent: emotionalIntent,
    date_type: dateType,
    group_size_hint: groupSizeHint,
    spontaneity,
    confidence,
    dish_level_intent: dishLevelIntent,  // V6
  };

  console.log(
    `[V5 Intent] Deterministic: ${signalCount} signals, confidence=${overallConfidence}, ` +
    `cuisines=[${targetCuisines.join(",")}], tags=[${targetTags.slice(0, 5).join(",")}], ` +
    `emotional=${emotionalIntent}, spontaneity=${spontaneity}` +
    (dishLevelIntent ? `, dish_level="${dishLevelIntent}"` : ""),
  );

  return { intent: result, classificationPath: "deterministic" };
}
