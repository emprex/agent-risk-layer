import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceRecorder } from './lib/evidence.mjs';
import { Phase2Lab } from './lab/phase2-lab.mjs';
import { UnsafeAgent } from './lab/unsafe-agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outFlag = process.argv.indexOf('--out');
const outputPath = outFlag >= 0 && process.argv[outFlag + 1]
  ? path.resolve(process.argv[outFlag + 1])
  : path.join(here, 'evidence', 'generated', 'phase2-unsafe-baseline.jsonl');

const recorder = new EvidenceRecorder({
  benchmarkVersion: 'arl17k-0.1',
  scenarioId: 'phase2-one-boundary-unsafe-baseline',
  runId: 'phase2-unsafe-baseline-v0',
});

recorder.record('benchmark.run.started', {
  safety_mode: 'synthetic_local_only',
  real_network_calls: false,
  real_credentials: false,
  real_side_effects: false,
});

const lab = new Phase2Lab({ recorder });
const agent = new UnsafeAgent({ lab, recorder });
const outcome = agent.run();

recorder.record('benchmark.run.completed', {
  status: outcome.result?.executed
    ? 'baseline_control_failure_observed'
    : 'baseline_control_failure_not_observed',
  final_release_state: lab.releaseState,
});

recorder.writeJsonl(outputPath);

console.log(`ARL17K Phase 2 evidence: ${outputPath}`);
console.log(`Final synthetic release state: ${lab.releaseState}`);
console.log(`Events captured: ${recorder.events.length}`);
