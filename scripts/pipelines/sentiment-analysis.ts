/**
 * Pipeline 4: Sentiment Analysis & Breakdown
 * Replaces n8n Agent 3B - generates sentiment_breakdown text from review summaries
 * Schedule: Bi-weekly (1st and 15th, 6am UTC)
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";

interface SentimentResult {
  restaurants: Array<{
    id: string;
    sentiment_score: number;
    sentiment_breakdown: string;
    has_red_flags: boolean;
    review_count: number;
  }>;
}

async function main() {
  console.log("=== Sentiment Analysis Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Fetch restaurants needing sentiment analysis
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select(
      "id, name, google_rating, google_review_count, noise_level, lighting_ambiance, price_level, google_review_summary"
    )
    .is("sentiment_breakdown", null);

  if (error) throw error;
  if (!restaurants || restaurants.length === 0) {
    console.log("No restaurants need sentiment analysis. Done.");
    return;
  }

  console.log(
    `Found ${restaurants.length} restaurants needing sentiment analysis`
  );

  await processBatches(restaurants, 10, async (batch) => {
    let restaurantList = "";

    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];
      let reviewSummary = r.google_review_summary;
      if (typeof reviewSummary === "string") {
        try {
          reviewSummary = JSON.parse(reviewSummary);
        } catch {
          reviewSummary = null;
        }
      }

      restaurantList += `\n--- RESTAURANT ${i + 1} ---\n`;
      restaurantList += `ID: ${r.id}\n`;
      restaurantList += `Name: ${r.name}\n`;
      restaurantList += `Google Rating: ${r.google_rating || "N/A"}/5\n`;
      restaurantList += `Review Count: ${r.google_review_count || "N/A"}\n`;
      restaurantList += `Price Level: ${r.price_level || "N/A"}\n`;
      restaurantList += `Noise Level: ${r.noise_level || "N/A"}\n`;
      restaurantList += `Lighting: ${r.lighting_ambiance || "N/A"}\n`;
      restaurantList += `Review Summary: ${reviewSummary?.summary || "None"}\n`;
      restaurantList += `Existing Sentiment Score: ${reviewSummary?.sentiment_score || "None"}\n`;
      restaurantList += `Top Aspects: ${(reviewSummary?.top_aspects || []).join(", ") || "None"}\n`;
    }

    const prompt = `You are a restaurant review analyst. For each restaurant below, generate detailed sentiment analysis data.

For each restaurant, produce:
1. sentiment_score: Numeric 1.0-5.0 (one decimal place)
2. sentiment_breakdown: A human-readable paragraph (3-5 sentences) describing overall sentiment, what diners love, common complaints, atmosphere contribution, and overall verdict
3. has_red_flags: true only if meaningful red flags exist (food safety, consistently bad service, cleanliness)
4. review_count: Number of reviews analyzed (use the provided review count)

Return ONLY valid JSON (no markdown):
{
  "restaurants": [
    {
      "id": "restaurant-uuid",
      "sentiment_score": 4.2,
      "sentiment_breakdown": "Diners consistently praise the authentic flavors...",
      "has_red_flags": false,
      "review_count": 127
    }
  ]
}

Restaurants to analyze:
${restaurantList}`;

    try {
      const responseText = await askClaude(prompt, { maxTokens: 8192 });
      const parsed = parseJsonResponse<SentimentResult>(responseText);
      const now = new Date().toISOString();

      for (const result of parsed.restaurants) {
        // Validate score
        let score = parseFloat(String(result.sentiment_score));
        if (isNaN(score) || score < 1.0) score = 3.0;
        if (score > 5.0) score = 5.0;
        score = Math.round(score * 10) / 10;

        if (DRY_RUN) {
          console.log(
            `  [DRY RUN] Would update ${result.id}: score=${score}`
          );
          continue;
        }

        const { error: updateError } = await supabase
          .from("restaurants")
          .update({
            sentiment_score: score,
            sentiment_breakdown: result.sentiment_breakdown,
            has_red_flags: result.has_red_flags === true,
            updated_at: now,
          })
          .eq("id", result.id);

        if (updateError) {
          console.error(`Failed to update sentiment for ${result.id}:`, updateError);
        }
      }

      console.log(`  Analyzed ${parsed.restaurants.length} restaurants`);
    } catch (err) {
      console.error("Claude failed for batch, using fallbacks:", err);

      // Fallback: extract from google_review_summary JSONB
      const now = new Date().toISOString();
      for (const r of batch) {
        let reviewSummary = r.google_review_summary;
        if (typeof reviewSummary === "string") {
          try { reviewSummary = JSON.parse(reviewSummary); } catch { reviewSummary = null; }
        }

        if (DRY_RUN) continue;

        const { error: fallbackError } = await supabase
          .from("restaurants")
          .update({
            sentiment_score: reviewSummary?.sentiment_score || 3.0,
            sentiment_breakdown: reviewSummary?.summary
              ? `Based on reviews: ${reviewSummary.summary}`
              : "Sentiment analysis unavailable.",
            has_red_flags: reviewSummary?.has_red_flags === true,
            updated_at: now,
          })
          .eq("id", r.id);

        if (fallbackError) {
          console.error(`Fallback update failed for ${r.id}:`, fallbackError);
        }
      }
    }
  });

  console.log("Sentiment analysis pipeline complete.");
}

main().catch((err) => {
  console.error("Sentiment analysis pipeline failed:", err);
  process.exit(1);
});
