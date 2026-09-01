#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPhase8Benchmark } from './phase8-benchmark.mjs';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, 'evidence', 'generated');
fs.mkdirSync(outputDir, { recursive: true });

const run = runPhase8Benchmark();
const paths = {
  workload: path.join(outputDir, 'phase8-workload-manifest.json'),
  baseline: path.join(outputDir, 'phase8-baseline-evidence.jsonl'),
  protected: path.join(outputDir, 'phase8-protected-evidence.jsonl'),
  result: path.join(outputDir, 'phase8-benchmark-result.json'),
  evidenceManifest: path.join(outputDir, 'phase8-evidence-manifest.json'),
};

fs.writeFileSync(paths.workload, `${JSON.stringify(run.workload.manifest, null, 2)}\n`, 'utf8');
run.baseline.observerRecorder.writeJsonl(paths.baseline);
run.protected.observerRecorder.writeJsonl(paths.protected);
fs.writeFileSync(paths.result, `${JSON.stringify(run.result, null, 2)}\n`, 'utf8');

const artifacts = [
  ['phase8-workload-manifest.json', paths.workload],
  ['phase8-baseline-evidence.jsonl', paths.baseline],
  ['phase8-protected-evidence.jsonl', paths.protected],
  ['phase8-benchmark-result.json', paths.result],
].map(([name, filePath]) => ({
  name,
  sha256: sha256File(filePath),
  bytes: fs.statSync(filePath).size,
}));

const evidenceManifest = {
  schema: 'arl17k.evidence_manifest.v1',
  benchmark_version: 'arl17k-0.7',
  benchmark: 'ARL17K',
  phase: 8,
  result: run.result.result,
  canonical_workload_digest: run.workload.digest,
  canonical_digest_note: 'The canonical workload digest hashes compact JSON. The pretty-printed workload artifact file has its own artifact SHA-256.',
  artifacts,
  evidence_boundary: {
    synthetic_local_only: true,
    same_process_lab_observer: true,
    independent_operator_assurance: false,
    third_party_assurance: false,
    production_gateway_proven: false,
  },
};
fs.writeFileSync(paths.evidenceManifest, `${JSON.stringify(evidenceManifest, null, 2)}\n`, 'utf8');

console.log(`ARL17K Phase 8 workload manifest: ${paths.workload}`);
console.log(`ARL17K Phase 8 evidence manifest: ${paths.evidenceManifest}`);
console.log(`Workload attempts: ${run.workload.manifest.attempt_budget}`);
console.log(`Canonical workload SHA-256: ${run.workload.digest}`);
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
console.log(`Final benchmark result: ${run.result.result.toUpperCase()}`);
console.log('Deployment decision: NOT EVALUATED — Phase 6 operator HOLD remains separate.');
console.log('Evidence boundary: synthetic same-process lab observation; not independent operator, third-party, or production gateway assurance.');
