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

test('ARL17K attribution is allowlisted and follows the consent-gated funnel', () => {
  assert.match(source, /ALLOWED_JOURNEY_SOURCES = new Set\(\['arl17k'\]\)/);
  assert.match(source, /JOURNEY_SOURCE_KEY = 'arl_journey_source'/);
  assert.match(source, /params\.get\('from'\)/);
  assert.match(source, /referrerPath\(\) === '\/arl17k\.html'/);
  assert.match(source, /assessment_start', \{ entry_source: entrySource \}/);
  assert.match(source, /assessment_complete', \{ entry_source: entrySource \}/);
  assert.match(source, /begin_checkout', \{ plan: planFromElement\(target\), entry_source: entrySource \}/);
  assert.match(source, /purchase', \{ source: 'stripe_checkout', entry_source: captureJourneySource\(\) \}/);
  assert.doesNotMatch(source, /sessionStorage\.setItem\([^\n]*location\.search/);
});
