#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPhase7Stability } from './phase7-stability.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, 'evidence', 'generated');
fs.mkdirSync(outputDir, { recursive: true });

const run = runPhase7Stability();
const paths = {
  workload: path.join(outputDir, 'phase7-workload-manifest.json'),
  baseline: path.join(outputDir, 'phase7-baseline-evidence.jsonl'),
  protected: path.join(outputDir, 'phase7-protected-evidence.jsonl'),
  result: path.join(outputDir, 'phase7-stability-result.json'),
};

fs.writeFileSync(paths.workload, `${JSON.stringify(run.workload.manifest, null, 2)}\n`, 'utf8');
run.baseline.observerRecorder.writeJsonl(paths.baseline);
run.protected.observerRecorder.writeJsonl(paths.protected);
fs.writeFileSync(paths.result, `${JSON.stringify(run.result, null, 2)}\n`, 'utf8');

console.log(`ARL17K Phase 7 workload manifest: ${paths.workload}`);
console.log(`Workload attempts: ${run.workload.manifest.attempt_budget}`);
console.log(`Workload SHA-256: ${run.workload.digest}`);
console.log(`Repeat count: ${run.result.repeat_count}`);
console.log(`Baseline attempts started: ${run.result.unsafe_baseline.attempts_started}`);
console.log(`Baseline failed paths: ${run.result.unsafe_baseline.denied_paths}`);
console.log(`Baseline final synthetic release state: ${run.result.unsafe_baseline.final_release_state}`);
console.log(`Baseline privileged action executed: ${run.result.unsafe_baseline.privileged_action_executed}`);
console.log(`Baseline observer events captured: ${run.result.unsafe_baseline.observer_events}`);
console.log(`Baseline deterministic across repeats: ${run.result.unsafe_baseline.deterministic_across_repeats}`);
console.log(`Protected attempts started: ${run.result.protected.attempts_started}`);
console.log(`Protected failed paths: ${run.result.protected.denied_paths}`);
console.log(`Protected control-blocked attempts: ${run.result.protected.control_blocked_attempts}`);
console.log(`Protected circuit breaker opened: ${run.result.protected.circuit_breaker_open}`);
console.log(`Protected final synthetic release state: ${run.result.protected.final_release_state}`);
console.log(`Protected privileged action executed: ${run.result.protected.privileged_action_executed}`);
console.log(`Protected observer events captured: ${run.result.protected.observer_events}`);
console.log(`Protected deterministic across repeats: ${run.result.protected.deterministic_across_repeats}`);
console.log(`Stability result: ${run.result.result.toUpperCase()}`);
console.log('Deployment decision: NOT EVALUATED — Phase 6 operator HOLD remains separate.');
console.log('Evidence boundary: synthetic same-process lab observation; not independent operator, third-party, or production gateway assurance.');
