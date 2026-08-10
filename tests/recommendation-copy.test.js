import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAssessment, questionnaire } from '../src/risk-engine.js';

function safestAnswers(evidence = 'customer_assertion') {
  return Object.fromEntries(questionnaire.map((question) => [question.id, {
    value: question.options[0].value,
    evidence,
  }]));
}

test('critical remediation copy does not imply an unverified finding is confirmed', () => {
  const answers = safestAnswers();
  answers.input_boundary = { value: 'none', evidence: 'customer_assertion' };

  const result = evaluateAssessment(answers);
  const recommendation = result.recommendations.find((item) => item.tag === 'critical');

  assert.ok(recommendation);
  assert.equal(
    recommendation.text,
    'Do not deploy or expand while a critical finding remains unresolved; remediate it and retest before relying on a deployment decision.',
  );
  assert.doesNotMatch(recommendation.text, /confirmed/i);
});

test('information-and-remediation headline stays evidence-neutral', () => {
  const answers = safestAnswers();
  answers.permissions = { value: 'user', evidence: 'customer_assertion' };
  answers.memory_security = { value: 'unknown', evidence: 'none' };

  const result = evaluateAssessment(answers);

  assert.equal(result.decision, 'HOLD FOR INFORMATION AND REMEDIATION');
  assert.match(result.headline, /address the listed weaknesses/i);
  assert.doesNotMatch(result.headline, /confirmed weaknesses/i);
});
