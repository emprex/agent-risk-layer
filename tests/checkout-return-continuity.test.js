import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('cancelled or browser-back checkout return restores the assessment purchase state', () => {
  const shared = read('public/shared.js');
  const result = read('public/result.js');
  assert.match(shared, /restoreCheckoutReturnState/);
  assert.match(shared, /Checkout was not completed/i);
  assert.match(shared, /assessment has been preserved/i);
  assert.match(shared, /pageshow/);
  assert.match(shared, /params\.delete\('cancelled'\)/);
  assert.match(shared, /#buyPro/);
  assert.match(shared, /Get Security Assessment · £99/);
  assert.match(result, /Opening secure checkout…/);
});

test('checkout return handling does not claim that a payment definitely failed or succeeded', () => {
  const shared = read('public/shared.js');
  assert.doesNotMatch(shared, /Nothing was charged/i);
  assert.doesNotMatch(shared, /Payment completed/i);
});

test('one-off assessment checkout is account-bound with no privileged billing bypass', () => {
  const server = read('server.js');
  const start = server.indexOf('async function createCheckout');
  const end = server.indexOf('async function checkoutStatus', start);
  assert.ok(start >= 0 && end > start, 'createCheckout source must be available');
  const checkout = server.slice(start, end);
  assert.match(checkout, /SELECT \* FROM assessments WHERE id = \? AND user_id = \?/);
  assert.match(checkout, /\.get\(body\.assessmentId,\s*req\.user\.id\)/);
  assert.doesNotMatch(checkout, /req\.user\.role/);
  assert.doesNotMatch(checkout, /isPlatformSuperuser|superuser|admin.*bypass|bypass.*admin/i);
});
