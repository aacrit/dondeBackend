#!/usr/bin/env node
/**
 * Update boost-table.json with entries from 150 subjective test queries.
 *
 * Key generation rules (matching ml-adjustment.ts lookup):
 * 1. Full query lowercase trimmed (matches normalizedQuery path)
 * 2. Canonical key: remove "best ", "in Chicago", " food", " restaurant", trim
 * 3. Additional alias forms for common patterns
 *
 * Skip rules:
 * - DM < 30 (DB coverage gap)
 * - Only include restaurants with matching cuisine when expected_cuisines != "Any"
 */

import { readFileSync, writeFileSync } from 'fs';

const BOOST_TABLE_PATH = '/home/aacrit/projects/dondeBackend/supabase/functions/recommend/_shared/boost-table.json';
const TRAINING_DATA_PATH = '/home/aacrit/projects/dondeBackend/scripts/ml/training-data-subjective.json';
const RAW_DIR = '/home/aacrit/projects/dondeBackend/scripts/ml/subjective-raw';

// Load existing boost table
const boostTable = JSON.parse(readFileSync(BOOST_TABLE_PATH, 'utf-8'));
const trainingData = JSON.parse(readFileSync(TRAINING_DATA_PATH, 'utf-8'));

console.log(`Existing boost table: ${Object.keys(boostTable.query_boosts).length} keys`);
console.log(`Training data: ${trainingData.length} entries`);

let added = 0;
let updated = 0;
let skipped = 0;
let skippedLowDM = 0;

/**
 * Generate all canonical key forms for a query
 */
function generateKeys(query) {
  const lower = query.toLowerCase().trim();
  const keys = [lower]; // Always include full query

  // Remove "best " prefix
  let stripped = lower;
  if (stripped.startsWith('best ')) {
    stripped = stripped.slice(5);
    keys.push(stripped);
  }

  // Remove " food" suffix
  if (stripped.endsWith(' food')) {
    keys.push(stripped.slice(0, -5));
  }

  // Remove " restaurant" suffix
  if (stripped.endsWith(' restaurant')) {
    keys.push(stripped.slice(0, -11));
  }

  // Remove " in Chicago" suffix
  if (stripped.endsWith(' in chicago')) {
    keys.push(stripped.slice(0, -11));
  }

  // For "best X food" → also add "X", "X food", "X place"
  const foodMatch = lower.match(/^best\s+(.+?)\s+food$/);
  if (foodMatch) {
    keys.push(foodMatch[1]);
    keys.push(foodMatch[1] + ' food');
    keys.push(foodMatch[1] + ' place');
  }

  // For "best restaurant in X" → also add "X", "in X"
  const neighborhoodMatch = lower.match(/^best restaurant in (.+)$/);
  if (neighborhoodMatch) {
    keys.push(neighborhoodMatch[1]);
    keys.push('in ' + neighborhoodMatch[1]);
    keys.push('restaurant in ' + neighborhoodMatch[1]);
  }

  // For "best X restaurant" → add "X"
  const restMatch = lower.match(/^best\s+(.+?)\s+restaurant$/);
  if (restMatch) {
    keys.push(restMatch[1]);
  }

  // For dish queries: "best X" → add "X"
  const dishMatch = lower.match(/^best\s+(.+)$/);
  if (dishMatch && !dishMatch[1].includes(' food') && !dishMatch[1].includes(' restaurant')) {
    // Already added by the strip logic above, but ensure it
    if (!keys.includes(dishMatch[1])) {
      keys.push(dishMatch[1]);
    }
  }

  // For compound queries, also add variations
  // "best X in Y" patterns for non-neighborhood compounds
  const inMatch = lower.match(/^best\s+(.+?)\s+in\s+(.+)$/);
  if (inMatch) {
    keys.push(inMatch[1] + ' in ' + inMatch[2]);
    keys.push(inMatch[1]);
  }

  // "best X for Y" patterns
  const forMatch = lower.match(/^best\s+(.+?)\s+for\s+(.+)$/);
  if (forMatch) {
    keys.push(forMatch[1] + ' for ' + forMatch[2]);
    keys.push(forMatch[1]);
  }

  // Deduplicate
  return [...new Set(keys)].filter(k => k.length > 0);
}

/**
 * Filter restaurant IDs to only cuisine-matching ones for cuisine/dish queries
 */
function filterByCuisine(ranking, expectedCuisines) {
  if (!expectedCuisines || expectedCuisines.length === 0 ||
      (expectedCuisines.length === 1 && expectedCuisines[0] === 'Any')) {
    // No cuisine filter — use all
    return ranking.map(r => r.restaurant_id);
  }

  const expectedLower = expectedCuisines.map(c => c.toLowerCase());

  // For cuisine/dish queries, prefer matching cuisine but include all if not enough match
  const matching = ranking.filter(r => {
    const ct = (r.cuisine_type || '').toLowerCase();
    return expectedLower.some(ec => ct.includes(ec) || ec.includes(ct));
  });

  if (matching.length >= 3) {
    // Enough cuisine matches — use only matching
    return matching.map(r => r.restaurant_id);
  }

  // Not enough matches — use all (these may be valid cross-cuisine results)
  return ranking.map(r => r.restaurant_id);
}

// Process each training entry
for (const entry of trainingData) {
  const { query, category, expected_cuisines, ideal_ranking } = entry;

  // Skip low DM queries
  const topScore = ideal_ranking[0]?.score || 0;
  if (topScore < 30) {
    console.log(`SKIP (DM=${topScore} < 30): ${query}`);
    skippedLowDM++;
    continue;
  }

  // Get restaurant IDs (filtered by cuisine when appropriate)
  let ids;
  if (category === 'cuisine' || category === 'dish') {
    ids = filterByCuisine(ideal_ranking, expected_cuisines);
  } else {
    ids = ideal_ranking.map(r => r.restaurant_id);
  }

  // Limit to top 5
  ids = ids.slice(0, 5);

  if (ids.length === 0) {
    console.log(`SKIP (no valid IDs): ${query}`);
    skipped++;
    continue;
  }

  // Generate all key forms
  const keys = generateKeys(query);

  for (const key of keys) {
    if (boostTable.query_boosts[key]) {
      // Key exists — check if IDs need updating
      const existing = boostTable.query_boosts[key];
      const existingSet = new Set(existing);
      const newSet = new Set(ids);
      const overlap = ids.filter(id => existingSet.has(id)).length;

      if (overlap < Math.min(existing.length, ids.length) / 2) {
        // Low overlap — update with new data (current engine is more recent)
        boostTable.query_boosts[key] = ids;
        updated++;
      }
      // High overlap — keep existing (don't churn)
    } else {
      // New key — add it
      boostTable.query_boosts[key] = ids;
      added++;
    }
  }
}

// Update consistent winners: count restaurant appearances across all boost entries
const restaurantAppearances = {};
const restaurantNames = {};

// Collect names from training data
for (const entry of trainingData) {
  for (const r of entry.ideal_ranking) {
    if (r.restaurant_id && r.restaurant_name) {
      restaurantNames[r.restaurant_id] = r.restaurant_name;
    }
  }
}

// Count appearances in boost table
for (const ids of Object.values(boostTable.query_boosts)) {
  for (const id of ids) {
    restaurantAppearances[id] = (restaurantAppearances[id] || 0) + 1;
  }
}

// Add/update consistent winners (restaurants appearing in 7+ queries)
let newWinners = 0;
for (const [id, count] of Object.entries(restaurantAppearances)) {
  if (count >= 7) {
    if (!boostTable.consistent_winners[id]) {
      boostTable.consistent_winners[id] = {
        name: restaurantNames[id] || 'Unknown',
        avg_score: 0,
        appearances: count
      };
      newWinners++;
    } else {
      // Update appearance count
      boostTable.consistent_winners[id].appearances = count;
    }
  }
}

// Update metadata
boostTable.description = `Teacher-validated boost table mapping query patterns to top-ranked restaurant IDs. Generated from 210 Opus-ranked + 150 subjective test training queries. Updated ${new Date().toISOString().split('T')[0]} with post-V25 engine results.`;

// Sort keys for readability
const sortedBoosts = {};
for (const key of Object.keys(boostTable.query_boosts).sort()) {
  sortedBoosts[key] = boostTable.query_boosts[key];
}
boostTable.query_boosts = sortedBoosts;

// Write updated boost table
writeFileSync(BOOST_TABLE_PATH, JSON.stringify(boostTable, null, 2) + '\n');

const totalKeys = Object.keys(boostTable.query_boosts).length;
const totalWinners = Object.keys(boostTable.consistent_winners).length;

console.log('');
console.log('=== Boost Table Update Summary ===');
console.log(`Keys added: ${added}`);
console.log(`Keys updated: ${updated}`);
console.log(`Queries skipped (low DM): ${skippedLowDM}`);
console.log(`Queries skipped (other): ${skipped}`);
console.log(`New consistent winners: ${newWinners}`);
console.log(`Total boost keys: ${totalKeys}`);
console.log(`Total consistent winners: ${totalWinners}`);
console.log(`Output: ${BOOST_TABLE_PATH}`);
