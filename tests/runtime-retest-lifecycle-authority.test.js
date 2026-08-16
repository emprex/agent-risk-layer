import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');
const backend = fs.readFileSync(new URL('../src/control-plane.js', import.meta.url), 'utf8');

test('Runtime does not client-block Record retest before server verification is written', () => {
  assert.doesNotMatch(html, /runtime-retest-gate\.js/);
});

test('server remains authoritative for passed retest transition', () => {
  assert.match(backend, /criteria\.status !== 'completed'/);
  assert.match(backend, /criteria\.result !== 'passed'/);
  assert.match(backend, /!criteria\.runtime_event_id/);
  assert.match(backend, /A server-derived passed retest is required\./);
});
