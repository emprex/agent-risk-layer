import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePricingMode } from '../public/pricing-mode.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('PAY fails closed unless production billing is explicitly live', () => {
  const live = resolvePricingMode({ productStage: 'production', demoMode: false });
  assert.equal(live.mode, 'live');
  assert.equal(live.allowCheckout, true);
  assert.equal(live.showDemoNotice, false);

  const productionMismatch = resolvePricingMode({ productStage: 'production', demoMode: true });
  assert.equal(productionMismatch.allowCheckout, false);
  assert.equal(productionMismatch.showDemoNotice, false);
  assert.match(productionMismatch.message, /will not simulate/i);

  const nonProduction = resolvePricingMode({ productStage: 'controlled-beta', demoMode: true });
  assert.equal(nonProduction.allowCheckout, false);
  assert.match(nonProduction.message, /does not process live payments/i);
});

test('PAY public trust copy cannot statically overclaim current billing state', () => {
  const trust = read('public/trust.html');
  assert.doesNotMatch(trust, />Live Stripe payments</i);
  assert.match(trust, /production-readiness requirement/i);
  assert.match(trust, /System status/i);
});

test('PAY -> FIX preserves the purchased assessment instead of dropping into a generic dashboard', () => {
  const success = read('public/success.js');
  assert.match(success, /purchase\?\.assessment_id/);
  assert.match(success, /control-plane\.html\?assessment=.*#remediation/);
  assert.match(success, /Continue to fixes/);
  assert.match(success, /assign the first fix/i);
  assert.match(success, /run the exact retest/i);
});

test('FIX keeps normal customers on findings, owners and exact proof instead of the full catalogue', () => {
  const result = read('public/result.js');
  const controlPlane = read('public/control-plane.js');

  assert.match(result, /What could happen/);
  assert.match(result, /Who should own it/);
  assert.match(result, /How to prove it is fixed/);
  assert.match(result, /assessmentRemediationHref/);
  assert.doesNotMatch(result, /108 controls to review/i);

  assert.match(controlPlane, /A clear plan, then one fix at a time\./);
  assert.match(controlPlane, /Assignment is not proof of implementation/i);
  assert.match(controlPlane, /retest/i);
  assert.doesNotMatch(controlPlane, /Northstar deployment/i);
});

test('PROVE -> DEPLOY remains evidence-first and human-accountable', () => {
  const trust = read('public/trust.html');
  const deployment = read('public/control-intelligence.html');
  const ux = read('public/control-intelligence-ux.js');

  for (const label of ['Declared controls', 'Observed controls', 'Findings', 'Attack evidence', 'Runtime evidence', 'Human approval', 'Remediation', 'Retest', 'Deployment decision']) {
    assert.match(trust, new RegExp(label, 'i'));
  }
  assert.match(deployment, /Can this agent deploy\?/i);
  assert.match(deployment, /server-recorded decision/i);
  assert.match(ux, /Controls requiring attention/);
  assert.match(ux, /exact retest/i);
});

test('RETURN restores the selected agent and keeps one next action ahead of specialist tools', () => {
  const dashboard = read('public/dashboard.js');
  assert.match(dashboard, /requestedAssessment = params\.get\('assessment'\)/);
  assert.match(dashboard, /sessionStorage\.setItem\('arl_selected_assessment'/);
  assert.match(dashboard, /workspace-next-action/);
  assert.match(dashboard, /Specialist tools and supporting progress/);
});
