import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('runtime guidance helper cannot self-trigger a MutationObserver loop', () => {
  const js = fs.readFileSync(new URL('../public/runtime-guidance-fix.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /new\s+MutationObserver/);
  assert.match(js, /setInterval/);
  assert.match(js, /clearInterval/);
  assert.match(js, /attempts\s*>?=\s*50/);
});

test('control plane loads the fixed guidance asset version', () => {
  const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');
  assert.match(html, /runtime-guidance-fix\.js\?v=20260816\.3/);
});
