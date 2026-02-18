# DondeAI — UI/UX Business Requirements

**Version:** 1.0
**Product:** AI-powered restaurant/bar recommendation engine
**Market:** Chicago (expandable)
**Platform:** Web + Mobile (responsive SPA)
**Backend:** n8n webhook + Supabase (immutable — UI must conform to its contract)

---

## 1. Design Philosophy

### 1.1 Core Identity: "Ink & Momentum"

DondeAI should feel like writing a wish on paper and watching it come to life. Every interaction should carry the weight of a pen stroke — confident, fluid, irreversible in feeling but forgivable in practice. The experience is a conversation, not a form.

### 1.2 Inspiration Reference

| Reference | Design Principle to Extract |
|---|---|
| **Arc Browser** | **Sliding choreography as narrative.** Inputs should feel like camera pans across a storyboard — each frame reveals exactly one decision. Transitions should use spring physics (overshoot + settle) rather than linear easing. Dark/light modes should be equally premium — never an afterthought. Discovery should feel gamified (progress tracking, achievement-like indicators). |
| **Notion** | **Progressive disclosure as experience design.** Never show two unrelated decisions simultaneously. The first screen should feel like an onboarding moment, not a form. Content should slide off-screen rather than collapse. Typography should do the work of hierarchy — no heavy visual chrome needed. |
| **Linear** | **Handwritten texture meets precision engineering.** Serif/italic typography should feel hand-lettered for emotional prompts. Monospace typography should feel like annotated blueprints for data and scores. Focus states should feel alive — subtle animation on the element receiving attention. Dark themes should feel "buttery" — warm, not harsh. |
| **Raycast** | **Instant-commit interactions.** Shortcut actions (surprise me, quick picks, history recall) should go from zero to result in a single gesture. Score badges should use monospace numerals with a "handwritten measurement" quality. Theme switching must be instantaneous — zero layout shift, zero flash. |
| **Supabase Dashboard** | **Code-like annotations as design language.** Data labels, scores, and utility text should read like annotated blueprints. Staggered entrance animations should feel like ink stamps appearing one by one. Slide-to-next-screen choreography should have clear spatial logic (left = past, right = future). |
| **Apple Notes (iOS)** | **Physical ink simulation.** Cursor/touch interactions should have a diffusion/bloom quality. Swipe gestures should have rubber-band resistance (dampened, not 1:1). Haptic feedback should be rhythmic (heartbeat pattern), not percussive. Reveal patterns should feel like lifting a page. |

### 1.3 Design Principles

1. **One Decision Per Frame** — Each step of the input flow must contain exactly one input category. The user must never be asked to make two unrelated decisions at the same time.

2. **Momentum Over Confirmation** — Optional filters should auto-advance after selection (target: ~600ms delay). The system assumes forward intent. Users go back explicitly; they go forward by momentum.

3. **Commit and Forgive** — Selections should feel decisive (confident animation feedback) but be instantly reversible at any point before final submission. A summary/review step must allow the user to jump back to any prior input to edit it.

4. **Sound Is Texture** — Audio feedback must be ambient and culture-appropriate. It should feel like environmental texture, not notification alerts. Sound must be opt-in (off by default) and persistent across sessions.

5. **The Screen Is the Canvas** — The interface should use the full viewport as its canvas. No visible scrollbars during the input flow. Content IS the interface — minimize chrome, headers, and navigation furniture.

6. **Three Voices of Type** — Typography must carry hierarchy through three distinct roles:
   - **Emotional voice** (serif/italic) — Prompts, greetings, headings. Should feel handwritten.
   - **Structural voice** (geometric sans) — Buttons, labels, navigation. Should feel authoritative.
   - **Data voice** (monospace) — Scores, tags, badges, metadata. Should feel like annotated measurements.

7. **Cultural Personality** — The entire UI's color palette, accent tones, textures, iconography, and terminology must adapt to the user's selected cultural theme. This is not just a color swap — it is a personality change.

8. **Motion Has Grammar** — Motion should follow a consistent language:
   - **Spring physics** (overshoot + settle) for user-initiated transitions
   - **Gentle easing** for system-initiated reveals and score animations
   - **Instant fallback** for users who prefer reduced motion (respect `prefers-reduced-motion`)

---

## 2. Business Requirements

### 2.1 Critical — Core User Journey

These requirements define the minimum viable product. Without any one of them, the app cannot deliver its primary value (input → AI recommendation → display).

---

#### BR-C1: Free-Text Craving Input

The user must be able to describe what they are craving in free text. This is the **primary and only required input**. All other inputs are optional refinements.

| Requirement | Detail |
|---|---|
| Input type | Multi-line free text |
| Required | **Yes** — submission must be blocked if this field is empty |
| Placeholder | Must be contextual (changes by time of day — see BR-H7) |
| Voice input | Must support speech-to-text as an alternative input method (Web Speech API). Gracefully degrade on unsupported browsers. |
| Smart chips | On focus, show contextual shortcut chips (e.g. "BYOB", "Outdoor", "Hidden gem", "Kid-friendly") that append text to the input when tapped. |

**Maps to backend field:** `special_request` (string)

---

#### BR-C2: Occasion/Vibe Filter

The user may optionally select an occasion or vibe for their outing.

| Requirement | Detail |
|---|---|
| Input type | Single-select from predefined list |
| Required | **No** — skippable, defaults to "Any" |
| Options | `Date Night`, `Group Hangout`, `Family Dinner`, `Business Lunch`, `Solo Dining`, `Special Occasion`, `Treat Myself`, `Adventure`, `Chill Hangout` |
| Deselect | Tapping a selected option must deselect it |


**Maps to backend field:** `occasion` (string, falls back to `"Any"`)

---

#### BR-C3: Neighborhood Filter

The user may optionally select a neighborhood.

| Requirement | Detail |
|---|---|
| Input type | Single-select from predefined list |
| Required | **No** — skippable, defaults to "Anywhere" |
| Default | "Anywhere" must be pre-selected |
| Options | `Anywhere`, `Pilsen`, `Wicker Park`, `Logan Square`, `Lincoln Park`, `West Loop`, `Bucktown`, `Hyde Park`, `Chinatown`, `Little Italy`, `Andersonville`, `River North`, `Old Town`, `Lakeview`, `Fulton Market` |


**Maps to backend field:** `neighborhood` (string, falls back to `"Anywhere"`)

---

#### BR-C4: Budget Filter

The user may optionally select a budget range.

| Requirement | Detail |
|---|---|
| Input type | Single-select from 5 tiers |
| Required | **No** — skippable, defaults to "Any" |
| Options | `Any` (default), `$` (Budget), `$$` (Mid), `$$$` (Upscale), `$$$$` (Splurge) |
| Auto-advance | After selection, auto-advance  |
| Accessibility | Must provide a screen-reader-accessible equivalent (e.g. hidden range slider) |

**Maps to backend field:** `price_level` (string: `"Any"`, `"$"`, `"$$"`, `"$$$"`, or `"$$$$"`)

---



#### BR-C6: Recommendation Display

After submission, the app must display the AI-generated restaurant recommendation with all available data from the backend response.

**Required display elements:**

| Data Point | Priority | Notes |
|---|---|---|
| Restaurant name | Must show | Animated reveal recommended |
| One-liner description | Must show | |
| AI recommendation paragraph | Must show | |
| DondeAI Score (0-10) | Must show | Animated score visualization with color tiers: ≥8 (excellent), ≥5 (good), <5 (risky) |
| Google rating + stars | Must show | 5-star visualization + numeric rating + review count |
| Price level | Must show | |
| Address | Must show | Tappable — opens navigation/maps |
| Insider tip | Show if present | |
| Vibe profile radar | Show if ≥3 dimensions present | Radar/spider chart of 6 vibe scores |
| Cuisine emoji + gradient | Show (computed) | Derived from cuisine keywords in response |
| Action buttons (Website, Call, Reviews) | Show if data present | |
| Atmosphere tags (lighting, dress code, patio, live music, pets) | Show if data present | |
| Parking info | Show if present | |
| Sentiment breakdown | Show if present | Positive/neutral/negative bar |
| Tags | Show if present | |
| Noise level | Show if present | |

---

#### BR-C7: Try Another / Reject

The user must be able to dismiss the current recommendation and request an alternative.

| Requirement | Detail |
|---|---|
| Mechanism | Swipe-to-dismiss gesture (mobile) and/or explicit "Again" button |
| Behavior | Re-submits the same payload to get a different result |
| Visual feedback | Card dismissal must have clear exit animation |

---

#### BR-C8: Start Over / Reset

The user must be able to reset all inputs and start the flow from the beginning.

| Requirement | Detail |
|---|---|
| Trigger | Button on result screen + logo/home tap in header |
| Behavior | Clears all inputs to defaults, navigates to the first step |

---

### 2.2 High — Enhanced User Experience

These requirements significantly improve usability and engagement.

---

#### BR-H1: Surprise Me (One-Tap Recommendation)

A shortcut that bypasses all optional filters and immediately requests a recommendation.

| Requirement | Detail |
|---|---|
| Trigger | Button on the first screen |
| Behavior | Auto-fills the craving input with a random prompt from a curated list, skips to the review step, auto-submits after a brief delay (~800ms) |
| Prompt examples | "surprise me with the best spot tonight", "the most underrated gem nearby", "whatever locals are obsessed with" |

---

#### BR-H2: Quick Picks (Contextual Shortcuts)

Time-of-day-aware shortcut tiles on the first screen.

| Requirement | Detail |
|---|---|
| Content | 4 tiles, changing by time of day (morning: Brunch/Coffee/Bakery; lunch: Quick/Healthy/Noodles; dinner: Date/Drinks/Trendy; late: Late/Cocktails/Comfort) |
| Behavior | On tap: fills craving input, skips to review, auto-submits |
| History tile | If the user has search history, show the most recent search as an additional tile |

---

#### BR-H3: Search History

Persist the user's last 3 searches for quick re-execution.

| Requirement | Detail |
|---|---|
| Storage | Client-side persistent (survives page reload) |
| Display | Compact chips in the header area (visible during filter steps) |
| Max entries | 3 (most recent first, deduped by label) |
| Re-execute | Tapping a history chip restores all fields and auto-submits |

---

#### BR-H4: Share Recommendation

Users must be able to share their recommendation via multiple channels.

| Requirement | Detail |
|---|---|
| Channels | Clipboard copy, WhatsApp, SMS, X (Twitter), Instagram (clipboard), TikTok (clipboard), Reddit, Facebook |
| Share text | Formatted with restaurant name, one-liner, recommendation excerpt, insider tip, address, website, "via DondeAI" attribution |
| UI | Bottom sheet with platform buttons |

---

#### BR-H5: Cultural Theming System

The UI must support 5 cultural (Indian/Middle Eastern, Nepalese/Tibetian, Japanese/Korean, African/Black American, South American/Puerto Rican)  themes and 1 Neutral theme , each with dark and light modes (12 total variants).

| Requirement | Detail |
|---|---|
| Themes | 5 cultural (Indian/Middle Eastern, Nepalese/Tibetian, Japanese/Korean, African/Black American, South American/Puerto Rican)  themes and 1 Neutral theme
Color Panel : Should be meaningful and match based on cultural theme selected
iconography:: Should be meaningful and match based on cultural theme selected
| What changes per theme | Color palette (40+ variables), accent colors, background tones, glass/blur intensity, border radius, shadow depth, background texture/pattern, vibe icon set, all UI label text (prompt, placeholder, CTA label, section headings, button text), ambient blob colors/timing, audio chime signature |
| Persistence | Selected theme must persist across sessions (client-side storage) |
| Switching | Must be instantaneous — no page reload, no layout shift |
| Selection UI | A gallery/picker showing all themes with visual preview (color swatch, name, description) |
| Light/dark toggle | Independent of culture selection — must persist separately |

---

#### BR-H6: Sound & Haptic Feedback

| Requirement | Detail |
|---|---|
| Sound toggle | Off by default, user opt-in, persists across sessions |
| Culture chimes | Each theme has a signature audio tone (Web Audio synthesized, not audio files). Plays once on theme switch and on recommendation reveal. |
Should be meaningful and match based on cultural theme selected
| Haptic | Vibration pattern on recommendation reveal (mobile only, gracefully degrade) |

---

#### BR-H7: Time-of-Day Intelligence

| Requirement | Detail |
|---|---|
| Greeting | Personalized by time: "Good morning", "Good afternoon", "Good evening", "Late night" |
Should be meaningful and match based on cultural theme selected
| Placeholder text | Craving input placeholder adapts to meal context |
| Quick picks | Tile options adapt to meal context (see BR-H2) |
| Smart defaults banner | Optional subtle indicator showing detected context (e.g. "Sensing dinner time — defaults applied") |

---

#### BR-H8: Voice Input

| Requirement | Detail |
|---|---|
| API | Web Speech Recognition |
| Behavior | Activates on button tap, shows recording indicator, fills craving input with transcript |
| Auto-submit | If final result has high confidence (>70%) and sufficient length (>5 characters), auto-advance to review and submit |
| Fallback | Button does nothing on unsupported browsers |


#### BR-H0: Animated Score Visualization

DondeAI Score should animate on reveal: ring fill with spring easing, number counting up, color tier indicator (green/accent/red), orbit dot positioning at score angle, verdict label fade-in (e.g. "Outstanding", "Solid Pick").

---

### 2.3 Low — Polish & Delight

---

#### BR-L1: Ambient Visual Layer

Background atmosphere that reinforces the cultural theme: animated gradient blobs, grain/noise texture, cursor-following glow effect, cultural pattern overlays.

#### BR-L2: Particle Loading Animation

During API request, a full-screen particle animation. On response, particles should converge into the brand logo shape before dispersing to reveal the restaurant name. Must respect `prefers-reduced-motion`.

#### BR-L3: Keyboard Navigation

Full keyboard support: arrow keys to navigate between steps, Enter/Cmd+Enter to submit, Escape to go back or reset from results.

#### BR-L4: Offline Detection

Show a persistent banner when the user loses connectivity. Block submission with a clear message. Auto-dismiss when connectivity returns.

#### BR-L5: Virtual Keyboard Adaptation

On mobile, when the software keyboard opens, the UI should reflow to prioritize the input area (hide branding, reduce padding, shift content toward the top).


#### BR-L7: Smart Chips (Input Augmentation)

Below the craving input, show tappable shortcut chips that append common modifiers to the text (e.g. "BYOB", "Outdoor seating", "Hidden gem", "Kid-friendly"). Chips should appear on input focus and disappear on blur.

---

## 3. Backend Integration Contract

> **This contract is immutable.** The UI must conform to these exact field names and types. The backend (n8n + Supabase) is not modified by UI changes.

### 3.1 API Endpoint

```
POST https://donde.app.n8n.cloud/webhook-test/donde-recommend
Content-Type: application/json
```

### 3.2 Request Payload

Exactly 4 fields. No additional fields should be sent.

| Field | Type | Source | Default |
|---|---|---|---|
| `special_request` | `string` | User's free-text craving input | `""` |
| `occasion` | `string` | Selected vibe/occasion | `"Any"` |
| `neighborhood` | `string` | Selected neighborhood | `"Anywhere"` |
| `price_level` | `string` | Selected budget tier | `"Any"` |

**Example request:**
```json
{
  "special_request": "cozy ramen with killer sake",
  "occasion": "Date Night",
  "neighborhood": "Wicker Park",
  "price_level": "$$$"
}
```

### 3.3 Response Schema

```json
{
  "success": boolean,

  "restaurant": {
    "name": "string",
    "best_for_oneliner": "string",
    "address": "string",
    "phone": "string | null",
    "website": "string | null",
    "price_level": "string",
    "noise_level": "string | null",
    "cuisine_type": "string | null",
    "google_rating": "string (numeric) | null",
    "google_review_count": "string | null",
    "google_place_id": "string | null",
    "parking_availability": "string | null",
    "lighting_ambiance": "string | null",
    "dress_code": "string | null",
    "outdoor_seating": "boolean | null",
    "live_music": "boolean | null",
    "pet_friendly": "boolean | null",
    "sentiment_breakdown": "string | null",
    "sentiment_score": "string (numeric 0-1) | null"
  },

  "recommendation": "string",
  "insider_tip": "string | null",
  "donde_score": "string (numeric 0-10)",

  "scores": {
    "date_friendly_score": "string (numeric 0-10) | null",
    "group_friendly_score": "string (numeric 0-10) | null",
    "family_friendly_score": "string (numeric 0-10) | null",
    "business_lunch_score": "string (numeric 0-10) | null",
    "solo_dining_score": "string (numeric 0-10) | null",
    "hole_in_wall_factor": "string (numeric 0-10) | null",
    "romantic_rating": "string (numeric 0-10) | null"
  },

  "tags": ["string"] | null
}
```

### 3.4 Response Field Descriptions

| Field | What It Is | How to Use It |
|---|---|---|
| `success` | Whether the backend found a recommendation | `false` → show error from `recommendation` field |
| `restaurant.name` | Restaurant name | Primary heading of result |
| `restaurant.best_for_oneliner` | Short tagline | Subtitle under name |
| `restaurant.address` | Full street address | Display + link to Google Maps navigation |
| `restaurant.phone` | Phone number | `tel:` link (show only if present) |
| `restaurant.website` | Restaurant URL | External link (show only if present) |
| `restaurant.price_level` | Price range string | Display as-is (e.g. "$$") |
| `restaurant.noise_level` | Noise description | Display as-is |
| `restaurant.cuisine_type` | Cuisine category | Can use for visual theming (emoji, color) |
| `restaurant.google_rating` | Google star rating (e.g. "4.5") | Parse to float, render as star visualization |
| `restaurant.google_review_count` | Review count (e.g. "1,234") | Display alongside rating |
| `restaurant.google_place_id` | Google Maps Place ID | Link to Google Maps place page |
| `restaurant.parking_availability` | Parking description | Display only if present |
| `restaurant.lighting_ambiance` | Ambiance description | Display as atmosphere tag |
| `restaurant.dress_code` | Dress code | Display as atmosphere tag |
| `restaurant.outdoor_seating` | Has patio | Display as atmosphere tag if true |
| `restaurant.live_music` | Has live music | Display as atmosphere tag if true |
| `restaurant.pet_friendly` | Allows pets | Display as atmosphere tag if true |
| `restaurant.sentiment_breakdown` | Text like "85% positive, 10% neutral, 5% negative" | Parse percentages, render as stacked bar |
| `restaurant.sentiment_score` | Float 0-1 | Fallback if breakdown is not parseable |
| `recommendation` | AI-written paragraph about why this restaurant fits | Main body text of result |
| `insider_tip` | Insider knowledge | Display in a highlighted callout (only if present) |
| `donde_score` | AI confidence score 0-10 | Render as animated score visualization with color tiers |
| `scores.date_friendly_score` | How good for dates (0-10) | Radar chart dimension |
| `scores.group_friendly_score` | How good for groups (0-10) | Radar chart dimension |
| `scores.family_friendly_score` | How good for families (0-10) | Radar chart dimension |
| `scores.business_lunch_score` | How good for business (0-10) | Radar chart dimension |
| `scores.solo_dining_score` | How good for solo (0-10) | Radar chart dimension |
| `scores.hole_in_wall_factor` | Hidden gem factor (0-10) | Radar chart dimension |
| `scores.romantic_rating` | Romance factor (0-10) | Display as separate score element |
| `tags` | Array of descriptor tags | Render as pill-shaped tag cloud |

### 3.5 Error Handling Requirements

| Condition | UI Must |
|---|---|
| HTTP error (non-200) | Show user-friendly error (e.g. "The engine took a nap — try again."), return to review step, re-enable submit |
| `success: false` | Show the `recommendation` field value as the error message |
| Network failure | Show "Couldn't reach the engine.", return to review step |
| Offline (pre-check) | Block submission entirely, show "You're offline — reconnect to get recommendations" |
| All inputs empty/default | Block submission, show "Give us a hint — a craving, a vibe, a neighborhood…" |

---

## 4. Client-Side Persistence

| Key | What to Store | Retention |
|---|---|---|
| Theme preference | Culture name + light/dark mode | Permanent (until user changes) |
| Sound preference | On/off boolean | Permanent |
| Search history | Last 3 search payloads with labels and timestamps | Permanent (FIFO, deduped by label) |

Storage mechanism is implementation-dependent (localStorage, IndexedDB, cookies, etc.).

---

## 5. Accessibility Requirements

| Requirement | Detail |
|---|---|
| Skip navigation link | Must be available for keyboard users |
| Semantic landmarks | Main content area must have `role="main"` or `<main>` |
| Input step semantics | Each input step must be announced to screen readers on transition |
| Selection inputs | All radio-style selectors must use proper ARIA roles (`radiogroup`, `radio`, `aria-pressed`/`aria-checked`) |
| Error announcements | Errors must use `aria-live="assertive"` |
| Focus management | Focus must move to the primary interactive element when transitioning between steps |
| Reduced motion | All animations must be disabled when `prefers-reduced-motion: reduce` is set |
| Keyboard operability | All interactive elements must be reachable and operable via keyboard |
| Color contrast | Text and interactive elements must meet WCAG 2.1 AA contrast requirements across all 30 theme variants |

---

## 6. Platform Requirements

| Requirement | Detail |
|---|---|
| Responsive | Must work on screens from 320px to 2560px wide |
| Mobile-first | Primary design target is mobile (375px viewport) |
| Touch support | All interactions must work with touch input |
| No framework dependency | Must remain vanilla HTML/CSS/JS (no React, Vue, Angular, etc.) |
| No build step | Files must be servable as-is (no webpack, Vite, etc.) |
| Safe areas | Must respect `env(safe-area-inset-*)` for notched devices |
| Offline resilience | Must detect and communicate connectivity state |

---

## 7. Cuisine Visual Mapping Reference

The UI should attempt to derive a visual identity (color hue and emoji) for each recommendation based on keyword matching against the restaurant's name, one-liner, cuisine type, recommendation text, and tags.

**Keyword → Hue mapping:**

| Keywords | Hue (HSL) | Emoji |
|---|---|---|
| sushi, japanese, ramen | 210 | 🍣 |
| mexican, taco | 25-30 | 🌮 |
| italian, pasta, pizza | 95-100 | 🍝 |
| indian, curry | 35-40 | 🍛 |
| thai, vietnamese | 140-150 | 🍜 |
| chinese, dim sum | 5 | 🥟 |
| korean, bbq | 350 | 🥩 |
| french, bistro | 45 | 🥐 |
| seafood, fish | 195 | 🦞 |
| steak | 10 | 🥩 |
| burger, american | 35-220 | 🍔 |
| coffee, cafe | 30 | ☕ |
| cocktail, bar | 280 | 🍸 |
| vegan | 130 | 🥗 |
| brunch | — | 🥞 |
| *(no match)* | — | 🍽 |

---

## 8. Radar Chart Dimension Reference

The vibe profile radar requires at minimum 3 of the following 6 dimensions to render. If fewer than 3 are present in the response, the radar should be hidden.

| Backend Key | Short Label | Full Label |
|---|---|---|
| `date_friendly_score` | DT | Date |
| `group_friendly_score` | GR | Group |
| `family_friendly_score` | FM | Family |
| `business_lunch_score` | BZ | Business |
| `solo_dining_score` | SL | Solo |
| `hole_in_wall_factor` | GM | Gem |

---

## 9. Theme Label Mapping Reference

Each cultural theme overrides the following UI labels. A new UI implementation must support all these override points.

| Label Key | What It Controls | Example (Vinyl) | Example (Sabor) | Example (Console) |
|---|---|---|---|---|
| `vibe` | Vibe/occasion step heading | "Mood" | "Vibe" | "Type" |
| `hood` | Neighborhood step heading | "Spot" | "Barrio" | "Area" |
| `blurb` | Recommendation section title | "The Liner Notes" | "El Cuento" | "Notes" |
| `prompt` | Craving input label | "What are you craving?" | "¿Qué quieres?" | "Search" |
| `placeholder` | Craving input placeholder | "cozy ramen with killer sake…" | "carnitas with fire salsa…" | "restaurant query…" |
| `cta` | Submit/manifest button label | "Manifest" | "Dale" | "Search" |
| `again` | Try again button label | "Again" | "Otra vez" | "Reset" |
| `share` | Share button label | "Share" | "Comparte" | "Copy" |

**Full label set for all 15 cultures is defined in the codebase as `THEME_LABELS` and must be preserved in any reimplementation.**

---

## 10. Score Color Tier Reference

The DondeAI Score (0-10) must use color tiers to communicate quality at a glance:

| Score Range | Tier | Color Token | Verdict Label |
|---|---|---|---|
| 9-10 | High | `--green` | "Outstanding" |
| 8 | High | `--green` | "Excellent" |
| 6-7 | Mid | `--ac` (accent) | "Solid Pick" |
| 4-5 | Mid | `--ac` (accent) | "Worth a Try" |
| 0-3 | Low | `--rose` | "Adventurous" |
