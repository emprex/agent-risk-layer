import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/control-intelligence-control.html', import.meta.url), 'utf8');

test('focused Control Intelligence page does not load the looping customer-guidance observer', () => {
  assert.doesNotMatch(html, /control-intelligence-customer-guidance\.js/);
  assert.match(html, /control-intelligence-control\.js/);
  assert.match(html, /control-intelligence-ux\.js/);
});
