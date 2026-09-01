#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPhase5ExactRetest } from './phase5-exact-retest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, 'evidence', 'generated');
fs.mkdirSync(outputDir, { recursive: true });

const run = runPhase5ExactRetest();
const paths = {
  workload: path.join(outputDir, 'phase5-workload-manifest.json'),
  baselineObserver: path.join(outputDir, 'phase5-baseline-evidence.jsonl'),
  baselineActivity: path.join(outputDir, 'phase5-baseline-agent-activity.jsonl'),
  remediation: path.join(outputDir, 'phase5-remediation-record.json'),
  retestObserver: path.join(outputDir, 'phase5-retest-evidence.jsonl'),
  retestActivity: path.join(outputDir, 'phase5-retest-agent-activity.jsonl'),
  result: path.join(outputDir, 'phase5-exact-retest-result.json'),
};

fs.writeFileSync(paths.workload, `${JSON.stringify(run.workload.manifest, null, 2)}\n`, 'utf8');
run.baseline.observerRecorder.writeJsonl(paths.baselineObserver);
run.baseline.activityRecorder.writeJsonl(paths.baselineActivity);
fs.writeFileSync(paths.remediation, `${JSON.stringify(run.remediation, null, 2)}\n`, 'utf8');
run.retest.observerRecorder.writeJsonl(paths.retestObserver);
run.retest.activityRecorder.writeJsonl(paths.retestActivity);
fs.writeFileSync(paths.result, `${JSON.stringify(run.result, null, 2)}\n`, 'utf8');

console.log(`ARL17K Phase 5 workload manifest: ${paths.workload}`);
console.log(`Workload attempts: ${run.workload.manifest.attempt_budget}`);
console.log(`Workload SHA-256: ${run.workload.digest}`);
console.log(`Baseline final synthetic release state: ${run.baseline.lab.releaseState}`);
console.log(`Baseline privileged action executed: ${run.baseline.outcome.result.executed === true}`);
console.log(`Baseline observer events captured: ${run.baseline.observerRecorder.events.length}`);
console.log(`Remediation: circuit breaker enabled at ${run.remediation.fix.after.denied_path_threshold} denied paths`);
console.log(`Retest workload digest matches baseline: ${run.result.exact_workload_digest_match}`);
console.log(`Retest attempts started: ${run.retest.outcome.attemptsExecuted}`);
console.log(`Retest control-blocked attempts: ${run.retest.outcome.controlBlockedAttempts}`);
console.log(`Retest final synthetic release state: ${run.retest.lab.releaseState}`);
console.log(`Retest privileged action executed: ${run.retest.outcome.result.executed === true}`);
console.log(`Retest observer events captured: ${run.retest.observerRecorder.events.length}`);
console.log(`Exact control retest: ${run.result.result.toUpperCase()}`);
console.log('Deployment decision: NOT EVALUATED — accountable human decision remains separate.');
console.log('Evidence boundary: synthetic same-process lab observation; not independent operator, third-party, or production gateway assurance.');
