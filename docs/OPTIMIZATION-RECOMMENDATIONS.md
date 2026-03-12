# DondeAI Optimization Recommendations (Backend)

Last updated: 2026-03-12

Strategic optimization assessment by CEO Advisor. Backend-relevant items from the full recommendation set.

---

## Backend-Relevant Recommendations

### 1. Build the Learning Flywheel (Priority: Q2)

**What:** Feed user history into scoring pipeline as preference signals.

- Create `user_preference_profile` materialized view: top 3 cuisines, avg price level, preferred neighborhoods, favorite occasion types
- Use frequency counts from `user_searches`, `user_favorites`, and feedback data
- Apply as tiebreaker in ranked queue when quality scores are within 5 points
- Incremental rollout: frequency counts first, then tiebreaking logic

### 2. Cache Smarter — Prefetch & Expand Queue (Priority: Next Sprint)

**What:** Reduce time-to-first-recommendation and extend "Try Another" depth.

- Increase ranked queue depth from 2-5 to 5-8 for common query patterns
- Add `stale-while-revalidate` semantics to 5-min cache
- For returning users: support prefetch endpoint for "top pick" based on last occasion + neighborhood combo
- Track cache hit rate as KPI (target: 30%+ for returning users)

### 3. Match Narrative Surfacing (Priority: This Week)

**What:** Ensure `match_narrative.strongest_factor` is always populated and descriptive enough for Tier 1 display. No backend changes needed if field is already reliably present — verify and document.

---

See full recommendations: `../dondeAI/docs/OPTIMIZATION-RECOMMENDATIONS.md`
