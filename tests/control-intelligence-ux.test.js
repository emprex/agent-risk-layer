import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const overview = read('public/control-intelligence.html');
const control = read('public/control-intelligence-control.html');
const ux = read('public/control-intelligence-ux.js');
const css = read('public/control-intelligence-ux.css');
const controlPlane = read('src/control-plane.js');

test('Control Intelligence pages load the progressive workflow UX', () => {
  for (const html of [overview, control]) {
    assert.match(html, /control-intelligence-ux\.css/);
    assert.match(html, /control-intelligence-ux\.js/);
  }
});

test('control workflow uses progressive evidence wording and remediation substeps', () => {
  assert.match(ux, /3\. Evidence/);
  assert.match(ux, /Evidence trust remains explicit/);
  assert.match(ux, /Remediation & implementation/);
  assert.match(ux, /Implementation evidence/);
  assert.match(ux, /Do not record planned work as implemented/);
  assert.match(ux, /Create a new immutable snapshot only after confirming this exact system version contains the implemented remediation/);
});

test('guided remediation plan and implementation metadata survive the server verification allowlist', () => {
  for (const key of ['rootCause', 'correctiveAction', 'targetEnvironment', 'rollbackPlan', 'validationPlan', 'changeReference', 'limitations']) {
    assert.match(controlPlane, new RegExp(`['\"]${key}['\"]`));
  }
});

test('browser bulk review saves decisions independently instead of losing valid rows', () => {
  assert.match(ux, /document\.addEventListener\('submit', saveBulkIndependently, true\)/);
  assert.match(ux, /control-intelligence\/controls\/\$\{encodeURIComponent\(control\)\}\/applicability/);
  assert.doesNotMatch(ux, /applicability\/batch/);
  assert.match(ux, /successful rows were not rolled back/);
});

test('overview makes the first-eight preview explicit and routes to all controls', () => {
  assert.match(ux, /This overview shows the first controls requiring attention/);
  assert.match(ux, /View all controls/);
  assert.match(ux, /view=controls/);
});

test('responsive workflow navigation avoids a horizontal step rail', () => {
  assert.match(css, /\.ci-stage-nav ol\{display:grid/);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:430px\)\{\.ci-tabs,\.ci-metrics,\.ci-stage-nav ol\{grid-template-columns:1fr\}/);
  assert.match(css, /\.ci-bulk-row-error/);
});
