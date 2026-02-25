/**
 * DondeAI V4 Full Dataset Audit
 *
 * Comprehensive read-only audit across all tables that feed the recommendation engine.
 * Reports data gaps, quality grades, cross-table integrity, and a Scoring Impact Matrix.
 *
 * Usage:
 *   npx tsx scripts/pipelines/audit-full-dataset.ts
 *   npx tsx scripts/pipelines/audit-full-dataset.ts --json   # Also write audit-results-{date}.json
 */

import { createAdminClient } from "../lib/supabase";
import * as fs from "fs";

// ==========================================
// TYPES
// ==========================================

interface ColumnAudit {
  column: string;
  total: number;
  nullCount: number;
  emptyCount: number;
  emptyArrayCount: number;
  filledCount: number;
  filledPct: string;
  grade: string;
  distribution: Record<string, number>;
}

interface ScoringImpact {
  dataGap: string;
  affectedFactor: string;
  subCriterion: string;
  restaurantsAffected: number;
  scoreImpactEstimate: string;
  priority: number;
}

// ==========================================
// HELPERS
// ==========================================

function grade(filledPct: number): string {
  if (filledPct >= 95) return "A";
  if (filledPct >= 85) return "B";
  if (filledPct >= 70) return "C";
  if (filledPct >= 50) return "D";
  return "F";
}

function isEmpty(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  if (Array.isArray(val) && val.length === 0) return true;
  return false;
}

function isEmptyArray(val: unknown): boolean {
  return Array.isArray(val) && val.length === 0;
}

function countValues(rows: Record<string, unknown>[], col: string): {
  nullCount: number;
  emptyCount: number;
  emptyArrayCount: number;
  distribution: Record<string, number>;
} {
  let nullCount = 0;
  let emptyCount = 0;
  let emptyArrayCount = 0;
  const distribution: Record<string, number> = {};

  for (const row of rows) {
    const val = row[col];
    if (val === null || val === undefined) {
      nullCount++;
      continue;
    }
    if (typeof val === "string" && val.trim() === "") {
      emptyCount++;
      continue;
    }
    if (isEmptyArray(val)) {
      emptyArrayCount++;
      continue;
    }

    // Count distribution
    let key: string;
    if (Array.isArray(val)) {
      key = `[${val.length} items]`;
    } else if (typeof val === "object") {
      key = JSON.stringify(val).substring(0, 60);
    } else {
      key = String(val);
    }
    distribution[key] = (distribution[key] || 0) + 1;
  }

  return { nullCount, emptyCount, emptyArrayCount, distribution };
}

function auditColumn(rows: Record<string, unknown>[], col: string): ColumnAudit {
  const total = rows.length;
  const { nullCount, emptyCount, emptyArrayCount, distribution } = countValues(rows, col);
  const filledCount = total - nullCount - emptyCount - emptyArrayCount;
  const filledPct = total > 0 ? ((filledCount / total) * 100).toFixed(1) : "0.0";

  // Top 10 distribution
  const sorted = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const top10: Record<string, number> = {};
  for (const [k, v] of sorted) top10[k] = v;

  return {
    column: col,
    total,
    nullCount,
    emptyCount,
    emptyArrayCount,
    filledCount,
    filledPct,
    grade: grade(parseFloat(filledPct)),
    distribution: top10,
  };
}

function printColumnAudit(audit: ColumnAudit, tier?: string) {
  const tierTag = tier ? ` [${tier}]` : "";
  const missing = audit.nullCount + audit.emptyCount + audit.emptyArrayCount;
  console.log(
    `  ${audit.column}${tierTag}: ${audit.grade} — ${audit.filledPct}% filled (${missing} missing: ${audit.nullCount} NULL, ${audit.emptyCount} empty, ${audit.emptyArrayCount} empty[])`
  );
  if (Object.keys(audit.distribution).length > 0 && Object.keys(audit.distribution).length <= 15) {
    for (const [val, count] of Object.entries(audit.distribution)) {
      console.log(`    ${val}: ${count}`);
    }
  } else if (Object.keys(audit.distribution).length > 15) {
    const entries = Object.entries(audit.distribution).slice(0, 10);
    for (const [val, count] of entries) {
      console.log(`    ${val}: ${count}`);
    }
    console.log(`    ... and ${Object.keys(audit.distribution).length - 10} more values`);
  }
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ==========================================
// MAIN
// ==========================================

async function main() {
  const supabase = createAdminClient();
  const WRITE_JSON = process.argv.includes("--json");
  const auditData: Record<string, unknown> = {};

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║     DondeAI V4 Full Dataset Audit                   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // ==========================================
  // 1.1 — RESTAURANTS TABLE
  // ==========================================

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("1.1 — restaurants table");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const { data: restaurants, error: rErr } = await supabase
    .from("restaurants")
    .select("*")
    .eq("is_active", true);

  if (rErr) {
    console.error("Failed to fetch restaurants:", rErr.message);
    process.exit(1);
  }

  const rRows = (restaurants || []) as Record<string, unknown>[];
  console.log(`Total active restaurants: ${rRows.length}\n`);

  // Scoring-critical columns
  const scoringCritical = [
    "cuisine_type", "noise_level", "lighting_ambiance", "dress_code",
    "dietary_options", "best_for_oneliner", "insider_tip", "price_level",
    "outdoor_seating", "live_music", "best_times", "good_for", "ambiance",
  ];

  // All restaurant columns to audit
  const rCols = rRows.length > 0 ? Object.keys(rRows[0]) : [];
  const rAudits: ColumnAudit[] = [];

  console.log("Scoring-Critical Columns:");
  for (const col of scoringCritical) {
    if (!rCols.includes(col)) {
      console.log(`  ${col}: MISSING FROM TABLE`);
      continue;
    }
    const audit = auditColumn(rRows, col);
    rAudits.push(audit);
    printColumnAudit(audit);
  }

  console.log("\nAll Other Columns:");
  for (const col of rCols) {
    if (scoringCritical.includes(col)) continue;
    const audit = auditColumn(rRows, col);
    rAudits.push(audit);
    printColumnAudit(audit);
  }

  // Check for suspicious enum values
  console.log("\nSuspicious Values Check:");
  const validNoise = ["Quiet", "Moderate", "Loud"];
  const noiseDist = countValues(rRows, "noise_level");
  for (const val of Object.keys(noiseDist.distribution)) {
    if (!validNoise.includes(val)) {
      console.log(`  ⚠ noise_level: "${val}" (${noiseDist.distribution[val]} rows) — not in ${validNoise.join("|")}`);
    }
  }

  const validDress = ["Casual", "Smart Casual", "Business Casual", "Formal"];
  const dressDist = countValues(rRows, "dress_code");
  for (const val of Object.keys(dressDist.distribution)) {
    if (!validDress.includes(val)) {
      console.log(`  ⚠ dress_code: "${val}" (${dressDist.distribution[val]} rows) — not in ${validDress.join("|")}`);
    }
  }

  const validPrice = ["$", "$$", "$$$", "$$$$"];
  const priceDist = countValues(rRows, "price_level");
  for (const val of Object.keys(priceDist.distribution)) {
    if (!validPrice.includes(val)) {
      console.log(`  ⚠ price_level: "${val}" (${priceDist.distribution[val]} rows) — not in ${validPrice.join("|")}`);
    }
  }

  auditData.restaurants = { total: rRows.length, columns: rAudits };

  // ==========================================
  // 1.2 — RESTAURANT_DEEP_PROFILES TABLE
  // ==========================================

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("1.2 — restaurant_deep_profiles table");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const { data: deepProfiles, error: dpErr } = await supabase
    .from("restaurant_deep_profiles")
    .select("*");

  if (dpErr) {
    console.error("Failed to fetch deep profiles:", dpErr.message);
    process.exit(1);
  }

  const dpRows = (deepProfiles || []) as Record<string, unknown>[];
  console.log(`Total deep profiles: ${dpRows.length}\n`);

  // Tier classifications
  const tier1 = [
    "flavor_profiles", "signature_dishes", "cuisine_subcategory", "spice_level",
    "service_style", "meal_pacing", "reservation_difficulty", "typical_wait_minutes",
    "group_size_sweet_spot", "kid_friendliness", "music_vibe",
    "conversation_friendliness", "energy_level", "origin_story", "enrichment_confidence",
  ];
  const tier2 = [
    "check_average_per_person", "seating_options", "instagram_worthiness",
    "cultural_authenticity", "crowd_profile", "wow_factors", "best_seat_in_house",
    "date_progression", "decor_style", "awards_recognition", "chef_notable",
    "unique_selling_point",
  ];
  const tier3 = [
    "seasonal_relevance", "neighborhood_integration", "ideal_weather",
    "transit_accessibility", "byob_policy", "payment_notes", "dietary_depth",
    "menu_depth", "tipping_culture",
  ];

  const dpAudits: ColumnAudit[] = [];

  console.log("Tier 1 — Directly Used in Factor Computation (HIGH IMPACT):");
  for (const col of tier1) {
    const audit = auditColumn(dpRows, col);
    dpAudits.push(audit);
    printColumnAudit(audit, "T1");
  }

  console.log("\nTier 2 — UI Display and Blurb Generation (MEDIUM IMPACT):");
  for (const col of tier2) {
    const audit = auditColumn(dpRows, col);
    dpAudits.push(audit);
    printColumnAudit(audit, "T2");
  }

  console.log("\nTier 3 — Contextual / Nice-to-Have:");
  for (const col of tier3) {
    const audit = auditColumn(dpRows, col);
    dpAudits.push(audit);
    printColumnAudit(audit, "T3");
  }

  // Remaining columns
  const dpCols = dpRows.length > 0 ? Object.keys(dpRows[0]) : [];
  const knownDpCols = new Set([...tier1, ...tier2, ...tier3, "restaurant_id", "id", "enriched_at", "enrichment_version"]);
  const unknownDpCols = dpCols.filter((c) => !knownDpCols.has(c));
  if (unknownDpCols.length > 0) {
    console.log("\nOther/Unknown Columns:");
    for (const col of unknownDpCols) {
      const audit = auditColumn(dpRows, col);
      dpAudits.push(audit);
      printColumnAudit(audit);
    }
  }

  auditData.deep_profiles = { total: dpRows.length, columns: dpAudits };

  // ==========================================
  // 1.3 — OCCASION_SCORES TABLE
  // ==========================================

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("1.3 — occasion_scores table");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const { data: occasionScores, error: osErr } = await supabase
    .from("occasion_scores")
    .select("*");

  if (osErr) {
    console.error("Failed to fetch occasion scores:", osErr.message);
    process.exit(1);
  }

  const osRows = (occasionScores || []) as Record<string, unknown>[];
  console.log(`Total occasion_scores rows: ${osRows.length}\n`);

  const scoreDimensions = [
    "date_friendly_score", "group_friendly_score", "family_friendly_score",
    "romantic_rating", "business_lunch_score", "solo_dining_score", "hole_in_wall_factor",
  ];

  // Distribution histograms per dimension
  console.log("Score Distribution per Dimension:");
  const osStats: Record<string, { histogram: Record<number, number>; nullCount: number; zeroCount: number; mean: number }> = {};

  for (const dim of scoreDimensions) {
    const histogram: Record<number, number> = {};
    let nullCount = 0;
    let zeroCount = 0;
    let sum = 0;
    let count = 0;

    for (const row of osRows) {
      const val = row[dim];
      if (val === null || val === undefined) {
        nullCount++;
        continue;
      }
      const n = Number(val);
      if (n === 0) zeroCount++;
      histogram[n] = (histogram[n] || 0) + 1;
      sum += n;
      count++;
    }

    const mean = count > 0 ? sum / count : 0;
    osStats[dim] = { histogram, nullCount, zeroCount, mean };

    // Print compact histogram
    const bars = [];
    for (let i = 0; i <= 10; i++) {
      bars.push(`${i}:${histogram[i] || 0}`);
    }
    console.log(`  ${dim}: mean=${mean.toFixed(1)} | NULL=${nullCount} | zero=${zeroCount}`);
    console.log(`    [${bars.join(" ")}]`);
  }

  // Identical scores check
  let identicalCount = 0;
  const identicalRestaurants: string[] = [];
  for (const row of osRows) {
    const scores = scoreDimensions.map((d) => Number(row[d]));
    if (scores.every((s) => s === scores[0])) {
      identicalCount++;
      identicalRestaurants.push(row.restaurant_id as string);
    }
  }
  console.log(`\nRows where ALL 7 scores identical: ${identicalCount} (suggests bulk-generated)`);
  if (identicalCount > 0 && identicalCount <= 10) {
    console.log(`  IDs: ${identicalRestaurants.join(", ")}`);
  }

  // Contradiction detection: look up noise_level for restaurants
  const restaurantMap = new Map<string, Record<string, unknown>>();
  for (const r of rRows) {
    restaurantMap.set(r.id as string, r);
  }

  let contradictionCount = 0;
  for (const row of osRows) {
    const rid = row.restaurant_id as string;
    const rest = restaurantMap.get(rid);
    if (!rest) continue;

    const noise = rest.noise_level as string | null;
    const romantic = Number(row.romantic_rating) || 0;
    const family = Number(row.family_friendly_score) || 0;

    // Loud + high romantic = contradiction
    if (noise === "Loud" && romantic >= 8) {
      if (contradictionCount < 5) {
        console.log(`  ⚠ Contradiction: ${rest.name} — noise=Loud but romantic_rating=${romantic}`);
      }
      contradictionCount++;
    }
    // Loud + high family = potential issue
    if (noise === "Loud" && family >= 8) {
      if (contradictionCount < 10) {
        console.log(`  ⚠ Contradiction: ${rest.name} — noise=Loud but family_friendly=${family}`);
      }
      contradictionCount++;
    }
  }
  console.log(`Total contradictions found: ${contradictionCount}`);

  // Any NULL or 0 scores
  let anyNullOrZero = 0;
  for (const row of osRows) {
    for (const dim of scoreDimensions) {
      const val = row[dim];
      if (val === null || val === undefined || Number(val) === 0) {
        anyNullOrZero++;
        break;
      }
    }
  }
  console.log(`Rows with any NULL or 0 score: ${anyNullOrZero}`);

  auditData.occasion_scores = { total: osRows.length, stats: osStats, identicalCount, contradictionCount };

  // ==========================================
  // 1.4 — TAGS TABLE
  // ==========================================

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("1.4 — tags table");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const { data: tags, error: tErr } = await supabase.from("tags").select("*");

  if (tErr) {
    console.error("Failed to fetch tags:", tErr.message);
    process.exit(1);
  }

  const tRows = (tags || []) as Record<string, unknown>[];
  console.log(`Total tags: ${tRows.length}\n`);

  // Tags per restaurant
  const tagsPerRestaurant = new Map<string, number>();
  for (const t of tRows) {
    const rid = t.restaurant_id as string;
    tagsPerRestaurant.set(rid, (tagsPerRestaurant.get(rid) || 0) + 1);
  }

  const tagCounts = Array.from(tagsPerRestaurant.values());
  const minTags = tagCounts.length > 0 ? Math.min(...tagCounts) : 0;
  const maxTags = tagCounts.length > 0 ? Math.max(...tagCounts) : 0;
  const avgTags = tagCounts.length > 0 ? tagCounts.reduce((a, b) => a + b, 0) / tagCounts.length : 0;
  const medianTags = median(tagCounts);

  console.log(`Tags per restaurant: min=${minTags}, max=${maxTags}, avg=${avgTags.toFixed(1)}, median=${medianTags}`);

  // Restaurants with 0 tags
  const restaurantsWithTags = new Set(tagsPerRestaurant.keys());
  const restaurantsWithoutTags = rRows.filter((r) => !restaurantsWithTags.has(r.id as string));
  console.log(`Restaurants with 0 tags: ${restaurantsWithoutTags.length}`);
  if (restaurantsWithoutTags.length > 0 && restaurantsWithoutTags.length <= 10) {
    for (const r of restaurantsWithoutTags) {
      console.log(`  - ${r.name} (${r.id})`);
    }
  }

  // Distribution by tag_category
  const categoryDist: Record<string, number> = {};
  for (const t of tRows) {
    const cat = (t.tag_category as string) || "uncategorized";
    categoryDist[cat] = (categoryDist[cat] || 0) + 1;
  }
  console.log("\nDistribution by tag_category:");
  for (const [cat, count] of Object.entries(categoryDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  // Top 20 and bottom 20 tags
  const tagTextDist: Record<string, number> = {};
  for (const t of tRows) {
    const text = (t.tag_text as string) || "";
    tagTextDist[text] = (tagTextDist[text] || 0) + 1;
  }
  const sortedTags = Object.entries(tagTextDist).sort((a, b) => b[1] - a[1]);

  console.log("\nTop 20 most common tags:");
  for (const [tag, count] of sortedTags.slice(0, 20)) {
    console.log(`  "${tag}": ${count}`);
  }

  console.log("\nBottom 20 least common tags:");
  for (const [tag, count] of sortedTags.slice(-20)) {
    console.log(`  "${tag}": ${count}`);
  }

  // Near-duplicate detection
  console.log("\nNear-Duplicate Tags:");
  const normalized = new Map<string, string[]>();
  for (const [tag] of sortedTags) {
    const norm = tag.toLowerCase().replace(/[-_\s]+/g, " ").trim();
    if (!normalized.has(norm)) normalized.set(norm, []);
    normalized.get(norm)!.push(tag);
  }
  let dupCount = 0;
  for (const [norm, variants] of normalized) {
    if (variants.length > 1) {
      console.log(`  "${norm}" → [${variants.map((v) => `"${v}"`).join(", ")}]`);
      dupCount++;
    }
  }
  if (dupCount === 0) console.log("  None found");

  auditData.tags = {
    total: tRows.length,
    perRestaurant: { min: minTags, max: maxTags, avg: avgTags, median: medianTags },
    withoutTags: restaurantsWithoutTags.length,
    categoryDist,
    topTags: sortedTags.slice(0, 20),
  };

  // ==========================================
  // 1.5 — CROSS-TABLE INTEGRITY
  // ==========================================

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("1.5 — Cross-Table Integrity");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const restaurantIds = new Set(rRows.map((r) => r.id as string));
  const dpIds = new Set(dpRows.map((r) => r.restaurant_id as string));
  const osIds = new Set(osRows.map((r) => r.restaurant_id as string));
  const tagRestIds = new Set(tRows.map((r) => r.restaurant_id as string));

  // Restaurants with no deep_profile
  const noDpIds = [...restaurantIds].filter((id) => !dpIds.has(id));
  console.log(`Restaurants with NO deep_profile: ${noDpIds.length}`);
  for (const id of noDpIds) {
    const r = restaurantMap.get(id);
    console.log(`  - ${r?.name || id} (${id})`);
  }

  // Restaurants with no occasion_scores
  const noOsIds = [...restaurantIds].filter((id) => !osIds.has(id));
  console.log(`Restaurants with NO occasion_scores: ${noOsIds.length}`);
  for (const id of noOsIds.slice(0, 10)) {
    const r = restaurantMap.get(id);
    console.log(`  - ${r?.name || id}`);
  }
  if (noOsIds.length > 10) console.log(`  ... and ${noOsIds.length - 10} more`);

  // Restaurants with no tags
  const noTagIds = [...restaurantIds].filter((id) => !tagRestIds.has(id));
  console.log(`Restaurants with NO tags: ${noTagIds.length}`);
  for (const id of noTagIds.slice(0, 10)) {
    const r = restaurantMap.get(id);
    console.log(`  - ${r?.name || id}`);
  }
  if (noTagIds.length > 10) console.log(`  ... and ${noTagIds.length - 10} more`);

  // Orphaned rows
  const orphanedDp = [...dpIds].filter((id) => !restaurantIds.has(id));
  const orphanedOs = [...osIds].filter((id) => !restaurantIds.has(id));
  const orphanedTags = [...tagRestIds].filter((id) => !restaurantIds.has(id));
  console.log(`\nOrphaned deep_profiles (no matching restaurant): ${orphanedDp.length}`);
  console.log(`Orphaned occasion_scores (no matching restaurant): ${orphanedOs.length}`);
  console.log(`Orphaned tags (no matching restaurant): ${orphanedTags.length}`);

  // Enrichment confidence distribution
  console.log("\nenrichment_confidence distribution:");
  const confValues = dpRows
    .map((r) => r.enrichment_confidence)
    .filter((v) => v !== null && v !== undefined)
    .map((v) => Number(v));

  if (confValues.length > 0) {
    const confMean = confValues.reduce((a, b) => a + b, 0) / confValues.length;
    const confMedian = median(confValues);
    const belowHalf = confValues.filter((v) => v < 0.5).length;
    const belowThree = confValues.filter((v) => v < 0.3).length;
    const confMin = Math.min(...confValues);
    const confMax = Math.max(...confValues);

    console.log(`  Count: ${confValues.length}, Mean: ${confMean.toFixed(3)}, Median: ${confMedian.toFixed(3)}`);
    console.log(`  Min: ${confMin.toFixed(3)}, Max: ${confMax.toFixed(3)}`);
    console.log(`  Below 0.5 (low confidence): ${belowHalf} (${((belowHalf / confValues.length) * 100).toFixed(1)}%)`);
    console.log(`  Below 0.3 (very low): ${belowThree} (${((belowThree / confValues.length) * 100).toFixed(1)}%)`);

    // Histogram in 0.1 buckets
    const buckets: Record<string, number> = {};
    for (const v of confValues) {
      const bucket = (Math.floor(v * 10) / 10).toFixed(1);
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
    console.log("  Histogram:");
    for (const [bucket, count] of Object.entries(buckets).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
      const bar = "█".repeat(Math.ceil(count / 10));
      console.log(`    ${bucket}: ${count} ${bar}`);
    }
  } else {
    console.log("  No confidence values found");
  }

  const nullConfCount = dpRows.filter((r) => r.enrichment_confidence === null || r.enrichment_confidence === undefined).length;
  console.log(`  NULL enrichment_confidence: ${nullConfCount}`);

  auditData.crossTable = {
    noDeepProfile: noDpIds,
    noOccasionScores: noOsIds.length,
    noTags: noTagIds.length,
    orphanedDp: orphanedDp.length,
    orphanedOs: orphanedOs.length,
    orphanedTags: orphanedTags.length,
  };

  // ==========================================
  // 1.6 — SCORING IMPACT MATRIX
  // ==========================================

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("1.6 — Scoring Impact Matrix");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const impacts: ScoringImpact[] = [];

  // Helper: count missing for a column across restaurants or deep_profiles
  function rMissing(col: string): number {
    return rRows.filter((r) => isEmpty(r[col])).length;
  }
  function dpMissing(col: string): number {
    return dpRows.filter((r) => isEmpty(r[col])).length;
  }

  // enrichment_confidence scale mismatch — affects ALL scoring
  const lowConfCount = confValues.filter((v) => v < 0.3).length;
  impacts.push({
    dataGap: "enrichment_confidence < 0.3 (V4 'low' threshold)",
    affectedFactor: "ALL (Food, Vibe, Service)",
    subCriterion: "50% regression toward 5.5 for all enrichment-dependent factors",
    restaurantsAffected: lowConfCount,
    scoreImpactEstimate: "HIGH — destroys score differentiation",
    priority: lowConfCount * 10,
  });

  // noise_level NULL — excluded from RPC entirely
  const noiseNull = rMissing("noise_level");
  impacts.push({
    dataGap: "noise_level NULL",
    affectedFactor: "Vibe (Atmosphere)",
    subCriterion: "Restaurant excluded from RPC results (WHERE noise_level IS NOT NULL)",
    restaurantsAffected: noiseNull,
    scoreImpactEstimate: "CRITICAL — restaurant invisible to recommendations",
    priority: noiseNull * 100,
  });

  // Other scoring-critical fields
  const fieldImpacts: Array<[string, string, string, string, number, string]> = [
    ["cuisine_type", "Food Quality", "Cuisine alignment (0-6)", "restaurants", 8, "FQ capped at 4/10"],
    ["lighting_ambiance", "Vibe", "Lighting match (0-2)", "restaurants", 3, "Vibe sub-score drops"],
    ["dress_code", "Vibe", "Dress code (0-1)", "restaurants", 1, "Minor vibe impact"],
    ["price_level", "Convenience", "Price mismatch penalty", "restaurants", 5, "Can't filter/penalize price"],
    ["dietary_options", "Food Quality", "Dietary fit (0-2)", "restaurants", 3, "Dealbreaker can't fire"],
    ["best_for_oneliner", "Frontend UI", "Card description", "restaurants", 0, "Empty card"],
    ["insider_tip", "Frontend UI", "Social proof element", "restaurants", 0, "Missing blurb grounding"],
    ["best_times", "Convenience", "Timing fit", "restaurants", 2, "Can't score timing"],
    ["good_for", "Service", "Occasion context", "restaurants", 1, "Weaker occasion matching"],
    ["ambiance", "Vibe", "Vibe keyword matches", "restaurants", 1, "Fewer vibe hits"],
    ["flavor_profiles", "Food Quality", "Flavor profile match (0-2)", "deep_profiles", 3, "FQ sub-score drops"],
    ["signature_dishes", "Food Quality", "Menu interest (0-1)", "deep_profiles", 2, "No dish matching"],
    ["service_style", "Service", "Service style alignment (-0.5 to +1.5)", "deep_profiles", 4, "Service sub-score flat"],
    ["meal_pacing", "Service", "Pacing score", "deep_profiles", 2, "Missing pacing signal"],
    ["reservation_difficulty", "Convenience", "Reservation accessibility (-2.5 to +2)", "deep_profiles", 3, "Can't score accessibility"],
    ["typical_wait_minutes", "Convenience", "Wait time (-1 to +1)", "deep_profiles", 1, "Missing wait signal"],
    ["group_size_sweet_spot", "Service", "Social dynamics", "deep_profiles", 2, "Missing group fit"],
    ["kid_friendliness", "Service", "Family occasion scoring", "deep_profiles", 2, "Family score flat"],
    ["music_vibe", "Vibe", "Music vibe (0-1.5)", "deep_profiles", 3, "Vibe sub-score drops"],
    ["conversation_friendliness", "Vibe / Service", "Cross-factor", "deep_profiles", 2, "Missing cross-factor"],
    ["energy_level", "Vibe", "Energy level (0-2)", "deep_profiles", 3, "Vibe sub-score drops"],
    ["origin_story", "Frontend UI", "Card content + blurb grounding", "deep_profiles", 0, "Missing narrative"],
    ["cultural_authenticity", "Reputation", "Authenticity bonus (+0.5)", "deep_profiles", 1, "Missing rep signal"],
    ["awards_recognition", "Reputation", "Awards (0-2)", "deep_profiles", 1, "Missing rep signal"],
    ["neighborhood_integration", "Reputation", "Community standing (0-2)", "deep_profiles", 2, "Missing rep signal"],
  ];

  for (const [field, factor, subCrit, table, impact, desc] of fieldImpacts) {
    const missing = table === "restaurants" ? rMissing(field) : dpMissing(field);
    if (missing > 0) {
      impacts.push({
        dataGap: `${field} missing`,
        affectedFactor: factor,
        subCriterion: subCrit,
        restaurantsAffected: missing,
        scoreImpactEstimate: desc,
        priority: missing * impact,
      });
    }
  }

  // Sort by priority (count × impact)
  impacts.sort((a, b) => b.priority - a.priority);

  // Print matrix
  console.log("Rank | Data Gap                                  | Factor          | # Affected | Impact");
  console.log("─────┼───────────────────────────────────────────┼─────────────────┼────────────┼────────────────────────────");
  for (let i = 0; i < impacts.length; i++) {
    const imp = impacts[i];
    const rank = String(i + 1).padStart(4);
    const gap = imp.dataGap.padEnd(43).substring(0, 43);
    const factor = imp.affectedFactor.padEnd(17).substring(0, 17);
    const count = String(imp.restaurantsAffected).padStart(10);
    console.log(`${rank} | ${gap} | ${factor} | ${count} | ${imp.scoreImpactEstimate}`);
  }

  auditData.scoringImpactMatrix = impacts;

  // ==========================================
  // SUMMARY
  // ==========================================

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║     AUDIT SUMMARY                                   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  console.log(`Active restaurants:        ${rRows.length}`);
  console.log(`Deep profiles:             ${dpRows.length} (missing: ${noDpIds.length})`);
  console.log(`Occasion scores:           ${osRows.length} (missing: ${noOsIds.length})`);
  console.log(`Tags:                      ${tRows.length} (restaurants without: ${noTagIds.length})`);
  console.log(`Enrichment confidence avg: ${confValues.length > 0 ? (confValues.reduce((a, b) => a + b, 0) / confValues.length).toFixed(3) : "N/A"}`);
  console.log(`Identical occasion scores: ${identicalCount}`);

  const criticalGaps = impacts.filter((i) => i.priority >= 1000);
  if (criticalGaps.length > 0) {
    console.log(`\n🔴 CRITICAL GAPS (${criticalGaps.length}):`);
    for (const gap of criticalGaps) {
      console.log(`  - ${gap.dataGap}: ${gap.restaurantsAffected} restaurants — ${gap.scoreImpactEstimate}`);
    }
  }

  const highGaps = impacts.filter((i) => i.priority >= 100 && i.priority < 1000);
  if (highGaps.length > 0) {
    console.log(`\n🟡 HIGH-PRIORITY GAPS (${highGaps.length}):`);
    for (const gap of highGaps) {
      console.log(`  - ${gap.dataGap}: ${gap.restaurantsAffected} restaurants`);
    }
  }

  // Write JSON if requested
  if (WRITE_JSON) {
    const filename = `audit-results-${new Date().toISOString().slice(0, 10)}.json`;
    fs.writeFileSync(filename, JSON.stringify(auditData, null, 2));
    console.log(`\nAudit data written to: ${filename}`);
  }

  console.log("\nAudit complete.");
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
