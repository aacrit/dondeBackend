# DondeAI Optimization Recommendations (Backend)

Last updated: 2026-03-15

Strategic optimization assessment by CEO Advisor. Backend-relevant items from the full recommendation set.

---

## Backend-Relevant Recommendations

### 1. Build the Learning Flywheel (Priority: Q2)

**What:** Feed user history into scoring pipeline as preference signals.

- Create `user_preference_profile` materialized view: top 3 cuisines, avg price level, preferred neighborhoods, favorite occasion types
- Use frequency counts from `user_searches`, `user_favorites`, and feedback data
- Apply as tiebreaker in ranked queue when quality scores are within 5 points
- Incremental rollout: frequency counts first, then tiebreaking logic

### 2. ~~Cache Smarter — Prefetch & Expand Queue~~ IMPLEMENTED (2026-03-14)

**Status:** Implemented as DondeCache. Persistent 3-level fuzzy query cache with quality gate (B-/80+). Pre-warming pipeline (`cache-warmer.ts`) runs daily. Cache hit rate tracked via `get_cache_dashboard()` RPC. Try Another uses cached `ranked_queue` for instant fallback. See `_shared/query-cache.ts`, `scripts/pipelines/cache-warmer.ts`, migration `20260314000001_query_cache.sql`.

### 3. Match Narrative Surfacing (Priority: This Week)

**What:** Ensure `match_narrative.strongest_factor` is always populated and descriptive enough for Tier 1 display. No backend changes needed if field is already reliably present — verify and document.

---

See full recommendations: `../dondeAI/docs/OPTIMIZATION-RECOMMENDATIONS.md`
