/**
 * Claude-powered intent pre-classification (V2 → V4).
 *
 * Runs BEFORE the RPC query to understand what the user is really asking for.
 * V2 adds: flavor preferences, vibe keywords, practical constraints, emotional intent,
 * date type, group size hint, and spontaneity detection.
 * V4 adds: per-signal confidence scoring for dynamic weight modulation.
 *
 * Cost: ~150 input tokens (cached system prompt) + ~120 output tokens per request.
 * Latency: ~200-400ms (runs in parallel with initial RPC call).
 */

import { callClaude, parseClaudeJson } from "./claude.ts";

export interface IntentClassification {
  target_cuisines: string[];
  target_tags: string[];
  target_features: string[];
  cuisine_importance: "high" | "medium" | "low";
}

/** V4: Per-signal confidence levels for weight modulation */
export interface IntentConfidence {
  cuisine: "high" | "medium" | "low";
  vibe: "high" | "medium" | "low";
  occasion: "high" | "medium" | "low";
  constraints: "high" | "medium" | "low";
  overall: "high" | "medium" | "low";
}

/** V2 extended intent with nuanced signals for multi-dimensional ranking */
export interface IntentClassificationV2 extends IntentClassification {
  flavor_preferences: string[];
  vibe_keywords: string[];
  practical_constraints: string[];
  emotional_intent: string;
  date_type: string | null;
  group_size_hint: string | null;
  spontaneity: "planned" | "spontaneous" | "unknown";
  /** V4: Per-signal confidence levels */
  confidence?: IntentConfidence;
}

const INTENT_SYSTEM_PROMPT_V2 = `You classify restaurant search intent for a Chicago dining recommendation app. Given a user's request, extract structured search criteria.

Available cuisines: Mexican, American, Italian, Japanese, Thai, Chinese, Korean, French, Seafood, Steak, Mediterranean, Vietnamese, Indian, Ethiopian, Peruvian, Brazilian, Brunch, Vegan, Cocktail Bar, Coffee/Cafe, Polish, Puerto Rican, Southern/Soul Food, Middle Eastern, Greek, Fusion, BBQ, Brewery/Beer Bar

Available tags: byob, rooftop, outdoor patio, hidden gem, late night, craft cocktails, craft beer, live music, farm-to-table, scenic view, romantic, trendy, quiet, great value, brunch spot, waterfront, vegan friendly, gluten free, lively atmosphere

Available features: outdoor_seating, live_music, pet_friendly

Available flavors: smoky, spicy, fresh, rich, sweet, tangy, earthy, savory, umami, bright, crispy, charred, herbaceous, creamy, bold, delicate, fermented

Available vibe keywords: intimate, lively, cozy, elegant, casual, buzzing, chill, refined, rustic, modern, industrial, classic, funky, warm, minimalist

Rules:
- cuisine_importance "high": user clearly wants a specific cuisine (pizza, sushi, tacos, deep dish, mole, pho, dim sum, BBQ ribs)
- cuisine_importance "medium": implied cuisine preference (comfort food, spicy, noodles)
- cuisine_importance "low": request is about vibe, occasion, or location only (cozy date night, bustling atmosphere)
- Map food items to their cuisine: pizza/pasta/gnocchi/carbonara → Italian, sushi/ramen/yakitori/udon/tempura → Japanese, tacos/mole/birria/al pastor/chilaquiles → Mexican, pho/banh mi/bun bo hue → Vietnamese, dim sum/hotpot/bao/peking duck → Chinese, BBQ/brisket/ribs/pulled pork → BBQ, korean bbq/bulgogi/bibimbap → Korean, deep dish → Italian, beer/craft beer/brewery/IPA/ale/taproom/brewpub → Brewery/Beer Bar, pierogi/kielbasa → Polish, mofongo/pernil/tostones → Puerto Rican, injera/doro wat/kitfo → Ethiopian, ceviche/lomo saltado → Peruvian, churrasco/rodizio/picanha → Brazilian, shawarma/kebab/falafel → Middle Eastern, gyro/souvlaki/moussaka → Greek, fried chicken/gumbo/collard greens/jambalaya → Southern/Soul Food, tikka masala/biryani/vindaloo/samosa/idli/dosa/uttapam/sambar/rasam/vada/paneer/dal/korma/rogan josh/butter chicken/palak paneer/chana masala/naan/tandoori/appam/pongal/upma → Indian, pad thai/green curry/tom yum → Thai, espresso/latte/cappuccino → Coffee/Cafe, bouillabaisse/coq au vin/steak frites → French
- Only include tags/features/flavors/vibes that are clearly implied by the request
- emotional_intent: "impress" (trying to wow someone), "comfort" (cozy/familiar), "explore" (try something new), "celebrate" (special event), "casual" (low-key, no fuss), "indulge" (treat yourself)
- date_type: "first_date", "anniversary", "casual_weeknight", null (only set if clearly a date context)
- group_size_hint: "solo", "couple", "small_group" (3-5), "large_group" (6+), null
- spontaneity: "spontaneous" if mentions tonight/now/walk-in/last-minute, "planned" if mentions reservation/book/next week, "unknown" otherwise

Confidence scoring (V4):
- For each signal category, assess confidence: "high" = explicitly stated, "medium" = implied from context, "low" = no signal or very vague
- confidence.cuisine: "high" if specific food/cuisine named, "medium" if food style implied, "low" if no food signal
- confidence.vibe: "high" if vibe words used, "medium" if occasion implies vibe, "low" if no vibe signal
- confidence.occasion: "high" if occasion context clear, "medium" if implied, "low" if ambiguous
- confidence.constraints: "high" if specific constraints named, "medium" if implied, "low" if none
- confidence.overall: "high" if request is detailed (5+ words, clear intent), "medium" if moderate (3-4 words), "low" if vague (1-2 words)

Respond ONLY in JSON (no markdown, no explanation):
{"target_cuisines":[],"target_tags":[],"target_features":[],"cuisine_importance":"low","flavor_preferences":[],"vibe_keywords":[],"practical_constraints":[],"emotional_intent":"casual","date_type":null,"group_size_hint":null,"spontaneity":"unknown","confidence":{"cuisine":"low","vibe":"low","occasion":"low","constraints":"low","overall":"low"}}`;

export async function classifyIntent(
  specialRequest: string
): Promise<IntentClassificationV2 | null> {
  if (!specialRequest || specialRequest.trim().length < 3) return null;

  try {
    const response = await callClaude(
      `Classify: "${specialRequest}"`,
      INTENT_SYSTEM_PROMPT_V2,
      { maxTokens: 300, temperature: 0.1 }
    );
    const parsed = parseClaudeJson<IntentClassificationV2>(response);

    // Validate structure
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.target_cuisines)) parsed.target_cuisines = [];
    if (!Array.isArray(parsed.target_tags)) parsed.target_tags = [];
    if (!Array.isArray(parsed.target_features)) parsed.target_features = [];
    if (!["high", "medium", "low"].includes(parsed.cuisine_importance)) {
      parsed.cuisine_importance = "low";
    }
    // V2 fields — validate with safe defaults
    if (!Array.isArray(parsed.flavor_preferences)) parsed.flavor_preferences = [];
    if (!Array.isArray(parsed.vibe_keywords)) parsed.vibe_keywords = [];
    if (!Array.isArray(parsed.practical_constraints)) parsed.practical_constraints = [];
    if (!parsed.emotional_intent || typeof parsed.emotional_intent !== "string") {
      parsed.emotional_intent = "casual";
    }
    if (parsed.date_type && typeof parsed.date_type !== "string") parsed.date_type = null;
    if (parsed.group_size_hint && typeof parsed.group_size_hint !== "string") parsed.group_size_hint = null;
    if (!["planned", "spontaneous", "unknown"].includes(parsed.spontaneity)) {
      parsed.spontaneity = "unknown";
    }

    // V4: Validate confidence field
    const validConfLevels = ["high", "medium", "low"];
    if (parsed.confidence && typeof parsed.confidence === "object") {
      if (!validConfLevels.includes(parsed.confidence.cuisine)) parsed.confidence.cuisine = "low";
      if (!validConfLevels.includes(parsed.confidence.vibe)) parsed.confidence.vibe = "low";
      if (!validConfLevels.includes(parsed.confidence.occasion)) parsed.confidence.occasion = "low";
      if (!validConfLevels.includes(parsed.confidence.constraints)) parsed.confidence.constraints = "low";
      if (!validConfLevels.includes(parsed.confidence.overall)) parsed.confidence.overall = "low";
    } else {
      // Fallback: infer confidence from signal presence
      parsed.confidence = {
        cuisine: parsed.target_cuisines.length > 0 ? (parsed.cuisine_importance === "high" ? "high" : "medium") : "low",
        vibe: parsed.vibe_keywords.length > 0 ? "high" : (parsed.target_tags.length > 0 ? "medium" : "low"),
        occasion: parsed.emotional_intent !== "casual" || parsed.date_type ? "high" : (parsed.group_size_hint ? "medium" : "low"),
        constraints: parsed.practical_constraints.length > 0 ? "high" : (parsed.spontaneity !== "unknown" ? "medium" : "low"),
        overall: specialRequest.trim().split(/\s+/).length >= 5 ? "high" : (specialRequest.trim().split(/\s+/).length >= 3 ? "medium" : "low"),
      };
    }

    return parsed;
  } catch (err) {
    console.warn("Intent classification V2 failed, continuing without:", err);
    return null;
  }
}
