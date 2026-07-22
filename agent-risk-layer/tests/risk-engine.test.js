import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAssessment, questionnaire } from '../src/risk-engine.js';

function answersAt(optionIndex) {
  return Object.fromEntries(questionnaire.map((q) => [q.id, q.options[optionIndex].value]));
}

test('hardened configuration scores as low risk', () => {
  const result = evaluateAssessment(answersAt(0));
  assert.equal(result.score, 0);
  assert.equal(result.riskBand, 'Low');
  assert.equal(result.findings.length, 0);
});

test('maximum-risk configuration scores as critical', () => {
  const result = evaluateAssessment(answersAt(3));
  assert.equal(result.score, 100);
  assert.equal(result.riskBand, 'Critical');
  assert.ok(result.findings.length >= 10);
  assert.ok(result.recommendations.some((item) => item.priority === 'Immediate'));
});

test('moderate configuration produces explainable findings', () => {
  const answers = answersAt(1);
  answers.permissions = 'user';
  answers.untrusted_input = 'mixed';
  answers.kill_switch = 'slow';
  const result = evaluateAssessment(answers);
  assert.ok(result.score >= 25 && result.score < 50);
  assert.equal(result.riskBand, 'Moderate');
  assert.equal(result.topFindings.length, 3);
  assert.ok(result.controls.some((control) => control.status === 'action'));
});

test('invalid or missing answer is rejected', () => {
  assert.throws(() => evaluateAssessment({}), /Missing or invalid answer/);
});
