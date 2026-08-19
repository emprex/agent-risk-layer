import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [binding, proofState, controlHtml, resultHtml] = await Promise.all([
  readFile(new URL('../public/assessment-remediation-dynamic-binding.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/result-current-proof-state.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/control-plane.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/result.html', import.meta.url), 'utf8'),
]);

test('assessment remediation binds controls by the actual finding question rather than positional F number', () => {
  assert.match(binding, /byWeakness/);
  assert.match(binding, /finding\.title/);
  assert.match(binding, /control\.controlId/);
  assert.match(binding, /This binding comes from the finding question, not its display number/);
  assert.match(controlHtml, /assessment-remediation-dynamic-binding\.js/);
});

test('assessment result separates immutable baseline from current proof state', () => {
  assert.match(proofState, /The assessment above remains the historical baseline/);
  assert.match(proofState, /New evidence, fixes and retests are shown separately/);
  assert.match(proofState, /verified closed/);
  assert.match(proofState, /Observed static evidence can support or challenge a claim, but it does not automatically close/);
  assert.match(resultHtml, /result-current-proof-state\.js/);
});

test('free assessment preserves the commercial boundary while explaining the paid outcome', () => {
  assert.match(proofState, /The £99 Security Assessment unlocks the remediation, evidence, exact-retest and accountable closure workflow/);
  assert.match(proofState, /Existing assessment and observed evidence remain preserved through checkout/);
});

test('proof journey keeps closure evidence-bounded', () => {
  assert.match(binding, /Each declared finding stays historical until evidence is linked, the exact mapped control is tested again, and an accountable reviewer records closure/);
  assert.match(binding, /A passed test proves only its bounded control and scope/);
});
