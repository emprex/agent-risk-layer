import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAssessment, questionnaire } from '../src/risk-engine.js';

function answersAt(optionIndex, evidence = 'automatically_tested') {
  return Object.fromEntries(questionnaire.map((q) => [q.id, { value: q.options[optionIndex].value, evidence }]));
}

test('hardened and tested configuration scores as low risk', () => {
  const result = evaluateAssessment(answersAt(0));
  assert.ok(result.score < 10);
  assert.equal(result.riskBand, 'Low');
  assert.equal(result.findings.length, 0);
  assert.equal(result.evidenceConfidence, 85);
  assert.equal(result.decision, 'PROCEED WITH MONITORING');
});

test('maximum-risk configuration scores as critical', () => {
  const result = evaluateAssessment(answersAt(3, 'none'));
  assert.equal(result.score, 100);
  assert.equal(result.riskBand, 'Critical');
  assert.ok(result.findings.length >= 15);
  assert.ok(result.recommendations.some((item) => item.priority === 'Immediate'));
});

test('critical attack path always overrides aggregate score and blocks deployment', () => {
  const answers = answersAt(0);
  answers.external_content = { value: 'open', evidence: 'tested' };
  answers.input_boundary = { value: 'none', evidence: 'tested' };
  answers.tool_scope = { value: 'privileged', evidence: 'tested' };
  const result = evaluateAssessment(answers);
  assert.ok(result.attackPaths.some((path) => path.severity === 'critical'));
  assert.equal(result.decision, 'DO NOT DEPLOY');
});

test('moderate configuration produces findings and attack paths', () => {
  const answers = answersAt(1, 'documented');
  answers.permissions = { value: 'user', evidence: 'documented' };
  answers.external_content = { value: 'mixed', evidence: 'documented' };
  answers.input_boundary = { value: 'prompt-only', evidence: 'claimed' };
  answers.tool_scope = { value: 'broad', evidence: 'documented' };
  const result = evaluateAssessment(answers, { agentType: 'Email agent' });
  assert.ok(result.score >= 25 && result.score < 75);
  assert.ok(['Moderate', 'High'].includes(result.riskBand));
  assert.equal(result.topFindings.length, 3);
  assert.ok(result.attackPaths.length >= 1);
  assert.ok(result.controls.some((control) => control.status === 'action'));
});

test('unsupported control claims reduce evidence confidence', () => {
  const result = evaluateAssessment(answersAt(0, 'customer_assertion'));
  assert.equal(result.riskBand, 'Low');
  assert.equal(result.evidenceConfidence, 20);
  assert.ok(result.score > 0);
  assert.equal(result.decision, 'HOLD FOR EVIDENCE');
  assert.ok(result.blockingEvidenceGaps.length > 0);
});

test('legacy tested selections are treated as unsupported customer assertions', () => {
  const result = evaluateAssessment(answersAt(0, 'tested'));
  assert.equal(result.evidenceConfidence, 20);
  assert.equal(result.decision, 'HOLD FOR EVIDENCE');
  assert.ok(result.controls.every((control) => control.verified === false));
});

test('invalid or missing answer is rejected', () => {
  assert.throws(() => evaluateAssessment({}), /Missing or invalid answer/);
});
