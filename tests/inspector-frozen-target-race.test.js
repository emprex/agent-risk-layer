import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('frozen target panel is rendered even when target data loads before inspector shell markup', () => {
  const js = read('public/inspector-frozen-target.js');
  assert.match(js, /if \(!id\) return;/);
  assert.match(js, /if \(id === activeAssessmentId\) \{/);
  assert.match(js, /if \(!document\.querySelector\('\[data-inspector-target-panel\]'\)\) renderTargetPanel\(\);/);
  assert.match(js, /enhanceCommand\(\);/);
});
