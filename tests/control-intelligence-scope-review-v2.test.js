import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('public/control-intelligence.html');
const script = read('public/control-intelligence-scope-review-v2.js');
const css = read('public/control-intelligence-scope-review.css');

test('Deployment Evidence loads one hardened compact scope-review layer', () => {
  assert.match(html, /control-intelligence-scope-review\.css/);
  assert.match(html, /control-intelligence-scope-review-v2\.js/);
  assert.doesNotMatch(html, /control-intelligence-customer-guidance\.js/);
});

test('scope preparation is conservative and never auto-submits', () => {
  assert.match(script, /facts\.length >= 2 && riskBearing/);
  assert.match(script, /One broad fact such as staging or tool:read is not enough/);
  assert.match(script, /decision\.value = 'applicable'/);
  assert.match(script, /Nothing is saved until you review and confirm the batch/);
  assert.doesNotMatch(script, /\.submit\s*\(/);
  assert.doesNotMatch(script, /requestSubmit\s*\(/);
  assert.doesNotMatch(script, /fetch\s*\(/);
  assert.doesNotMatch(script, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(script, /method:\s*['"]PATCH['"]/);
});

test('scope-review copy preserves evidence semantics', () => {
  assert.match(script, /match means relevant to review; it is not a vulnerability, failed control or confirmed applicability decision/);
  assert.match(script, /Matched ≠ applicable/);
  assert.match(script, /Applicable ≠ failed/);
  assert.match(script, /Unknown ≠ finding/);
  assert.match(script, /No automatic deployment decision/);
  assert.match(script, /does not create test results, findings, remediation records, approvals or a deployment decision/);
});

test('prepared rows use existing snapshot-bound applicability fields only', () => {
  assert.match(script, /\[name="decision-\$\{index\}"\]/);
  assert.match(script, /\[name="reason-\$\{index\}"\]/);
  assert.match(script, /\[name="fact-\$\{index\}"\]/);
  assert.match(script, /multiple confirmed architecture facts match this control/);
  assert.match(script, /individual applicability decisions for this exact snapshot/);
});

test('uncertain controls remain unselected and visible for customer confirmation', () => {
  assert.match(script, /const prepared = Boolean\(meta\?\.prepare\)/);
  assert.match(script, /ci-scope-row-exception/);
  assert.match(script, /Confirmation required/);
  assert.match(script, /need your confirmation because the snapshot match is too broad/);
  assert.match(css, /#bulkForm>\.ci-scope-row-prepared\{display:none\}/);
  assert.match(css, /#bulkForm\.ci-show-prepared>\.ci-scope-row-prepared\{display:block\}/);
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
  assert.match(css, /\.ci-scope-exception-note/);
  assert.match(css, /\.ci-scope-prepared-toggle/);
  assert.match(css, /@media\(max-width:860px\)/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /\.ci-scope-final-confirm/);
});
