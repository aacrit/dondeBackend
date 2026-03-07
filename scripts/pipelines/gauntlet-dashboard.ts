/**
 * Donde Gauntlet Dashboard Generator
 * Generates markdown dashboard + JSON data for frontend from gauntlet results.
 *
 * Usage: npx tsx pipelines/gauntlet-dashboard.ts <results.jsonl>
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, "..", "..", "tests");

// ─── Types ───────────────────────────────────────────────────────────────────

interface QueryResult {
  query_id: string;
  query: string;
  tier: number;
  category: string;
  result: {
    success: boolean;
    restaurant_name: string | null;
    cuisine_type: string | null;
    neighborhood: string | null;
    donde_match: number;
    relevance_type: string;
    food: number; vibe: number; service: number; reputation: number; convenience: number;
    response_time_ms: number;
    was_lightweight: boolean;
    error?: string;
  };
  evaluation: {
    score_tier: string;
    score_pass: boolean;
    gap_type: string | null;
    gap_severity: string | null;
  };
  timestamp: string;
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

function detectGapType(r: { donde_match: number; intent_alignment?: { score: number; cuisine: number; dish: number; vibe: number } }): { gap_type: string | null; gap_severity: string | null } {
  const dm = r.donde_match;
  const ia = r.intent_alignment;

  if (dm < 40) return { gap_type: "db_coverage", gap_severity: "P0" };
  if (ia && ia.vibe < 0.3 && ia.cuisine < 0.3) return { gap_type: "intent", gap_severity: "P1" };
  if (dm >= 40 && dm < 60) return { gap_type: "scoring", gap_severity: "P1" };
  if (dm >= 60 && dm < 70) return { gap_type: "relevance_ceiling", gap_severity: "P2" };
  return { gap_type: null, gap_severity: null };
}

function normalizeResult(raw: any): QueryResult {
  if (raw.query_id && raw.result && raw.evaluation) return raw as QueryResult;

  const dm = raw.donde_match ?? 0;
  const gap = detectGapType(raw);

  return {
    query_id: raw.test_id || raw.id || "UNKNOWN",
    query: raw.query || "",
    tier: raw.tier ?? 0,
    category: (raw.category || "unknown").toLowerCase(),
    result: {
      success: !!raw.restaurant_name || !!raw.top1?.name,
      restaurant_name: raw.restaurant_name || raw.top1?.name || null,
      cuisine_type: raw.cuisine_type || raw.top1?.cuisine || null,
      neighborhood: raw.neighborhood || null,
      donde_match: dm,
      relevance_type: raw.relevance_type || "unknown",
      food: raw.food ?? raw.top1?.food_q ?? 0,
      vibe: raw.vibe ?? 0,
      service: raw.service ?? 0,
      reputation: raw.reputation ?? 0,
      convenience: raw.convenience ?? 0,
      response_time_ms: raw.response_time_ms ?? 0,
      was_lightweight: raw.was_lightweight ?? false,
      error: raw.error,
    },
    evaluation: {
      score_tier: computeScoreTier(dm),
      score_pass: dm >= 60,
      gap_type: gap.gap_type,
      gap_severity: gap.gap_severity,
    },
    timestamp: raw.timestamp || new Date().toISOString(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  if (d === 0) return "0";
  return ((n / d) * 100).toFixed(1);
}

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

function ragEmoji(dm: number): string {
  if (dm >= 80) return "G";
  if (dm >= 60) return "A";
  return "R";
}

// ─── Main ───────────────────────────────────────────────────────────────────

function generate(resultsPath: string) {
  const lines = readFileSync(resultsPath, "utf-8").split("\n").filter((l) => l.trim());
  const results: QueryResult[] = lines.map((l) => normalizeResult(JSON.parse(l)));
  const date = new Date().toISOString().substring(0, 10);

  // ─── Compute Statistics ──────────────────────────────────────────────────

  const total = results.length;
  const successful = results.filter((r) => r.result.success).length;
  const passed60 = results.filter((r) => r.result.donde_match >= 60).length;
  const passed80 = results.filter((r) => r.result.donde_match >= 80).length;
  const passed90 = results.filter((r) => r.result.donde_match >= 90).length;
  const avgDM = results.reduce((s, r) => s + r.result.donde_match, 0) / total;
  const gapCount = results.filter((r) => r.evaluation.gap_type).length;
  const avgResponseTime = results.reduce((s, r) => s + r.result.response_time_ms, 0) / total;
  const lightweight = results.filter((r) => r.result.was_lightweight).length;
  const totalCost = lightweight === total ? 0.21 * (total / 7000) : (total - lightweight) * 0.018 + lightweight * 0.00003;

  // ─── Statistical helpers ──────────────────────────────────────────────────
  const allDM = results.map((r) => r.result.donde_match).sort((a, b) => a - b);
  const percentile = (arr: number[], p: number) => arr[Math.min(Math.floor(arr.length * p), arr.length - 1)];
  const stddev = (arr: number[], mean: number) =>
    Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);

  const globalStats = {
    stddev: Math.round(stddev(allDM, avgDM) * 10) / 10,
    min: allDM[0],
    max: allDM[allDM.length - 1],
    p25: percentile(allDM, 0.25),
    p50: percentile(allDM, 0.5),
    p75: percentile(allDM, 0.75),
    p95: percentile(allDM, 0.95),
    scores: allDM,
  };

  // Global factor averages
  const factorSums = { food: 0, vibe: 0, service: 0, reputation: 0, convenience: 0 };
  for (const r of results) {
    factorSums.food += r.result.food;
    factorSums.vibe += r.result.vibe;
    factorSums.service += r.result.service;
    factorSums.reputation += r.result.reputation;
    factorSums.convenience += r.result.convenience;
  }
  const globalFactorAverages = {
    food: Math.round((factorSums.food / total) * 10) / 10,
    vibe: Math.round((factorSums.vibe / total) * 10) / 10,
    service: Math.round((factorSums.service / total) * 10) / 10,
    reputation: Math.round((factorSums.reputation / total) * 10) / 10,
    convenience: Math.round((factorSums.convenience / total) * 10) / 10,
  };

  // Category stats (enriched)
  interface CatStat {
    total: number; sumDM: number; pass60: number; pass80: number;
    below40: number; gaps: number; pass_score: number;
    dmValues: number[];
    sumFood: number; sumVibe: number; sumService: number; sumReputation: number; sumConvenience: number;
    gapTypeBreakdown: Record<string, number>;
  }
  const catStats: Record<string, CatStat> = {};
  for (const r of results) {
    if (!catStats[r.category]) catStats[r.category] = {
      total: 0, sumDM: 0, pass60: 0, pass80: 0, below40: 0, gaps: 0, pass_score: 0,
      dmValues: [], sumFood: 0, sumVibe: 0, sumService: 0, sumReputation: 0, sumConvenience: 0,
      gapTypeBreakdown: {},
    };
    const s = catStats[r.category];
    s.total++;
    s.sumDM += r.result.donde_match;
    s.dmValues.push(r.result.donde_match);
    s.sumFood += r.result.food;
    s.sumVibe += r.result.vibe;
    s.sumService += r.result.service;
    s.sumReputation += r.result.reputation;
    s.sumConvenience += r.result.convenience;
    if (r.result.donde_match >= 60) s.pass60++;
    if (r.result.donde_match >= 80) s.pass80++;
    if (r.result.donde_match < 40) s.below40++;
    if (r.evaluation.gap_type) {
      s.gaps++;
      s.gapTypeBreakdown[r.evaluation.gap_type] = (s.gapTypeBreakdown[r.evaluation.gap_type] || 0) + 1;
    }
    if (r.evaluation.score_pass) s.pass_score++;
  }

  // Tier stats
  const tierStats: Record<number, CatStat> = {};
  for (const r of results) {
    if (!tierStats[r.tier]) tierStats[r.tier] = { total: 0, sumDM: 0, pass60: 0, pass80: 0, below40: 0, gaps: 0, pass_score: 0 };
    const s = tierStats[r.tier];
    s.total++;
    s.sumDM += r.result.donde_match;
    if (r.result.donde_match >= 60) s.pass60++;
    if (r.result.donde_match >= 80) s.pass80++;
    if (r.result.donde_match < 40) s.below40++;
    if (r.evaluation.gap_type) s.gaps++;
    if (r.evaluation.score_pass) s.pass_score++;
  }

  // Neighborhood × Cuisine matrix
  const nxcMatrix: Record<string, Record<string, { count: number; sumDM: number }>> = {};
  for (const r of results) {
    const hood = r.result.neighborhood || "Unknown";
    const cuisine = r.result.cuisine_type || "Unknown";
    if (!nxcMatrix[hood]) nxcMatrix[hood] = {};
    if (!nxcMatrix[hood][cuisine]) nxcMatrix[hood][cuisine] = { count: 0, sumDM: 0 };
    nxcMatrix[hood][cuisine].count++;
    nxcMatrix[hood][cuisine].sumDM += r.result.donde_match;
  }

  // Top gaps
  const gaps = results
    .filter((r) => r.evaluation.gap_type)
    .sort((a, b) => a.result.donde_match - b.result.donde_match);

  // Gap type counts
  const gapTypeCounts: Record<string, number> = {};
  for (const r of gaps) {
    const gt = r.evaluation.gap_type!;
    gapTypeCounts[gt] = (gapTypeCounts[gt] || 0) + 1;
  }

  // Relevance type distribution
  const relTypeCounts: Record<string, number> = {};
  for (const r of results) {
    relTypeCounts[r.result.relevance_type] = (relTypeCounts[r.result.relevance_type] || 0) + 1;
  }

  // ─── Generate Markdown ───────────────────────────────────────────────────

  let md = `# Donde Gauntlet Dashboard — ${date}\n\n`;

  // Executive Summary
  md += `## Executive Summary\n\n`;
  md += "```\n";
  md += `┌──────────────────────────────────────────────────────┐\n`;
  md += `│  Queries Tested:    ${pad(String(total), 36)}│\n`;
  md += `│  API Success Rate:  ${pad(pct(successful, total) + "%", 36)}│\n`;
  md += `│  Pass Rate (DM≥60): ${pad(pct(passed60, total) + "%", 36)}│\n`;
  md += `│  Excellence (DM≥80):${pad(pct(passed80, total) + "%", 36)}│\n`;
  md += `│  Outstanding(DM≥90):${pad(pct(passed90, total) + "%", 36)}│\n`;
  md += `│  Average DondeMatch:${pad(avgDM.toFixed(1), 36)}│\n`;
  md += `│  Gaps Detected:     ${pad(String(gapCount), 36)}│\n`;
  md += `│  Avg Response Time:  ${pad(avgResponseTime.toFixed(0) + "ms", 35)}│\n`;
  md += `│  Mode:              ${pad(lightweight === total ? "Lightweight" : "Full-fidelity", 36)}│\n`;
  md += `│  Est. Cost:         ${pad("~$" + totalCost.toFixed(2), 36)}│\n`;
  md += `└──────────────────────────────────────────────────────┘\n`;
  md += "```\n\n";

  // Tier Performance
  md += `## Tier Performance\n\n`;
  md += `| Tier | Name | Queries | Avg DM | Pass (≥60) | Excel (≥80) | Weak (<40) | Gaps |\n`;
  md += `|------|------|---------|--------|------------|-------------|------------|------|\n`;
  const tierNames: Record<number, string> = {
    0: "Gold Standard", 1: "Core Singles", 2: "Two-Dim Combos",
    3: "NL + Slang", 4: "Edge Cases", 5: "Param Matrix",
  };
  for (const [tier, stats] of Object.entries(tierStats).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const avg = (stats.sumDM / stats.total).toFixed(1);
    md += `| ${tier} | ${tierNames[Number(tier)] || "?"} | ${stats.total} | ${avg} | ${pct(stats.pass60, stats.total)}% | ${pct(stats.pass80, stats.total)}% | ${pct(stats.below40, stats.total)}% | ${stats.gaps} |\n`;
  }
  md += "\n";

  // Category Performance Heatmap
  md += `## Category Performance\n\n`;
  md += `| Category | Queries | Avg DM | Pass (≥60) | Excel (≥80) | Weak (<40) | Gaps |\n`;
  md += `|----------|---------|--------|------------|-------------|------------|------|\n`;
  for (const [cat, stats] of Object.entries(catStats).sort((a, b) => b[1].total - a[1].total)) {
    const avg = (stats.sumDM / stats.total).toFixed(1);
    md += `| ${cat} | ${stats.total} | ${avg} | ${pct(stats.pass60, stats.total)}% | ${pct(stats.pass80, stats.total)}% | ${pct(stats.below40, stats.total)}% | ${stats.gaps} |\n`;
  }
  md += "\n";

  // Relevance Type Distribution
  md += `## Relevance Type Distribution\n\n`;
  md += `| Type | Count | % |\n|------|-------|---|\n`;
  for (const [type, count] of Object.entries(relTypeCounts).sort((a, b) => b[1] - a[1])) {
    md += `| ${type} | ${count} | ${pct(count, total)}% |\n`;
  }
  md += "\n";

  // Gap Summary
  md += `## Gap Summary\n\n`;
  md += `| Gap Type | Count | Severity |\n|----------|-------|----------|\n`;
  for (const [type, count] of Object.entries(gapTypeCounts).sort((a, b) => b[1] - a[1])) {
    const sev = gaps.find((g) => g.evaluation.gap_type === type)?.evaluation.gap_severity || "?";
    md += `| ${type} | ${count} | ${sev} |\n`;
  }
  md += "\n";

  // Top 20 Gaps
  md += `## Top 20 Gaps (Lowest Scores)\n\n`;
  md += `| # | Query | DM | Type | Category | Restaurant |\n`;
  md += `|---|-------|-----|------|----------|------------|\n`;
  for (const [i, g] of gaps.slice(0, 20).entries()) {
    md += `| ${i + 1} | ${g.query.substring(0, 35)} | ${g.result.donde_match} | ${g.evaluation.gap_type} | ${g.category} | ${(g.result.restaurant_name || "none").substring(0, 20)} |\n`;
  }
  md += "\n";

  // DM Score Distribution
  md += `## Score Distribution\n\n`;
  const buckets = [
    { label: "90-99 (Outstanding)", min: 90, max: 100 },
    { label: "80-89 (Excellent)", min: 80, max: 89 },
    { label: "70-79 (Strong)", min: 70, max: 79 },
    { label: "60-69 (Solid)", min: 60, max: 69 },
    { label: "50-59 (Marginal)", min: 50, max: 59 },
    { label: "40-49 (Weak)", min: 40, max: 49 },
    { label: "< 40 (Critical)", min: 0, max: 39 },
  ];
  md += `| Range | Count | % | Bar |\n|-------|-------|---|-----|\n`;
  for (const b of buckets) {
    const count = results.filter(
      (r) => r.result.donde_match >= b.min && r.result.donde_match <= b.max
    ).length;
    const barLen = Math.round((count / total) * 40);
    md += `| ${b.label} | ${count} | ${pct(count, total)}% | ${"█".repeat(barLen)} |\n`;
  }
  md += "\n";

  // Run info
  md += `---\n\n`;
  md += `*Generated: ${new Date().toISOString()} | Source: ${basename(resultsPath)}*\n`;

  // ─── Write Files ─────────────────────────────────────────────────────────

  const dashboardPath = join(TESTS_DIR, "GAUNTLET_DASHBOARD.md");
  writeFileSync(dashboardPath, md);
  console.log(`  ✓ Dashboard: ${dashboardPath.split("/tests/")[1]}`);

  // ─── Gap Impact Analysis ──────────────────────────────────────────────────
  const fixabilityMap: Record<string, string> = {
    intent: "auto", scoring: "tuning", db_coverage: "auto",
    relevance_ceiling: "architectural", diversity: "tuning",
    synonym: "auto", neighborhood: "auto", constraint: "tuning",
  };

  const gapImpact: Record<string, { count: number; sumDM: number; below60: number; fixability: string }> = {};
  for (const g of gaps) {
    const gt = g.evaluation.gap_type!;
    if (!gapImpact[gt]) gapImpact[gt] = { count: 0, sumDM: 0, below60: 0, fixability: fixabilityMap[gt] || "manual" };
    gapImpact[gt].count++;
    gapImpact[gt].sumDM += g.result.donde_match;
    if (g.result.donde_match < 60) gapImpact[gt].below60++;
  }

  const gapImpactOutput = Object.fromEntries(
    Object.entries(gapImpact).map(([type, gi]) => [
      type,
      {
        count: gi.count,
        avg_dm: Math.round((gi.sumDM / gi.count) * 10) / 10,
        fixability: gi.fixability,
        projected_dm_gain: Math.round(gi.below60 > 0
          ? gaps.filter((g) => g.evaluation.gap_type === type && g.result.donde_match < 60)
              .reduce((s, g) => s + (60 - g.result.donde_match), 0) / total * 10
          : 0) / 10,
        projected_pass_rate_gain: Math.round((gi.below60 / total) * 1000) / 10,
      },
    ])
  );

  // ─── Load gap-details for enriched gaps ─────────────────────────────────────
  const resultsDir = join(TESTS_DIR, "gauntlet-results");
  const gapDetailFiles = existsSync(resultsDir)
    ? readdirSync(resultsDir).filter((f) => f.startsWith("gap-details-") && f.endsWith(".json")).sort().reverse()
    : [];
  let gapDetailsMap: Record<string, { impact_score: number; fix_action: string; gap_severity: string }> = {};
  let gapDetailsFile: string | null = null;
  if (gapDetailFiles.length > 0) {
    gapDetailsFile = gapDetailFiles[0];
    try {
      const gd = JSON.parse(readFileSync(join(resultsDir, gapDetailsFile), "utf-8"));
      for (const g of gd.gaps || []) {
        gapDetailsMap[g.query_id || g.query] = {
          impact_score: g.impact_score ?? 0,
          fix_action: g.fix_action ?? "",
          gap_severity: g.gap_severity ?? "P2",
        };
      }
    } catch (_) { /* ignore */ }
  }

  // ─── Generate Recommendations ───────────────────────────────────────────────
  const recommendations: { priority: number; action: string; expected_impact: string; rationale: string; section: string }[] = [];

  // 1. Highest-impact gap type
  const sortedGapImpact = Object.entries(gapImpactOutput).sort((a, b) => b[1].projected_dm_gain - a[1].projected_dm_gain);
  if (sortedGapImpact.length > 0) {
    const [topGapType, topGap] = sortedGapImpact[0];
    if (topGap.projected_dm_gain > 0) {
      recommendations.push({
        priority: 1,
        action: `Fix ${topGap.count} ${topGapType} gaps (${topGap.fixability} fix)`,
        expected_impact: `+${topGap.projected_dm_gain} avg DM, +${topGap.projected_pass_rate_gain}% pass rate`,
        rationale: `${topGap.count} queries avg ${topGap.avg_dm} DM. ${topGap.fixability === "auto" ? "Dictionary expansion — fast automated fix." : topGap.fixability === "tuning" ? "Weight tuning required." : "Requires architectural changes to relevance multiplier."}`,
        section: "gaps",
      });
    }
  }

  // 2. Worst category
  const catEntries = Object.entries(catStats).sort((a, b) => (a[1].sumDM / a[1].total) - (b[1].sumDM / b[1].total));
  if (catEntries.length > 0) {
    const [worstCat, worstStats] = catEntries[0];
    const worstAvg = Math.round((worstStats.sumDM / worstStats.total) * 10) / 10;
    const topGapInCat = Object.entries(worstStats.gapTypeBreakdown).sort((a, b) => b[1] - a[1])[0];
    recommendations.push({
      priority: 2,
      action: `Improve "${worstCat}" category (${worstStats.pass60}/${worstStats.total} passing)`,
      expected_impact: `Category avg ${worstAvg} DM → target 65+`,
      rationale: topGapInCat
        ? `Primary gap type: ${topGapInCat[0]} (${topGapInCat[1]} gaps). Focus fixes here for max category lift.`
        : `${worstStats.gaps} gaps detected. Review scoring weights for this category.`,
      section: "categories",
    });
  }

  // 3. Relevance ceiling cluster
  const ceilingGaps = gaps.filter((g) => g.evaluation.gap_type === "relevance_ceiling");
  if (ceilingGaps.length > total * 0.3) {
    const ceilingAvg = Math.round(ceilingGaps.reduce((s, g) => s + g.result.donde_match, 0) / ceilingGaps.length * 10) / 10;
    recommendations.push({
      priority: 3,
      action: `Address relevance ceiling (${ceilingGaps.length} queries stuck at ${ceilingAvg} avg)`,
      expected_impact: `${Math.round(ceilingGaps.length / total * 100)}% of queries capped by relevance multiplier`,
      rationale: `These queries match correctly but score 60-69 due to relevance multiplier caps. Consider raising thresholds for high-quality restaurants or adjusting relevance scoring bands.`,
      section: "analysis",
    });
  }

  // 4. Factor weakness
  const factorEntries = Object.entries(globalFactorAverages) as [string, number][];
  const weakestFactor = factorEntries.sort((a, b) => a[1] - b[1])[0];
  if (weakestFactor && weakestFactor[1] < 6.5) {
    recommendations.push({
      priority: 4,
      action: `Strengthen "${weakestFactor[0]}" factor scoring (avg ${weakestFactor[1]}/10)`,
      expected_impact: `Lowest-performing factor across all queries`,
      rationale: `"${weakestFactor[0]}" consistently scores below other factors. Review data completeness and scoring signals for this dimension.`,
      section: "analysis",
    });
  }

  // 5. Second gap type if exists
  if (sortedGapImpact.length > 1) {
    const [secType, secGap] = sortedGapImpact[1];
    if (secGap.projected_dm_gain > 0) {
      recommendations.push({
        priority: 5,
        action: `Then fix ${secGap.count} ${secType} gaps`,
        expected_impact: `Additional +${secGap.projected_dm_gain} avg DM, +${secGap.projected_pass_rate_gain}% pass rate`,
        rationale: `Second highest ROI gap type. ${secGap.fixability === "auto" ? "Automated fix available." : "Manual tuning needed."}`,
        section: "gaps",
      });
    }
  }

  // JSON for frontend
  const jsonData = {
    generated: new Date().toISOString(),
    source: basename(resultsPath),
    summary: {
      total, successful, passed60, passed80, passed90,
      avg_dm: Math.round(avgDM * 10) / 10,
      gap_count: gapCount,
      avg_response_ms: Math.round(avgResponseTime),
      mode: lightweight === total ? "lightweight" : "full-fidelity",
      cost_estimate: Math.round(totalCost * 100) / 100,
    },
    statistics: globalStats,
    factor_averages: globalFactorAverages,
    tiers: Object.fromEntries(
      Object.entries(tierStats).map(([tier, stats]) => [
        tier,
        {
          name: tierNames[Number(tier)] || "?",
          total: stats.total,
          avg_dm: Math.round((stats.sumDM / stats.total) * 10) / 10,
          pass_rate_60: Math.round((stats.pass60 / stats.total) * 1000) / 10,
          excellence_rate: Math.round((stats.pass80 / stats.total) * 1000) / 10,
          gap_count: stats.gaps,
        },
      ])
    ),
    categories: Object.fromEntries(
      Object.entries(catStats).map(([cat, stats]) => {
        const catDM = stats.dmValues.sort((a, b) => a - b);
        const catAvg = stats.sumDM / stats.total;
        return [cat, {
          total: stats.total,
          avg_dm: Math.round(catAvg * 10) / 10,
          pass_rate_60: Math.round((stats.pass60 / stats.total) * 1000) / 10,
          excellence_rate: Math.round((stats.pass80 / stats.total) * 1000) / 10,
          weak_rate: Math.round((stats.below40 / stats.total) * 1000) / 10,
          gap_count: stats.gaps,
          stddev: Math.round(stddev(catDM, catAvg) * 10) / 10,
          p25: percentile(catDM, 0.25),
          p50: percentile(catDM, 0.5),
          p75: percentile(catDM, 0.75),
          factor_averages: {
            food: Math.round((stats.sumFood / stats.total) * 10) / 10,
            vibe: Math.round((stats.sumVibe / stats.total) * 10) / 10,
            service: Math.round((stats.sumService / stats.total) * 10) / 10,
            reputation: Math.round((stats.sumReputation / stats.total) * 10) / 10,
            convenience: Math.round((stats.sumConvenience / stats.total) * 10) / 10,
          },
          gap_type_breakdown: stats.gapTypeBreakdown,
        }];
      })
    ),
    relevance_types: relTypeCounts,
    gap_types: gapTypeCounts,
    gap_impact: gapImpactOutput,
    recommendations,
    all_gaps: gaps.map((g) => {
      const detail = gapDetailsMap[g.query_id] || gapDetailsMap[g.query] || {};
      return {
        query: g.query,
        dm: g.result.donde_match,
        gap_type: g.evaluation.gap_type,
        gap_severity: (detail as any).gap_severity || g.evaluation.gap_severity || "P2",
        category: g.category,
        restaurant: g.result.restaurant_name,
        impact_score: (detail as any).impact_score || 0,
        fix_action: (detail as any).fix_action || "",
        food: g.result.food,
        vibe: g.result.vibe,
        service: g.result.service,
        reputation: g.result.reputation,
        convenience: g.result.convenience,
      };
    }),
    gap_details_file: gapDetailsFile,
    score_distribution: buckets.map((b) => ({
      label: b.label,
      count: results.filter((r) => r.result.donde_match >= b.min && r.result.donde_match <= b.max).length,
    })),
  };

  const jsonPath = join(TESTS_DIR, "gauntlet-results", "dashboard-data.json");
  writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));
  console.log(`  ✓ Dashboard JSON: gauntlet-results/dashboard-data.json`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const resultsPath = process.argv[2];
if (!resultsPath) {
  // Try to find latest results
  const resultsDir = join(TESTS_DIR, "gauntlet-results");
  if (existsSync(resultsDir)) {
    const files = readdirSync(resultsDir).filter((f) => f.startsWith("run-") && f.endsWith(".jsonl")).sort().reverse();
    if (files.length > 0) {
      generate(join(resultsDir, files[0]));
      process.exit(0);
    }
  }
  console.error("Usage: npx tsx pipelines/gauntlet-dashboard.ts <results.jsonl>");
  process.exit(1);
}
generate(resultsPath);
