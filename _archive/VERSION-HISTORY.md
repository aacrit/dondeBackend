# DondeAI Backend — Version History Archive

Archived: 2026-03-05. This file consolidates all pre-V9 specifications, optimization reports, and historical test results for reference only. **Do not use for active development — see `CLAUDE.md` for current V9 docs.**

---

## Scoring Engine Evolution

| Version | Architecture | Status | Key Change |
|---------|-------------|--------|------------|
| V3.0 | 5-factor weighted sum (Food, Setting, Atmosphere, Reputation, Convenience) | Archived | Initial human-intuitive scoring |
| V3.6 | 5-factor + dynamic weights + deal-breaker gates | Archived | Production-hardened V3 |
| V4.0 | Dynamic-weight geometric mean | Archived | Replaced weighted sum with geometric mean |
| V5.0 | 28 context-shift rules, 4 adaptive layers | Archived | Weight engine with intent-aware shifts |
| V7.0 | Geometric mean + V5 weights + intent alignment | Archived | Combined geometric mean with V5 weight engine |
| V7.3b | V7 + stretched Google rating + post-Google re-score | Archived | Final geometric mean version |
| V8.0-V8.4 | Algorithm-inspired optimizations (14 across 4 rounds) | Archived | Bayesian priors, cold-start, calibration |
| **V9.0** | **Relevance(0-1) × Quality(0-100) + OccasionBonus(±5)** | **Active** | **Review intelligence gating, self-healing** |

## V8 Optimization Summary (V8.0→V8.4)

14 optimizations across 4 rounds. Pass rate: 49%→100%. Avg DondeMatch: 53→62.

Key optimizations: Bayesian priors for missing data, cuisine alignment from review signals, temporal convenience factors, cold-start regression toward 5.5, score distribution calibration, cross-factor coherence checks.

V8 was ultimately replaced by V9's simpler Relevance × Quality architecture which achieved 95/95 pass rate with cleaner separation of concerns.

## V7.3b → V9 Migration Notes

- Geometric mean replaced by multiplicative Relevance × Quality
- V5 weight-shift rules (28 rules) replaced by query-type-aware weight profiles
- Intent Alignment Score absorbed into Relevance classification
- Filter pipeline (6 filters + relaxation cascade) replaced by Relevance gating
- `get_ranked_restaurants` RPC replaced by `get_candidates_v9` with `p_query` full-text search
- Review intelligence (`cuisine_signals`, `dish_catalog`, `popular_dishes`) now drives relevance scoring
- Self-healing: NULL `cuisine_type` falls back to `cuisine_signals` (1806/2719 restaurants)

## Historical Test Results Summary

| Test Suite | Version | Date | Result |
|-----------|---------|------|--------|
| Golden Dataset V8 | V8.0 | 2026-02-28 | 95 pass, 16 fail, 80 warn (49%) |
| Golden Dataset V8.4 | V8.4 | 2026-02-28 | 191 pass, 0 fail, 0 warn (100%) |
| Golden Dataset 200 | V8.4 | 2026-02-28 | Extended 200-query benchmark |
| Catalog V7 | V7.3b | 2026-02-24 | 273 pass, 3 fail, 30 warn |
| Catalog V7 | V7.3b | 2026-02-27 | 286 pass, 3 fail, 23 warn (98.9%) |
| E2E 100 | V9.0 | 2026-03-04 | 490 pass, 0 fail, 1 warn (99%) |
| Golden Dataset | V9.0 | 2026-03-04 | 95/95 pass (100%) |

## Case Studies (Pre-V9)

### CS-001/CS-002: After-Hours Dining Gap

Engine returned restaurants closing at 10PM for "late-night dining" queries. Root cause: no mechanism to filter/score based on actual closing times. `best_times` enrichment unreliable (assigned without real hours data). `open_now` filter only checks present moment. Convenience scoring relies on unreliable `best_times` array.

**Status:** Known limitation. Recommended fix: parse Google `weekday_text` during enrichment, store `latest_closing_hour`, add convenience penalty for `time_of_day=late_night` when closing < 23:00.

### CS-UI-001/CS-UI-002: Signal Chips & Headline Styling

"Great Vibe" chip removed (redundant with match score). Match headline restyled from Playfair italic to Inter structural. Both resolved in V10 frontend (signal chips removed entirely from Tier 1).

## Archived Files Reference

| File | Contents |
|------|----------|
| `_archive/donde-match-design.md` (61K) | V3.0 scoring engine deep-dive — 5-factor model, scoring methodology |
| `_archive/donde-match-system-v4.0.md` (34K) | V4.0 full system spec — dynamic-weight geometric mean |
| `_archive/system-architecture.md` (17K) | Original backend architecture (V4 era) |
| `_archive/UI_UX_Requirements.md` (27K) | Full business requirements — design philosophy, 8 principles |
| `_archive/DondeAPP_Agent_Teams.md` (52K) | 15-agent QA framework specifications |
| `_archive/api-field-mapping.md` (8K) | UI↔Backend field mapping reference |
| `tests/V8_OPTIMIZATION_REPORT.md` (35K) | V8.0→V8.4 optimization details (14 optimizations) |
| `tests/V8_CASE_STUDIES.md` (11K) | V8 test case analysis |
| `tests/GOLDEN_DATASET_V8_RESULTS.md` (7K) | V8 golden dataset results |
| `tests/GOLDEN_DATASET_V8_200_RESULTS.md` (11K) | V8 extended 200-query benchmark |
