import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('assessment can freeze one exact GitHub repository revision without changing unknown semantics', () => {
  const html = read('public/assessment.html');
  const js = read('public/assessment.js');

  assert.match(html, /Freeze the exact repository version/);
  assert.match(html, /targetRepository/);
  assert.match(html, /targetRevision/);
  assert.match(html, /full 40-character commit SHA/i);
  assert.match(html, /A later commit must be assessed as a new revision/i);

  assert.match(js, /normaliseRepository/);
  assert.match(js, /\[ARL_TARGET\]/);
  assert.match(js, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(js, /Evidence and retests should use this exact revision/);
  assert.match(js, /Leave both blank if you are only running the questionnaire/);
  assert.match(js, /payloadAnswers\.__system_description/);
});

test('assessment result turns the frozen target into a source-evidence next action', () => {
  const html = read('public/result.html');
  const js = read('public/result-target.js');

  assert.match(html, /result-target\.js/);
  assert.match(js, /Frozen assessment target/);
  assert.match(js, /Run source evidence/);
  assert.match(js, /inspector\.html\?assessment=/);
  assert.match(js, /Evidence from a later revision must not silently replace it/);
  assert.match(js, /run only the bounded checks needed for unresolved evidence questions/i);
});
