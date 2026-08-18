import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('cancelled or browser-back checkout return restores the assessment purchase state', () => {
  const result = read('public/result.js');
  assert.match(result, /arl_checkout_pending_assessment/);
  assert.match(result, /Payment was not completed/i);
  assert.match(result, /Nothing was charged/i);
  assert.match(result, /pageshow/);
  assert.match(result, /searchParams\.delete\('cancelled'\)/);
  assert.match(result, /Get Security Assessment · £99/);
});

test('successful checkout clears the pending-return marker', () => {
  const success = read('public/success.js');
  assert.match(success, /arl_checkout_pending_assessment/);
  assert.match(success, /removeItem/);
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
