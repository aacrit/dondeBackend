/**
 * Pipeline: Intent Gap Analysis — Continuous Learning
 *
 * Analyzes unmatched_keywords from user_queries to identify gaps in the
 * INTENT_MAP and TAG_KEYWORDS dictionaries. Uses Claude to suggest new
 * entries based on frequently occurring unmatched terms.
 *
 * Schedule: Weekly (or triggered manually)
 * Usage: cd scripts && npx tsx pipelines/intent-gap-analysis.ts
 * Env: DRY_RUN=true to skip Claude call and just show keyword frequencies
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";

const DRY_RUN = process.env.DRY_RUN === "true";
const MIN_OCCURRENCES = parseInt(process.env.MIN_OCCURRENCES || "3", 10);
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "30", 10);
const TOP_N = parseInt(process.env.TOP_N || "20", 10);

interface SuggestedEntry {
  keyword: string;
  occurrences: number;
  suggested_tags: string[];
  suggested_cuisines: string[];
  suggested_features: string[];
  reasoning: string;
}

async function main() {
  console.log("=== Intent Gap Analysis Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Lookback: ${LOOKBACK_DAYS} days, Min occurrences: ${MIN_OCCURRENCES}, Top N: ${TOP_N}`);

  const supabase = createAdminClient();

  // Step 1: Query unmatched keywords from recent user queries
  const cutoffDate = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: queries, error } = await supabase
    .from("user_queries")
    .select("unmatched_keywords, special_request, donde_match")
    .gte("created_at", cutoffDate)
    .not("unmatched_keywords", "is", null);

  if (error) throw error;

  if (!queries || queries.length === 0) {
    console.log("No queries with unmatched keywords found. Dictionary coverage is complete!");
    return;
  }

  console.log(`Found ${queries.length} queries with unmatched keywords`);

  // Step 2: Aggregate keyword frequencies
  const keywordCounts = new Map<string, number>();
  const keywordContexts = new Map<string, string[]>(); // keyword -> sample special_requests

  for (const q of queries) {
    const keywords = q.unmatched_keywords as string[];
    for (const kw of keywords) {
      keywordCounts.set(kw, (keywordCounts.get(kw) || 0) + 1);
      if (!keywordContexts.has(kw)) keywordContexts.set(kw, []);
      const contexts = keywordContexts.get(kw)!;
      if (contexts.length < 3 && q.special_request) {
        contexts.push(q.special_request);
      }
    }
  }

  // Step 3: Sort by frequency and filter to top N with minimum occurrences
  const sorted = [...keywordCounts.entries()]
    .filter(([, count]) => count >= MIN_OCCURRENCES)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N);

  if (sorted.length === 0) {
    console.log(`No keywords with >= ${MIN_OCCURRENCES} occurrences. Reduce MIN_OCCURRENCES or wait for more data.`);
    console.log("\nAll unmatched keywords (by frequency):");
    const allSorted = [...keywordCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const [kw, count] of allSorted) {
      console.log(`  "${kw}": ${count} occurrence(s)`);
    }
    return;
  }

  console.log(`\nTop ${sorted.length} unmatched keywords (>= ${MIN_OCCURRENCES} occurrences):`);
  for (const [kw, count] of sorted) {
    const contexts = keywordContexts.get(kw) || [];
    console.log(`  "${kw}": ${count}x — e.g., "${contexts[0] || "N/A"}"`);
  }

  if (DRY_RUN) {
    console.log("\n[DRY RUN] Would call Claude to suggest INTENT_MAP entries. Set DRY_RUN=false to proceed.");
    return;
  }

  // Step 4: Ask Claude to suggest INTENT_MAP entries
  const keywordsForClaude = sorted.map(([kw, count]) => ({
    keyword: kw,
    occurrences: count,
    sample_queries: keywordContexts.get(kw) || [],
  }));

  const prompt = `You are helping improve a restaurant recommendation engine's keyword matching system for Chicago restaurants.

The system has an INTENT_MAP that maps user search terms to restaurant attributes (tags, cuisines, features).

Available tags: byob, rooftop, outdoor patio, hidden gem, late night, craft cocktails, live music, farm-to-table, scenic view, romantic, trendy, quiet, great value, brunch spot, waterfront, vegan friendly, gluten free, lively atmosphere

Available cuisines: Mexican, Italian, Japanese, Thai, Chinese, Korean, Indian, French, Seafood, Steak, Mediterranean, Vietnamese, Brunch, American, Ethiopian, Peruvian, Brazilian

Available features: outdoor_seating, live_music, pet_friendly

Here are the most frequently searched keywords that currently have NO matching entries in our system. For each keyword, suggest the most appropriate tags, cuisines, and/or features to map it to:

${JSON.stringify(keywordsForClaude, null, 2)}

Respond in this exact JSON format (array):
[
  {
    "keyword": "the keyword",
    "occurrences": 5,
    "suggested_tags": ["tag1", "tag2"],
    "suggested_cuisines": ["Cuisine1"],
    "suggested_features": ["outdoor_seating"],
    "reasoning": "Brief explanation of why these mappings make sense"
  }
]

Only include tags/cuisines/features from the available lists above. If a keyword doesn't clearly map to anything, use empty arrays and explain in reasoning.`;

  console.log("\nAsking Claude to suggest INTENT_MAP entries...");
  const response = await askClaude(prompt, { maxTokens: 4096, temperature: 0.2 });
  const suggestions = parseJsonResponse<SuggestedEntry[]>(response);

  // Step 5: Output structured report
  console.log("\n" + "=".repeat(70));
  console.log("SUGGESTED INTENT_MAP ADDITIONS");
  console.log("=".repeat(70));

  for (const s of suggestions) {
    const parts: string[] = [];
    if (s.suggested_cuisines.length > 0) {
      parts.push(`cuisines: [${s.suggested_cuisines.map((c) => `"${c}"`).join(", ")}]`);
    }
    if (s.suggested_tags.length > 0) {
      parts.push(`tags: [${s.suggested_tags.map((t) => `"${t}"`).join(", ")}]`);
    }
    if (s.suggested_features.length > 0) {
      parts.push(`features: [${s.suggested_features.map((f) => `"${f}"`).join(", ")}]`);
    }

    if (parts.length > 0) {
      console.log(`\n  "${s.keyword}": { ${parts.join(", ")} },`);
      console.log(`    // ${s.occurrences}x — ${s.reasoning}`);
    } else {
      console.log(`\n  // SKIP: "${s.keyword}" (${s.occurrences}x) — ${s.reasoning}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("Copy the entries above into INTENT_MAP in scoring.ts");
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("Intent gap analysis failed:", err);
  process.exit(1);
});
