import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', 'server.js'),
  'utf8'
);

test('supports Dahlia invoice parent subscription references', () => {
  assert.match(source, /invoice\.parent\?\.subscription_details\?\.subscription/);
});

test('supports subscription item-level billing periods', () => {
  assert.match(source, /subscription\.items\?\.data/);
  assert.match(source, /item\.current_period_end/);
});
