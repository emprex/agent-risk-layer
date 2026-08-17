import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('public/control-intelligence.html');
const script = read('public/control-intelligence-scope-review-v2.js');
const css = read('public/control-intelligence-scope-review.css');

test('Deployment Evidence loads the hardened compact scope-review layer', () => {
  assert.match(html, /control-intelligence-scope-review\.css/);
  assert.match(html, /control-intelligence-scope-review-v2\.js/);
  assert.ok(html.indexOf('control-intelligence-customer-guidance.js') < html.indexOf('control-intelligence-scope-review-v2.js'));
});

test('strong architecture matches are prepared as suggestions, never auto-submitted', () => {
  assert.match(script, /strong architecture match/i);
  assert.match(script, /decision\.value = 'applicable'/);
  assert.match(script, /Nothing is saved until you review and confirm the batch/);
  assert.match(script, /applicability suggestions only/);
  assert.doesNotMatch(script, /\.submit\s*\(/);
  assert.doesNotMatch(script, /requestSubmit\s*\(/);
  assert.doesNotMatch(script, /fetch\s*\(/);
  assert.doesNotMatch(script, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(script, /method:\s*['"]PATCH['"]/);
});

test('scope-review copy preserves evidence semantics', () => {
  assert.match(script, /matched control is relevant to review, not a vulnerability or failed control/);
  assert.match(script, /Matched ≠ failed/);
  assert.match(script, /Unknown ≠ finding/);
  assert.match(script, /No automatic deployment decision/);
  assert.match(script, /does not create test results, findings, remediation records or a deployment decision/);
});

test('prepared rows use existing snapshot-bound applicability fields only', () => {
  assert.match(script, /\[name="decision-\$\{index\}"\]/);
  assert.match(script, /\[name="reason-\$\{index\}"\]/);
  assert.match(script, /\[name="fact-\$\{index\}"\]/);
  assert.match(script, /confirmed architecture matches this control/);
  assert.match(script, /individual applicability decisions for this exact snapshot/);
});

test('dynamic control copy is rendered with textContent rather than interpolated innerHTML', () => {
  assert.match(script, /const make = \(tag, className, value\)/);
  assert.match(script, /node\.textContent = value/);
  assert.doesNotMatch(script, /summaryCard\.innerHTML/);
  assert.doesNotMatch(script, /guide\.innerHTML/);
});

test('render observation is bounded and cannot self-loop on subtree edits', () => {
  assert.match(script, /observer\.observe\(root, \{ childList: true \}\)/);
  assert.doesNotMatch(script, /subtree:\s*true/);
  assert.match(script, /scopeReviewDecorated/);
  assert.match(script, /scopeReviewCompacted/);
});

test('scope review is compact and responsive', () => {
  assert.match(css, /\.ci-scope-review-summary/);
  assert.match(css, /\.ci-scope-row-details/);
  assert.match(css, /@media\(max-width:860px\)/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /\.ci-scope-final-confirm/);
});
