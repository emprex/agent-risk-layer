import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceRecorder } from './lib/evidence.mjs';
import { SeparateLabObserver } from './lab/phase3-observer.mjs';
import { Phase3Lab } from './lab/phase3-lab.mjs';
import { PersistentAgent } from './lab/persistent-agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function flagValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1]
    ? path.resolve(process.argv[index + 1])
    : fallback;
}

const observerOutput = flagValue(
  '--observer-out',
  path.join(here, 'evidence', 'generated', 'phase3-observer-evidence.jsonl'),
);
const activityOutput = flagValue(
  '--activity-out',
  path.join(here, 'evidence', 'generated', 'phase3-agent-activity.jsonl'),
);

const observerRecorder = new EvidenceRecorder({
  benchmarkVersion: 'arl17k-0.2',
  scenarioId: 'phase3-bounded-persistence-observer',
  runId: 'phase3-calibration-200-v0',
});
const activityRecorder = new EvidenceRecorder({
  benchmarkVersion: 'arl17k-0.2',
  scenarioId: 'phase3-bounded-persistence-observer',
  runId: 'phase3-calibration-200-v0',
});

const observer = new SeparateLabObserver({ recorder: observerRecorder });
observer.observe('observer.run.started', {
  safety_mode: 'synthetic_local_only',
  real_network_calls: false,
  real_credentials: false,
  real_side_effects: false,
  calibration_attempt_budget: 200,
});

activityRecorder.record('benchmark.run.started', {
  evidence_source: 'benchmark_runner',
  safety_mode: 'synthetic_local_only',
  calibration_attempt_budget: 200,
});

const lab = new Phase3Lab({ observer });
const agent = new PersistentAgent({ lab, activityRecorder, maxAttempts: 200 });
const outcome = agent.run();

observer.observe('observer.run.completed', {
  attempts_executed: outcome.attemptsExecuted,
  denied_attempts: outcome.deniedAttempts,
  privileged_action_executed: outcome.result.executed,
  final_release_state: lab.releaseState,
});
activityRecorder.record('benchmark.run.completed', {
  evidence_source: 'benchmark_runner',
  attempts_executed: outcome.attemptsExecuted,
  denied_attempts: outcome.deniedAttempts,
  privileged_action_executed: outcome.result.executed,
  final_release_state: lab.releaseState,
});

observerRecorder.writeJsonl(observerOutput);
activityRecorder.writeJsonl(activityOutput);

console.log(`ARL17K Phase 3 observer evidence: ${observerOutput}`);
console.log(`ARL17K Phase 3 agent activity: ${activityOutput}`);
console.log(`Attempts executed: ${outcome.attemptsExecuted}`);
console.log(`Failed paths observed: ${outcome.deniedAttempts}`);
console.log(`Final synthetic release state: ${lab.releaseState}`);
console.log(`Observer events captured: ${observerRecorder.events.length}`);
console.log('Observer boundary: separate lab-side recorder; same process; not an independent operator or external monitor.');
