import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/result.html', import.meta.url), 'utf8');
const guard = fs.readFileSync(new URL('../public/result-technical-evidence-integrity.js', import.meta.url), 'utf8');

test('result page loads the technical evidence integrity guard', () => {
  assert.match(html, /result-technical-evidence-integrity\.js/);
});

test('technical evidence never leaves blank structural headings', () => {
  assert.match(guard, /Source observations/);
  assert.match(guard, /Bounded test evidence/);
  assert.match(guard, /Source observation/);
  assert.match(guard, /Bounded test result/);
  assert.match(guard, /if \(!text\(heading\)\) heading\.remove\(\)/);
});

test('empty technical evidence uses explicit non-claiming copy', () => {
  assert.match(guard, /No detailed source observations are shown on this result surface/);
  assert.match(guard, /No detailed bounded-test result is shown on this result surface/);
});
