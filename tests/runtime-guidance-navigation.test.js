import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/runtime-guidance-fix.js', import.meta.url), 'utf8');

test('stage-three guidance targets Developer integration instead of generic runtime evidence', () => {
  assert.match(source, /Developer integration/);
  assert.match(source, /developerIntegration/);
  assert.match(source, /scrollIntoView/);
});

test('stage-three navigation retry is bounded and does not use MutationObserver', () => {
  assert.doesNotMatch(source, /MutationObserver/);
  assert.match(source, /attempts >= 30/);
  assert.match(source, /setTimeout/);
});
