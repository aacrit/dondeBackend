/**
 * Donde Gauntlet Gap Analyzer
 * Analyzes gauntlet results to detect and classify gaps in DB coverage, scoring, and intent.
 *
 * Usage: npx tsx pipelines/gap-analyzer.ts <results.jsonl>
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Types ───────────────────────────────────────────────────────────────────

interface QueryResult {
  query_id: string;
  query: string;
  tier: number;
  category: string;
  params: { special_request: string; occasion: string; neighborhood: string; price_level: string };
  result: {
    success: boolean;
    restaurant_name: string | null;
    cuisine_type: string | null;
    neighborhood: string | null;
    donde_match: number;
    relevance_score: number;
    relevance_type: string;
    quality_score: number;
    food: number; vibe: number; service: number; reputation: number; convenience: number;
    ranked_queue_size: number;
    response_time_ms: number;
    error?: string;
  };
  evaluation: {
    score_tier: string;
    score_pass: boolean;
    relevance_correct: boolean;
    cuisine_match: boolean | null;
    neighborhood_match: boolean | null;
    gap_type: string | null;
    gap_severity: string | null;
  };
}

interface Gap {
  query_id: string;
  query: string;
  tier: number;
  category: string;
  gap_type: string;
  gap_severity: string;
  donde_match: number;
  relevance_type: string;
  restaurant_name: string | null;
  details: string;
  impact_score: number;
  fix_action: string;
}

// ─── Schema Adapter (V8/V9 legacy → Gauntlet format) ─────────────────────────

function computeScoreTier(dm: number): string {
  if (dm >= 90) return "outstanding";
  if (dm >= 80) return "excellent";
  if (dm >= 70) return "strong";
  if (dm >= 60) return "solid";
  if (dm >= 50) return "marginal";
  return "weak";
}

function detectGapType(r: { donde_match: number; category?: string; intent_alignment?: { score: number; cuisine: number; dish: number; vibe: number } }): { gap_type: string | null; gap_severity: string | null } {
  const dm = r.donde_match;
  const ia = r.intent_alignment;

  if (dm < 40) return { gap_type: "db_coverage", gap_severity: "P0" };
  if (ia && ia.vibe < 0.3 && ia.cuisine < 0.3) return { gap_type: "intent", gap_severity: "P1" };
  if (dm >= 40 && dm < 60) return { gap_type: "scoring", gap_severity: "P1" };
  if (dm >= 60 && dm < 70) return { gap_type: "relevance_ceiling", gap_severity: "P2" };
  return { gap_type: null, gap_severity: null };
}

function normalizeResult(raw: any): QueryResult {
  // Already in gauntlet format
  if (raw.query_id && raw.result && raw.evaluation) return raw as QueryResult;

  // V8/V9 legacy flat format → gauntlet nested format
  const dm = raw.donde_match ?? 0;
  const gap = detectGapType(raw);

  return {
    query_id: raw.test_id || raw.id || "UNKNOWN",
    query: raw.query || "",
    tier: raw.tier ?? 0,
    category: (raw.category || "unknown").toLowerCase(),
    params: {
      special_request: raw.query || "",
      occasion: raw.occasion || "Any",
      neighborhood: raw.neighborhood || "Anywhere",
      price_level: raw.price_level || "Any",
    },
    result: {
      success: !!raw.restaurant_name || !!raw.top1?.name,
      restaurant_name: raw.restaurant_name || raw.top1?.name || null,
      cuisine_type: raw.cuisine_type || raw.top1?.cuisine || null,
      neighborhood: raw.neighborhood || null,
      donde_match: dm,
      relevance_score: raw.intent_alignment?.score ?? 0.5,
      relevance_type: raw.relevance_type || "unknown",
      quality_score: dm,
      food: raw.food ?? raw.top1?.food_q ?? 0,
      vibe: raw.vibe ?? 0,
      service: raw.service ?? 0,
      reputation: raw.reputation ?? 0,
      convenience: raw.convenience ?? 0,
      ranked_queue_size: raw.result_count ?? 1,
      response_time_ms: raw.response_time_ms ?? 0,
      error: raw.error,
    },
    evaluation: {
      score_tier: computeScoreTier(dm),
      score_pass: dm >= 60,
      relevance_correct: raw.intent_alignment?.score >= 0.5,
      cuisine_match: raw.expected_cuisines
        ? raw.expected_cuisines === "any" || (raw.cuisine_type || "").toLowerCase().includes(raw.expected_cuisines.toLowerCase())
        : null,
      neighborhood_match: null,
      gap_type: gap.gap_type,
      gap_severity: gap.gap_severity,
    },
  };
}

// ─── Impact Scoring ──────────────────────────────────────────────────────────

function volumeWeight(result: QueryResult): number {
  // Tiers 0-1 = high volume (3), Tier 2 = medium (2), Tier 3-5 = low (1)
  if (result.tier <= 1) return 3;
  if (result.tier === 2) return 2;
  return 1;
}

function severityWeight(severity: string): number {
  if (severity === "P0") return 5;
  if (severity === "P1") return 3;
  return 1;
}

function fixabilityWeight(gapType: string): number {
  const autoFixable = ["synonym", "neighborhood", "intent"];
  const semiAuto = ["db_coverage", "constraint"];
  if (autoFixable.includes(gapType)) return 3;
  if (semiAuto.includes(gapType)) return 2;
  return 1;
}

function fixAction(gapType: string): string {
  const actions: Record<string, string> = {
    db_coverage: "Run targeted discovery pipeline for missing cuisine/dish in this neighborhood",
    synonym: "Add dish term to DISH_SYNONYMS in scoring-v9.ts",
    neighborhood: "Add neighborhood alias to NEIGHBORHOOD_ALIASES in scoring-v9.ts",
    intent: "Add keyword to intent-classifier-v5.ts dictionaries",
    scoring: "Review weight profiles — potential tuning needed for this query pattern",
    cuisine_mismatch: "Verify restaurant cuisine_type is correctly classified",
    relevance_ceiling: "Analyze relevance multiplier for this category",
    diversity: "Tune diversity filter — over-indexing on popular restaurants",
    constraint: "Flag restaurants for re-enrichment (missing deep_profile data)",
    api_error: "Investigate API error — may indicate edge case in input handling",
  };
  return actions[gapType] || "Manual review required";
}

// ─── Diversity Gap Detection ─────────────────────────────────────────────────

function detectDiversityGaps(results: QueryResult[]): Gap[] {
  const gaps: Gap[] = [];
  const categoryRestaurants: Record<string, Record<string, number>> = {};

  for (const r of results) {
    if (!r.result.restaurant_name) continue;
    if (!categoryRestaurants[r.category]) categoryRestaurants[r.category] = {};
    const name = r.result.restaurant_name;
    categoryRestaurants[r.category][name] = (categoryRestaurants[r.category][name] || 0) + 1;
  }

  for (const [category, restaurants] of Object.entries(categoryRestaurants)) {
    const catTotal = Object.values(restaurants).reduce((s, c) => s + c, 0);
    for (const [name, count] of Object.entries(restaurants)) {
      const pct = count / catTotal;
      if (pct > 0.05 && count >= 3) {
        gaps.push({
          query_id: `DIV-${category}`,
          query: `[Diversity] ${name} appears in ${(pct * 100).toFixed(1)}% of ${category} queries`,
          tier: 0,
          category,
          gap_type: "diversity",
          gap_severity: "P2",
          donde_match: 0,
          relevance_type: "n/a",
          restaurant_name: name,
          details: `Restaurant "${name}" recommended ${count}/${catTotal} times (${(pct * 100).toFixed(1)}%) in category "${category}"`,
          impact_score: Math.round(count * 2),
          fix_action: fixAction("diversity"),
        });
      }
    }
  }
  return gaps;
}

// ─── Main Analysis ───────────────────────────────────────────────────────────

function analyze(resultsPath: string) {
  const lines = readFileSync(resultsPath, "utf-8").split("\n").filter((l) => l.trim());
  const results: QueryResult[] = lines.map((l) => normalizeResult(JSON.parse(l)));

  console.log(`\n  Analyzing ${results.length} results from ${basename(resultsPath)}...`);

  // Collect gaps from evaluation
  const gaps: Gap[] = [];
  for (const r of results) {
    if (r.evaluation.gap_type) {
      const severity = r.evaluation.gap_severity || "P2";
      gaps.push({
        query_id: r.query_id,
        query: r.query,
        tier: r.tier,
        category: r.category,
        gap_type: r.evaluation.gap_type,
        gap_severity: severity,
        donde_match: r.result.donde_match,
        relevance_type: r.result.relevance_type,
        restaurant_name: r.result.restaurant_name,
        details: `DM=${r.result.donde_match}, relevance=${r.result.relevance_type}, restaurant=${r.result.restaurant_name || "none"}`,
        impact_score: volumeWeight(r) * severityWeight(severity) * fixabilityWeight(r.evaluation.gap_type),
        fix_action: fixAction(r.evaluation.gap_type),
      });
    }
  }

  // Add diversity gaps
  gaps.push(...detectDiversityGaps(results));

  // Sort by impact
  gaps.sort((a, b) => b.impact_score - a.impact_score);

  // ─── Generate Gap Report (Markdown) ──────────────────────────────────────

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const gauntletResultsDir = join(__dirname, "..", "..", "tests", "gauntlet-results");
  const reportPath = join(gauntletResultsDir, `gap-report-${timestamp}.md`);

  let md = `# Donde Gauntlet Gap Report — ${new Date().toISOString().substring(0, 10)}\n\n`;

  // Summary
  const gapsByType: Record<string, Gap[]> = {};
  for (const g of gaps) {
    if (!gapsByType[g.gap_type]) gapsByType[g.gap_type] = [];
    gapsByType[g.gap_type].push(g);
  }

  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total queries analyzed | ${results.length} |\n`;
  md += `| Gaps detected | ${gaps.length} |\n`;
  md += `| P0 (critical) | ${gaps.filter((g) => g.gap_severity === "P0").length} |\n`;
  md += `| P1 (important) | ${gaps.filter((g) => g.gap_severity === "P1").length} |\n`;
  md += `| P2 (minor) | ${gaps.filter((g) => g.gap_severity === "P2").length} |\n`;
  md += `| Auto-fixable | ${gaps.filter((g) => ["synonym", "neighborhood", "intent"].includes(g.gap_type)).length} |\n\n`;

  // By type
  md += `## Gap Breakdown by Type\n\n`;
  md += `| Gap Type | Count | Severity | Fix Path |\n|----------|-------|----------|----------|\n`;
  for (const [type, typeGaps] of Object.entries(gapsByType).sort((a, b) => b[1].length - a[1].length)) {
    const primarySeverity = typeGaps[0].gap_severity;
    md += `| ${type} | ${typeGaps.length} | ${primarySeverity} | ${fixAction(type)} |\n`;
  }
  md += "\n";

  // Top 30 gaps by impact
  md += `## Top 30 Gaps by Impact Score\n\n`;
  md += `| # | Query | DM | Gap Type | Sev | Impact | Fix Action |\n`;
  md += `|---|-------|-----|----------|-----|--------|------------|\n`;
  for (const [i, g] of gaps.slice(0, 30).entries()) {
    md += `| ${i + 1} | ${g.query.substring(0, 40)} | ${g.donde_match} | ${g.gap_type} | ${g.gap_severity} | ${g.impact_score} | ${g.fix_action.substring(0, 50)} |\n`;
  }
  md += "\n";

  // Category gap counts
  md += `## Gaps by Category\n\n`;
  const catGapCounts: Record<string, number> = {};
  for (const g of gaps) {
    catGapCounts[g.category] = (catGapCounts[g.category] || 0) + 1;
  }
  md += `| Category | Gaps |\n|----------|------|\n`;
  for (const [cat, count] of Object.entries(catGapCounts).sort((a, b) => b[1] - a[1])) {
    md += `| ${cat} | ${count} |\n`;
  }
  md += "\n";

  // Action items
  md += `## Prioritized Action Items\n\n`;
  const actionGroups: Record<string, Gap[]> = {};
  for (const g of gaps) {
    if (!actionGroups[g.fix_action]) actionGroups[g.fix_action] = [];
    actionGroups[g.fix_action].push(g);
  }
  let actionNum = 1;
  for (const [action, actionGaps] of Object.entries(actionGroups).sort(
    (a, b) => b[1].reduce((s, g) => s + g.impact_score, 0) - a[1].reduce((s, g) => s + g.impact_score, 0)
  )) {
    const totalImpact = actionGaps.reduce((s, g) => s + g.impact_score, 0);
    md += `### ${actionNum}. ${action}\n`;
    md += `- **Affected queries:** ${actionGaps.length}\n`;
    md += `- **Total impact score:** ${totalImpact}\n`;
    md += `- **Examples:** ${actionGaps.slice(0, 5).map((g) => `"${g.query}"`).join(", ")}\n\n`;
    actionNum++;
  }

  writeFileSync(reportPath, md);
  console.log(`  ✓ Gap report: ${basename(reportPath)}`);

  // ─── Generate Gap Details (JSON) ──────────────────────────────────────────

  const detailsPath = join(gauntletResultsDir, `gap-details-${timestamp}.json`);
  writeFileSync(
    detailsPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        source: basename(resultsPath),
        total_queries: results.length,
        total_gaps: gaps.length,
        summary: {
          by_type: Object.fromEntries(Object.entries(gapsByType).map(([k, v]) => [k, v.length])),
          by_severity: {
            P0: gaps.filter((g) => g.gap_severity === "P0").length,
            P1: gaps.filter((g) => g.gap_severity === "P1").length,
            P2: gaps.filter((g) => g.gap_severity === "P2").length,
          },
          by_category: catGapCounts,
        },
        gaps,
      },
      null,
      2
    )
  );
  console.log(`  ✓ Gap details: ${basename(detailsPath)}`);

  // Print summary
  console.log(`\n  ┌────────────────────────────────────────┐`);
  console.log(`  │ Gaps: ${String(gaps.length).padEnd(5)} │ P0: ${String(gaps.filter((g) => g.gap_severity === "P0").length).padEnd(5)} │ P1: ${String(gaps.filter((g) => g.gap_severity === "P1").length).padEnd(5)}│`);
  console.log(`  │ Auto-fixable: ${String(gaps.filter((g) => ["synonym", "neighborhood", "intent"].includes(g.gap_type)).length).padEnd(25)}│`);
  console.log(`  └────────────────────────────────────────┘`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const resultsPath = process.argv[2];
if (!resultsPath) {
  console.error("Usage: npx tsx pipelines/gap-analyzer.ts <results.jsonl>");
  process.exit(1);
}
analyze(resultsPath);
