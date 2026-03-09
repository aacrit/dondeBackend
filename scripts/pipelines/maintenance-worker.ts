/**
 * Maintenance Worker
 *
 * Polls maintenance_requests for pending items, executes the matching pipeline,
 * and updates the request status (running → complete/failed).
 *
 * Runs on a 5-minute cron via GitHub Actions.
 *
 * Usage:
 *   npx tsx pipelines/maintenance-worker.ts
 */

import { createAdminClient } from '../lib/supabase.js';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Map pipeline IDs (from frontend PIPELINES config) to their script(s)
// Array = run scripts sequentially
const PIPELINE_SCRIPTS: Record<string, string[]> = {
  discovery: ['discovery.ts'],
  enrichment: ['enrich-new-or-gaps.ts'],
  scores_tags: ['generate-occasion-scores.ts', 'generate-tags.ts'],
  audit: ['audit-full-dataset.ts'],
};

async function main() {
  const sb = createAdminClient();

  // Find pending requests (oldest first, max 1 at a time to avoid overlap)
  const { data: pending, error } = await sb
    .from('maintenance_requests')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Failed to query maintenance_requests:', error.message);
    process.exit(1);
  }

  if (!pending || pending.length === 0) {
    console.log('No pending maintenance requests. Exiting.');
    return;
  }

  const request = pending[0];
  const scripts = PIPELINE_SCRIPTS[request.operation];

  if (!scripts) {
    console.error(`Unknown pipeline operation: ${request.operation}`);
    await sb.from('maintenance_requests').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      result: { error: `Unknown operation: ${request.operation}` },
    }).eq('id', request.id);
    return;
  }

  console.log(`Processing request ${request.id}: ${request.operation} (${scripts.length} script${scripts.length > 1 ? 's' : ''})`);

  // Mark as running with first stage active
  const stages = (request.stages || []).map((s: { name: string; status: string }, i: number) => ({
    ...s,
    status: i === 0 ? 'running' : 'pending',
    ...(i === 0 ? { started_at: new Date().toISOString() } : {}),
  }));

  await sb.from('maintenance_requests').update({
    status: 'running',
    started_at: new Date().toISOString(),
    stages,
  }).eq('id', request.id);

  const startTime = Date.now();
  let allOutput = '';

  try {
    // Run each script sequentially, updating stages as we go
    for (let si = 0; si < scripts.length; si++) {
      const scriptPath = join(__dirname, scripts[si]);
      console.log(`  Running script ${si + 1}/${scripts.length}: ${scripts[si]}`);

      // Update current stage to running
      const updatedStages = (request.stages || []).map((s: { name: string; status: string }, i: number) => {
        if (i < si) return { ...s, status: 'complete', completed_at: new Date().toISOString() };
        if (i === si) return { ...s, status: 'running', started_at: new Date().toISOString() };
        return { ...s, status: 'pending' };
      });
      await sb.from('maintenance_requests').update({ stages: updatedStages }).eq('id', request.id);

      const output = execSync(`npx tsx "${scriptPath}"`, {
        cwd: join(__dirname, '..'),
        timeout: 25 * 60 * 1000,
        stdio: 'pipe',
        env: { ...process.env },
      }).toString();

      allOutput += output + '\n';
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    const completedStages = (request.stages || []).map((s: { name: string; status: string }) => ({
      ...s,
      status: 'complete',
      completed_at: new Date().toISOString(),
    }));

    const summary = allOutput.slice(-500).trim();

    await sb.from('maintenance_requests').update({
      status: 'complete',
      completed_at: new Date().toISOString(),
      stages: completedStages,
      result: { duration_seconds: duration, summary },
    }).eq('id', request.id);

    console.log(`Completed ${request.operation} in ${duration}s`);
  } catch (err: unknown) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Mark the current stage as failed, prior stages as complete
    const failedStages = (request.stages || []).map((s: { name: string; status: string }, i: number) => {
      // Find which script failed based on output length
      const completedScripts = allOutput.split('\n').filter(l => l.length > 0).length > 0 ? 1 : 0;
      if (i < completedScripts) return { ...s, status: 'complete', completed_at: new Date().toISOString() };
      if (i === completedScripts) return { ...s, status: 'failed', completed_at: new Date().toISOString() };
      return { ...s, status: 'pending' };
    });

    await sb.from('maintenance_requests').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      stages: failedStages,
      result: { duration_seconds: duration, error: errorMessage.slice(0, 500) },
    }).eq('id', request.id);

    console.error(`Failed ${request.operation} after ${duration}s:`, errorMessage.slice(0, 200));
  }
}

main().catch(e => {
  console.error('Maintenance worker crashed:', e);
  process.exit(1);
});
