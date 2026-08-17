import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const controlHtml = read('public/control-intelligence-control.html');
const overviewHtml = read('public/control-intelligence.html');
const guidance = read('public/control-intelligence-customer-guidance.js');
const css = read('public/control-intelligence-customer-guidance.css');

test('Control Intelligence customer guidance stays dormant until browser regression verification', () => {
  for (const html of [controlHtml, overviewHtml]) {
    assert.doesNotMatch(html, /control-intelligence-customer-guidance\.js/);
  }
  assert.match(controlHtml, /control-intelligence-customer-guidance\.css/);
  assert.match(guidance, /function setText/);
  assert.match(guidance, /queueMicrotask/);
});

test('applicability guidance separates relevance from vulnerability', () => {
  assert.match(guidance, /Relevant to this system\. This is not a vulnerability, failed test or finding\./);
  assert.match(guidance, /Missing information remains unknown; it is not a finding\./);
  assert.match(guidance, /Applicability only defines review scope; it does not say the control has failed\./);
});

test('planned test wording cannot be mistaken for executed evidence', () => {
  assert.match(guidance, /Plan only — not executed/);
  assert.match(guidance, /Save test plan — no evidence yet/);
  assert.match(guidance, /No executed result means no test evidence/);
  assert.match(guidance, /planned, missing or inconclusive result must not be turned into a finding/);
});

test('test execution guidance states the real customer-operated trust boundary', () => {
  assert.match(guidance, /does not independently operate your agent or customer systems/);
  assert.match(guidance, /Run the exact planned scenario against the authorised version/);
  assert.match(guidance, /Controlled attack testing/);
  assert.match(guidance, /customer-operated non-production test commands/);
  assert.match(guidance, /does not automatically execute this Control Intelligence plan/);
});

test('controls guidance reduces 108-control burden without inferring applicability', () => {
  assert.match(guidance, /You do not need to open all 108 controls one by one/);
  assert.match(guidance, /review those suggestions in batches/i);
  assert.match(guidance, /Suggestions are not applicability decisions/);
  assert.match(guidance, /unmatched controls are not silently marked not applicable/);
});

test('customer guidance is presentation-only and does not write security evidence', () => {
  assert.doesNotMatch(guidance, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(guidance, /method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(guidance, /\/findings/);
  assert.doesNotMatch(guidance, /deployment-decision/);
});

test('guidance remains responsive for narrow customer screens', () => {
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /\.ci-test-flow/);
  assert.match(css, /\.ci-test-routes/);
});
