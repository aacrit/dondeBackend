# CEO Quick Reference — Operating DondeAI Through the COO

Last updated: 2026-03-15

> Your agent team is your engineering org. The COO is your VP of Engineering. This guide shows you how to operate it.

---

## One-Command Operations

Say any of these to start a COO-led operation:

### Daily Operations

| Command | What Happens | Duration | Cost |
|---------|-------------|----------|------|
| `"Initiate COO quality cycle"` | Golden dataset test → fix failures → retest → update docs → CEO briefing | 15-20 min | $0 |
| `"COO: status report"` | Full system health dashboard with RAG color coding | 5-10 min | $0 |
| `"COO: what needs my attention?"` | Only escalated items requiring CEO decision | 3-5 min | $0 |

### Project Commands

| Command | Project | What Happens | Duration |
|---------|---------|-------------|----------|
| `"COO: run Project Alpha"` | Quality Automation | Full closed-loop quality cycle with team orchestration | 15-20 min |
| `"COO: run Project Bravo"` | Sync Guardian | Fix all grading drift between backend and frontend | 10 min |
| `"COO: run Project Charlie"` | Cache Intelligence | Analyze and optimize DondeCache performance | 20 min |
| `"COO: run Project Delta"` | Competitive Intel | Board-ready competitive analysis from 3 advisors | 25 min |
| `"COO: run Project Echo"` | Launch Readiness | Full security + performance + UX + data audit | 30 min |

### Specific Agent Commands

| Command | What Happens |
|---------|-------------|
| `"Run security audit"` | COO spawns donde-ciso for 10-domain audit |
| `"Benchmark the scoring engine"` | COO spawns analytics-expert for competitive analysis |
| `"Update all documentation"` | COO spawns update-docs to sync all MD files |
| `"Generate test queries"` | COO spawns gen-test-queries for 10 new persona queries |
| `"Audit restaurant data quality"` | COO spawns db-reviewer for data completeness check |
| `"Profile response latency"` | COO spawns perf-optimizer for latency waterfall |
| `"Run UAT browser tests"` | COO spawns uat-tester for Playwright testing |

---

## Reading COO Reports

### RAG Color Guide

| Color | Meaning | Your Action |
|-------|---------|-------------|
| **GREEN** | On target. No action needed. | None — COO has it handled |
| **AMBER** | Within 10% of target. Watch trend. | Ask COO for improvement plan if persists 2+ sessions |
| **RED** | Below target. Action required. | Review COO's recommended action. Approve or redirect. |

### Report Sections

| Section | What It Tells You | How to Use It |
|---------|-------------------|---------------|
| **THE BOTTOM LINE** | One sentence — honest system state | Read this first. If it's good, skim the rest. |
| **SYSTEM HEALTH** | RAG dashboard across all dimensions | Scan for RED items. Those need your attention. |
| **TOP 3 ISSUES** | Ranked by impact x urgency | Decide: approve COO's plan, redirect, or defer. |
| **TOP 3 WINS** | What improved since last session | Celebrate momentum. Share with stakeholders. |
| **APPROVAL NEEDED** | Decisions only you can make | These are blocking. Decide now. |
| **NEXT ACTIONS** | What happens next, with owners | Verify priorities align with your strategy. |

### Approval Needed — Decision Framework

When the COO asks for approval:

| Decision Type | Default | Override When |
|--------------|---------|---------------|
| $0 agent operations | Auto-approve | Never — always safe |
| Claude API calls (>$0) | CEO decides | Approve with budget cap |
| Scoring engine changes | Review diff | Trust if bug-fixer + retest cycle passed |
| Cross-repo changes | Review scope | Trust if COO ran Project Bravo process |
| New agent creation | Review spec | Approve if gap documented in 2+ sessions |
| Launch readiness GO | CEO decides | Only after Project Echo passes all thresholds |

---

## When to Intervene vs. Delegate

### Let the COO Handle (Delegate)

- Quality cycle results (test → fix → retest)
- Documentation drift (COO auto-spawns update-docs)
- Minor scoring adjustments (bug-fixer within guardrails)
- Routine security scans (no CRITICAL findings)
- Cache optimization analysis

### Step In (Intervene)

- CRITICAL security finding (COO will escalate immediately)
- Scoring regression > 5 points avg DM
- Strategic direction changes (what to build next)
- Budget approvals > $0
- Launch/no-launch decisions
- New agent creation decisions
- Public-facing changes (marketing, messaging)

### Escalation Signals

If you see these in a COO report, pay close attention:

| Signal | Meaning |
|--------|---------|
| "APPROVAL NEEDED" section has items | Blocking decisions — respond now |
| Any RED in system health | Below target — review COO's plan |
| "CRITICAL" in any finding | Security or quality emergency |
| Pass rate dropped between sessions | Possible regression — ask for details |
| "COO recommends CEO review" | Something outside COO's authority |

---

## Team Health at a Glance

### Division Scorecard

Ask `"COO: division scorecard"` to get:

```
DIVISION HEALTH — 2026-03-15
==============================
QUALITY:        94% pass rate (target: 95%) [AMBER]
INFRASTRUCTURE: 0 day doc drift (target: <1) [GREEN]
PRODUCT:        98% features complete       [GREEN]
SECURITY:       85/100 posture (target: 85) [GREEN]
```

### Trend Indicators

| Trend | Meaning | Action |
|-------|---------|--------|
| 3+ sessions GREEN | System is healthy and improving | Shift focus to Product innovation |
| Mix of GREEN/AMBER | Normal operations, some gaps | Let COO prioritize fixes |
| Any RED | Active problem | Review COO's remediation plan |
| RED for 2+ sessions | Systemic issue | Intervene — COO may need strategic redirect |

---

## Your Agent Roster

### Who Does What

| Agent | One-Line Description | When You'd Use Them |
|-------|---------------------|-------------------|
| **COO** | Your VP Engineering — orchestrates everything | Always. Your primary interface. |
| **analytics-expert** | Scores the scoring engine against Google/Netflix/TikTok | "How good is our engine really?" |
| **bug-fixer** | Surgical scorer fixer — root causes, groups, fixes | After test failures (COO auto-spawns) |
| **gen-test-queries** | Generates diverse test queries from Chicago personas | "We need more test coverage" |
| **perf-optimizer** | Sub-8s response time guardian | "Responses feel slow" |
| **db-reviewer** | Audits 2,719 restaurant profiles for accuracy | "Is our data fresh and complete?" |
| **update-docs** | Keeps all documentation current | Auto after changes (COO handles) |
| **ceo-advisor** | Board-level product strategist | "What should we build next?" |
| **donde-premium-advisor** | $50B app quality assessor | "Are we premium enough?" |
| **donde-ciso** | Security auditor across 10 domains | "Are we secure for launch?" |
| **uat-tester** | Browser testing via Playwright | "Test the actual UI" |

### You Should Never Need To

- Spawn agents directly (COO does this)
- Read test output files (COO summarizes)
- Debug scoring engine code (bug-fixer handles)
- Check CI/CD status (COO monitors)
- Sync documentation (update-docs auto-runs)
- Worry about $0 operations (all safe, all reversible)

---

## Common Scenarios

### "I want to see where we stand"
```
"COO: status report"
```
COO runs Phase 0+1, delivers system health dashboard.

### "I want to improve scoring quality"
```
"COO: run Project Alpha"
```
COO creates quality team, runs tests, fixes failures, retests, reports.

### "We have an investor demo next week"
```
"COO: run Project Echo"
```
COO runs full launch readiness audit across all 4 divisions. Delivers GO/NO-GO.

### "I want to know what to build next"
```
"COO: run Project Delta"
```
COO spawns 3 advisors in parallel, produces competitive intelligence report.

### "The dashboard grades look wrong"
```
"COO: run Project Bravo"
```
COO syncs grading code between backend and frontend.

### "I want to optimize cache performance"
```
"COO: run Project Charlie"
```
COO spawns analyst + profiler + auditor to optimize DondeCache.

### "Something feels broken"
```
"COO: what needs my attention?"
```
COO checks for regressions, CI failures, security issues. Reports only what's escalation-worthy.

---

## Cost Summary

| Operation | Cost | Notes |
|-----------|------|-------|
| All agent operations | $0.00 | All use `skip_claude: true` or read-only analysis |
| analytics-expert Phase 5 (quick-wins) | $0.20 max | Only if you approve the benchmark run |
| Any Claude API pipeline | Varies | Always requires explicit CEO approval with estimate |

**Your default posture:** Approve all $0 operations freely. Review any operation that costs money.

---

## Agent Communication Architecture

```
     You (CEO)
       |
       | natural language commands
       |
     COO (team lead)
       |
       +-- SendMessage (direct) -----> Individual agents
       |
       +-- SendMessage (broadcast) --> All agents (emergencies only)
       |
       +-- TaskCreate/TaskUpdate -----> Shared task list
       |
       +-- Agent (spawn) ------------> New teammates into team
       |
       +-- shutdown_request ----------> Graceful team teardown
```

**Key insight:** You talk to the COO in natural language. The COO translates your intent into structured agent operations, task lists, and real-time coordination via SendMessage. You never need to learn the tooling — just tell the COO what you want.
