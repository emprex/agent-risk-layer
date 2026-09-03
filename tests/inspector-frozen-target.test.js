import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Inspector loads selected assessment scope and fails closed on a different commit', () => {
  const html = read('public/inspector.html');
  const js = read('public/inspector-frozen-target.js');
  assert.match(html, /inspector-frozen-target\.js/);
  assert.match(js, /api\(`\/api\/assessments\/\$\{encodeURIComponent\(assessmentId\)\}`\)/);
  assert.match(js, /\[ARL_TARGET\]/);
  assert.match(js, /git rev-parse HEAD/);
  assert.match(js, /Frozen revision mismatch/);
  assert.match(js, /exit 1/);
  assert.match(js, /Run source evidence for this exact revision/);
  assert.match(js, /different commit fails closed/i);
});

test('Inspector makes missing revision identity an explicit limitation', () => {
  const js = read('public/inspector-frozen-target.js');
  assert.match(js, /No frozen repository revision is recorded for this assessment/);
  assert.match(js, /revision identity remains a limitation/);
  assert.doesNotMatch(js, /revision verified without target/i);
});
