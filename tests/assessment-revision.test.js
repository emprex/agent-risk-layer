import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildRevisionQuestionFlow } from '../public/assessment-revision.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const questions = [
  { id: 'data_sensitivity' },
  { id: 'tool_authorization' },
  { id: 'egress_control' },
];

test('revision flow keeps the fast path focused on unresolved questions', () => {
  const answers = new Map([
    ['data_sensitivity', { value: 'unknown', evidence: 'none' }],
    ['tool_authorization', { value: 'none', evidence: 'customer_assertion' }],
  ]);

  assert.deepEqual(
    buildRevisionQuestionFlow(questions, answers).map((question) => question.id),
    ['data_sensitivity', 'egress_control'],
  );
});

test('review-all mode exposes every inherited answer for correction without changing the source map', () => {
  const answers = new Map([
    ['data_sensitivity', { value: 'unknown', evidence: 'none' }],
    ['tool_authorization', { value: 'none', evidence: 'customer_assertion' }],
    ['egress_control', { value: 'unknown', evidence: 'none' }],
  ]);

  assert.deepEqual(
    buildRevisionQuestionFlow(questions, answers, true).map((question) => question.id),
    questions.map((question) => question.id),
  );
  assert.deepEqual(answers.get('tool_authorization'), { value: 'none', evidence: 'customer_assertion' });
});

test('a fully answered source assessment still opens all questions for a new immutable revision', () => {
  const answers = new Map(questions.map((question) => [question.id, { value: 'known', evidence: 'customer_assertion' }]));

  assert.deepEqual(
    buildRevisionQuestionFlow(questions, answers).map((question) => question.id),
    questions.map((question) => question.id),
  );
});

test('assessment update UI exposes explicit review-all control and preserves immutable-source messaging', () => {
  const html = read('public/assessment.html');
  const js = read('public/assessment.js');

  assert.match(html, /<div(?=[^>]*id="revisionReviewField")(?=[^>]*hidden)[^>]*>/);
  assert.match(html, /id="reviewPreviousAnswers"[^>]*type="checkbox"/);
  assert.match(html, /Review all previous answers/);
  assert.match(html, /previous assessment stays unchanged/i);
  assert.match(js, /import \{ buildRevisionQuestionFlow \} from '\.\/assessment-revision\.js'/);
  assert.match(js, /buildRevisionQuestionFlow\(questionnaire, answers, reviewAll\)/);
  assert.match(js, /reviewPreviousAnswers\?\.addEventListener\('change'/);
  assert.match(js, /by default, only unresolved questions need a new answer/i);
  assert.match(js, /Previous answers are prefilled for review and can be changed in this new assessment/i);
  assert.match(js, /Object\.fromEntries\(questionnaire\.map/);
  assert.doesNotMatch(js, /localStorage/);
});
