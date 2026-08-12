import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const overview = read('public/control-intelligence.html');
const control = read('public/control-intelligence-control.html');
const ux = read('public/control-intelligence-ux.js');
const css = read('public/control-intelligence-ux.css');
const controlPlane = read('src/control-plane.js');
const controlIntelligenceCore = read('src/control-intelligence-core.js');
const controlIntelligenceFacade = read('src/control-intelligence.js');
const focusedControl = read('public/control-intelligence-control.js');
const journey = read('public/control-intelligence-journey.js');

test('Control Intelligence pages load the progressive workflow UX', () => {
  for (const html of [overview, control]) {
    assert.match(html, /control-intelligence-ux\.css/);
    assert.match(html, /control-intelligence-ux\.js/);
  }
  assert.match(control, /control-intelligence-safe-defaults\.js/);
});

test('control workflow uses progressive evidence wording and remediation substeps', () => {
  assert.match(ux, /3\. Evidence/);
  assert.match(ux, /Evidence trust remains explicit/);
  assert.match(ux, /Remediation & implementation/);
  assert.match(ux, /Implementation evidence/);
  assert.match(ux, /Do not record planned work as implemented/);
  assert.match(ux, /Create a new immutable snapshot only after confirming this exact system version contains the implemented remediation/);
});

test('guided remediation plan and implementation metadata survive the server verification sanitizer', () => {
  for (const key of ['rootCause', 'correctiveAction', 'targetEnvironment', 'rollbackPlan', 'validationPlan', 'changeReference', 'limitations']) {
    assert.match(controlPlane, new RegExp(`\\b${key}: \\d+`));
  }
  assert.match(controlPlane, /correctiveAction: 4000/);
  assert.match(controlPlane, /validationPlan: 3000/);
  assert.match(controlPlane, /limitations: 3000/);
  assert.doesNotMatch(controlPlane, /const safe = privacySafeObject\(input, 30\);\s*const allowed = new Set\([^)]*rootCause/s);
});

test('core remediation gating remains unchanged behind the compatibility facade', () => {
  assert.match(controlIntelligenceCore, /const implementationRecorded =/);
  assert.match(controlIntelligenceCore, /const remediatedSnapshotReady =/);
  assert.match(controlIntelligenceCore, /const remediationReadyForRetest = implementationRecorded && remediatedSnapshotReady/);
  assert.match(controlIntelligenceCore, /open\.length && implementationRecorded/);
  assert.doesNotMatch(controlIntelligenceCore, /\bremediating\b/);
  assert.match(controlIntelligenceCore, /Create a remediated system snapshot before retesting\./);
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
  assert.match(css, /\.ci-focus-stepper ol\{display:grid/);
  assert.match(css, /\.ci-current-action/);
});

test('cross-snapshot failure lineage remains in the unchanged core implementation', () => {
  assert.match(controlIntelligenceCore, /const currentTests = data\.tests\.filter/);
  assert.match(controlIntelligenceCore, /const historicalTests = \(data\.testHistory \|\| data\.tests\)/);
  assert.match(controlIntelligenceCore, /const currentEvidence = data\.evidence\.filter/);
  assert.match(controlIntelligenceCore, /const historicalEvidence = \(data\.evidenceHistory \|\| data\.evidence\)/);
  assert.match(controlIntelligenceCore, /const tests = open\.length \? historicalTests : currentTests/);
  assert.match(controlIntelligenceCore, /row\.test_execution_id===initialFailure\?\.id/);
  assert.match(controlIntelligenceCore, /verifiedEvidence=currentEvidence\.some/);
});

test('focused control workflow never lets a later plan hide a reproduced failure', () => {
  assert.match(controlIntelligenceFacade, /A reproduced failure is already recorded for this control/);
  assert.match(controlIntelligenceFacade, /Attach observed evidence to the failed test/);
  assert.match(journey, /A reproduced failure is safety-significant and must never be hidden by a later plan/);
  assert.match(journey, /Create the finding from the reproduced failure/);
});

test('focused control workflow exposes one editable current action', () => {
  assert.match(focusedControl, /Only the current action is editable/);
  assert.match(focusedControl, /Saved evidence history/);
  assert.match(focusedControl, /Advanced evidence details/);
  assert.match(focusedControl, /filter\(\(item\) => item\.result !== 'planned'\)/);
  assert.doesNotMatch(focusedControl, /Test name/);
});
