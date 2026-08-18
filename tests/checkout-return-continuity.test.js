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
  assert.match(shared, /searchParams\.delete\('cancelled'\)/);
  assert.match(shared, /#buyPro/);
  assert.match(shared, /Get Security Assessment · £99/);
  assert.match(result, /Opening secure checkout…/);
});

test('checkout return handling does not claim that a payment definitely failed or succeeded', () => {
  const shared = read('public/shared.js');
  assert.doesNotMatch(shared, /Nothing was charged/i);
  assert.doesNotMatch(shared, /Payment completed/i);
});

test('one-off assessment checkout is account-bound with no email or admin bypass', () => {
  const server = read('server.js');
  const start = server.indexOf('async function createCheckout');
  const end = server.indexOf('async function checkoutStatus', start);
  assert.ok(start >= 0 && end > start, 'createCheckout source must be available');
  const checkout = server.slice(start, end);
  assert.match(checkout, /WHERE id = \? AND user_id = \?/);
  assert.match(checkout, /req\.user\.id/);
  assert.doesNotMatch(checkout, /req\.user\.(?:email|role)/);
  assert.doesNotMatch(checkout, /admin.*bypass|bypass.*admin|free.*owner/i);
});
