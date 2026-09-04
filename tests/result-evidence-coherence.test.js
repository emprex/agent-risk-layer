import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('result separates confirmed findings from evidence gaps and source observations', () => {
  const journey = read('public/result-evidence-journey.js');
  assert.match(journey, /id=\"confirmedFindings\"/);
  assert.match(journey, /No confirmed findings are currently eligible for remediation/);
  assert.match(journey, /Source observations, questionnaire concerns, unknown information and evidence gaps are kept separate from findings/);
  assert.match(journey, /Source observations are not confirmed findings/);
  assert.match(journey, /usable\.slice\(5\)\.forEach/);
  assert.match(journey, /Review full evidence/);
});

test('completed evidence review reaches human deployment decision without control-plane detour', () => {
  const journey = read('public/result-evidence-journey.js');
  assert.match(journey, /title: 'Record the deployment decision with evidence gaps'/);
  assert.match(journey, /href: '#deploymentReview'/);
  assert.match(journey, /id=\"deploymentReview\"/);
  assert.match(journey, /data-deployment-decision=\"hold\"/);
  assert.match(journey, /data-deployment-decision=\"do_not_deploy\"/);
  assert.match(journey, /Proceed is unavailable while material information gaps, evidence gaps or confirmed failures remain/);
  assert.match(journey, /deployment-decision/);
});

test('stale frozen-target copy cannot override the live evidence state', () => {
  const target = read('public/result-target.js');
  assert.doesNotMatch(target, /Inspect the frozen revision/);
  assert.doesNotMatch(target, /Run source evidence/);
  assert.match(target, /Review evidence/);
  assert.match(target, /questionnaire evidence confidence/);
});

test('normal customer stage language says Evidence rather than internal PROVE terminology', () => {
  const journey = read('public/result-evidence-journey.js');
  assert.doesNotMatch(journey, /stage: 'PROVE'/);
  assert.match(journey, /stage: 'Evidence'/);
});
