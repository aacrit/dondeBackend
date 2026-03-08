/**
 * Converts V8 raw results JSONL to AtlasQuery JSONL format for the gauntlet runner.
 * Preserves test_id as query id so dataset_hash matches existing Supabase runs.
 *
 * Usage: npx tsx pipelines/convert-v8-to-atlas.ts <input.jsonl> <output.jsonl>
 */

import { readFileSync, writeFileSync } from "fs";

interface V8Result {
  test_id: string;
  query: string;
  category: string;
  min_score: number;
  occasion?: string;
  expected_cuisines?: string;
  [key: string]: unknown;
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: npx tsx pipelines/convert-v8-to-atlas.ts <input.jsonl> <output.jsonl>");
  process.exit(1);
}

const lines = readFileSync(input, "utf-8").split("\n").filter((l) => l.trim());
const atlasLines: string[] = [];

for (const line of lines) {
  const r: V8Result = JSON.parse(line);

  const expectedSignals: Record<string, unknown> = {
    min_score: r.min_score || 50,
  };
  if (r.expected_cuisines && r.expected_cuisines.toLowerCase() !== "any") {
    expectedSignals.cuisines = [r.expected_cuisines];
  }

  const atlas = {
    id: r.test_id,
    tier: 0,
    category: r.category.toLowerCase(),
    subcategory: "v8_retest",
    query: r.query,
    params: {
      special_request: r.query,
      occasion: r.occasion || "Any",
      neighborhood: "Anywhere",
      price_level: "Any",
      dietary_restrictions: [],
      time_of_day: null,
    },
    expected_signals: expectedSignals,
    search_volume_estimate: "medium",
    tags: ["v8-retest", r.category.toLowerCase()],
  };

  atlasLines.push(JSON.stringify(atlas));
}

writeFileSync(output, atlasLines.join("\n") + "\n");
console.log(`Converted ${atlasLines.length} queries: ${input} → ${output}`);
