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
  assert.match(html, /Full commit SHA/);
  assert.match(html, /40-character commit SHA/);
  assert.match(html, /A later commit must be assessed as a new revision/i);

  assert.match(js, /normaliseRepository/);
  assert.match(js, /\[ARL_TARGET\]/);
  assert.match(js, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(js, /Evidence and retests should use this exact revision/);
  assert.match(js, /Leave both blank if you are only running the questionnaire/);
  assert.match(js, /payloadAnswers\.__system_description/);
});

test('frozen target stays scoped while live evidence journey owns the next action', () => {
  const html = read('public/result.html');
  const target = read('public/result-target.js');
  const journey = read('public/result-evidence-journey.js');

  assert.match(html, /result-target\.js/);
  assert.match(html, /result-evidence-journey\.js/);
  assert.match(target, /Frozen assessment target/);
  assert.match(target, /Review evidence/);
  assert.match(target, /inspector\.html\?assessment=/);
  assert.match(target, /Evidence from a later revision must not silently replace it/);
  assert.match(target, /source evidence, bounded checks and recorded limitations/i);
  assert.match(target, /declared concern/);
  assert.match(target, /Concerns to verify/);
  assert.match(target, /Possible actions if confirmed/);
  assert.match(target, /Verify with evidence first/);
  assert.match(target, /questionnaire-only band/);
  assert.match(target, /\/100 provisional/);
  assert.doesNotMatch(target, /Inspect the frozen revision/);
  assert.doesNotMatch(target, /Run source evidence/);
  assert.match(journey, /title: 'Run source evidence'/);
  assert.match(journey, /No confirmed findings; evidence gaps remain/);
});

test('light result theme keeps conditional action cards readable', () => {
  const css = read('public/result-light-fix.css');
  assert.match(css, /\.simple-remediation-list article[\s\S]*?background:\s*#f8fafc\s*!important/);
  assert.match(css, /\.simple-remediation-list article strong[\s\S]*?color:\s*#0f172a\s*!important/);
  assert.match(css, /\.simple-remediation-list article p[\s\S]*?color:\s*#475569\s*!important/);
});
