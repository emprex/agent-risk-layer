import test from 'node:test';
import assert from 'node:assert/strict';
import { questionnaire } from '../src/risk-engine.js';
import { buildAdaptiveQuestionFlow, deriveDeterministicApplicability } from '../public/assessment-flow.js';

function answers(values = {}) {
  return new Map(Object.entries(values).map(([id, value]) => [id, { value, evidence: 'customer_assertion' }]));
}

test('only logically not-applicable follow-ups are skipped', () => {
  const state = answers({ tool_scope: 'none', transactions: 'none' });
  const flow = buildAdaptiveQuestionFlow(questionnaire, state);
  assert.equal(flow.questions.some((question) => question.id === 'tool_authorization'), false);
  assert.equal(flow.questions.some((question) => question.id === 'human_approval'), false);
  assert.deepEqual(flow.derived.map((item) => item.questionId).sort(), ['human_approval', 'tool_authorization']);
  for (const item of flow.derived) {
    assert.equal(item.answer.evidence, 'none');
    assert.match(item.reason, /^Skipped because/);
  }
});

test('unknown or broader capability answers never cause a skip', () => {
  for (const state of [
    answers({ tool_scope: 'unknown', transactions: 'unknown' }),
    answers({ tool_scope: 'narrow', transactions: 'draft' }),
    answers({ tool_scope: 'privileged', transactions: 'unbounded' }),
  ]) {
    const flow = buildAdaptiveQuestionFlow(questionnaire, state);
    assert.equal(flow.questions.length, questionnaire.length);
    assert.equal(flow.derived.length, 0);
  }
});

test('changing an upstream answer restores the previously skipped question', () => {
  const low = answers({ tool_scope: 'none', transactions: 'none' });
  assert.equal(buildAdaptiveQuestionFlow(questionnaire, low).questions.some((question) => question.id === 'human_approval'), false);
  low.set('transactions', { value: 'bounded', evidence: 'customer_assertion' });
  assert.equal(buildAdaptiveQuestionFlow(questionnaire, low).questions.some((question) => question.id === 'human_approval'), true);
});

test('derived applicability values exist in the canonical questionnaire', () => {
  const derived = deriveDeterministicApplicability(questionnaire, answers({ tool_scope: 'none', transactions: 'none' }));
  for (const item of derived) {
    const question = questionnaire.find((candidate) => candidate.id === item.questionId);
    assert.ok(question);
    assert.ok(question.options.some((option) => option.value === item.answer.value));
  }
});
