# DondeAI Claude Code Mastery Reference

## Optimal CLAUDE.md Template for DondeAI

```markdown
# DondeAI — Premium Restaurant Discovery (Chicago)

## Stack
- Frontend: HTML/CSS/JS (mobile-first PWA), 15 cultural themes
- Backend: Supabase (PostgreSQL, Auth, Edge Functions, Realtime)
- AI Pipeline: Gemini Flash (filtering) → Claude Sonnet (recommendations)
- Scoring: Dynamic-weight geometric mean, 5 factors
- Hosting: GitHub Pages (frontend), Supabase (backend)

## Quick Commands
- Open staging: https://[username].github.io/donde-staging/
- Run tests: node test-lite.js (55 scenarios)
- Full test: node test-full.js (170 scenarios)
- Deploy: git push origin main (auto-deploys via Pages)

## Architecture
/frontend
  /css          — Theme stylesheets, design tokens
  /js           — App logic, scoring engine, animations
  /assets       — Icons, audio chimes, particle configs
  index.html    — Main app entry (mobile-first)
/supabase
  /migrations   — Schema changes (never edit directly)
  /functions    — Edge Functions (recommendation API)
  /seed         — Restaurant data, test fixtures
/tests
  test-lite.js  — 55 core scoring scenarios
  test-full.js  — 170 comprehensive scenarios

## Workflow Rules
- Mobile-first: every component handles safe areas + notch
- Design tokens: never hardcode colors, spacing, or fonts
- Animations: spring physics only, no CSS ease-in-out
- Commits: conventional format (feat:, fix:, perf:, style:)
- Testing: run test-lite after scoring changes
- Themes: all 15 themes must share the same token structure
- Performance: sub-3s load, 60fps animations, max 200 particles

## Reference Docs
Read these on demand (don't load into every context):
- references/animation-patterns.md — Spring configs, entrance/exit patterns
- references/behavioral-psychology.md — Retention hooks, onboarding, gamification
- references/scoring-algorithm.md — Weight system, test scenarios, tuning guide
- references/cultural-themes.md — All 15 theme specifications
- references/supabase-patterns.md — RLS policies, Edge Functions, migrations
```

## Agent Team Setup

### .claude/agents/ directory structure

```
.claude/
├── agents/
│   ├── frontend-polisher.md
│   ├── scoring-engine.md
│   ├── db-architect.md
│   ├── theme-builder.md
│   └── e2e-tester.md
├── skills/
│   └── donde-premium-advisor/
│       ├── SKILL.md
│       └── references/
└── CLAUDE.md
```

### Agent Definitions

**frontend-polisher.md:**
```markdown
---
name: frontend-polisher
description: "Premium UI specialist for DondeAI. Use for any component creation, 
animation work, theme CSS, design token updates, or visual polish tasks."
tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
---
You are a frontend specialist for a premium mobile-first restaurant app.

ALWAYS:
- Use spring physics (stiffness: 300, damping: 25 as default)
- Reference design-tokens.css for all colors, spacing, fonts
- Ensure 44x44pt minimum touch targets
- Test on mobile viewport (375px width)
- Use GPU-composited properties only (transform, opacity)

NEVER:
- Use CSS ease-in-out for animations
- Hardcode hex colors
- Use px for spacing (use token variables)
- Create entrance animations > 24px translateY
- Forget exit animations
```

**scoring-engine.md:**
```markdown
---
name: scoring-engine
description: "Recommendation algorithm specialist. Use for scoring formula changes, 
weight tuning, test scenario creation, and API response optimization."
tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
---
The DondeAI scoring engine uses a dynamic-weight geometric mean across 5 factors:
1. Food Quality (base weight varies by intent)
2. Vibe (higher for date nights, celebrations)
3. Service (higher for business, family)
4. Reputation (normalized across sources)
5. Convenience (distance, wait time, hours)

ALWAYS run test-lite.js (55 scenarios) after any change.
ALWAYS run test-full.js (170 scenarios) before merging.
NEVER modify weights without documenting the rationale.
```

**db-architect.md:**
```markdown
---
name: db-architect
description: "Supabase database specialist. Use for migrations, RLS policies, 
index optimization, Edge Function development, and data pipeline work."
tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
---
ALWAYS:
- Create migrations for schema changes (never ALTER directly)
- Index columns used in RLS policies
- Use efficient RLS: column IN (SELECT ...) pattern
- Wrap security definer functions in SELECT
- Add created_at/updated_at with DEFAULT now()
- Specify TO authenticated/anon on every policy

NEVER:
- Use auth.uid() IN (SELECT user_id FROM ...) pattern (slow)
- Create policies without corresponding indexes
- Deploy Edge Functions without error handling
- Expose API keys in client-accessible code
```

## Context Management Playbook

### The 50/Clear/Document Pattern

```
Session Start
│
├─ Work on task (monitor with /context)
│
├─ At ~50% capacity → /compact "preserve: [current task], [files modified], [next steps]"
│
├─ Continue working
│
├─ At ~70% or switching tasks:
│   1. Ask Claude: "Write task-progress.md with current state and next steps"
│   2. /clear
│   3. Start fresh: "Read task-progress.md and continue from where we left off"
│
└─ Repeat
```

### Subagent Cost Optimization

```bash
# Run subagents on Sonnet (5x cheaper than Opus)
export CLAUDE_CODE_SUBAGENT_MODEL="claude-sonnet-4-5-20250929"

# Keep main session on Opus for complex architectural decisions
# Subagents handle: testing, code review, file exploration, web research
```

### MCP Configuration (.mcp.json)

```json
{
  "mcpServers": {
    "supabase": {
      "url": "https://mcp.supabase.com/mcp?project_ref=${SUPABASE_PROJECT_REF}&read_only=false"
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "scope": "local"
    }
  }
}
```

**Keep MCPs minimal.** Each MCP server consumes 1-5K tokens of context just being loaded. More than 5 active MCP servers seriously degrades performance.

## Custom Skills for DondeAI

### donde-theme-builder (create this skill)

```markdown
---
name: donde-theme-builder  
description: "Build new cultural themes for DondeAI with consistent token structure.
Triggers on: new theme, add cuisine, cultural theme, design theme."
---
# Theme Builder

## Process
1. Read the existing theme template from css/themes/_template.css
2. Research the target culture's visual identity (colors, patterns, typography)
3. Generate: color palette (5 colors), font pairing, particle config, audio chime spec
4. Create the CSS file following the exact token structure
5. Add the theme to the theme registry in js/themes.js
6. Test: verify all token variables are defined, no hardcoded values
```

### donde-component (create this skill)

```markdown
---
name: donde-component
description: "Scaffold new UI components with DondeAI design system compliance.
Triggers on: new component, create component, build component, add UI."
---
# Component Scaffold

## Process  
1. Read design-tokens.css for available tokens
2. Read the closest existing component for patterns
3. Create component with:
   - All spacing from tokens (8px grid)
   - All colors from tokens (no hex)
   - Spring animation for entrance/exit
   - Touch target >= 44x44pt
   - Skeleton loading state
   - Reduced motion fallback
4. Run visual check at 375px viewport width
```

## GitHub Actions for DondeAI

### Auto-Review PRs

```yaml
# .github/workflows/claude-review.yml
name: Claude Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    if: github.actor != 'claude[bot]'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            Review for DondeAI quality standards:
            1. Design tokens used (no hardcoded colors/spacing)?
            2. Animations use spring physics?
            3. Touch targets >= 44x44pt?
            4. Reduced motion respected?
            5. RLS policies indexed?
            6. Error handling present?
            Focus on actionable suggestions. Be specific about file and line.
```

### Auto-Run Scoring Tests

```yaml
# .github/workflows/scoring-tests.yml  
name: Scoring Engine Tests
on:
  push:
    paths:
      - 'js/scoring/**'
      - 'tests/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: node tests/test-lite.js
      - run: node tests/test-full.js
```

## Power User Tips

### 1. The "#" Shortcut
Press `#` during a Claude Code session to add a learning to CLAUDE.md. Use this every time Claude does something right or wrong to build institutional memory.

### 2. Slash Commands You Should Use Daily
- `/compact` — Manual compaction (do at 50% capacity)
- `/context` — See token usage breakdown  
- `/clear` — Full reset between tasks
- `/init` — Generate CLAUDE.md from repo analysis
- `/install-github-app` — Set up GitHub Actions integration

### 3. The "Think Hard" Pattern
For complex architectural decisions, prefix your prompt:
"Think step by step about the tradeoffs before writing any code: [question]"
This triggers deeper reasoning before implementation.

### 4. Image-Based Development
Take a screenshot of a premium app's UI, paste it into Claude Code:
"Implement this design for DondeAI's [component], adapted to our design tokens and cultural theme system."

### 5. Git Worktrees for Parallel Development
```bash
# Work on two features simultaneously with separate Claude Code sessions
git worktree add ../donde-feature-onboarding feature/onboarding
git worktree add ../donde-feature-gamification feature/gamification
# Run a Claude Code session in each directory
```
