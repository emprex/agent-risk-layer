import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const helper = fs.readFileSync(new URL('../public/runtime-retest-workflow.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');

test('bound remediation retest helper preserves server binding semantics', () => {
  assert.match(helper, /retestCriteriaId/);
  assert.match(helper, /Copy bound retest command/);
  assert.match(helper, /normal Guard request without it will remain runtime evidence but will not satisfy this remediation/);
  assert.doesNotMatch(helper, /MutationObserver/);
});

test('bound retest helper loads before the runtime application module', () => {
  const helperIndex = html.indexOf('/runtime-retest-workflow.js?v=20260816.1');
  const appIndex = html.indexOf('/control-plane.js?v=20260814.6');
  assert.ok(helperIndex >= 0, 'bound retest helper must be loaded');
  assert.ok(appIndex >= 0, 'runtime app must be loaded');
  assert.ok(helperIndex < appIndex, 'bound retest helper must intercept project responses before the runtime app starts');
});
