import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const helper = fs.readFileSync(new URL('../public/runtime-retest-gate.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');

test('premature Record retest is blocked before the application lifecycle handler', () => {
  assert.match(helper, /addEventListener\('change'/);
  assert.match(helper, /stopImmediatePropagation/);
  assert.match(helper, /select\.value !== 'retested'/);
  assert.match(helper, /retest result:\\s\*passed/);
});

test('operator gets the exact required order instead of the server exception', () => {
  assert.match(helper, /Run the bound retest first/);
  assert.match(helper, /retest\.result = passed/);
  assert.match(helper, /Copy bound retest command/);
  assert.match(helper, /Record retest/);
});

test('Runtime loads the retest gate helper', () => {
  assert.match(html, /runtime-retest-gate\.js\?v=20260816\.1/);
});
