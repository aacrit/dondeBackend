/**
 * Claude-powered intent pre-classification.
 *
 * Runs BEFORE the RPC query to understand what the user is really asking for.
 * Replaces reliance on static keyword dictionaries as the primary cuisine-matching mechanism.
 *
 * Cost: ~100 input tokens (cached system prompt) + ~50 output tokens per request.
 * Latency: ~200-300ms (runs in parallel with initial RPC call).
 */

import { callClaude, parseClaudeJson } from "./claude.ts";

export interface IntentClassification {
  target_cuisines: string[];
  target_tags: string[];
  target_features: string[];
  cuisine_importance: "high" | "medium" | "low";
}

const INTENT_SYSTEM_PROMPT = `You classify restaurant search intent for a Chicago dining recommendation app. Given a user's request, extract structured search criteria.

Available cuisines: Mexican, American, Italian, Japanese, Thai, Chinese, Korean, French, Seafood, Steak, Mediterranean, Vietnamese, Indian, Ethiopian, Peruvian, Brazilian, Brunch, Vegan, Cocktail Bar, Coffee/Cafe, Polish, Puerto Rican, Southern/Soul Food, Middle Eastern, Greek, Fusion, BBQ

Available tags: byob, rooftop, outdoor patio, hidden gem, late night, craft cocktails, live music, farm-to-table, scenic view, romantic, trendy, quiet, great value, brunch spot, waterfront, vegan friendly, gluten free, lively atmosphere

Available features: outdoor_seating, live_music, pet_friendly

Rules:
- cuisine_importance "high": user clearly wants a specific cuisine (pizza, sushi, tacos, deep dish, mole, pho, dim sum, BBQ ribs)
- cuisine_importance "medium": implied cuisine preference (comfort food, spicy, noodles)
- cuisine_importance "low": request is about vibe, occasion, or location only (cozy date night, bustling atmosphere)
- Map food items to their cuisine: pizza/pasta → Italian, sushi/ramen → Japanese, tacos/mole → Mexican, pho/banh mi → Vietnamese, dim sum → Chinese, BBQ → BBQ or Korean depending on context, deep dish → Italian
- Only include tags/features that are clearly implied by the request

Respond ONLY in JSON (no markdown, no explanation):
{"target_cuisines":[],"target_tags":[],"target_features":[],"cuisine_importance":"low"}`;

const DEFAULT_RESULT: IntentClassification = {
  target_cuisines: [],
  target_tags: [],
  target_features: [],
  cuisine_importance: "low",
};

export async function classifyIntent(
  specialRequest: string
): Promise<IntentClassification | null> {
  if (!specialRequest || specialRequest.trim().length < 3) return null;

  try {
    const response = await callClaude(
      `Classify: "${specialRequest}"`,
      INTENT_SYSTEM_PROMPT,
      { maxTokens: 150, temperature: 0.1 }
    );
    const parsed = parseClaudeJson<IntentClassification>(response);

    // Validate structure
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.target_cuisines)) parsed.target_cuisines = [];
    if (!Array.isArray(parsed.target_tags)) parsed.target_tags = [];
    if (!Array.isArray(parsed.target_features)) parsed.target_features = [];
    if (!["high", "medium", "low"].includes(parsed.cuisine_importance)) {
      parsed.cuisine_importance = "low";
    }

    return parsed;
  } catch (err) {
    console.warn("Intent classification failed, continuing without:", err);
    return null;
  }
}
