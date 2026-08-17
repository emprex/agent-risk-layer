import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePricingMode } from '../public/pricing-mode.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('public pricing never presents a simulated purchase path', () => {
  const live = resolvePricingMode({ productStage: 'production', demoMode: false });
  assert.equal(live.allowCheckout, true);
  assert.equal(live.showDemoNotice, false);

  const demo = resolvePricingMode({ productStage: 'controlled-beta', demoMode: true });
  assert.equal(demo.allowCheckout, false);
  assert.equal(demo.showDemoNotice, true);
  assert.match(demo.message, /does not process live payments/i);
  assert.doesNotMatch(demo.message, /simulated checkout/i);

  const mismatch = resolvePricingMode({ productStage: 'production', demoMode: true });
  assert.equal(mismatch.allowCheckout, false);
  assert.equal(mismatch.showDemoNotice, false);
  assert.match(mismatch.message, /will not simulate/i);
});

test('paid assessment checkout returns to the same assessment context instead of a generic dashboard', () => {
  const success = read('public/success.js');
  assert.match(success, /purchase\?\.assessment_id/);
  assert.match(success, /dashboard\.html\?assessment=/);
  assert.match(success, /Continue this assessment/);
  assert.match(success, /assign the first fix/i);
  assert.match(success, /retest the exact risk/i);
  assert.match(success, /A finding is not closed until remediation evidence and a bounded retest support closure/i);
});

test('free result makes the paid outcome explicit and paid result leads into remediation', () => {
  const result = read('public/result.js');
  assert.match(result, /Get Security Assessment · £99/);
  assert.match(result, /The £99 assessment unlocks the full report, remediation and retest workflows/);
  assert.match(result, /paid \? assessmentRemediationHref/);
  assert.match(result, /Assign the fix, record implementation evidence and retest the same risk before closure/);
  assert.match(result, /What could happen/);
  assert.match(result, /Who should own it/);
  assert.match(result, /How to prove it is fixed/);
});

test('normal customer dashboard keeps one next action above specialist tools', () => {
  const dashboard = read('public/dashboard.js');
  assert.match(dashboard, /workspace-next-action/);
  assert.match(dashboard, /Next action/);
  assert.match(dashboard, /workspace-secondary/);
  assert.match(dashboard, /Specialist tools and supporting progress/);
  assert.match(dashboard, /Unknown information is not a vulnerability/);
  assert.doesNotMatch(dashboard, /108 controls to review/i);
});
