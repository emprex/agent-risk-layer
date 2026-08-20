import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const helper = fs.readFileSync(new URL('../public/runtime-retest-workflow.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/control-plane-bootstrap.js', import.meta.url), 'utf8');

test('bound remediation retest helper preserves server binding semantics', () => {
  assert.match(helper, /retestCriteriaId/);
  assert.match(helper, /Copy bound retest command/);
  assert.match(helper, /normal Guard request without it will remain runtime evidence but will not satisfy this remediation/);
  assert.doesNotMatch(helper, /MutationObserver/);
});

test('retest command is generated only from exact criteria captured from the form', () => {
  assert.match(helper, /exactCriteriaCaptured:\s*true/);
  assert.match(helper, /record\.exactCriteriaCaptured === true/);
  assert.doesNotMatch(helper, /fallbackDetails/);
  assert.doesNotMatch(helper, /title\.includes\(['"]shell['"]\)/);
});

test('missing historical criteria are reset instead of guessed', () => {
  assert.match(helper, /Reset retest criteria/);
  assert.match(helper, /status:\s*'evidence_attached'/);
  assert.match(helper, /AgentRiskLayer will not guess those security criteria/);
});

test('reset uses the shared CSRF-aware API helper', () => {
  assert.match(helper, /await import\(['"]\.\/shared\.js['"]\)/);
  assert.match(helper, /const \{ api \}/);
  assert.doesNotMatch(helper, /window\.alert/);
});

test('guidance rendering is idempotent so action buttons do not wobble', () => {
  assert.match(helper, /guidanceSignature/);
  assert.match(helper, /panel\.dataset\.renderSignature === signature/);
  assert.match(helper, /panel\.dataset\.busy === 'true'/);
  assert.match(helper, /retest-action-busy/);
  assert.doesNotMatch(helper, /\.style\./);
});

test('existing ready-for-retest state is recovered after deploy or refresh', () => {
  assert.match(helper, /recoverExistingRetest/);
  assert.match(helper, /arl_selected_project/);
  assert.match(helper, /originalFetch\(`\/api\/projects\//);
  assert.match(helper, /rememberProject\(payload\.project\)/);
});

test('bound retest helper loads before the runtime application bootstrap', () => {
  const helperIndex = html.indexOf('/runtime-retest-workflow.js?v=20260816.4');
  const bootstrapIndex = html.indexOf('/control-plane-bootstrap.js');
  assert.ok(helperIndex >= 0, 'bound retest helper must be loaded');
  assert.ok(bootstrapIndex >= 0, 'runtime bootstrap must be loaded');
  assert.ok(helperIndex < bootstrapIndex, 'bound retest helper must recover or intercept project state before the runtime bootstrap starts');
  assert.match(bootstrap, /import\(['"]\.\/control-plane\.js\?v=20260820\.1['"]\)/, 'runtime bootstrap must load the current cache-busted runtime application');
});
