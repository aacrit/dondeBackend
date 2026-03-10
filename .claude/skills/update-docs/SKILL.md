---
name: update-docs
description: "Scans the DondeAI backend codebase for changes and updates all markdown documentation files (CLAUDE.md, docs/*.md) to reflect the current state. Run after major changes to keep documentation accurate for future sessions. Triggers on: 'update docs', 'refresh docs', 'sync documentation', 'update markdown', '/update-docs'."
---

# DondeAI Documentation Updater — Backend

You are a documentation maintenance agent for the DondeAI backend repo. Your job is to scan the codebase for the current state and update all markdown files so future Claude Code sessions can load full context without reading source code.

## Why This Skill Exists

Every token spent re-discovering architecture in a new session is wasted. Accurate MD files = instant context = faster sessions = lower cost. This skill keeps documentation as the single source of truth.

## Activation Protocol

### Phase 1: Scan Current State

Gather the ground truth from source code. Do NOT guess — read the actual files.

```
1. Read CLAUDE.md — note the "Last updated" date and all documented facts
2. Read docs/ARCHITECTURE.md — check file tree accuracy, module list, tech stack
3. Read docs/API-WORKFLOWS.md — verify request flow matches index.ts
4. Read docs/DATABASE.md — verify schema matches latest migrations
5. Read docs/FEATURES.md — check feature checklist against actual implementation
6. Read docs/RECOMMENDATION-BLURBS.md — verify blurb architecture matches prompts-v5.ts
7. Scan key source files for changes:
   - supabase/functions/recommend/index.ts (entry point, flow steps, line count)
   - supabase/functions/recommend/_shared/scoring-v9.ts (scoring formula, version)
   - supabase/functions/recommend/_shared/types-v9.ts (type definitions)
   - supabase/functions/recommend/_shared/intent-classifier-v5.ts (classification logic)
   - supabase/functions/recommend/_shared/prompts-v5.ts (prompt templates, literary voices)
   - supabase/functions/recommend/_shared/response-builder-v9.ts (response format)
8. Check for new files not documented:
   - Glob supabase/functions/recommend/_shared/*.ts — compare against ARCHITECTURE.md
   - Glob scripts/pipelines/*.ts — compare against API-WORKFLOWS.md pipeline inventory
   - Glob supabase/migrations/*.sql — count vs docs/DATABASE.md migration count
   - Glob .github/workflows/*.yml — compare against ARCHITECTURE.md CI/CD table
   - Glob tests/*.sh — compare against CLAUDE.md tests table
   - Glob .claude/skills/*/SKILL.md — compare against CLAUDE.md skills section
9. Check git log for recent changes:
   - git log --oneline -20 — identify what changed recently
   - git diff HEAD~10 --stat — understand scope of recent changes
10. Check .env.example for new environment variables
```

### Phase 2: Identify Drift

Compare scanned state against documented state. Flag every discrepancy:

| Category | What to Check |
|----------|---------------|
| **Scoring engine** | Version (V9/V10/V11), formula, relevance types, weight profiles, concept count |
| **API contract** | Request/response fields, new endpoints, error codes |
| **File tree** | New/deleted/renamed TS files in _shared/, new pipelines, new migrations |
| **RPC functions** | New/changed PostgreSQL RPCs (get_candidates_v11, etc.) |
| **Database** | New tables, new columns, migration count, RLS changes |
| **Pipelines** | New/removed pipeline scripts, changed schedules |
| **CI/CD** | New/changed GitHub Actions workflows |
| **Tests** | New test scripts, updated baselines, benchmark results |
| **Blurb generation** | Prompt changes, new literary voices, new guardrails |
| **Skills** | New/removed skills not in CLAUDE.md skills section |
| **Environment** | New env vars, changed prefixes |
| **Dates** | All "Last updated" dates should reflect today |

### Phase 3: Update Documentation

For each discrepancy found, update the relevant MD file:

1. **CLAUDE.md** — Always update:
   - `Last updated` date → today
   - Documentation Index table (add/remove docs)
   - Skills table (add/remove skills)
   - Tests table (add/remove test scripts, update baselines)
   - Scoring Engine section (version, formula, enhancements)
   - API Contract (if request/response changed)
   - Commands section (if new commands available)
   - Environment Variables (if new vars added)

2. **docs/ARCHITECTURE.md** — Update if structure changed:
   - File tree listing
   - Module table with status
   - Deployment triggers
   - CI/CD workflow table

3. **docs/API-WORKFLOWS.md** — Update if request flow changed:
   - Numbered flow steps
   - Scoring model details
   - Pipeline inventory tables
   - Test benchmark table

4. **docs/DATABASE.md** — Update if schema changed:
   - Table listings
   - Column definitions
   - RPC function signatures
   - Migration count

5. **docs/FEATURES.md** — Update if features added/removed:
   - Checklist items with [x] / [ ] status
   - New feature categories

6. **docs/RECOMMENDATION-BLURBS.md** — Update if blurb generation changed:
   - Prompt architecture
   - Literary personas
   - Quality guardrails
   - Fallback chain

7. **docs/CEO-COMMAND-CENTER.md** — Update if dashboard architecture changed

8. **docs/OPTIMIZATION-RECOMMENDATIONS.md** — Update if priorities shifted

### Phase 4: Report

After updating, provide a summary:

```
## Documentation Update Report

**Date:** [today]
**Files Updated:** [list]
**Key Changes:**
- [bullet list of what changed and why]

**Files Unchanged (verified current):**
- [list]

**Action Items (if any):**
- [things that need human decision before documenting]
```

## Rules

1. **Evidence-based only** — Never update docs based on assumptions. Read the actual source file before changing any documented fact.
2. **Version accuracy is critical** — The scoring engine version (V9/V10/V11) must be correct everywhere. File names may say "v9" but logic may be V11. Check the actual code.
3. **Compact format** — Use tables over prose. Use inline code for file paths. No filler text.
4. **Cross-repo awareness** — The frontend repo is at `../dondeAI/`. If API contract changed, the frontend's CLAUDE.md API Contract section needs updating too.
5. **Date stamp everything** — Every MD file updated gets today's date in its "Last updated" line.
6. **Don't bloat** — Remove outdated information rather than accumulating history. Archive-worthy content goes to `_archive/`.
7. **Cost policy reminder** — If documenting pipeline changes, always preserve the Claude API Cost Policy section in CLAUDE.md.

## Companion Skill

The frontend repo (`dondeAI`) has a matching `/update-docs` skill. When major changes span both repos, run both skills.
