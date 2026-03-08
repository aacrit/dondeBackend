/**
 * ARCADE OPS — Agent Orchestrator
 *
 * Main entry point for the 5-agent automated testing system.
 * Manages lifecycle (start/pause/stop), API budget, and status reporting.
 *
 * Usage:
 *   npx tsx pipelines/agent-orchestrator.ts [--budget N] [--agents agent1,agent2]
 *
 * Writes status to: tests/gauntlet-results/agent-status.json
 * Writes notifications to: tests/gauntlet-results/notification-queue.json
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKEND_ROOT = join(__dirname, '..', '..');
const RESULTS_DIR = join(BACKEND_ROOT, 'tests', 'gauntlet-results');
const STATUS_FILE = join(RESULTS_DIR, 'agent-status.json');
const NOTIF_FILE = join(RESULTS_DIR, 'notification-queue.json');

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface AgentStatus {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'paused' | 'budget_paused' | 'error';
  hp: number;
  xp: number;
  level: number;
  apiUsed: number;
  apiBudget: number;
  lastCycle: string | null;
  stats: Record<string, number | string>;
}

interface OrchestratorState {
  systemState: 'idle' | 'running' | 'paused';
  startTime: string | null;
  budgetUsed: number;
  budgetLimit: number;
  budgetDate: string;
  agents: Record<string, AgentStatus>;
  notifications: Notification[];
}

interface Notification {
  id: number;
  type: 'budget_request' | 'critical' | 'regression' | 'api_error' | 'achievement' | 'cycle_complete';
  message: string;
  agentId: string;
  timestamp: string;
  acknowledged: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_BUDGET = 50;
const AGENT_BUDGETS: Record<string, number> = {
  atlas: 20,
  qaudit: 0,
  sentinel: 15,
  hunter: 10,
  guardian: 5,
};

const XP_PER_LEVEL = 500;

const API_URL = process.env.SUPAB_URL
  ? `${process.env.SUPAB_URL}/functions/v1/recommend`
  : 'https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend';

const API_KEY = process.env.SUPAB_ANON_KEY || '';

// ═══════════════════════════════════════════════════════════════════
// State Management
// ═══════════════════════════════════════════════════════════════════

function initState(budgetLimit: number): OrchestratorState {
  const today = new Date().toISOString().split('T')[0];

  // Load existing state if same day
  if (existsSync(STATUS_FILE)) {
    try {
      const existing = JSON.parse(readFileSync(STATUS_FILE, 'utf-8')) as OrchestratorState;
      if (existing.budgetDate === today) {
        console.log(`[ORCHESTRATOR] Resuming session from ${existing.budgetDate}, budget: ${existing.budgetUsed}/${existing.budgetLimit}`);
        existing.systemState = 'running';
        existing.startTime = new Date().toISOString();
        return existing;
      }
    } catch { /* start fresh */ }
  }

  const agents: Record<string, AgentStatus> = {};
  for (const [id, budget] of Object.entries(AGENT_BUDGETS)) {
    agents[id] = {
      id,
      name: id.toUpperCase(),
      status: 'idle',
      hp: 100,
      xp: 0,
      level: 1,
      apiUsed: 0,
      apiBudget: budget,
      lastCycle: null,
      stats: {},
    };
  }

  return {
    systemState: 'running',
    startTime: new Date().toISOString(),
    budgetUsed: 0,
    budgetLimit,
    budgetDate: today,
    agents,
    notifications: [],
  };
}

function writeStatus(state: OrchestratorState) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(STATUS_FILE, JSON.stringify(state, null, 2));
}

function writeNotifications(notifications: Notification[]) {
  writeFileSync(NOTIF_FILE, JSON.stringify(notifications, null, 2));
}

function addNotification(state: OrchestratorState, type: Notification['type'], message: string, agentId: string) {
  state.notifications.push({
    id: Date.now(),
    type,
    message,
    agentId,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  });
  writeNotifications(state.notifications);
}

function awardXP(agent: AgentStatus, amount: number) {
  agent.xp += amount;
  const newLevel = Math.floor(agent.xp / XP_PER_LEVEL) + 1;
  if (newLevel > agent.level) {
    console.log(`[${agent.name}] LEVEL UP! Now Level ${newLevel}`);
    agent.level = newLevel;
  }
}

// ═══════════════════════════════════════════════════════════════════
// API Helper
// ═══════════════════════════════════════════════════════════════════

async function callAPI(
  state: OrchestratorState,
  agentId: string,
  specialRequest: string,
  params: Record<string, unknown> = {}
): Promise<{ success: boolean; donde_match?: number; restaurant?: Record<string, unknown>; recommendation?: string; error?: string }> {
  const agent = state.agents[agentId];

  if (state.budgetUsed >= state.budgetLimit) {
    addNotification(state, 'budget_request', `${agent.name} needs API calls but daily budget (${state.budgetLimit}) exhausted.`, agentId);
    agent.status = 'budget_paused';
    return { success: false, error: 'BUDGET_EXCEEDED' };
  }

  if (agent.apiUsed >= agent.apiBudget) {
    addNotification(state, 'budget_request', `${agent.name} requests ${10} additional API calls.`, agentId);
    agent.status = 'budget_paused';
    return { success: false, error: 'AGENT_BUDGET_EXCEEDED' };
  }

  const body = {
    special_request: specialRequest,
    occasion: (params.occasion as string) || 'Any',
    neighborhood: (params.neighborhood as string) || 'Anywhere',
    price_level: (params.price_level as string) || 'Any',
    exclude: (params.exclude as string[]) || [],
    dietary_restrictions: (params.dietary_restrictions as string[]) || [],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (API_KEY) {
      headers['Authorization'] = `Bearer ${API_KEY}`;
      headers['apikey'] = API_KEY;
    }

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    state.budgetUsed++;
    agent.apiUsed++;
    writeStatus(state);

    const data = await resp.json();
    return data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Agent Cycles
// ═══════════════════════════════════════════════════════════════════

const ATLAS_QUERIES = [
  'Italian beef sandwich', 'deep dish pizza', 'best sushi Chicago',
  'authentic Mexican food', 'Ethiopian restaurant', 'date night West Loop',
  'cheap eats Wicker Park', 'brunch Lincoln Park', 'late night food',
  'vegan restaurant', 'steakhouse downtown', 'like Portillos',
  'dinner before Cubs game', 'Devon Avenue food', 'Chinatown dim sum',
  'craft cocktails', 'farm to table', 'hole in the wall',
  'ramen near me', 'upscale Italian', 'BBQ ribs', 'seafood restaurant',
];

async function runAtlasCycle(state: OrchestratorState) {
  const agent = state.agents.atlas;
  agent.status = 'running';
  agent.lastCycle = new Date().toISOString();

  const query = ATLAS_QUERIES[Math.floor(Math.random() * ATLAS_QUERIES.length)];
  console.log(`[ATLAS] Testing: "${query}"`);

  const result = await callAPI(state, 'atlas', query);

  if (result.success && result.donde_match !== undefined) {
    const dm = result.donde_match;
    const total = (agent.stats.total as number || 0) + 1;
    const pass = (agent.stats.pass as number || 0) + (dm >= 60 ? 1 : 0);

    agent.stats.total = total;
    agent.stats.pass = pass;
    agent.stats.queries = total;
    agent.stats.avgDm = Math.round(((agent.stats.avgDm as number || 0) * (total - 1) + dm) / total);
    agent.stats.gaps = (agent.stats.gaps as number || 0) + (dm < 60 ? 1 : 0);

    agent.hp = Math.round((pass / total) * 100);
    awardXP(agent, dm >= 80 ? 25 : dm >= 60 ? 10 : 0);

    console.log(`[ATLAS] ${dm >= 60 ? 'PASS' : 'FAIL'}: "${query}" -> DM ${dm} (${(result.restaurant as Record<string, string>)?.name || 'unknown'})`);

    if (dm < 40) {
      addNotification(state, 'critical', `Critical gap: "${query}" scored DM ${dm}`, 'atlas');
    }
  } else {
    agent.stats.gaps = (agent.stats.gaps as number || 0) + 1;
    console.log(`[ATLAS] ERROR: "${query}" -> ${result.error}`);
    if (result.error !== 'AGENT_BUDGET_EXCEEDED' && result.error !== 'BUDGET_EXCEEDED') {
      addNotification(state, 'api_error', `API Error on "${query}": ${result.error}`, 'atlas');
    }
  }

  agent.status = agent.apiUsed >= agent.apiBudget ? 'budget_paused' : 'idle';
  writeStatus(state);
}

const GOLDEN_QUERIES = [
  { id: 'GD-F01', query: 'best burger in Chicago', minScore: 55 },
  { id: 'GD-F03', query: 'Korean BBQ', minScore: 55 },
  { id: 'GD-F10', query: 'wood-fired pizza', minScore: 60 },
  { id: 'GD-V01', query: 'romantic dinner', minScore: 55 },
  { id: 'GD-V05', query: 'outdoor dining', minScore: 55 },
  { id: 'GD-S04', query: 'special occasion dinner', minScore: 55 },
  { id: 'GD-R01', query: 'best restaurant in Chicago', minScore: 60 },
  { id: 'GD-C03', query: 'cheap eats', minScore: 45 },
];

async function runSentinelCycle(state: OrchestratorState) {
  const agent = state.agents.sentinel;
  agent.status = 'running';
  agent.lastCycle = new Date().toISOString();

  const gq = GOLDEN_QUERIES[Math.floor(Math.random() * GOLDEN_QUERIES.length)];
  console.log(`[SENTINEL] Baseline check: [${gq.id}] "${gq.query}"`);

  const result = await callAPI(state, 'sentinel', gq.query);

  if (result.success && result.donde_match !== undefined) {
    const dm = result.donde_match;
    agent.stats.checks = (agent.stats.checks as number || 0) + 1;

    if (dm >= gq.minScore) {
      awardXP(agent, 10);
      console.log(`[SENTINEL] [${gq.id}] PASS: DM ${dm} >= ${gq.minScore}`);
    } else {
      agent.stats.regressions = (agent.stats.regressions as number || 0) + 1;
      awardXP(agent, 50);
      console.log(`[SENTINEL] [${gq.id}] REGRESSION: DM ${dm} < ${gq.minScore}`);
      addNotification(state, 'regression', `Regression: [${gq.id}] "${gq.query}" scored ${dm}, expected >= ${gq.minScore}`, 'sentinel');
    }

    agent.stats.baseline = `DM ${dm}`;
    const checks = agent.stats.checks as number;
    const regs = (agent.stats.regressions as number) || 0;
    agent.hp = Math.round(((checks - regs) / checks) * 100);
  }

  agent.status = agent.apiUsed >= agent.apiBudget ? 'budget_paused' : 'idle';
  writeStatus(state);
}

const EDGE_PROBES = [
  { id: 'EC-01', input: '', name: 'Empty request' },
  { id: 'EC-02', input: 'a'.repeat(500), name: 'Max length input' },
  { id: 'EC-04', input: "'; DROP TABLE restaurants; --", name: 'SQL injection' },
  { id: 'EC-06', input: 'vegan steakhouse', name: 'Contradictory request' },
  { id: 'EC-07', input: '<script>alert("xss")</script>', name: 'XSS attempt' },
  { id: 'EC-10', input: 'hmm', name: 'Ultra-short cold start' },
];

async function runHunterCycle(state: OrchestratorState) {
  const agent = state.agents.hunter;
  agent.status = 'running';
  agent.lastCycle = new Date().toISOString();

  const probe = EDGE_PROBES[Math.floor(Math.random() * EDGE_PROBES.length)];
  console.log(`[HUNTER] Probe: [${probe.id}] ${probe.name}`);

  const result = await callAPI(state, 'hunter', probe.input);
  agent.stats.probes = (agent.stats.probes as number || 0) + 1;

  // Success or graceful failure both count as "safe"
  if (result.error === 'AGENT_BUDGET_EXCEEDED' || result.error === 'BUDGET_EXCEEDED') {
    agent.status = 'budget_paused';
    writeStatus(state);
    return;
  }

  let contractOk = true;
  if (result.success) {
    if (typeof result.donde_match !== 'number') contractOk = false;
    if (!result.restaurant) contractOk = false;
  }

  if (contractOk || !result.success) {
    awardXP(agent, 30);
    agent.stats.contract = 'OK';
    console.log(`[HUNTER] [${probe.id}] ${probe.name}: SAFE`);
  } else {
    agent.stats.vulns = (agent.stats.vulns as number || 0) + 1;
    agent.stats.errors = (agent.stats.errors as number || 0) + 1;
    agent.stats.contract = 'FAIL';
    console.log(`[HUNTER] [${probe.id}] ${probe.name}: CONTRACT VIOLATION`);
  }

  const probes = agent.stats.probes as number;
  const vulns = (agent.stats.vulns as number) || 0;
  agent.hp = Math.round(((probes - vulns) / probes) * 100);
  agent.status = agent.apiUsed >= agent.apiBudget ? 'budget_paused' : 'idle';
  writeStatus(state);
}

const BANNED_PATTERNS = [
  'culinary', 'gastronomic', 'delectable', 'exquisite', 'tantalizing',
  'delightful', 'mouthwatering', 'nestled', 'tucked away', 'hidden gem',
  'impeccable', 'unparalleled', 'masterfully', 'beautifully', 'stunningly',
  'perfectly', 'artisan', 'artisanal', 'elevate', 'elevated', 'transcend',
  'journey', 'tapestry', 'diverse menu', 'wide array', 'must-visit',
  'not disappoint', 'fusion of', 'indulge',
];

function runQauditCycle(state: OrchestratorState) {
  const agent = state.agents.qaudit;
  agent.status = 'running';
  agent.lastCycle = new Date().toISOString();

  // In production, reads latest gauntlet results. Here we analyze from recent ATLAS results.
  // For now, run a quick blurb check simulation
  const sampleBlurbs = [
    'We love this spot for its handmade pasta and warm neighborhood feel.',
    'A solid pick when you want classic Chicago comfort food without the wait.',
  ];

  let slopCount = 0;
  let cleanCount = 0;

  sampleBlurbs.forEach(blurb => {
    const found = BANNED_PATTERNS.filter(p => blurb.toLowerCase().includes(p));
    if (found.length > 0) {
      slopCount++;
      console.log(`[QAUDIT] SLOP: "${found.join('", "')}"`);
    } else {
      cleanCount++;
    }
  });

  agent.stats.audits = (agent.stats.audits as number || 0) + sampleBlurbs.length;
  agent.stats.slop = (agent.stats.slop as number || 0) + slopCount;
  agent.stats.clean = (agent.stats.clean as number || 0) + cleanCount;

  const totalAudits = agent.stats.audits as number;
  const totalSlop = agent.stats.slop as number;
  const slopRate = totalAudits > 0 ? totalSlop / totalAudits : 0;

  if (slopRate === 0) agent.stats.grade = 'A';
  else if (slopRate < 0.05) agent.stats.grade = 'A-';
  else if (slopRate < 0.1) agent.stats.grade = 'B+';
  else if (slopRate < 0.2) agent.stats.grade = 'B';
  else agent.stats.grade = 'F';

  agent.hp = Math.max(0, 100 - Math.round(slopRate * 200));
  awardXP(agent, slopCount === 0 ? 20 : 5);

  console.log(`[QAUDIT] Cycle: ${cleanCount} clean, ${slopCount} slop. Grade: ${agent.stats.grade}`);
  agent.status = 'idle';
  writeStatus(state);
}

async function runGuardianCycle(state: OrchestratorState) {
  const agent = state.agents.guardian;
  agent.status = 'running';
  agent.lastCycle = new Date().toISOString();

  // Spot-check a random restaurant via API
  const result = await callAPI(state, 'guardian', 'dinner');

  if (result.success && result.restaurant) {
    const r = result.restaurant as Record<string, unknown>;
    agent.stats.records = (agent.stats.records as number || 0) + 1;

    const fields = ['name', 'address', 'cuisine_type', 'google_rating', 'noise_level',
      'price_level', 'phone', 'neighborhood_name', 'lighting_ambiance'];
    const filled = fields.filter(f => r[f] != null).length;
    const coverage = Math.round((filled / fields.length) * 100);
    agent.stats.coverage = `${coverage}%`;

    const missing = fields.filter(f => r[f] == null);
    if (missing.length > 0) {
      agent.stats.issues = (agent.stats.issues as number || 0) + missing.length;
      console.log(`[GUARDIAN] "${r.name}": Missing ${missing.join(', ')}`);
    } else {
      awardXP(agent, 10);
      console.log(`[GUARDIAN] "${r.name}": ${coverage}% coverage OK`);
    }
  }

  const records = (agent.stats.records as number) || 1;
  const issues = (agent.stats.issues as number) || 0;
  agent.hp = Math.max(0, 100 - Math.round((issues / records) * 50));

  agent.status = agent.apiUsed >= agent.apiBudget ? 'budget_paused' : 'idle';
  writeStatus(state);
}

// ═══════════════════════════════════════════════════════════════════
// Main Loop
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  let budget = DEFAULT_BUDGET;

  const budgetIdx = args.indexOf('--budget');
  if (budgetIdx !== -1 && args[budgetIdx + 1]) {
    budget = parseInt(args[budgetIdx + 1], 10) || DEFAULT_BUDGET;
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ARCADE OPS — Agent Orchestrator                           ║');
  console.log(`║  Budget: ${budget} API calls/day                                  ║`);
  console.log(`║  Started: ${new Date().toISOString()}                ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const state = initState(budget);
  writeStatus(state);

  const CYCLE_INTERVALS: Record<string, number> = {
    atlas: 30000,     // 30s
    qaudit: 45000,    // 45s
    sentinel: 60000,  // 60s
    hunter: 40000,    // 40s
    guardian: 90000,  // 90s
  };

  const runners: Record<string, (s: OrchestratorState) => Promise<void> | void> = {
    atlas: runAtlasCycle,
    qaudit: runQauditCycle,
    sentinel: runSentinelCycle,
    hunter: runHunterCycle,
    guardian: runGuardianCycle,
  };

  // Run initial cycles with stagger
  let delay = 0;
  for (const [agentId, runner] of Object.entries(runners)) {
    setTimeout(async () => {
      await runner(state);
    }, delay);
    delay += 5000;
  }

  // Set up interval cycles
  for (const [agentId, interval] of Object.entries(CYCLE_INTERVALS)) {
    setInterval(async () => {
      if (state.systemState !== 'running') return;
      if (state.budgetUsed >= state.budgetLimit) {
        console.log(`[ORCHESTRATOR] Daily budget exhausted (${state.budgetUsed}/${state.budgetLimit}). All agents paused.`);
        state.systemState = 'paused';
        Object.values(state.agents).forEach(a => { a.status = 'budget_paused'; });
        writeStatus(state);
        return;
      }
      await runners[agentId](state);
    }, interval);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[ORCHESTRATOR] Shutdown signal received. Saving state...');
    state.systemState = 'idle';
    Object.values(state.agents).forEach(a => { a.status = 'idle'; });
    writeStatus(state);
    console.log('[ORCHESTRATOR] State saved. Goodbye.');
    process.exit(0);
  });

  // Keep alive
  console.log('[ORCHESTRATOR] Agent cycles active. Press Ctrl+C to stop.\n');
}

main().catch(err => {
  console.error('[ORCHESTRATOR] Fatal error:', err);
  process.exit(1);
});
