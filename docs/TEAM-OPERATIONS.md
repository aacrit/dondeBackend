# DondeAI Operations & Continuous Improvement Team

Last updated: 2026-03-15

> The Operations Team is DondeAI's force multiplier. Eleven specialized agents, orchestrated by the COO through real-time communication, replace the coordination overhead of a 100-person engineering org. Every cycle makes the product smarter.

---

## Team Architecture

```
                            CEO (Aacrit)
                                |
                     "COO: run Project Alpha"
                     "COO: status report"
                     "COO: what needs my attention?"
                                |
                    +-----------+-----------+
                    |     COO (team lead)   |
                    |   donde-coo (225 ln)  |
                    |   TeamCreate owner     |
                    |   SendMessage hub      |
                    +-----------+-----------+
                                |
     +----------+----------+----------+----------+----------+
     |          |          |          |          |          |
  QUALITY   INFRASTRUC-  FRONTEND   PRODUCT    SECURITY
  DIVISION  TURE DIV     DIVISION   DIVISION   DIVISION
     |          |          |          |          |
  analytics  perf-       frontend-  ceo-       donde-
  -expert    optimizer   builder    advisor    ciso
     |          |          |          |
  bug-fixer  db-reviewer frontend-  donde-
     |          |        fixer      premium-
  gen-test-  update-docs   |        advisor
  queries       |        css-theme-
     |       prod-       specialist
  continuous sentinel       |
  -tester                uat-tester
                            |
                         frontenddesign
                         (skill)
```

### Division Missions

| Division | Mission | Health Metric | Target |
|----------|---------|---------------|--------|
| **Quality** | "Nothing ships below B-" | Golden dataset pass rate | 95%+ |
| **Infrastructure** | "The system runs itself" | Doc freshness + P95 latency | <1 day drift, <8s |
| **Frontend** | "Ship-ready UI" | Smoke test + theme coverage | 10/10, 10/10 |
| **Product** | "Every release moves the needle" | Feature completion + premium score | 95%+, 90/100 |
| **Security** | "No surprises in production" | Security posture | 85/100+ |

---

## Agent Capability Matrix

| Agent | Division | Tools | Cost | Trigger | Output |
|-------|----------|-------|------|---------|--------|
| `donde-coo` | **Lead** | All tools | $0.00 | Auto/manual | CEO briefing + orchestration |
| `analytics-expert` | Quality | Read, Grep, Glob, Bash, Edit, Write | $0.20 max | Manual, post-scoring changes | CEO report + quick-wins |
| `bug-fixer` | Quality | Read, Grep, Glob, Bash, Edit, Write | $0.00 | Post-test failures | Root cause fixes + CEO report |
| `gen-test-queries` | Quality | Read, Write, Edit, Bash | $0.00 | Manual | 10 persona-driven queries |
| `continuous-tester` | Quality | Read, Grep, Glob, Bash | $0.00 | Post-deploy, manual | Test results + retest handoff |
| `perf-optimizer` | Infra | Read, Grep, Glob, Bash, Edit, Write | $0.00 | Manual, latency issues | Latency waterfall + optimizations |
| `db-reviewer` | Infra | Read, Grep, Glob, Bash, Edit, Write | $0.00 | Manual, post-enrichment | Data quality audit |
| `update-docs` | Infra | Read, Grep, Glob, Bash, Edit, Write | $0.00 | Auto after significant changes | Updated MD files |
| `prod-sentinel` | Infra | Read, Grep, Glob, Bash | $0.00 | Scheduled, manual | Production health report |
| `frontend-builder` | Frontend | Read, Grep, Glob, Bash, Edit, Write | $0.00 | CEO directives, COO tasks | Built UI components |
| `frontend-fixer` | Frontend | Read, Grep, Glob, Bash, Edit, Write | $0.00 | UAT failures, visual bugs | Root cause fixes + report |
| `css-theme-specialist` | Frontend | Read, Grep, Glob, Bash, Edit, Write | $0.00 | New components, theme bugs | Theme coverage report |
| `uat-tester` | Frontend | All tools | $0.00 | Manual | Playwright test results |
| `ceo-advisor` | Product | Read, Grep, Glob, Bash | $0.00 | Manual | Top 10 recommendations |
| `donde-premium-advisor` | Product | Read, Grep, Glob, Bash | $0.00 | Manual | Premium app audit |
| `donde-ciso` | Security | Read, Grep, Glob, Bash | $0.00 | Manual, security changes | Severity-ranked findings |

---

## Communication Protocol

### Infrastructure

The team operates on Claude Code's native multi-agent infrastructure:

| Tool | Purpose | When |
|------|---------|------|
| `TeamCreate` | Create a named team with shared task list | Start of any project or cycle |
| `Agent` (with `name` + `team_name`) | Spawn a teammate into the team | When COO needs an agent's capability |
| `SendMessage` | Direct or broadcast communication | Agent-to-agent coordination |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Shared work tracking | Task assignment and progress |
| `TeamDelete` | Cleanup after project completion | After all teammates shut down |

### Message Flow Patterns

**1. COO → Agent (Task Assignment)**
```
SendMessage({
  to: "bug-fixer",
  message: "3 root causes identified from golden dataset run:\n1. Vibe floor too low (affects 5 queries)\n2. Missing CUISINE_KEYWORD for 'Taiwanese' (affects 2 queries)\n3. Blurb opener missing for reputation queries (affects 4 queries)\nFix in priority order. Report results.",
  summary: "Assign 3 root cause fixes"
})
```

**2. Agent → COO (Result Report)**
```
SendMessage({
  to: "coo",
  message: "BUG FIXER COMPLETE:\n- 3/3 root causes fixed\n- 11 queries affected\n- Spot-check: 8/11 now PASS\n- Branch: claude/fix-golden-20260315\n- Pushed, awaiting deploy\n- GRADING SYNC: No grading.ts changes",
  summary: "Bug fixes complete, 8/11 pass"
})
```

**3. COO → All (Emergency Broadcast)**
```
SendMessage({
  to: "*",
  message: "CRITICAL: Scoring regression detected. All agents STOP current work. Bug-fixer: stand by for emergency fix assignment.",
  summary: "CRITICAL regression — all stop"
})
```

**4. COO → Agent (Shutdown)**
```
SendMessage({
  to: "analytics",
  message: { type: "shutdown_request", reason: "Quality cycle complete. Results aggregated." }
})
```

**5. COO → Agent (Plan Approval)**
```
SendMessage({
  to: "bug-fixer",
  message: { type: "plan_approval_response", request_id: "abc-123", approve: true }
})
```

**6. COO → Agent (Plan Rejection with Feedback)**
```
SendMessage({
  to: "bug-fixer",
  message: {
    type: "plan_approval_response",
    request_id: "abc-123",
    approve: false,
    feedback: "Do not change the vibe relevance floor — it was raised intentionally in V18. Fix the CUISINE_KEYWORD gap instead."
  }
})
```

### Communication Rules

1. **COO is the hub.** All inter-division communication routes through COO. Agents in the same division may message each other directly.
2. **Broadcast is expensive.** Only for CRITICAL emergencies. Default to direct messages.
3. **Structured over freeform.** Use consistent report formats so COO can aggregate efficiently.
4. **Results, not status.** Agents report what they found/fixed, not what they're doing.
5. **Escalate fast.** CRITICAL findings go to COO immediately, not at end of task.

---

## Task Management Protocol

### Task Lifecycle

```
CREATED → ASSIGNED → IN_PROGRESS → COMPLETED
                  ↘ BLOCKED (waiting on dependency)
```

### COO Task Creation Pattern

```
TaskCreate({
  title: "Run golden dataset retest",
  description: "Execute ./tests/golden-dataset-test.sh with skip_claude=true. Report pass/fail/warn counts, avg DM, and list all failing queries with their DM scores.",
  owner: "continuous-tester"
})
```

### Agent Task Claiming

Agents check `TaskList` after completing each task. They claim unassigned tasks in ID order (lowest first), as earlier tasks often set up context for later ones.

### Task Dependencies

COO creates tasks with implicit ordering:
1. `T1: Run golden dataset` (owner: continuous-tester)
2. `T2: Fix failures from T1` (owner: bug-fixer, blocked until T1 complete)
3. `T3: Retest after T2 fixes` (owner: continuous-tester, blocked until T2 complete)
4. `T4: Update documentation` (owner: update-docs, blocked until T3 complete)

COO unblocks tasks by updating their status when predecessors complete.

---

## Defined Workflows

### Workflow 1: Quality Cycle (Daily)

**Trigger:** COO session start, or CEO command "run quality cycle"
**Duration:** 15-20 minutes
**Cost:** $0.00

```
COO creates team "donde-quality-cycle"
  |
  +-- Spawns continuous-tester → runs golden-dataset-test.sh (skip_claude=true)
  |     |
  |     +-- Reports: 177P/0F/11W, avg DM 77
  |     |
  |     +-- If FAIL count > 0:
  |           |
  |           +-- COO spawns bug-fixer with failure context
  |           |     |
  |           |     +-- Diagnoses root causes, groups, implements fixes
  |           |     +-- Reports: "3 root causes fixed, branch pushed"
  |           |
  |           +-- COO spawns continuous-tester for retest
  |                 +-- Reports: 185P/0F/3W, avg DM 79
  |
  +-- COO spawns update-docs → syncs all documentation
  |
  +-- COO produces CEO briefing
  |
  +-- COO shuts down all teammates → TeamDelete
```

### Workflow 2: Incident Response

**Trigger:** Regression detected (pass rate drops, CI failure, user-reported issue)
**Duration:** 10-15 minutes
**Cost:** $0.00

```
COO detects regression (git log, CI status, or gauntlet_runs query)
  |
  +-- BROADCAST: "CRITICAL — scoring regression detected. All agents stop."
  |
  +-- COO diagnoses scope (which queries regressed, which commit)
  |
  +-- Spawns bug-fixer with:
  |     - Regressed queries
  |     - Suspect commit diff
  |     - Previous passing baseline
  |
  +-- bug-fixer implements targeted revert or fix
  |     +-- Reports via SendMessage
  |
  +-- COO spawns continuous-tester to verify
  |     +-- Reports: regression resolved / still present
  |
  +-- If resolved: COO reports to CEO
  +-- If not: COO escalates to CEO for manual intervention
```

### Workflow 3: Sprint Planning

**Trigger:** CEO directive "plan next sprint" or weekly cadence
**Duration:** 25-30 minutes
**Cost:** $0.00

```
COO creates team "donde-sprint-planning"
  |
  +-- Spawns ceo-advisor → "What should we build next?"
  |     +-- Returns Top 10 prioritized recommendations
  |
  +-- COO cross-references with:
  |     - Current test results (quality gaps)
  |     - Recent user queries (demand signals)
  |     - Security posture (risk gaps)
  |
  +-- COO creates task list for sprint:
  |     T1: [Quality] Fix top 5 scoring gaps
  |     T2: [Infra] Optimize cache hit rate
  |     T3: [Product] Implement ceo-advisor recommendation #1
  |     T4: [Security] Remediate top CISO finding
  |
  +-- COO presents sprint plan to CEO for approval
  +-- CEO approves/modifies → COO assigns tasks
```

### Workflow 4: Security Audit

**Trigger:** CEO command, pre-launch, or after security-relevant changes
**Duration:** 20-25 minutes
**Cost:** $0.00

```
COO creates team "donde-security-audit"
  |
  +-- Spawns in parallel:
  |     donde-ciso → 10-domain security audit
  |     uat-tester → Playwright browser testing
  |
  +-- Both report findings via SendMessage
  |
  +-- COO aggregates:
  |     - Security scorecard (X/100)
  |     - CRITICAL findings (immediate action)
  |     - HIGH findings (fix before launch)
  |     - UAT accessibility/visual issues
  |
  +-- If CRITICAL findings: escalate to CEO immediately
  +-- Otherwise: include in next briefing
```

### Workflow 5: Documentation Sync

**Trigger:** Auto after significant code changes (>3 files or scoring engine changes)
**Duration:** 5-10 minutes
**Cost:** $0.00

```
COO detects documentation drift (git log shows changes since last doc update)
  |
  +-- Spawns update-docs with change context:
  |     "26 commits since last update. Key changes: DondeCache, V17, V18, new agents."
  |
  +-- update-docs reads codebase, updates all MD files
  |     +-- Reports: "7 files updated, all current"
  |
  +-- COO verifies CLAUDE.md accuracy (spot-check 3 claims)
  +-- COO commits and pushes
```

---

## Escalation Matrix

| Severity | Definition | Agent Response | COO Response | CEO Notification |
|----------|-----------|----------------|--------------|-----------------|
| **CRITICAL** | Active regression, data loss risk, security breach | Stop work, report to COO immediately | Broadcast stop, spawn fix, escalate to CEO | **Immediate** — requires CEO decision |
| **HIGH** | Significant quality gap, security vulnerability, performance degradation | Report to COO with diagnosis | Create fix task, assign agent, track | **Next briefing** — included in top issues |
| **MEDIUM** | Minor quality gap, best-practice deviation, non-critical bug | Self-fix if within guardrails, report | Track in task list, schedule fix | **Weekly summary** — batched updates |
| **LOW** | Cosmetic issue, minor optimization opportunity, nice-to-have | Log for COO awareness | Add to backlog | **Monthly review** — trend analysis |

### Escalation Examples

| Scenario | Severity | Why |
|----------|----------|-----|
| Golden dataset pass rate drops from 94% to 80% | CRITICAL | 14-point regression = systemic failure |
| New WARN on 2 queries after scoring change | MEDIUM | Minor, self-fixable by bug-fixer |
| grading.ts changed but cc-grading.js not synced | HIGH | Dashboard accuracy at risk |
| Documentation 3 days out of date | MEDIUM | No user impact, but compounds |
| API key found in git history | CRITICAL | Security breach risk |
| P95 latency increased from 6s to 7.5s | HIGH | Approaching 8s budget |
| Blurb uses banned slop word | LOW | Single instance, cosmetic |

---

## Project Proposals

### Project Alpha: Closed-Loop Quality Automation

**Codename:** `donde-quality-alpha`
**Objective:** Fully automated test-diagnose-fix-retest-report cycle. Zero human intervention from trigger to CEO briefing.

**The Vision:** Today, quality cycles require manual orchestration — run tests, read results, spawn bug-fixer, re-run tests, update docs. Project Alpha automates the entire loop. The COO creates one team, and the agents handle everything through real-time communication.

**Team Composition:**

| Role | Agent | Responsibility |
|------|-------|---------------|
| Team Lead | `coo` | Orchestration, result aggregation, CEO report |
| Tester | `continuous-tester` (new) | Run golden-dataset-test.sh, report results |
| Fixer | `bug-fixer` | Root-cause analysis, surgical fixes |
| Analyst | `analytics-expert` | Competitive gap analysis, improvement ideas |
| Documenter | `update-docs` | Sync all MD files post-fix |

**Execution Flow:**

```
Step 1: COO → TeamCreate("donde-quality-alpha")

Step 2: COO → TaskCreate("Run golden dataset", owner: "tester")
        COO → Agent(name: "tester", subagent_type: "general-purpose",
               prompt: "Run ./tests/golden-dataset-test.sh. Report results.",
               team_name: "donde-quality-alpha")

Step 3: Tester → SendMessage(to: "coo", message: "Results: 177P/0F/11W, avg DM 77")

Step 4: COO evaluates. If failures > 0:
        COO → TaskCreate("Fix 11 WARNs", owner: "fixer")
        COO → Agent(name: "fixer", subagent_type: "bug-fixer",
               prompt: "Fix these failures: [context from tester]",
               team_name: "donde-quality-alpha")

Step 5: Fixer → SendMessage(to: "coo", message: "3 root causes fixed. Branch pushed.")

Step 6: COO → SendMessage(to: "tester", message: "Retest after fixes. Run golden dataset again.")

Step 7: Tester → SendMessage(to: "coo", message: "Retest: 185P/0F/3W, avg DM 79. Improvement!")

Step 8: COO → Agent(name: "documenter", subagent_type: "update-docs",
               prompt: "Sync all docs with latest changes.",
               team_name: "donde-quality-alpha")

Step 9: COO → Agent(name: "analyst", subagent_type: "analytics-expert",
               prompt: "Benchmark current engine state. Identify next improvements.",
               team_name: "donde-quality-alpha")

Step 10: COO aggregates all results → CEO Briefing
         COO → shutdown all teammates → TeamDelete
```

**Success Criteria:**
- Pass rate >= 95% (currently 94%)
- 0 FAILs (currently 0)
- Avg DM >= 80 (currently 77)
- Full cycle completes in single session

**Cost:** $0.00 (all `skip_claude: true`)
**Duration:** ~15-20 minutes

---

### Project Bravo: Cross-Repo Sync Guardian

**Codename:** `donde-sync-bravo`
**Objective:** Eliminate all grading drift between backend (`grading.ts`) and frontend (`cc-grading.js`). Establish a permanent sync verification process.

**The Problem:** The backend grading system has received V17 and V18 updates (stop words, service query handling, factor alignment thresholds) that are NOT present in the frontend `cc-grading.js`. This means the CEO Command Center grades queries differently than CLI tests — undermining CEO confidence in the dashboard.

**Team Composition:**

| Role | Agent | Responsibility |
|------|-------|---------------|
| Team Lead | `coo` | Diff analysis, coordination, CEO report |
| Deployer | `fullstack-deployer` (new) | Cross-repo branch creation, code sync |
| Verifier | `uat-tester` | Browser verification of grading accuracy |

**Execution Flow:**

```
Step 1: COO → TeamCreate("donde-sync-bravo")

Step 2: COO reads both files, produces diff:
        - grading.ts: 433 lines (V18, last updated 2026-03-14)
        - cc-grading.js: 440 lines (V16, last updated 2026-03-13)
        - Delta: 15 stop words missing, 3 relevance type checks missing,
                 2 factor alignment thresholds outdated

Step 3: COO → Agent(name: "deployer", subagent_type: "general-purpose",
               prompt: "Create claude/sync-grading branch in ../dondeAI.
                        Mirror these specific changes from grading.ts to cc-grading.js: [diff]",
               team_name: "donde-sync-bravo")

Step 4: Deployer → SendMessage(to: "coo", message: "Sync complete. Branch pushed.")

Step 5: COO → Agent(name: "verifier", subagent_type: "uat-tester",
               prompt: "Open CEO Command Center. Run 3 test queries.
                        Verify grades match expected values.",
               team_name: "donde-sync-bravo")

Step 6: Verifier → SendMessage(to: "coo", message: "All 3 queries grade correctly.")

Step 7: COO → CEO Briefing: "Grading sync restored. 0 discrepancies."
         COO → shutdown all → TeamDelete
```

**Success Criteria:**
- 0 grading discrepancies between CLI tests and CEO Command Center
- Sync verification process documented for future changes

**Cost:** $0.00
**Duration:** ~10 minutes

---

### Project Charlie: Cache Intelligence Engine

**Codename:** `donde-cache-charlie`
**Objective:** Transform DondeCache from a passive cache into a self-optimizing intelligence layer that learns from user query patterns, pre-warms strategically, and measures impact on latency and quality.

**The Opportunity:** DondeCache shipped on 2026-03-14 with 3-level fuzzy matching (L1 exact, L2 intent fingerprint, L3 canonical form), quality gates, and TTL management. But it's running cold — no analytics on hit rates, no optimized warming schedule, no feedback loop. This project activates the intelligence layer.

**Team Composition:**

| Role | Agent | Responsibility |
|------|-------|---------------|
| Team Lead | `coo` | Synthesis, optimization plan, CEO report |
| Analyst | `analytics-expert` | Query pattern analysis, hit rate metrics, miss patterns |
| Profiler | `perf-optimizer` | Cache lookup latency, L1/L2/L3 distribution, warm-up timing |
| Auditor | `db-reviewer` | Cache data quality, TTL effectiveness, staleness detection |

**Execution Flow:**

```
Step 1: COO → TeamCreate("donde-cache-charlie")

Step 2: COO spawns all 3 agents IN PARALLEL (no dependencies):

        Agent(name: "analyst", subagent_type: "analytics-expert",
              prompt: "Analyze DondeCache performance:
                       1. Query query_cache table for hit rates by level
                       2. Analyze user_queries for cache_hit distribution
                       3. Identify top 20 most frequent queries not in cache
                       4. Recommend warming priorities",
              team_name: "donde-cache-charlie")

        Agent(name: "profiler", subagent_type: "perf-optimizer",
              prompt: "Profile DondeCache latency:
                       1. Read query-cache.ts, measure lookup complexity
                       2. Analyze L1/L2/L3 matching algorithm efficiency
                       3. Identify O(n) scans that could be indexed
                       4. Measure warm-up pipeline timing",
              team_name: "donde-cache-charlie")

        Agent(name: "auditor", subagent_type: "db-reviewer",
              prompt: "Audit DondeCache data quality:
                       1. Check query_cache for stale entries (past TTL)
                       2. Verify quality gate enforcement (no sub-B- entries)
                       3. Analyze cache invalidation trigger coverage
                       4. Check synonym normalization completeness",
              team_name: "donde-cache-charlie")

Step 3: All 3 report findings via SendMessage to COO

Step 4: COO synthesizes into Cache Optimization Plan:
        - Warming schedule (which queries, what frequency)
        - TTL tuning (extend for stable queries, shorten for trending)
        - Synonym expansion (add missing normalizations)
        - Index recommendations (speed up L2/L3 lookups)
        - Quality gate review (threshold adjustment if needed)

Step 5: COO → CEO Briefing with cache performance dashboard

Step 6: Shutdown all → TeamDelete
```

**Success Criteria:**
- Cache hit rate >= 40% for repeat/similar queries
- P95 latency reduction >= 30% for cached queries vs uncached
- 0 stale or sub-quality entries in cache
- Warming schedule covering top 50 queries

**Cost:** $0.00 (analysis only, no API calls)
**Duration:** ~20 minutes

---

### Project Delta: Competitive Intelligence Sprint

**Codename:** `donde-intel-delta`
**Objective:** Produce a board-ready competitive intelligence report that maps DondeAI's position against every major competitor, identifies specific scoring engine improvements, and articulates the competitive moat.

**The Strategic Need:** DondeAI competes against Yelp (200+ engineers), Google Maps (1000+ engineers), The Infatuation (30+ editors), and Resy/OpenTable (100+ engineers). The agent team is the equalizer — but only if we know exactly where the gaps are and what to build next.

**Team Composition:**

| Role | Agent | Responsibility |
|------|-------|---------------|
| Team Lead | `coo` | Cross-reference, synthesis, unified report |
| Strategist | `ceo-advisor` | Strategic positioning, board-level recommendations |
| Engineer | `analytics-expert` | Scoring engine benchmark, technical gap analysis |
| Designer | `donde-premium-advisor` | Premium app assessment, UX/UI competitive analysis |

**Execution Flow:**

```
Step 1: COO → TeamCreate("donde-intel-delta")

Step 2: COO spawns all 3 advisors IN PARALLEL:

        Agent(name: "strategist", subagent_type: "ceo-advisor",
              prompt: "Deliver your Top 10 strategic recommendations.
                       Focus on competitive positioning vs Yelp, Google Maps,
                       The Infatuation, Resy, and Instagram Food.
                       For each recommendation: what competitor does this counter?",
              team_name: "donde-intel-delta")

        Agent(name: "engineer", subagent_type: "analytics-expert",
              prompt: "Benchmark DondeEngine V11 against world-class systems.
                       Score across 10 dimensions. Identify the 3 biggest gaps
                       between DondeAI and Google Search / Netflix / TikTok ranking.
                       For each gap: specific code change needed.",
              team_name: "donde-intel-delta")

        Agent(name: "designer", subagent_type: "donde-premium-advisor",
              prompt: "Audit DondeAI for $50B caliber premium app quality.
                       Compare against Arc, Apple Maps, Spotify.
                       Focus on: first impression, interaction polish, trust signals.
                       Score current state and identify top 5 upgrades.",
              team_name: "donde-intel-delta")

Step 3: All 3 report findings via SendMessage to COO

Step 4: COO cross-references all three perspectives:
        - Where do all 3 agree? (highest conviction improvements)
        - Where do they disagree? (trade-off decisions for CEO)
        - What's unique to each perspective? (blind spot discoveries)

Step 5: COO produces Unified Competitive Intelligence Report:
        - Competitive Position Map (DondeAI vs 5 competitors x 10 dimensions)
        - Convergent Recommendations (all 3 advisors agree)
        - Divergent Recommendations (CEO decision needed)
        - "The One Thing" (highest-impact single improvement)
        - 90-day competitive roadmap

Step 6: CEO Briefing → Shutdown → TeamDelete
```

**Success Criteria:**
- 10 prioritized improvements with effort/impact scores
- Clear competitive moat articulation (what can't competitors copy?)
- Specific code changes identified for top 3 improvements
- Board-ready document suitable for investor conversations

**Cost:** $0.00 (all analysis, no API calls)
**Duration:** ~25 minutes

---

### Project Echo: Launch Readiness Assessment

**Codename:** `donde-launch-echo`
**Objective:** Comprehensive pre-launch audit across all four divisions simultaneously. Produces a GO / CONDITIONAL GO / NO-GO decision with specific remediation for any blockers.

**The Stakes:** Before any public launch, marketing push, or investor demo, DondeAI needs a clean bill of health across security, performance, data quality, and user experience. Project Echo runs all four audits in parallel and synthesizes a launch readiness scorecard.

**Team Composition:**

| Role | Agent | Responsibility |
|------|-------|---------------|
| Team Lead | `coo` | Orchestration, scorecard synthesis, GO/NO-GO decision |
| Security | `donde-ciso` | 10-domain security audit |
| Performance | `perf-optimizer` | Latency waterfall, timeout audit |
| UX | `uat-tester` | Playwright browser testing, accessibility |
| Data | `db-reviewer` | Restaurant data quality, completeness, freshness |

**Execution Flow:**

```
Step 1: COO → TeamCreate("donde-launch-echo")

Step 2: COO spawns ALL 4 agents IN PARALLEL (maximum parallelism):

        Agent(name: "security", subagent_type: "donde-ciso",
              prompt: "Full 10-domain security audit. Report all findings
                       by severity. Produce security scorecard.",
              team_name: "donde-launch-echo")

        Agent(name: "performance", subagent_type: "perf-optimizer",
              prompt: "Profile complete latency waterfall. Audit all timeouts.
                       Report P50/P95/P99. Identify any >8s paths.",
              team_name: "donde-launch-echo")

        Agent(name: "ux", subagent_type: "uat-tester",
              prompt: "Run full UAT suite via Playwright. Test all user journeys.
                       Check accessibility (WCAG 2.1 AA). Report all findings.",
              team_name: "donde-launch-echo")

        Agent(name: "data", subagent_type: "db-reviewer",
              prompt: "Audit all 2,719 restaurants. Check data completeness,
                       freshness, cross-field consistency. Report quality score.",
              team_name: "donde-launch-echo")

Step 3: All 4 report findings via SendMessage to COO

Step 4: COO produces Launch Readiness Scorecard:

        LAUNCH READINESS SCORECARD — 2026-03-15
        =========================================
        SECURITY:     [score]/100  ([N] critical, [N] high, [N] medium)
        PERFORMANCE:  P95 [N]ms    (budget: 8000ms) [WITHIN/EXCEEDING]
        UX:           [N] critical bugs, [N] accessibility issues
        DATA:         [score]/100  ([N] stale, [N] incomplete, [N] inconsistent)
        -----------------------------------------
        OVERALL:      [GO / CONDITIONAL GO / NO-GO]

        BLOCKERS (if any):
        1. [blocker] — [remediation] — [owner] — [timeline]

Step 5: If CONDITIONAL GO:
        COO creates remediation tasks, assigns to agents
        Agents fix blockers → report back
        COO re-evaluates → updated scorecard

Step 6: CEO Briefing → Shutdown → TeamDelete
```

**Success Criteria:**

| Dimension | GO Threshold | NO-GO Threshold |
|-----------|-------------|-----------------|
| Security | >= 85/100, 0 critical | Any critical finding |
| Performance | P95 < 8s | P95 > 12s |
| UX | 0 critical bugs | Any critical UX bug |
| Data | >= 95/100 | < 80/100 |

**Cost:** $0.00 (all read-only audits, no API calls)
**Duration:** ~30 minutes

---

## Team Lifecycle

### Creating a Team

```
1. COO receives CEO directive (or triggers automatically)
2. COO → TeamCreate({ team_name: "donde-[project]", description: "..." })
3. COO → TaskCreate (multiple tasks for the project)
4. COO → Agent (spawn teammates with names into the team)
5. Teammates work, communicate via SendMessage
6. COO aggregates results
7. COO → SendMessage({ to: each teammate, message: { type: "shutdown_request" }})
8. COO → TeamDelete()
9. COO → CEO Briefing
```

### Team Naming Convention

| Pattern | Example | When |
|---------|---------|------|
| `donde-quality-*` | `donde-quality-alpha` | Quality Division projects |
| `donde-infra-*` | `donde-infra-sync` | Infrastructure projects |
| `donde-product-*` | `donde-product-delta` | Product projects |
| `donde-security-*` | `donde-security-echo` | Security projects |
| `donde-sprint-*` | `donde-sprint-w12` | Sprint planning (by week) |
| `donde-incident-*` | `donde-incident-20260315` | Incident response (by date) |

### Agent Naming Convention

When spawning agents into a team, use short, role-based names:

| Agent Type | Team Name | Division |
|-----------|-----------|----------|
| `donde-coo` | `coo` | Lead |
| `analytics-expert` | `analyst` | Quality |
| `bug-fixer` | `fixer` | Quality |
| `gen-test-queries` | `query-gen` | Quality |
| `continuous-tester` | `tester` | Quality |
| `perf-optimizer` | `profiler` | Infra |
| `db-reviewer` | `auditor` | Infra |
| `update-docs` | `documenter` | Infra |
| `prod-sentinel` | `sentinel` | Infra |
| `frontend-builder` | `builder` | Frontend |
| `frontend-fixer` | `ui-fixer` | Frontend |
| `css-theme-specialist` | `themer` | Frontend |
| `uat-tester` | `ux` | Frontend |
| `ceo-advisor` | `strategist` | Product |
| `donde-premium-advisor` | `designer` | Product |
| `donde-ciso` | `security` | Security |

---

## Continuous Improvement

### Quality Metrics Tracked

| Metric | Source | Frequency | Target |
|--------|--------|-----------|--------|
| Golden dataset pass rate | `gauntlet_runs` | Every quality cycle | 95%+ |
| Avg DondeMatch | `gauntlet_runs` | Every quality cycle | 80+ |
| Avg score fit | `gauntlet_runs` | Every quality cycle | 90+ |
| Avg blurb quality | `gauntlet_runs` | Every quality cycle | 85+ |
| Documentation freshness | `git log` vs doc dates | Every COO session | <1 day |
| Grading sync status | Diff grading.ts vs cc-grading.js | Every COO session | In sync |
| Cache hit rate | `query_cache` + `user_queries` | Weekly | 40%+ |
| Security posture | CISO audit | Monthly | 85/100+ |

### Improvement Flywheel

```
Measure (quality cycle)
  → Identify gaps (COO analysis)
    → Assign fixes (task management)
      → Implement (agent execution)
        → Verify (retest)
          → Document (update-docs)
            → Measure again (next cycle)
```

Each cycle should improve at least one metric. If no metrics improve for 3 consecutive cycles, COO escalates to CEO with a strategic reassessment.

---

## Agent Expansion Log

### Shipped (Project Phoenix — 2026-03-15)

| Agent | Division | Gap Filled |
|-------|----------|-----------|
| `frontend-builder` | Frontend | No agent could build frontend components |
| `frontend-fixer` | Frontend | No agent could fix UI bugs systematically |
| `css-theme-specialist` | Frontend | No agent owned 10 cultural theme variants |
| `continuous-tester` | Quality | No automated test execution after deploys |
| `prod-sentinel` | Infra | No production monitoring or anomaly detection |

### Planned (Future)

| Agent | Division | Status | Gap Filled | Priority |
|-------|----------|--------|-----------|----------|
| `fullstack-deployer` | Infra | PLANNED | Cross-repo sync coordination | MEDIUM |
| `ux-innovator` | Product | PLANNED | UI/UX innovation proposals | LOW |
| `engine-innovator` | Product | PLANNED | Scoring algorithm R&D | LOW |
| `learning-agent` | Quality | PLANNED | Personalization pipeline | LOW — post Learning Flywheel |

New agents are created only when:
1. A clear gap exists that no current agent covers
2. The gap has been encountered in at least 2 sessions
3. CEO approves the agent spec
4. COO verifies no overlap with existing agents
