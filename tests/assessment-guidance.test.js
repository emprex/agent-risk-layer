import test from 'node:test';
import assert from 'node:assert/strict';
import { questionnaire } from '../src/risk-engine.js';
import { answerQualification, guidanceFor, guidanceQuestionIds } from '../public/assessment-guidance.js';

test('every assessment question has plain-language decision guidance', () => {
  assert.equal(guidanceQuestionIds.length, questionnaire.length);
  for (const question of questionnaire) {
    const guidance = guidanceFor(question.id, 'Customer support agent');
    assert.ok(guidance, question.id);
    assert.ok(guidance.meaning.length > 40, question.id);
    assert.ok(guidance.checks.length >= 3, question.id);
    assert.match(guidance.example, /^For this customer support agent:/, question.id);
  }
});

test('answer qualification distinguishes uncertainty from a finding', () => {
  const question = questionnaire[0];
  assert.match(answerQualification(question, 'unknown'), /information gap, not a vulnerability/i);
  assert.match(answerQualification(question, question.options[0].value), /technically possible today/i);
});
