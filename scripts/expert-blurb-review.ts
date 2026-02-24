#!/usr/bin/env npx tsx
/**
 * Donde Multi-Expert Blurb Quality Review Tool
 *
 * Reusable script that runs 6 specialized expert reviews on restaurant
 * recommendation blurbs, then synthesizes findings via a Team Lead.
 *
 * Usage:
 *   npx tsx scripts/expert-blurb-review.ts          # Sample mode (hardcoded blurbs)
 *   npx tsx scripts/expert-blurb-review.ts --live    # Live mode (fetches from API)
 *
 * In Claude Code: expert analysis runs as Task tool subagents (no extra API cost).
 * In live mode: one Claude Haiku call per scenario via existing Supabase endpoint.
 */

const API_URL = "https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend";

// ─── Sample Blurbs (diverse scenarios for offline review) ────────────────────

interface BlurbSample {
  scenario: string;
  occasion: string;
  cuisine: string;
  neighborhood: string;
  price: string;
  recommendation: string;
  insider_tip: string;
  restaurant_name: string;
}

const SAMPLE_BLURBS: BlurbSample[] = [
  {
    scenario: "Date Night + Italian + West Loop + $$$",
    occasion: "Date Night",
    cuisine: "Italian",
    neighborhood: "West Loop",
    price: "$$$",
    restaurant_name: "Monteverde",
    recommendation:
      "Half of the West Loop shows up here on a Tuesday, and there's no reservation trick that helps. The handmade rigatoni has this ridged texture that traps every drop of the slow-cooked ragu. Lighting is low, the room has energy, and it never tries too hard. The wine list is way better than it needs to be.",
    insider_tip:
      "The two-top by the front window is the most intimate seat. Get there by 5:30.",
  },
  {
    scenario: "Adventure + Mexican + Pilsen + $",
    occasion: "Adventure",
    cuisine: "Mexican/Oaxacan",
    neighborhood: "Pilsen",
    price: "$",
    restaurant_name: "La Oaxaquena",
    recommendation:
      "Three generations of the same Oaxacan family. Same mole recipe. Pilsen hasn't gotten tired of it. Counter service, no frills, and the mole negro has a slow-building bitterness from charred chiles with just enough chocolate to round it out. Best plate is $12. You'll think about it for weeks.",
    insider_tip: "The mole negro is the one. It's the recipe that started everything.",
  },
  {
    scenario: "Group Hangout + Korean + Wicker Park + $$",
    occasion: "Group Hangout",
    cuisine: "Korean",
    neighborhood: "Wicker Park",
    price: "$$",
    restaurant_name: "En Hakkore",
    recommendation:
      "For a group hangout with energy, this is the move. Korean spot in Wicker Park where you'll order too many banchan and nobody will mind. It gets loud, which is part of the fun. BYOB keeps the bill low.",
    insider_tip:
      "It's BYOB, so grab a six-pack from the shop next door before you walk in.",
  },
  {
    scenario: "Solo Dining + Japanese + Anywhere + $$$$",
    occasion: "Solo Dining",
    cuisine: "Japanese",
    neighborhood: "River North",
    price: "$$$$",
    restaurant_name: "Omakase Yume",
    recommendation:
      "We keep sending solo diners here for a reason. The counter seats face the open kitchen, and watching the chef work the robata is half the experience. It's quiet enough to think, warm enough to linger. The omakase changes daily, so you never get the same meal twice. Not cheap, but worth treating yourself.",
    insider_tip: "Sit at the counter. Ask the chef what's freshest today.",
  },
  {
    scenario: "Family Dinner + Mexican + Logan Square + $$",
    occasion: "Family Dinner",
    cuisine: "Mexican",
    neighborhood: "Logan Square",
    price: "$$",
    restaurant_name: "L'Patron",
    recommendation:
      "The real test for a family spot: adults enjoy it AND kids don't lose it. This one passes. The tortillas are made fresh every hour, and you can smell the corn masa from the door. Portions are generous, the salsa verde has real heat, and the staff genuinely likes kids. Parking can be tricky on weekends, but the food makes up for it.",
    insider_tip: "Order the queso fundido as a table starter. It arrives bubbling.",
  },
  {
    scenario: "Business Lunch + American + West Loop + $$$",
    occasion: "Business Lunch",
    cuisine: "New American",
    neighborhood: "West Loop",
    price: "$$$",
    restaurant_name: "Girl & The Goat",
    recommendation:
      "Quiet enough to close a deal, interesting enough that nobody's bored. The menu changes enough that repeat visits don't feel stale, and the portions work for a business pace. Service is sharp without hovering. It's the kind of spot where the food impresses but doesn't distract from the conversation.",
    insider_tip:
      "Book the back corner table. It's quieter and feels more private.",
  },
  {
    scenario: "Special Occasion + French + River North + $$$$",
    occasion: "Special Occasion",
    cuisine: "French",
    neighborhood: "River North",
    price: "$$$$",
    restaurant_name: "Boka",
    recommendation:
      "We don't pull this card often. The tasting menu is serious without being stuffy, and the wine pairings actually match instead of just being expensive. Low lighting, impeccable pacing, and the kind of service where your glass never hits empty. It's not flashy. It's just really, really good at what it does. Expect to linger.",
    insider_tip: "Ask about the off-menu cheese course. It's worth the add-on.",
  },
  {
    scenario: "Chill Hangout + Brewery + Wicker Park + $$",
    occasion: "Chill Hangout",
    cuisine: "Brewery/American",
    neighborhood: "Wicker Park",
    price: "$$",
    restaurant_name: "Piece Brewery",
    recommendation:
      "No agenda needed. Piece has been doing thin-crust pizza and house-brewed beer in Wicker Park long enough that it feels like part of the neighborhood. The New Haven-style pies have a charred, crackly crust that splits clean. It can get rowdy on weekends, which is honestly the vibe you want for a chill hang.",
    insider_tip:
      "Try the white clam pie. It's not on the regular rotation but they usually have it.",
  },
  {
    scenario: "Cuisine Mismatch + Adventure + Jamaican + $ (mismatch)",
    occasion: "Adventure",
    cuisine: "Mexican-Indian Fusion (fallback)",
    neighborhood: "Logan Square",
    price: "$",
    restaurant_name: "Mirra",
    recommendation:
      "The carne apache here is bold and addictive, and the patio has the kind of warm, low-lit energy that works for a date just as well as a solo meal. It's not the Jamaican jerk you were after, but the Mexican-Indian fusion pulls flavors that scratch a similar itch. The orange-infused coffee at the end seals it.",
    insider_tip: "The carne apache is the move. Sit on the patio if weather allows.",
  },
  {
    scenario: "Cuisine Mismatch + Date Night + Scandinavian + $$ (mismatch)",
    occasion: "Date Night",
    cuisine: "French (fallback)",
    neighborhood: "River North",
    price: "$$",
    restaurant_name: "Boka",
    recommendation:
      "Low lighting, impeccable pacing, and a wine list that actually matches what's on the plate. It's French, not the Scandinavian you had in mind, but the tasting menu has a clean, restrained elegance that shares DNA with Nordic cooking. You'll linger.",
    insider_tip: "Ask about the off-menu cheese course.",
  },
];

// ─── Expert Prompt Definitions ───────────────────────────────────────────────

interface ExpertDefinition {
  name: string;
  role: string;
  prompt: string;
  dimensions: string[];
}

const EXPERTS: ExpertDefinition[] = [
  {
    name: "Linguist",
    role: "Language patterns, rhythm, cadence, and word choice specialist",
    dimensions: [
      "Sentence Rhythm & Cadence",
      "Word Choice Precision",
      "Punctuation Naturalness (em dashes, semicolons)",
      "Contractions & Conversational Register",
      "Opening Variety",
      "Register Consistency",
      "Overall Human-ness",
    ],
    prompt: `You are a Linguist reviewing restaurant recommendation blurbs for a food app called Donde.

SCORING RUBRIC (score each 1-10):
1. Sentence Rhythm: Do sentences alternate short/long? Any sub-6-word punchy sentences?
2. Word Choice: Are words specific? Flag vague intensifiers (genuine, actual, real).
3. Punctuation: Count em dashes. Flag semicolons. Are these natural for casual speech?
4. Contractions: Does it sound conversational? Any stiff "it is" or "do not"?
5. Opening Variety: Do blurbs start differently? Flag repeated patterns.
6. Register Consistency: Does voice stay consistent within each blurb?
7. Overall Human-ness: Would this sound like a person talking if read aloud?

For each blurb, provide:
- Scores per dimension
- Specific phrases that work/don't work (quote them)
- Concrete rewrites where needed

End with your TOP 3 most impactful improvements.`,
  },
  {
    name: "Psychologist",
    role: "Human psychology, emotional resonance, and behavioral triggers",
    dimensions: [
      "Emotional Resonance",
      "Trust Building",
      "Decision Confidence",
      "Personal Connection",
      "Social Proof Integration",
      "Call-to-Action Psychology",
      "Anticipation Building",
    ],
    prompt: `You are a Human Psychology & Behavioral Expert reviewing restaurant blurbs for Donde.

SCORING RUBRIC (score each 1-10):
1. Emotional Resonance: Which emotions are triggered? What's missing?
2. Trust Building: Does specificity build trust? Where is it vague?
3. Decision Confidence: Does this reduce choice anxiety?
4. Personal Connection: Does this feel directed at ME or at everyone?
5. Social Proof: Are crowd references organic or forced?
6. Call-to-Action: Does the insider tip create clear next action?
7. Anticipation: Can the reader imagine themselves at the restaurant?

For each blurb, provide:
- Scores per dimension
- Psychological principles at work (or missing)
- Specific phrases that work/fall flat

End with your TOP 3 most impactful improvements.`,
  },
  {
    name: "Food Critic",
    role: "Credible food writing, culinary knowledge, and authentic reviewing",
    dimensions: [
      "Credibility",
      "Cuisine Knowledge Authenticity",
      "Dish Description Quality",
      "Honest Assessment",
      "Comparative Context",
      "Insider Knowledge Signals",
      "Sensory Specificity",
    ],
    prompt: `You are a Food Critic (think Pete Wells, Bill Addison) reviewing restaurant blurbs for Donde.

SCORING RUBRIC (score each 1-10):
1. Credibility: Does the writer sound like they've eaten here?
2. Cuisine Knowledge: Are cultural terms used correctly? Is it surface-level?
3. Dish Descriptions: Can you taste the food? Flavor, texture, temperature?
4. Honest Assessment: Any trade-offs acknowledged? Or uniformly positive?
5. Comparative Context: Is the restaurant positioned within its genre?
6. Insider Knowledge: Do tips sound like real insider knowledge?
7. Sensory Specificity: Can you smell/taste/feel the experience?

For each blurb, provide:
- Scores per dimension
- Where cuisine vocabulary is accurate vs generic
- Where sensory details are present vs absent

End with your TOP 3 most impactful improvements.`,
  },
  {
    name: "Foodie",
    role: "Avid food enthusiast, restaurant obsessive, friend who texts recs",
    dimensions: [
      "Excitement Factor",
      "Relatability",
      "Discovery Delight",
      "Sensory Engagement",
      "Shareability",
      "Authenticity Radar",
      "The Friend Test",
    ],
    prompt: `You are an Avid Food Enthusiast who texts restaurant recs to friends constantly. Review these Donde blurbs.

SCORING RUBRIC (score each 1-10):
1. Excitement: Does this make you WANT to go?
2. Relatability: Would you text this exact phrasing to a friend?
3. Discovery Delight: Do you feel like you discovered something special?
4. Sensory Engagement: Can you imagine the first bite?
5. Shareability: Would you screenshot this recommendation?
6. Authenticity Radar: Does this pass your BS detector?
7. Friend Test: If a friend sent this, would you believe them?

For each blurb, provide:
- Scores per dimension
- How YOU would naturally describe this restaurant
- What feels real vs manufactured

End with your TOP 3 most impactful improvements.`,
  },
  {
    name: "Marketing Executive",
    role: "Conversion copywriting, brand voice, and persuasion psychology",
    dimensions: [
      "Conversion Power",
      "Value Proposition Clarity",
      "Brand Voice Consistency",
      "Call-to-Action Subtlety",
      "Differentiation",
      "Persuasion Without Selling",
      "Retention Hook",
    ],
    prompt: `You are a Marketing/Sales Executive reviewing restaurant blurbs for Donde's conversion funnel.

SCORING RUBRIC (score each 1-10):
1. Conversion Power: Does this move someone from "browsing" to "booking"?
2. Value Proposition: Is it clear WHY this spot for THIS occasion?
3. Brand Voice: Does Donde come through as a distinct personality?
4. Call-to-Action: Does the tip create urgency without being pushy?
5. Differentiation: What separates this from Yelp/Google/ChatGPT?
6. Persuasion: Is it persuasive without feeling like advertising?
7. Retention: Does this make the user want to come back to Donde?

For each blurb, provide:
- Scores per dimension
- Where the conviction moment happens (or doesn't)
- What would increase conversion

End with your TOP 3 most impactful improvements.`,
  },
  {
    name: "Prompt Engineer",
    role: "AI prompt optimization, anti-slop techniques, output quality",
    dimensions: [
      "Anti-Slop Effectiveness",
      "Example Quality",
      "Output Consistency",
      "Grounding Enforcement",
      "Voice Consistency Control",
    ],
    prompt: `You are an AI Prompt Engineering Expert reviewing the output quality of Donde's blurb system (Claude Haiku 4.5).

SCORING RUBRIC (score each 1-10):
1. Anti-Slop: Count em dashes, semicolons, banned phrases. What leaks through?
2. Example Quality: Do examples model good patterns without bad habits?
3. Output Consistency: Is word count reliably 50-80? JSON format consistent?
4. Grounding: Are all facts verifiable from provided context? Any hallucination risk?
5. Voice Consistency: Does voice stay consistent across occasions/cuisines?

For each blurb, provide:
- Scores per dimension
- Exact slop patterns found (em dashes, banned words, structural tells)
- Grounding violations if any

End with your TOP 3 most impactful prompt improvements.`,
  },
];

// ─── Team Lead Synthesis Prompt ──────────────────────────────────────────────

const TEAM_LEAD_PROMPT = `You are the Team Lead synthesizing feedback from 6 specialist experts who reviewed Donde's restaurant recommendation blurbs.

Your job:
1. Group findings by theme (voice, credibility, emotion, anti-slop, conversion)
2. Identify consensus items (3+ experts agree)
3. Resolve any conflicts between experts
4. Produce a PRIORITIZED list of the top 10 improvements
5. For each improvement, provide specific language to add/change in the system prompt

Format your output as:
## Consensus Findings
[themes where 3+ experts agree]

## Top 10 Improvements (Prioritized)
For each: what to change, why, and exact prompt language

## Expert Score Summary
[table of average scores by dimension across all experts]`;

// ─── Live Mode Fetching ──────────────────────────────────────────────────────

interface LiveScenario {
  special_request: string;
  occasion: string;
  neighborhood: string;
  price_level: string;
}

const LIVE_SCENARIOS: LiveScenario[] = [
  {
    special_request: "romantic Italian dinner",
    occasion: "Date Night",
    neighborhood: "West Loop",
    price_level: "$$$",
  },
  {
    special_request: "tacos al pastor",
    occasion: "Adventure",
    neighborhood: "Pilsen",
    price_level: "$",
  },
  {
    special_request: "Korean BBQ with friends",
    occasion: "Group Hangout",
    neighborhood: "Wicker Park",
    price_level: "$$",
  },
  {
    special_request: "omakase dinner",
    occasion: "Solo Dining",
    neighborhood: "Anywhere",
    price_level: "$$$$",
  },
  {
    special_request: "family dinner with kids",
    occasion: "Family Dinner",
    neighborhood: "Lincoln Park",
    price_level: "$$",
  },
  {
    special_request: "business lunch downtown",
    occasion: "Business Lunch",
    neighborhood: "West Loop",
    price_level: "$$$",
  },
  {
    special_request: "anniversary dinner",
    occasion: "Special Occasion",
    neighborhood: "River North",
    price_level: "$$$$",
  },
  {
    special_request: "craft beer and pizza",
    occasion: "Chill Hangout",
    neighborhood: "Wicker Park",
    price_level: "$$",
  },
  // Cuisine mismatch scenarios (negative testing)
  {
    special_request: "Jamaican jerk chicken and rum cocktails",
    occasion: "Adventure",
    neighborhood: "Anywhere",
    price_level: "$",
  },
  {
    special_request: "Scandinavian smorgasbord with pickled herring",
    occasion: "Date Night",
    neighborhood: "Anywhere",
    price_level: "$$",
  },
];

async function fetchLiveBlurbs(): Promise<BlurbSample[]> {
  const results: BlurbSample[] = [];
  for (const scenario of LIVE_SCENARIOS) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenario),
      });
      const data = await res.json();
      if (data.success) {
        results.push({
          scenario: `${scenario.occasion} + ${scenario.special_request} + ${scenario.neighborhood} + ${scenario.price_level}`,
          occasion: scenario.occasion,
          cuisine: data.restaurant?.cuisine_type || "Unknown",
          neighborhood: data.restaurant?.neighborhood_name || scenario.neighborhood,
          price: scenario.price_level,
          restaurant_name: data.restaurant?.name || "Unknown",
          recommendation: data.recommendation || "",
          insider_tip: data.insider_tip || "",
        });
      }
    } catch (err) {
      console.error(`Failed to fetch: ${scenario.occasion}`, err);
    }
    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 2000));
  }
  return results;
}

// ─── Report Generation ───────────────────────────────────────────────────────

function formatBlurbsForExpert(blurbs: BlurbSample[]): string {
  return blurbs
    .map(
      (b, i) =>
        `--- Blurb ${i + 1}: ${b.scenario} ---
Restaurant: ${b.restaurant_name}
Recommendation: "${b.recommendation}"
Insider Tip: "${b.insider_tip}"
`
    )
    .join("\n");
}

function buildExpertReviewPrompt(expert: ExpertDefinition, blurbs: BlurbSample[]): string {
  return `${expert.prompt}

Here are the blurbs to review:

${formatBlurbsForExpert(blurbs)}

Please review ALL blurbs and provide your analysis. Score each dimension 1-10.
End with your TOP 3 most impactful improvements with specific, actionable language.`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const isLive = process.argv.includes("--live");
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  DONDE MULTI-EXPERT BLURB QUALITY REVIEW`);
  console.log(`  Mode: ${isLive ? "LIVE (fetching from API)" : "SAMPLE (hardcoded blurbs)"}`);
  console.log(`  Experts: ${EXPERTS.length}`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`${"=".repeat(70)}\n`);

  const blurbs = isLive ? await fetchLiveBlurbs() : SAMPLE_BLURBS;
  console.log(`Loaded ${blurbs.length} blurbs for review.\n`);

  // Print blurbs for reference
  console.log("--- BLURBS UNDER REVIEW ---\n");
  blurbs.forEach((b, i) => {
    console.log(`[${i + 1}] ${b.scenario}`);
    console.log(`    Restaurant: ${b.restaurant_name}`);
    console.log(`    Rec: ${b.recommendation.slice(0, 100)}...`);
    console.log(`    Tip: ${b.insider_tip}`);
    console.log();
  });

  // Print expert prompts (for Claude Code Task tool execution)
  console.log("\n--- EXPERT REVIEW PROMPTS ---\n");
  console.log("To run expert reviews in Claude Code, use these as Task tool prompts:\n");

  EXPERTS.forEach((expert) => {
    console.log(`${"=".repeat(60)}`);
    console.log(`EXPERT: ${expert.name} (${expert.role})`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Dimensions: ${expert.dimensions.join(", ")}`);
    console.log(`\nFull prompt:\n`);
    console.log(buildExpertReviewPrompt(expert, blurbs));
    console.log("\n");
  });

  // Print Team Lead prompt
  console.log(`${"=".repeat(60)}`);
  console.log(`TEAM LEAD SYNTHESIS`);
  console.log(`${"=".repeat(60)}`);
  console.log(TEAM_LEAD_PROMPT);
  console.log("\n");

  // Quick automated quality checks
  console.log("--- AUTOMATED QUALITY CHECKS ---\n");
  let passCount = 0;
  let failCount = 0;

  blurbs.forEach((b, i) => {
    const label = `Blurb ${i + 1} (${b.scenario})`;

    // Em dash check
    const emDashes = (b.recommendation.match(/\u2014/g) || []).length;
    if (emDashes === 0) {
      console.log(`  PASS [${label}] No em dashes`);
      passCount++;
    } else {
      console.log(`  FAIL [${label}] ${emDashes} em dash(es) found`);
      failCount++;
    }

    // Word count check
    const wordCount = b.recommendation.split(/\s+/).length;
    if (wordCount >= 40 && wordCount <= 100) {
      console.log(`  PASS [${label}] Word count: ${wordCount}`);
      passCount++;
    } else {
      console.log(`  FAIL [${label}] Word count: ${wordCount} (target: 40-100)`);
      failCount++;
    }

    // Slop check
    const slopPatterns = [
      "culinary",
      "gastronomic",
      "unforgettable",
      "nestled",
      "tantalizing",
      "mouthwatering",
      "delectable",
      "exquisite",
      "dining experience",
      "taste buds",
      "burst of flavor",
      "unapologetically",
    ];
    const recLower = b.recommendation.toLowerCase();
    const slopHits = slopPatterns.filter((p) => recLower.includes(p));
    if (slopHits.length === 0) {
      console.log(`  PASS [${label}] No slop patterns`);
      passCount++;
    } else {
      console.log(`  FAIL [${label}] Slop found: ${slopHits.join(", ")}`);
      failCount++;
    }

    // Tip word count
    const tipWords = b.insider_tip.split(/\s+/).length;
    if (tipWords <= 25 && tipWords >= 3) {
      console.log(`  PASS [${label}] Tip length: ${tipWords} words`);
      passCount++;
    } else {
      console.log(`  FAIL [${label}] Tip length: ${tipWords} words (target: 3-25)`);
      failCount++;
    }
  });

  console.log(`\n--- AUTOMATED CHECK SUMMARY ---`);
  console.log(`  PASSED: ${passCount}`);
  console.log(`  FAILED: ${failCount}`);
  console.log(`  TOTAL:  ${passCount + failCount}`);
  console.log();
}

main().catch(console.error);
