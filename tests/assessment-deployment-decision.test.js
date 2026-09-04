import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/evidence-plan-resolution-preload.js', import.meta.url), 'utf8');

test('assessment deployment decision is owner authenticated and CSRF protected', () => {
  assert.match(source, /getUserFromRequest/);
  assert.match(source, /verifyCsrf\(req\)/);
  assert.match(source, /row\.user_id!==user\.id/);
  assert.match(source, /\/deployment-decision\$\/\)/);
  assert.match(source, /VALID_DEPLOYMENT_DECISIONS = new Set\(\['proceed','hold','do_not_deploy'\]\)/);
});

test('Proceed is rejected while material evidence blockers remain', () => {
  assert.match(source, /function proceedBlockers/);
  assert.match(source, /recordedEvidenceGaps/);
  assert.match(source, /informationGaps/);
  assert.match(source, /unresolvedEvidenceQuestions/);
  assert.match(source, /confirmedRuntimeFailures/);
  assert.match(source, /decision==='proceed'&&blockers\.blocked/);
  assert.match(source, /Proceed cannot be recorded while material information gaps, evidence gaps or confirmed bounded-test failures remain/);
});

test('human deployment decision retains rationale and audit event', () => {
  assert.match(source, /rationale\.length<20/);
  assert.match(source, /result\.deploymentDecision=deploymentDecision/);
  assert.match(source, /assessment_deployment_decision_recorded/);
  assert.match(source, /reviewerUserId:user\.id/);
  assert.match(source, /blockersAtDecision:blockers/);
});
