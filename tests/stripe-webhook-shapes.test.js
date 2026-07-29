import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = [
  fs.readFileSync(path.resolve(import.meta.dirname, '..', 'server.js'), 'utf8'),
  fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'stripe-webhook.js'), 'utf8'),
].join('\n');

test('supports Dahlia invoice parent subscription references', () => {
  assert.match(source, /invoice\.parent\?\.subscription_details\?\.subscription/);
});

test('supports subscription item-level billing periods', () => {
  assert.match(source, /subscription\.items\?\.data/);
  assert.match(source, /item\.current_period_end/);
});

test('every required billing event is mapped to an explicit handler', () => {
  for (const type of [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
  ]) {
    assert.match(source, new RegExp(`\\['${type.replaceAll('.', '\\.')}',\\s*[A-Za-z]+`));
  }
  assert.match(source, /ignored_unsupported/);
});
