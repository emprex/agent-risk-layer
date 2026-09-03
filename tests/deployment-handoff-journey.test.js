import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const resultJourney = fs.readFileSync(path.join(root, 'public', 'result-evidence-journey.js'), 'utf8');
const inspectorOutcome = fs.readFileSync(path.join(root, 'public', 'inspector-evidence-outcomes.js'), 'utf8');

test('deployment handoff prioritises unresolved evidence before human review', () => {
  const failureIndex = resultJourney.indexOf('const failure = outcome.confirmedFailures[0]');
  const inconclusiveIndex = resultJourney.indexOf('const uncertain = outcome.inconclusive[0]');
  const neverRunIndex = resultJourney.indexOf("item.evidence.state === 'open'");
  const supportingIndex = resultJourney.indexOf("item.evidence.state === 'supporting-pass'");
  const deployIndex = resultJourney.indexOf("stage: 'DEPLOY'");
  assert.ok(failureIndex > -1 && failureIndex < deployIndex);
  assert.ok(inconclusiveIndex > -1 && inconclusiveIndex < deployIndex);
  assert.ok(neverRunIndex > -1 && neverRunIndex < deployIndex);
  assert.ok(supportingIndex > -1 && supportingIndex < deployIndex);
});

test('exact bounded retest support hands off to review instead of rerunning forever', () => {
  assert.match(resultJourney, /exactSupported = outcome\.checks\.filter\(\(item\) => item\.evidence\.state === 'exact-retest-supported'\)/);
  assert.match(resultJourney, /Open deployment review/);
  assert.match(resultJourney, /accountable human must review the full chain/i);
  assert.match(inspectorOutcome, /Review deployment handoff/);
  assert.doesNotMatch(inspectorOutcome, /exact-retest-supported'\]\.includes/);
});

test('deployment handoff keeps evidence limitations and never auto-decides Proceed', () => {
  assert.match(resultJourney, /does not automatically record Proceed/);
  assert.match(resultJourney, /recording Proceed, Hold or Do not deploy/);
  assert.doesNotMatch(resultJourney, /decision\s*[:=]\s*['"]Proceed['"]/);
});
