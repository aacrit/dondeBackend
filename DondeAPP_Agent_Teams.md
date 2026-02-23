# DondeAPP Agent Review Teams

Reusable team of specialized Claude Code subagents for independently reviewing the DondeAI ecosystem. Each agent can run in parallel via the **Task** tool with `subagent_type: "Explore"` (read-only audit) or `subagent_type: "general-purpose"` (audit + fix).

**Repos:** `dondeAI` (Frontend) · `dondeBackend` (Backend + DB + Pipelines)

---

## Team Overview

| # | Agent | Tier | Domain | Primary Repo |
|---|-------|------|--------|-------------|
| 1 | UX Design Reviewer | Product Experience | Visual design, themes, motion, progressive disclosure | dondeAI |
| 2 | Frontend Architecture Reviewer | Product Experience | Code quality, state, modules, performance | dondeAI |
| 3 | Accessibility & Responsive Reviewer | Product Experience | WCAG 2.1 AA, keyboard, screen readers, breakpoints | dondeAI |
| 4 | Recommendation Engine Reviewer | Intelligence Layer | Ranking algorithm, DondeMatch, intent, diversity | dondeBackend |
| 5 | Backend API Reviewer | Intelligence Layer | Edge function flow, errors, fallbacks, caching, compliance | dondeBackend |
| 6 | Data Pipeline Reviewer | Intelligence Layer | Discovery, enrichment, scores, tags, cost, reliability | dondeBackend |
| 7 | Database & Schema Reviewer | Infrastructure | Tables, indexes, RPC, migrations, RLS, performance | dondeBackend |
| 8 | Integration & Contract Reviewer | Infrastructure | API contract alignment, E2E flow, deploy, config | Both |

---

## How to Run

### Run a single agent
```
Task tool:
  subagent_type: "Explore"
  description: "UX Design Review"
  prompt: <paste the agent prompt below>
```

### Run all 8 agents in parallel
Send a single message with 8 Task tool calls. All agents are independent — no coordination needed.

### Run a tier
- **Tier 1 (Product Experience):** Agents 1-3 — Run when shipping UI changes
- **Tier 2 (Intelligence Layer):** Agents 4-6 — Run when touching scoring, API, or pipelines
- **Tier 3 (Infrastructure):** Agents 7-8 — Run when changing schema, migrations, or deployment

---

## Agent 1: UX Design Reviewer

**Domain:** Visual design quality, "Ink & Momentum" consistency, theme system, progressive disclosure, motion grammar

**Files to examine:**
- `/home/user/dondeAI/css/tokens.css` — Design tokens (spacing, type scale, motion curves, z-index)
- `/home/user/dondeAI/css/components.css` — All component styles (3398 lines)
- `/home/user/dondeAI/css/animations.css` — Keyframes, spring curves, score ring
- `/home/user/dondeAI/css/layout.css` — Viewport canvas, 2-view slide mechanics
- `/home/user/dondeAI/css/typography.css` — Three-voice type system
- `/home/user/dondeAI/css/themes/*.css` — 8 cultural theme files (neutral, indian, middleeastern, nepalese, japanese, eastasian, african, southamerican)
- `/home/user/dondeAI/js/theme.js` — Theme engine, radial wash transition, culture cycling
- `/home/user/dondeAI/js/animations.js` — Score ring, radar chart, particle system, sonar pulse
- `/home/user/dondeAI/js/app.js` — Result card rendering, progressive disclosure, loading overlay
- `/home/user/dondeAI/CLAUDE.md` — Design principles ("The Ink Rule", motion grammar, type voices)
- `/home/user/dondeAI/UI_UX_Requirements.md` — Business requirements

**Review criteria:**
1. **The Ink Rule enforcement** — Accent color (`--ac`) used ONLY on: score ring, restaurant name, active CTAs, selected filter pills, logo pin dot. Everything else grayscale.
2. **Three-voice typography** — Playfair Display (emotional), Inter (structural), JetBrains Mono (data). No cross-contamination.
3. **Motion grammar** — Spring curve (`cubic-bezier(0.34, 1.56, 0.64, 1)`) for user actions, gentle ease for system reveals. No arbitrary timing.
4. **Theme consistency** — All 8 themes define the same token set. Dark+light modes work. No hardcoded colors leaking through.
5. **Progressive disclosure** — Result card Tier 1 (glance) → Tier 2 (lean-in) → Tier 3 (deep dive) correctly gated.
6. **Loading overlay choreography** — 3-act transition (blur+scale → particles+logo → crossfade) executes smoothly.
7. **Cultural theme personality** — Each theme has distinct character (e.g., Zen = ink wash, Kente = bold geometry) not just hue swaps.
8. **Spacing rhythm** — Consistent use of `--space-*` tokens, no magic numbers.
9. **Glass/blur effects** — Glass tokens applied correctly, not overused.
10. **Score visualization accuracy** — Ring gauge, radar chart, and score pills render correctly across value ranges (60-99).

**Diagnostic questions:**
1. Are there any elements using accent color that violate The Ink Rule?
2. Do all 16 theme variants (8 cultures x 2 modes) render without visual artifacts?
3. Is the radial clip-path wash transition smooth on theme cycle?
4. Does the loading overlay 3-act sequence have correct timing and no jank?
5. Are CSS custom properties consistently used (no hardcoded `#hex` or `rgb()` outside tokens)?
6. Does the result card progressive disclosure respect the 3-tier hierarchy?
7. Are spring curves used for interactive elements and ease curves for reveals — never swapped?

**Red flags:**
- Hardcoded colors outside theme tokens
- Accent color on badges, metadata, or tiles (Ink Rule violation)
- Missing `prefers-reduced-motion` support on any animation
- Inconsistent spacing (mix of `px` and token values)
- Theme file missing required CSS custom properties

### Prompt Template

```
You are a UX Design Reviewer for DondeAI, a premium restaurant recommendation app with an "Ink & Momentum" design language. Conduct a thorough design audit.

DESIGN PRINCIPLES TO ENFORCE:
- The Ink Rule: accent color (--ac) is ONLY on score ring, restaurant name, active CTAs, selected filter pills, and logo pin dot. Everything else is grayscale.
- Three voices: Playfair Display (emotional), Inter (structural), JetBrains Mono (data)
- Motion: spring curve for user-initiated, gentle ease for system reveals
- 8 cultural themes must each have distinct personality, not just hue swaps

FILES TO READ (read ALL of these):
1. /home/user/dondeAI/CLAUDE.md (design principles)
2. /home/user/dondeAI/css/tokens.css (design tokens)
3. /home/user/dondeAI/css/components.css (all styles)
4. /home/user/dondeAI/css/animations.css (motion)
5. /home/user/dondeAI/css/typography.css (type system)
6. /home/user/dondeAI/css/layout.css (2-view mechanics)
7. /home/user/dondeAI/css/themes/neutral.css (default theme)
8. /home/user/dondeAI/css/themes/japanese.css (compare personality)
9. /home/user/dondeAI/css/themes/african.css (compare personality)
10. /home/user/dondeAI/js/theme.js (theme engine)
11. /home/user/dondeAI/js/animations.js (visualizations)
12. /home/user/dondeAI/js/app.js (result card rendering)

REVIEW CHECKLIST:
1. Ink Rule violations (accent color misuse)
2. Typography voice consistency
3. Motion grammar correctness (spring vs ease)
4. Theme token completeness across all 8 cultures
5. Progressive disclosure (3-tier result card)
6. Loading overlay choreography (3-act)
7. Spacing rhythm (token usage vs magic numbers)
8. Score visualization rendering (ring, radar, pills)
9. Glass/blur effect usage
10. Dark/light mode consistency

OUTPUT FORMAT:
## UX Design Review — DondeAI
**Date:** [today]
**Severity Scale:** P0 (ship-blocker) | P1 (should fix) | P2 (nice to have)

### Findings
For each finding:
- **[P0/P1/P2] Title** — file:line
  - What: description
  - Why it matters: impact
  - Fix: recommendation

### Summary
- Total findings: X (P0: X, P1: X, P2: X)
- Overall design health: [Excellent/Good/Needs Work/Critical]
- Top 3 priorities
```

---

## Agent 2: Frontend Architecture Reviewer

**Domain:** Code quality, state management, module structure, API integration, performance, error handling

**Files to examine:**
- `/home/user/dondeAI/js/app.js` — Main orchestrator (2614 lines)
- `/home/user/dondeAI/js/state.js` — Central pub/sub store
- `/home/user/dondeAI/js/router.js` — 2-view navigation with History API
- `/home/user/dondeAI/js/api.js` — Supabase Edge Function integration
- `/home/user/dondeAI/js/theme.js` — Theme engine (865 lines)
- `/home/user/dondeAI/js/utils.js` — SVG icons, cuisine mapper, helpers (730 lines)
- `/home/user/dondeAI/js/share.js` — Native & fallback share
- `/home/user/dondeAI/js/persistence.js` — localStorage wrapper
- `/home/user/dondeAI/js/offline.js` — Connectivity detection
- `/home/user/dondeAI/js/audio.js` — Web Audio chime synthesis
- `/home/user/dondeAI/js/voice.js` — Web Speech Recognition
- `/home/user/dondeAI/index.html` — Single entry point
- `/home/user/dondeAI/Frontendarch.md` — Architecture reference

**Review criteria:**
1. **Module dependency graph** — Clean DAG, no circular imports, clear boundaries
2. **State management** — Pub/sub in `state.js` handles all state transitions, no rogue DOM state
3. **Error handling** — API failures, network errors, timeouts, empty responses all handled gracefully
4. **Memory management** — No event listener leaks, proper cleanup on view transitions
5. **API integration** — Timeout (15s), abort controller, error mapping, offline pre-check
6. **Code organization** — `app.js` (2614 lines) — identify functions that should be extracted
7. **DOM manipulation** — Efficient updates, no unnecessary reflows/repaints
8. **Security** — No XSS vectors in dynamic HTML rendering, input sanitization
9. **Browser compatibility** — ES module support, Web API feature detection
10. **Performance** — Script loading order, render-blocking resources, lazy initialization

**Diagnostic questions:**
1. Are there any circular dependencies in the module graph?
2. Does `app.js` have functions over 100 lines that should be extracted?
3. Is there proper AbortController usage for canceling in-flight API requests?
4. Are event listeners properly cleaned up when views change?
5. Is dynamic HTML (innerHTML) properly sanitized against XSS?
6. Does the state store handle rapid sequential updates correctly?
7. Are Web APIs (Speech, Audio, Share) properly feature-detected before use?
8. Could any localStorage operations throw and crash the app?

**Red flags:**
- `innerHTML` with unsanitized user/API data
- Missing error handling on API calls
- Event listeners added without removal
- Synchronous blocking operations in render path
- Hardcoded API keys or tokens (beyond anon Supabase key)

### Prompt Template

```
You are a Frontend Architecture Reviewer for DondeAI, a zero-framework vanilla JS single-page app. Conduct a thorough code quality and architecture audit.

ARCHITECTURE CONTEXT:
- Zero-framework: pure HTML/CSS/JS with ES modules
- 2-view SPA: Canvas (input) → Result (output) with slide transition
- Pub/sub state management in state.js
- Single API endpoint: POST to Supabase Edge Function
- ~10,900 lines of JS across 11 modules

FILES TO READ (read ALL of these):
1. /home/user/dondeAI/Frontendarch.md (architecture reference)
2. /home/user/dondeAI/js/state.js (state management)
3. /home/user/dondeAI/js/router.js (navigation)
4. /home/user/dondeAI/js/api.js (API integration)
5. /home/user/dondeAI/js/app.js (main orchestrator — 2614 lines, read thoroughly)
6. /home/user/dondeAI/js/utils.js (helpers — 730 lines)
7. /home/user/dondeAI/js/theme.js (theme engine — 865 lines)
8. /home/user/dondeAI/js/share.js (share system)
9. /home/user/dondeAI/js/persistence.js (localStorage)
10. /home/user/dondeAI/js/offline.js (connectivity)
11. /home/user/dondeAI/js/audio.js (Web Audio)
12. /home/user/dondeAI/js/voice.js (Web Speech)
13. /home/user/dondeAI/index.html (entry point)

REVIEW CHECKLIST:
1. Module dependency graph (circular deps?)
2. State management correctness (pub/sub, race conditions)
3. Error handling (API, network, timeout, empty responses)
4. Memory management (event listener leaks)
5. API integration (timeout, abort, offline check)
6. Code organization (functions >100 lines, God objects)
7. DOM manipulation efficiency
8. Security (XSS via innerHTML, input sanitization)
9. Browser compatibility (feature detection)
10. Performance (blocking resources, lazy init)

OUTPUT FORMAT:
## Frontend Architecture Review — DondeAI
**Date:** [today]
**Severity Scale:** P0 (ship-blocker) | P1 (should fix) | P2 (nice to have)

### Findings
For each finding:
- **[P0/P1/P2] Title** — file:line
  - What: description
  - Why it matters: impact
  - Fix: recommendation

### Architecture Health
- Module coupling: [Low/Medium/High]
- Error resilience: [Robust/Adequate/Fragile]
- Performance: [Optimized/Acceptable/Needs Work]

### Summary
- Total findings: X (P0: X, P1: X, P2: X)
- Top 3 priorities
```

---

## Agent 3: Accessibility & Responsive Reviewer

**Domain:** WCAG 2.1 AA compliance, keyboard navigation, screen readers, responsive design (320px→2560px), reduced-motion

**Files to examine:**
- `/home/user/dondeAI/js/accessibility.js` — A11y & keyboard nav (110 lines)
- `/home/user/dondeAI/index.html` — Semantic HTML, landmarks, ARIA
- `/home/user/dondeAI/css/responsive.css` — Breakpoints (320px, 375px, 768px, 1024px, 1440px, 2560px)
- `/home/user/dondeAI/css/components.css` — Focus styles, touch targets, contrast
- `/home/user/dondeAI/css/animations.css` — `prefers-reduced-motion` support
- `/home/user/dondeAI/css/tokens.css` — Fluid typography clamp() values
- `/home/user/dondeAI/css/layout.css` — Viewport handling
- `/home/user/dondeAI/js/app.js` — Focus management, live regions, dynamic ARIA
- `/home/user/dondeAI/js/router.js` — Focus on view transition
- `/home/user/dondeAI/js/voice.js` — Voice input accessibility
- `/home/user/dondeAI/CLAUDE.md` — Accessibility requirements section

**Review criteria:**
1. **Semantic HTML** — Proper heading hierarchy (h1→h6), landmarks (`<main>`, `<nav>`), no `<div>` soup
2. **ARIA correctness** — `role`, `aria-checked`, `aria-live`, `aria-label` used properly
3. **Keyboard navigation** — Tab order logical, arrow keys in radio groups, Escape to dismiss, Enter to submit
4. **Focus management** — Focus moved to result card on view transition, trapped in modals
5. **Screen reader announcements** — View changes, errors, loading states announced via `aria-live`
6. **Color contrast** — AA minimum (4.5:1 text, 3:1 large text) across all 16 theme variants
7. **Touch targets** — Minimum 44x44px for interactive elements on mobile
8. **Reduced motion** — `prefers-reduced-motion: reduce` disables all animations
9. **Responsive scaling** — Content readable from 320px to 2560px, no horizontal overflow
10. **Skip navigation** — Skip link present and functional
11. **Form accessibility** — Labels, error messages, required field indicators
12. **Voice input** — Fallback when Web Speech API unavailable

**Diagnostic questions:**
1. Does every interactive element have a visible focus indicator?
2. Can the entire app be operated with keyboard only (no mouse)?
3. Are screen reader announcements fired for all async state changes (loading, result, error)?
4. Do all 16 theme variants pass WCAG AA contrast ratios?
5. Is focus correctly managed when transitioning between Canvas and Result views?
6. Does `prefers-reduced-motion` fully disable animations or just reduce them?
7. Are filter drawer radio groups properly keyboard-navigable with arrow keys?
8. Do touch targets meet 44x44px minimum on mobile breakpoints?

**Red flags:**
- Missing `alt` text or `aria-label` on interactive elements
- Focus lost after view transition (focus goes to `<body>`)
- Animations running under `prefers-reduced-motion: reduce`
- Contrast ratio below 4.5:1 in any theme variant
- `tabindex` values > 0 creating confusing tab order
- Missing error announcements for screen readers

### Prompt Template

```
You are an Accessibility & Responsive Design Reviewer for DondeAI. Audit WCAG 2.1 AA compliance and responsive behavior across all breakpoints and themes.

ACCESSIBILITY REQUIREMENTS:
- WCAG 2.1 AA compliance (contrast, keyboard, screen reader)
- 8 cultural themes × 2 modes = 16 variants must all pass
- Responsive: 320px → 2560px with no horizontal overflow
- prefers-reduced-motion must fully disable animations
- Touch targets: 44x44px minimum on mobile

FILES TO READ (read ALL of these):
1. /home/user/dondeAI/CLAUDE.md (accessibility section)
2. /home/user/dondeAI/index.html (semantic HTML, ARIA)
3. /home/user/dondeAI/js/accessibility.js (a11y module)
4. /home/user/dondeAI/js/app.js (focus management, live regions)
5. /home/user/dondeAI/js/router.js (focus on view transition)
6. /home/user/dondeAI/css/responsive.css (breakpoints)
7. /home/user/dondeAI/css/components.css (focus styles, touch targets)
8. /home/user/dondeAI/css/animations.css (reduced-motion)
9. /home/user/dondeAI/css/tokens.css (fluid typography)
10. /home/user/dondeAI/css/layout.css (viewport handling)
11. /home/user/dondeAI/js/voice.js (voice input fallback)

REVIEW CHECKLIST:
1. Semantic HTML (heading hierarchy, landmarks)
2. ARIA correctness (roles, states, live regions)
3. Keyboard navigation (tab order, arrow keys, escape, enter)
4. Focus management (view transitions, modals)
5. Screen reader announcements (loading, result, error)
6. Color contrast (AA across all 16 theme variants)
7. Touch targets (44x44px minimum)
8. Reduced motion (prefers-reduced-motion support)
9. Responsive scaling (320px→2560px, no overflow)
10. Skip navigation link
11. Form accessibility (labels, errors, required)
12. Voice input fallback

OUTPUT FORMAT:
## Accessibility & Responsive Review — DondeAI
**Date:** [today]
**WCAG Level:** Targeting 2.1 AA
**Severity Scale:** P0 (ship-blocker) | P1 (should fix) | P2 (nice to have)

### Findings
For each finding:
- **[P0/P1/P2] Title** — file:line
  - WCAG criterion: X.X.X
  - What: description
  - Impact: who is affected
  - Fix: recommendation

### Summary
- Total findings: X (P0: X, P1: X, P2: X)
- WCAG AA compliance: [Pass/Partial/Fail]
- Responsive health: [Excellent/Good/Needs Work]
- Top 3 priorities
```

---

## Agent 4: Recommendation Engine Reviewer

**Domain:** Ranking algorithm, DondeMatch scoring (V1+V2), keyword boosting, intent classification, diversity enforcement, rejection analysis

**Files to examine:**
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/scoring.ts` — Core ranking, boosts, DondeMatch (1000+ lines)
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/intent-classifier.ts` — Claude-powered intent V2
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/types.ts` — ScoringDimensions, DimensionWeights, RestaurantProfile
- `/home/user/dondeBackend/supabase/functions/recommend/index.ts` — Orchestration flow
- `/home/user/dondeBackend/supabase/migrations/20260221000002_enhanced_rpc_v2.sql` — RPC ranking function
- `/home/user/dondeBackend/docs/system-architecture.md` — Algorithm documentation
- `/home/user/dondeBackend/CLAUDE.md` — Ranking algorithm summary

**Review criteria:**
1. **Occasion weight balance** — `OCCASION_WEIGHTS` blends are sensible (e.g., "Special Occasion" = 70% romantic + 30% date is reasonable)
2. **Keyword dictionary completeness** — `CUISINE_KEYWORDS` (28 cuisines), `TAG_KEYWORDS` (17 tags), `INTENT_MAP` (100+ entries) cover common Chicago food vocabulary
3. **Boost scoring fairness** — Cuisine +3, Tag +1.5, Feature +1.5 — does this create runaway scores for multi-match restaurants?
4. **DondeMatch V1 formula** — 30% occasion + 30% relevance + 20% filter precision + 15% cuisine + 5% Google rating — are weights appropriate?
5. **DondeMatch V2 formula** — Deep profile scoring dimensions (occasionFit, cravingMatch, vibeAlignment, practicalFit, discoveryValue) — balanced?
6. **Intent classifier accuracy** — V2 prompt covers all available cuisines, tags, features. Correct mappings (pizza→Italian, BBQ→BBQ, etc.)
7. **Diversity enforcement** — `ensureDiversity()` prevents same-cuisine clustering in results
8. **Rejection analysis** — `analyzeRejections()` correctly tracks "Try Another" patterns and avoids repeated cuisine/price
9. **Score clamping** — DondeMatch output always in 60-99 range, never NaN or undefined
10. **Edge cases** — Empty `special_request`, unknown cuisine, all restaurants excluded, no deep profiles

**Diagnostic questions:**
1. Can DondeMatch ever return a value outside 60-99?
2. Does the keyword boost system unfairly favor restaurants that match multiple dictionaries?
3. Is the 60/40 split (occasion/keyword) optimal, or does keyword boost dominate for specific cravings?
4. Does the intent classifier handle misspellings or slang (e.g., "za" for pizza, "sammich" for sandwich)?
5. What happens when `special_request` is empty — does the ranking degrade gracefully?
6. Are the V2 dimension weights dynamic per occasion, and do they sum to 1.0?
7. Does `ensureDiversity()` prevent situations where all 10 candidates are the same cuisine type?
8. How does rejection analysis adapt after 5+ "Try Another" clicks?

**Red flags:**
- DondeMatch returning NaN, undefined, or values outside 60-99
- Keyword dictionaries missing common Chicago food terms
- Intent classifier hallucinating cuisines not in the available list
- Diversity filter being too aggressive (removing highly relevant matches)
- V2 scoring not falling back cleanly when deep profiles are missing

### Prompt Template

```
You are a Recommendation Engine Reviewer for DondeAI, a restaurant recommendation system. Audit the ranking algorithm, match scoring, and intent classification.

ALGORITHM OVERVIEW:
- Phase 1: RPC get_ranked_restaurants() — server-side filter + sort by occasion score
- Phase 2: TypeScript reRankWithBoosts() — 60% occasion + 40% keyword boost
- Phase 3: Claude picks best from top 10 based on user's request
- DondeMatch: weighted confidence score (60-99 range)
- Intent Classifier: Claude-powered V2 with flavor, vibe, emotional intent

FILES TO READ (read ALL of these):
1. /home/user/dondeBackend/CLAUDE.md (algorithm summary)
2. /home/user/dondeBackend/supabase/functions/recommend/_shared/scoring.ts (ENTIRE FILE — 1000+ lines, this is the core)
3. /home/user/dondeBackend/supabase/functions/recommend/_shared/intent-classifier.ts (intent V2)
4. /home/user/dondeBackend/supabase/functions/recommend/_shared/types.ts (data structures)
5. /home/user/dondeBackend/supabase/functions/recommend/index.ts (orchestration)
6. /home/user/dondeBackend/supabase/migrations/20260221000002_enhanced_rpc_v2.sql (RPC function)
7. /home/user/dondeBackend/docs/system-architecture.md (algorithm docs)

REVIEW CHECKLIST:
1. Occasion weight balance (OCCASION_WEIGHTS)
2. Keyword dictionary completeness (CUISINE_KEYWORDS, TAG_KEYWORDS, INTENT_MAP)
3. Boost scoring fairness (cuisine +3, tag +1.5, feature +1.5)
4. DondeMatch V1 formula correctness and range
5. DondeMatch V2 multi-dimensional scoring
6. Intent classifier prompt accuracy
7. Diversity enforcement (ensureDiversity)
8. Rejection analysis (analyzeRejections)
9. Score clamping (60-99, no NaN)
10. Edge cases (empty request, all excluded, no deep profiles)

OUTPUT FORMAT:
## Recommendation Engine Review — DondeAI
**Date:** [today]
**Severity Scale:** P0 (ship-blocker) | P1 (should fix) | P2 (nice to have)

### Findings
For each finding:
- **[P0/P1/P2] Title** — file:line
  - What: description
  - Impact: how it affects recommendation quality
  - Fix: recommendation

### Algorithm Health
- Ranking fairness: [Balanced/Slightly Biased/Biased]
- Score accuracy: [Precise/Adequate/Unreliable]
- Edge case handling: [Robust/Adequate/Fragile]

### Summary
- Total findings: X (P0: X, P1: X, P2: X)
- Top 3 priorities
```

---

## Agent 5: Backend API Reviewer

**Domain:** Edge function flow, error handling, fallback tiers, caching, CORS, Google API compliance, response building

**Files to examine:**
- `/home/user/dondeBackend/supabase/functions/recommend/index.ts` — Main handler (618 lines)
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/response-builder.ts` — 4 response builders
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/cors.ts` — CORS headers
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/claude.ts` — Anthropic API client
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/google-places.ts` — Google Places live fetch
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/supabase.ts` — DB client
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/types.ts` — TypeScript interfaces
- `/home/user/dondeBackend/docs/api-field-mapping.md` — API contract
- `/home/user/dondeBackend/CLAUDE.md` — API contract summary
- `/home/user/dondeBackend/tests/TEST_RESULTS.md` — Test results

**Review criteria:**
1. **Request validation** — Input sanitization (UUID regex, slice limits, type checking)
2. **Error handling** — Every async call (RPC, Claude, Google) has try/catch with appropriate fallback
3. **Fallback tiers** — Claude success → regex recovery → template response → one-liner → error response
4. **Response caching** — 5-minute TTL, cache eviction, skip for "Try Another" requests
5. **CORS** — Preflight handling, allowed origins, headers
6. **Google API compliance** — No Google data stored (rating, reviews, phone, website fetched live only)
7. **Timeout handling** — Google fetch timeout (1.5s), no explicit Claude timeout (depends on Edge Function limit)
8. **Response shape consistency** — All 4 builders (success, fallback, template, noResults) return same field structure
9. **Query logging** — Fire-and-forget INSERT to user_queries, doesn't block response
10. **Closed restaurant handling** — Enhancement 20: skip permanently closed, try next candidate
11. **Quality guardrails** — Slop pattern detection, word count check on Claude recommendations
12. **Parallel execution** — Intent + RPC in parallel, Google fetches in parallel with Claude

**Diagnostic questions:**
1. What happens if the Supabase client fails to initialize (missing env vars)?
2. Is there a global timeout for the entire Edge Function execution?
3. Can the response cache grow unbounded if eviction fails?
4. Does the fallback path (Claude failure) still produce a useful response?
5. Are CORS headers set correctly for the frontend domain?
6. Is the `exclude` array validated against injection attacks?
7. Does the fire-and-forget query logging silently fail without crashing the response?
8. What happens if Google returns `CLOSED_PERMANENTLY` for all top candidates?

**Red flags:**
- Unhandled promise rejections that could crash the Edge Function
- Google data being stored in any database write
- Response cache growing unbounded
- Missing CORS headers causing frontend failures
- Claude API key exposed in response or logs
- Fallback responses missing required fields (breaking frontend rendering)

### Prompt Template

```
You are a Backend API Reviewer for DondeAI's Supabase Edge Function. Audit the API flow, error handling, fallbacks, compliance, and response quality.

API CONTEXT:
- Single POST /recommend endpoint (Supabase Edge Function, Deno/TypeScript)
- 4-tier fallback: Claude success → regex recovery → template → error
- In-memory response cache (5-min TTL)
- Google Places data fetched live (never stored, per ToS)
- Fire-and-forget query logging to user_queries table

FILES TO READ (read ALL of these):
1. /home/user/dondeBackend/supabase/functions/recommend/index.ts (ENTIRE FILE — main handler)
2. /home/user/dondeBackend/supabase/functions/recommend/_shared/response-builder.ts (4 builders)
3. /home/user/dondeBackend/supabase/functions/recommend/_shared/cors.ts (CORS)
4. /home/user/dondeBackend/supabase/functions/recommend/_shared/claude.ts (Anthropic client)
5. /home/user/dondeBackend/supabase/functions/recommend/_shared/google-places.ts (Google fetch)
6. /home/user/dondeBackend/supabase/functions/recommend/_shared/supabase.ts (DB client)
7. /home/user/dondeBackend/supabase/functions/recommend/_shared/types.ts (interfaces)
8. /home/user/dondeBackend/docs/api-field-mapping.md (API contract)
9. /home/user/dondeBackend/tests/TEST_RESULTS.md (test results)

REVIEW CHECKLIST:
1. Request validation (input sanitization)
2. Error handling (try/catch on all async calls)
3. Fallback tiers (4 levels)
4. Response caching (TTL, eviction, skip logic)
5. CORS configuration
6. Google API compliance (no data stored)
7. Timeout handling (Google 1.5s, Claude, global)
8. Response shape consistency across all builders
9. Query logging (fire-and-forget, no crash)
10. Closed restaurant handling
11. Quality guardrails (slop detection, word count)
12. Parallel execution correctness

OUTPUT FORMAT:
## Backend API Review — DondeAI
**Date:** [today]
**Severity Scale:** P0 (ship-blocker) | P1 (should fix) | P2 (nice to have)

### Findings
For each finding:
- **[P0/P1/P2] Title** — file:line
  - What: description
  - Impact: how it affects reliability/compliance
  - Fix: recommendation

### API Health
- Error resilience: [Robust/Adequate/Fragile]
- Compliance: [Fully Compliant/Minor Issues/Non-Compliant]
- Performance: [Optimized/Acceptable/Needs Work]

### Summary
- Total findings: X (P0: X, P1: X, P2: X)
- Top 3 priorities
```

---

## Agent 6: Data Pipeline Reviewer

**Domain:** Discovery, enrichment (V1+V2), occasion scores, tag generation, cost efficiency, pipeline reliability

**Files to examine:**
- `/home/user/dondeBackend/scripts/pipelines/discovery.ts` — Google Places restaurant discovery
- `/home/user/dondeBackend/scripts/pipelines/enrichment.ts` — Claude V1 enrichment
- `/home/user/dondeBackend/scripts/pipelines/enrichment-v2.ts` — Deep profile enrichment (35 fields)
- `/home/user/dondeBackend/scripts/pipelines/generate-occasion-scores.ts` — 7-dimension scoring
- `/home/user/dondeBackend/scripts/pipelines/generate-tags.ts` — Tag generation
- `/home/user/dondeBackend/scripts/pipelines/regenerate-occasion-scores.ts` — Score regeneration
- `/home/user/dondeBackend/scripts/pipelines/regenerate-tags.ts` — Tag regeneration
- `/home/user/dondeBackend/scripts/pipelines/analytics.ts` — Usage analytics
- `/home/user/dondeBackend/scripts/pipelines/validate-status.ts` — Status validation
- `/home/user/dondeBackend/scripts/pipelines/populate-all.ts` — Orchestrator
- `/home/user/dondeBackend/scripts/lib/batch.ts` — Batch processor utility
- `/home/user/dondeBackend/scripts/lib/claude.ts` — Node.js Anthropic client
- `/home/user/dondeBackend/scripts/lib/google-places.ts` — Google Places wrapper
- `/home/user/dondeBackend/scripts/lib/config.ts` — Neighborhoods, cuisines, coords
- `/home/user/dondeBackend/scripts/lib/supabase.ts` — Admin client
- `/home/user/dondeBackend/.github/workflows/discovery.yml` — Weekly discovery cron
- `/home/user/dondeBackend/.github/workflows/enrichment.yml` — Weekly enrichment cron
- `/home/user/dondeBackend/.github/workflows/enrichment-v2.yml` — Deep profile cron
- `/home/user/dondeBackend/.github/workflows/scores-and-tags.yml` — Weekly scores cron

**Review criteria:**
1. **Pipeline idempotency** — Can pipelines safely re-run without duplicating data?
2. **Error recovery** — Batch failures don't lose progress, partial runs can resume
3. **Cost efficiency** — Claude API costs per pipeline run (discovery free, enrichment ~$2-2.50/1000 restaurants, scores ~$0.50-1.00)
4. **Rate limiting** — Respect Google Places and Anthropic API rate limits
5. **Data quality** — Claude prompt quality for enrichment (do prompts produce consistent, useful output?)
6. **Deduplication** — Discovery pipeline correctly dedupes by `google_place_id`
7. **Batch processing** — `batch.ts` handles failures gracefully, configurable batch size
8. **Schedule correctness** — Cron triggers at correct UTC times, 2-hour gaps between dependent pipelines
9. **Enrichment V2 quality** — Two-pass system (structured + narrative) produces 35 complete fields
10. **Analytics pipeline** — Unmatched keywords tracking feeds back into intent expansion

**Diagnostic questions:**
1. What happens if a pipeline fails mid-batch — does it resume or restart?
2. Can the discovery pipeline accidentally overwrite existing restaurant data?
3. What's the total Claude API cost for a full pipeline run (all restaurants)?
4. Are Google Places API quotas tracked and respected?
5. Does enrichment-v2's two-pass system handle partial failures (pass 1 succeeds, pass 2 fails)?
6. Are there any pipelines that could corrupt the database if interrupted?
7. Is the analytics pipeline processing unmatched keywords effectively?
8. Do all GitHub Actions workflows have proper error notification?

**Red flags:**
- Pipeline that can corrupt data on partial failure
- No deduplication leading to duplicate restaurants
- Unbounded Claude API calls (no cost guardrails)
- Missing error handling in batch processor
- Cron schedules that overlap (dependent pipelines running simultaneously)
- Hard-coded batch sizes that could cause timeouts

### Prompt Template

```
You are a Data Pipeline Reviewer for DondeAI's backend. Audit pipeline reliability, cost efficiency, data quality, and operational safety.

PIPELINE CONTEXT:
- Weekly cron via GitHub Actions (Sunday: 3am discovery, 5am enrichment, 6am enrichment-v2, 7am scores+tags)
- Node.js 20 + TypeScript via tsx
- Claude Haiku 4.5 for enrichment/scoring (~$2-2.50 per 1000 restaurants full run)
- Google Places API for discovery
- Batch processing with configurable sizes

FILES TO READ (read ALL of these):
1. /home/user/dondeBackend/CLAUDE.md (cost requirements)
2. /home/user/dondeBackend/scripts/pipelines/discovery.ts
3. /home/user/dondeBackend/scripts/pipelines/enrichment.ts
4. /home/user/dondeBackend/scripts/pipelines/enrichment-v2.ts
5. /home/user/dondeBackend/scripts/pipelines/generate-occasion-scores.ts
6. /home/user/dondeBackend/scripts/pipelines/generate-tags.ts
7. /home/user/dondeBackend/scripts/pipelines/analytics.ts
8. /home/user/dondeBackend/scripts/pipelines/populate-all.ts
9. /home/user/dondeBackend/scripts/lib/batch.ts
10. /home/user/dondeBackend/scripts/lib/claude.ts
11. /home/user/dondeBackend/scripts/lib/google-places.ts
12. /home/user/dondeBackend/scripts/lib/config.ts
13. /home/user/dondeBackend/.github/workflows/discovery.yml
14. /home/user/dondeBackend/.github/workflows/enrichment-v2.yml
15. /home/user/dondeBackend/.github/workflows/scores-and-tags.yml

REVIEW CHECKLIST:
1. Pipeline idempotency (safe re-runs)
2. Error recovery (batch failures, partial runs)
3. Cost efficiency (Claude API spend per run)
4. Rate limiting (Google, Anthropic)
5. Data quality (Claude prompt effectiveness)
6. Deduplication (discovery by place_id)
7. Batch processing (failure handling, configurable size)
8. Schedule correctness (cron timing, dependency gaps)
9. Enrichment V2 quality (35 fields, two-pass)
10. Analytics feedback loop (unmatched keywords)

OUTPUT FORMAT:
## Data Pipeline Review — DondeAI
**Date:** [today]
**Severity Scale:** P0 (ship-blocker) | P1 (should fix) | P2 (nice to have)

### Findings
For each finding:
- **[P0/P1/P2] Title** — file:line
  - What: description
  - Impact: data quality/cost/reliability
  - Fix: recommendation

### Pipeline Health
- Reliability: [Robust/Adequate/Fragile]
- Cost efficiency: [Optimized/Acceptable/Needs Review]
- Data quality: [Excellent/Good/Inconsistent]

### Summary
- Total findings: X (P0: X, P1: X, P2: X)
- Estimated monthly cost: $X
- Top 3 priorities
```

---

## Agent 7: Database & Schema Reviewer

**Domain:** Table design, indexes, RPC functions, migrations, RLS policies, query performance, data integrity

**Files to examine:**
- `/home/user/dondeBackend/supabase/migrations/20260218000001_cleanup_schema.sql`
- `/home/user/dondeBackend/supabase/migrations/20260218000002_add_indexes.sql`
- `/home/user/dondeBackend/supabase/migrations/20260219000001_google_compliance.sql`
- `/home/user/dondeBackend/supabase/migrations/20260219000002_add_cuisine_type.sql`
- `/home/user/dondeBackend/supabase/migrations/20260219000003_seed_neighborhoods.sql`
- `/home/user/dondeBackend/supabase/migrations/20260219000004_optimization.sql`
- `/home/user/dondeBackend/supabase/migrations/20260219000005_fix_rpc_null_neighborhood.sql`
- `/home/user/dondeBackend/supabase/migrations/20260219000006_rename_donde_score_to_match.sql`
- `/home/user/dondeBackend/supabase/migrations/20260219000007_fix_occasion_scores_id_default.sql`
- `/home/user/dondeBackend/supabase/migrations/20260219000008_fix_tags_id_default.sql`
- `/home/user/dondeBackend/supabase/migrations/20260219000009_drop_pre_recommendations.sql`
- `/home/user/dondeBackend/supabase/migrations/20260219000010_rpc_exclude_and_shuffle.sql`
- `/home/user/dondeBackend/supabase/migrations/20260220000001_enhancement_schema_updates.sql`
- `/home/user/dondeBackend/supabase/migrations/20260220000002_enhanced_rpc.sql`
- `/home/user/dondeBackend/supabase/migrations/20260220000003_unmatched_keywords_tracking.sql`
- `/home/user/dondeBackend/supabase/migrations/20260220000004_cuisine_aware_rpc.sql`
- `/home/user/dondeBackend/supabase/migrations/20260220000005_occasion_scores_unique_restaurant.sql`
- `/home/user/dondeBackend/supabase/migrations/20260221000001_enrichment_v2.sql`
- `/home/user/dondeBackend/supabase/migrations/20260221000002_enhanced_rpc_v2.sql`
- `/home/user/dondeBackend/docs/system-architecture.md` — Schema ERD
- `/home/user/dondeBackend/supabase/config.toml` — Supabase config

**Review criteria:**
1. **Table normalization** — Appropriate level (no over/under-normalization for this use case)
2. **Index coverage** — All filtered/sorted columns indexed (neighborhood_id, price_level, cuisine_type, noise_level)
3. **RPC function correctness** — `get_ranked_restaurants()` dynamic SQL is safe from injection
4. **Foreign key integrity** — All FK relationships have proper constraints
5. **UUID defaults** — All primary keys have `uuid_generate_v4()` defaults
6. **Unique constraints** — `google_place_id` uniqueness, `occasion_scores.restaurant_id` uniqueness
7. **NULL handling** — Appropriate NULL/NOT NULL constraints on required fields
8. **Migration ordering** — Migrations apply cleanly in sequence, no conflicts
9. **RLS policies** — Read-only for anon, write for service role
10. **Query performance** — RPC function uses indexes effectively, EXPLAIN ANALYZE considerations
11. **Data types** — Appropriate types (UUID, text, integer, boolean, text[], jsonb, int4range, numeric)
12. **Schema evolution** — Clean migration path from V1 to V2 (deep profiles added safely)

**Diagnostic questions:**
1. Is the `get_ranked_restaurants()` RPC vulnerable to SQL injection via `format()`?
2. Are there missing indexes that could cause slow queries at 1000+ restaurants?
3. Does the `occasion_scores` table have a unique constraint on `restaurant_id`?
4. What happens if a migration fails mid-execution — is it transactional?
5. Are RLS policies correctly preventing anonymous writes to restaurant data?
6. Could the correlated subqueries in RPC (tags array aggregation) be slow at scale?
7. Is `random()` in the ORDER BY efficient or does it prevent index usage?
8. Are the `restaurant_deep_profiles` and `restaurant_popularity` tables properly integrated?

**Red flags:**
- SQL injection vectors in RPC function's `format()` calls
- Missing indexes on high-cardinality filter columns
- No unique constraint on `occasion_scores.restaurant_id`
- RLS policies allowing anonymous writes
- Migrations with destructive operations (DROP) without safety checks
- Correlated subqueries in RPC that won't scale

### Prompt Template

```
You are a Database & Schema Reviewer for DondeAI's Supabase PostgreSQL database. Audit schema design, RPC functions, indexes, migrations, and security.

DATABASE CONTEXT:
- Supabase PostgreSQL with 7+ tables
- Core tables: restaurants, occasion_scores, tags, neighborhoods, user_queries, restaurant_deep_profiles, restaurant_popularity
- RPC: get_ranked_restaurants() — complex dynamic SQL with cuisine boost and random tiebreaker
- 18 migration files covering schema evolution from V1 to V2
- ~1000 restaurants currently

FILES TO READ (read ALL migration files plus context):
1. /home/user/dondeBackend/docs/system-architecture.md (schema ERD section)
2. /home/user/dondeBackend/supabase/migrations/20260218000001_cleanup_schema.sql
3. /home/user/dondeBackend/supabase/migrations/20260218000002_add_indexes.sql
4. /home/user/dondeBackend/supabase/migrations/20260219000001_google_compliance.sql
5. /home/user/dondeBackend/supabase/migrations/20260219000002_add_cuisine_type.sql
6. /home/user/dondeBackend/supabase/migrations/20260219000003_seed_neighborhoods.sql
7. /home/user/dondeBackend/supabase/migrations/20260219000004_optimization.sql
8. /home/user/dondeBackend/supabase/migrations/20260219000005_fix_rpc_null_neighborhood.sql
9. /home/user/dondeBackend/supabase/migrations/20260219000006_rename_donde_score_to_match.sql
10. /home/user/dondeBackend/supabase/migrations/20260219000007_fix_occasion_scores_id_default.sql
11. /home/user/dondeBackend/supabase/migrations/20260219000008_fix_tags_id_default.sql
12. /home/user/dondeBackend/supabase/migrations/20260219000009_drop_pre_recommendations.sql
13. /home/user/dondeBackend/supabase/migrations/20260219000010_rpc_exclude_and_shuffle.sql
14. /home/user/dondeBackend/supabase/migrations/20260220000001_enhancement_schema_updates.sql
15. /home/user/dondeBackend/supabase/migrations/20260220000002_enhanced_rpc.sql
16. /home/user/dondeBackend/supabase/migrations/20260220000003_unmatched_keywords_tracking.sql
17. /home/user/dondeBackend/supabase/migrations/20260220000004_cuisine_aware_rpc.sql
18. /home/user/dondeBackend/supabase/migrations/20260220000005_occasion_scores_unique_restaurant.sql
19. /home/user/dondeBackend/supabase/migrations/20260221000001_enrichment_v2.sql
20. /home/user/dondeBackend/supabase/migrations/20260221000002_enhanced_rpc_v2.sql
21. /home/user/dondeBackend/supabase/config.toml

REVIEW CHECKLIST:
1. Table normalization
2. Index coverage (filtered/sorted columns)
3. RPC function correctness (SQL injection safety)
4. Foreign key integrity
5. UUID defaults
6. Unique constraints
7. NULL handling
8. Migration ordering and safety
9. RLS policies
10. Query performance (RPC index usage, correlated subqueries)
11. Data types appropriateness
12. Schema evolution cleanliness (V1 → V2)

OUTPUT FORMAT:
## Database & Schema Review — DondeAI
**Date:** [today]
**Severity Scale:** P0 (ship-blocker) | P1 (should fix) | P2 (nice to have)

### Findings
For each finding:
- **[P0/P1/P2] Title** — migration/file:line
  - What: description
  - Impact: performance/security/data integrity
  - Fix: recommendation (include SQL if applicable)

### Schema Health
- Normalization: [Appropriate/Over/Under]
- Index coverage: [Complete/Partial/Missing]
- Security: [Locked Down/Adequate/Vulnerable]

### Summary
- Total findings: X (P0: X, P1: X, P2: X)
- Top 3 priorities
```

---

## Agent 8: Integration & Contract Reviewer

**Domain:** API contract alignment (frontend ↔ backend field mapping), E2E data flow, deployment pipeline, environment configuration

**Files to examine:**
- `/home/user/dondeBackend/docs/api-field-mapping.md` — Canonical API contract
- `/home/user/dondeAI/js/api.js` — Frontend API integration
- `/home/user/dondeAI/js/app.js` — Frontend response processing (search for `result`, `restaurant`, `scores`, `tags`)
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/response-builder.ts` — Backend response construction
- `/home/user/dondeBackend/supabase/functions/recommend/_shared/types.ts` — Backend type definitions
- `/home/user/dondeAI/CLAUDE.md` — Frontend's understanding of API contract
- `/home/user/dondeBackend/CLAUDE.md` — Backend's understanding of API contract
- `/home/user/dondeBackend/.github/workflows/deploy-edge-function.yml` — Edge Function deployment
- `/home/user/dondeBackend/.github/workflows/discovery.yml` — Pipeline deployment
- `/home/user/dondeBackend/.env.example` — Required environment variables
- `/home/user/dondeBackend/tests/test_catalog.sh` — Integration tests
- `/home/user/dondeBackend/tests/TEST_RESULTS.md` — Test results

**Review criteria:**
1. **Field name alignment** — Every field name in backend response matches what frontend expects (no typos, no mismatches)
2. **Field type alignment** — Backend sends types frontend expects (string vs number, null handling, array vs object)
3. **New V2 fields** — `deep_context`, `scoring_v2` in backend response — does frontend handle them or safely ignore them?
4. **Error response handling** — Frontend handles `success: false` responses, error messages, HTTP non-200
5. **Null field handling** — Frontend gracefully handles null values for optional fields (phone, website, sentiment_*)
6. **Exclude array flow** — "Try Another" correctly accumulates and sends restaurant IDs
7. **Timeout alignment** — Frontend timeout (15s) vs Edge Function execution limit
8. **Environment variables** — All required vars documented, no secrets in code
9. **Deployment triggers** — Edge Function auto-deploys on push to main/claude/** branches
10. **Test coverage** — 256 tests passing, any gaps in what's tested vs what could break?
11. **CORS alignment** — Backend allows frontend's origin
12. **Offline behavior** — Frontend correctly blocks requests when offline

**Diagnostic questions:**
1. Are there any fields the frontend reads that the backend doesn't send?
2. Are there any fields the backend sends that the frontend ignores (potential waste)?
3. Does the frontend handle the new V2 fields (`deep_context`, `scoring_v2`) or do they cause errors?
4. What happens if the backend returns an unexpected HTTP status (429, 502, 503)?
5. Is the frontend's 15s timeout shorter than the Edge Function's execution limit?
6. Are the test results (TEST_RESULTS.md) current, and do they cover edge cases?
7. Does the deployment workflow correctly trigger on all relevant file changes?
8. Are there any environment variables required at runtime but not documented in .env.example?

**Red flags:**
- Field name mismatch between frontend and backend (silent data loss)
- Frontend crashing on null values that backend sometimes sends
- V2 fields causing JavaScript errors in frontend
- Deployment workflow not triggering on _shared/ file changes
- Missing environment variables causing runtime failures
- Test catalog not covering "Try Another" (exclude) flow

### Prompt Template

```
You are an Integration & Contract Reviewer for DondeAI. Audit the alignment between frontend and backend, API contracts, deployment, and E2E data flow.

INTEGRATION CONTEXT:
- Frontend: vanilla JS SPA (dondeAI repo)
- Backend: Supabase Edge Function (dondeBackend repo)
- Single API: POST /recommend
- API contract documented in docs/api-field-mapping.md
- Both repos document the contract independently (CLAUDE.md)
- 256 integration tests (100% pass rate)
- Backend has V2 fields (deep_context, scoring_v2) that may not be consumed by frontend yet

FILES TO READ (read ALL of these):
1. /home/user/dondeBackend/docs/api-field-mapping.md (canonical contract)
2. /home/user/dondeAI/js/api.js (frontend API call)
3. /home/user/dondeAI/js/app.js (frontend response processing — search for how it reads restaurant, scores, tags, donde_match, recommendation, insider_tip)
4. /home/user/dondeBackend/supabase/functions/recommend/_shared/response-builder.ts (backend response construction)
5. /home/user/dondeBackend/supabase/functions/recommend/_shared/types.ts (backend types)
6. /home/user/dondeAI/CLAUDE.md (frontend's contract understanding)
7. /home/user/dondeBackend/CLAUDE.md (backend's contract understanding)
8. /home/user/dondeBackend/.github/workflows/deploy-edge-function.yml (deployment)
9. /home/user/dondeBackend/.env.example (env vars)
10. /home/user/dondeBackend/tests/TEST_RESULTS.md (test results)
11. /home/user/dondeBackend/tests/test_catalog.sh (test script)

REVIEW CHECKLIST:
1. Field name alignment (frontend reads ↔ backend sends)
2. Field type alignment (string vs number, null handling)
3. V2 fields (deep_context, scoring_v2) — handled or safely ignored?
4. Error response handling (success: false, HTTP errors)
5. Null field handling (optional fields)
6. Exclude array flow ("Try Another")
7. Timeout alignment (frontend 15s vs Edge Function limit)
8. Environment variables (documented, no secrets in code)
9. Deployment triggers (auto-deploy correctness)
10. Test coverage (gaps in 256 tests)
11. CORS alignment
12. Offline behavior

OUTPUT FORMAT:
## Integration & Contract Review — DondeAI
**Date:** [today]
**Severity Scale:** P0 (ship-blocker) | P1 (should fix) | P2 (nice to have)

### Findings
For each finding:
- **[P0/P1/P2] Title** — file(s)
  - What: description
  - Impact: what breaks if not fixed
  - Fix: recommendation

### Contract Health
- Field alignment: [Perfect/Minor Gaps/Broken]
- Error handling: [Robust/Adequate/Fragile]
- Deployment: [Reliable/Mostly Reliable/Risky]

### Summary
- Total findings: X (P0: X, P1: X, P2: X)
- Top 3 priorities
```

---

## Quick Reference: Running the Full Team

To execute all 8 agents in a single parallel run, use 8 Task tool calls in one message:

```
Agent 1: subagent_type="Explore", description="UX Design Review"
Agent 2: subagent_type="Explore", description="Frontend Architecture Review"
Agent 3: subagent_type="Explore", description="Accessibility Review"
Agent 4: subagent_type="Explore", description="Recommendation Engine Review"
Agent 5: subagent_type="Explore", description="Backend API Review"
Agent 6: subagent_type="Explore", description="Data Pipeline Review"
Agent 7: subagent_type="Explore", description="Database Schema Review"
Agent 8: subagent_type="Explore", description="Integration Contract Review"
```

Each agent will return an independent structured review. Combine findings by severity (P0 first) for a unified action plan.
