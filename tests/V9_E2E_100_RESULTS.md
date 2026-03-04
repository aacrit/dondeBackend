# V9 End-to-End Test Results — 100 Complex Queries

**Date:** 2026-03-04T02:55:44Z
**RPC:** get_candidates_v9 (review intelligence + ts_rank)
**Tests:** 100 queries | **Checks:** 491

## Summary

| Metric | Value |
|--------|-------|
| PASSED | 490 |
| FAILED | 0 |
| WARNED | 1 |
| Hard Pass Rate | 99% |
| RI Coverage (candidates with RI) | 1000 |
| RI Misses (queries with 0 RI) | 0 |

## Category Breakdown

| Category | Tests | Pass | Fail | Warn |
|----------|-------|------|------|------|
| DishCuisine | 10 | 10 | 0 | 0 |
| VibeDish | 10 | 10 | 0 | 0 |
| OccasionDish | 10 | 10 | 0 | 0 |
| CompoundNoise | 10 | 10 | 0 | 0 |
| NicheCuisine | 10 | 10 | 0 | 0 |
| DietaryDish | 10 | 10 | 0 | 0 |
| PriceDish | 10 | 10 | 0 | 0 |
| MultiSignal | 10 | 10 | 0 | 0 |
| EdgeCase | 10 | 9 | 0 | 1 |
| DiscoveryMix | 10 | 10 | 0 | 0 |

## Test Design

Each query is **complex multi-signal**: cuisine + dish + occasion + natural language noise.
This tests the V9 pipeline's ability to:
1. Retrieve relevant candidates via `ts_rank()` on review intelligence text vectors
2. Surface restaurants whose `dish_catalog` contains the queried dish
3. Match `cuisine_signals` from actual reviewer descriptions
4. Populate review quality scores (food, service, ambiance, value)

### Categories
- **DishCuisine (10):** Specific dish + cuisine type + occasion
- **VibeDish (10):** Vibe descriptor + specific dish
- **OccasionDish (10):** Occasion context + dish craving
- **CompoundNoise (10):** Multiple cuisines/dishes + conversational padding
- **NicheCuisine (10):** Less common cuisines (Peruvian, Polish, Filipino, etc.)
- **DietaryDish (10):** Dietary restriction + dish + occasion
- **PriceDish (10):** Price expectation + specific dish
- **MultiSignal (10):** Overlapping reinforcing signals
- **EdgeCase (10):** Ambiguous, misspelled, contradictory queries
- **DiscoveryMix (10):** Unusual combos testing RI breadth
