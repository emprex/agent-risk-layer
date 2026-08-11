import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'public', 'analytics.js'), 'utf8');

test('GA4 uses the production stream and remains consent-gated', () => {
  assert.match(source, /G-T1V035EGTB/);
  assert.match(source, /consentState\(\) !== 'granted'/);
  assert.match(source, /googletagmanager\.com\/gtag\/js\?id=/);
  assert.match(source, /send_page_view:\s*true/);
});

test('commercial funnel events are instrumented without reading form contents', () => {
  for (const eventName of ['assessment_start', 'assessment_complete', 'sign_up', 'login', 'begin_checkout', 'purchase']) {
    assert.match(source, new RegExp(`['\"]${eventName}['\"]`), eventName);
  }
  assert.match(source, /#buyPro/);
  assert.match(source, /Payment and fulfilment completed/);
  assert.doesNotMatch(source, /#(?:registerEmail|loginEmail|registerPassword|loginPassword|mfaCode)/);
});

test('analytics parameters are bounded to primitive non-sensitive metadata', () => {
  assert.match(source, /safeParameters/);
  assert.match(source, /slice\(0, 100\)/);
  assert.match(source, /\['string', 'number', 'boolean'\]/);
});

test('analytics page metadata strips query strings and fragments before GA4 sees capability URLs', () => {
  assert.match(source, /function analyticsPageLocation\(\)/);
  assert.match(source, /return `\$\{url\.origin\}\$\{url\.pathname\}`/);
  assert.match(source, /function analyticsPageReferrer\(\)/);
  assert.match(source, /page_location:\s*analyticsPageLocation\(\)/);
  assert.match(source, /page_referrer:\s*analyticsPageReferrer\(\)/);
  assert.doesNotMatch(source, /page_location:\s*location\.href/);
  assert.doesNotMatch(source, /page_location:\s*document\.location/);
});
