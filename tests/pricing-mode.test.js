import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePricingMode } from '../public/pricing-mode.js';

test('production with live billing shows no demo notice and permits checkout', () => {
  assert.deepEqual(resolvePricingMode({ productStage: 'production', demoMode: false }), {
    mode: 'live',
    allowCheckout: true,
    showDemoNotice: false,
    message: '',
  });
});

test('non-production demo explicitly labels simulated checkout', () => {
  const result = resolvePricingMode({ productStage: 'controlled-beta', demoMode: true });
  assert.equal(result.mode, 'demo');
  assert.equal(result.allowCheckout, true);
  assert.equal(result.showDemoNotice, true);
  assert.match(result.message, /simulated/i);
});

test('production demo mismatch fails closed and never presents simulated checkout', () => {
  const result = resolvePricingMode({ productStage: 'production', demoMode: true });
  assert.equal(result.mode, 'production_billing_blocked');
  assert.equal(result.allowCheckout, false);
  assert.equal(result.showDemoNotice, false);
  assert.match(result.message, /will not simulate/i);
});
