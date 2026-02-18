/**
 * Pipeline 3: Review Summarization
 * Replaces n8n Agent 3 - fetches Google reviews and generates summaries via Claude
 * Schedule: Bi-weekly (1st and 15th, 4am UTC)
 */

import { createAdminClient } from "../lib/supabase.js";
import { getPlaceReviews } from "../lib/google-places.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";

interface ReviewSummaryResult {
  restaurant_id: string;
  summary: string;
  sentiment_score: number;
  top_aspects: string[];
  has_red_flags: boolean;
}

async function main() {
  console.log("=== Review Summarization Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Fetch restaurants needing review summaries
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select("id, name, google_place_id")
    .is("google_review_summary", null)
    .not("google_place_id", "is", null)
    .limit(100);

  if (error) throw error;
  if (!restaurants || restaurants.length === 0) {
    console.log("No restaurants need review summarization. Done.");
    return;
  }

  console.log(
    `Found ${restaurants.length} restaurants needing review summaries`
  );

  await processBatches(restaurants, 10, async (batch) => {
    // Fetch reviews from Google Places for each restaurant
    const reviewData: Array<{
      id: string;
      name: string;
      reviews: string;
    }> = [];

    for (const r of batch) {
      if (!r.google_place_id) continue;

      try {
        const details = await getPlaceReviews(r.google_place_id);
        const reviews = details?.reviews || [];

        if (reviews.length > 0) {
          const reviewText = reviews
            .slice(0, 5)
            .map((rev) => `${rev.rating}/5: ${rev.text.substring(0, 200)}`)
            .join(" | ");

          reviewData.push({ id: r.id, name: r.name, reviews: reviewText });
        }
      } catch (err) {
        console.error(`Failed to fetch reviews for ${r.name}:`, err);
      }

      // Small delay between Google API calls
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (reviewData.length === 0) {
      console.log("  No reviews found in this batch");
      return;
    }

    const prompt = `Analyze these restaurants' reviews. Return ONLY valid JSON array (no markdown):

[{"restaurant_id":"uuid","summary":"2-3 sentence review summary","sentiment_score":4.2,"top_aspects":["food quality","service","atmosphere"],"has_red_flags":false}]

${reviewData.map((r, i) => `${i + 1}. ${r.name} (${r.id}): ${r.reviews}`).join("\n")}`;

    try {
      const responseText = await askClaude(prompt);
      const results = parseJsonResponse<ReviewSummaryResult[]>(responseText);
      const now = new Date().toISOString();

      for (const result of results) {
        if (DRY_RUN) {
          console.log(`  [DRY RUN] Would update ${result.restaurant_id}`);
          continue;
        }

        const { error: updateError } = await supabase
          .from("restaurants")
          .update({
            google_review_summary: {
              summary: result.summary,
              sentiment_score: result.sentiment_score,
              top_aspects: result.top_aspects,
              has_red_flags: result.has_red_flags,
            },
            review_last_fetched_at: now,
            updated_at: now,
          })
          .eq("id", result.restaurant_id);

        if (updateError) {
          console.error(
            `Failed to update review summary for ${result.restaurant_id}:`,
            updateError
          );
        }
      }

      console.log(`  Summarized ${results.length} restaurants`);
    } catch (err) {
      console.error("Claude failed for batch:", err);
    }
  });

  console.log("Review summarization pipeline complete.");
}

main().catch((err) => {
  console.error("Review summarization pipeline failed:", err);
  process.exit(1);
});
