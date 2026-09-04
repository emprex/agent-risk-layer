import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('red-team token flow prepares before token creation and supports immediate reruns', () => {
  const html = read('public/redteam.html');
  const fix = read('public/redteam-busy-release.js');

  assert.match(html, /redteam-busy-release\.js/);
  assert.match(fix, /Prepare the target before issuing a one-time token/);
  assert.match(fix, /first upload attempt consumes this token/i);
  assert.match(fix, /Create new one-time token/);
  assert.match(fix, /id=\"adapterTimeout\"/);
  assert.match(fix, /id=\"targetPrepared\"/);
  assert.match(fix, /completed error or inconclusive result consumes it too/i);
  assert.match(fix, /sessionStorage\.setItem\(roeStorageKey/);
  assert.match(fix, /MutationObserver/);
  assert.doesNotMatch(fix, /observer\.disconnect\(\)/);

  const campaign = read('public/redteam.js');
  assert.doesNotMatch(campaign, /=YOUR_ADAPTER_TOKEN/);
  assert.match(campaign, /test -n/);
  assert.match(campaign, /--timeout \$\{timeout\}/);
  assert.match(campaign, /finally\{setBusy/);
});

test('evidence page shows one current bounded check and keeps evidence-gap disposition directly available', () => {
  const html = read('public/inspector.html');
  const fix = read('public/inspector-journey-fix.js');

  assert.match(html, /inspector-journey-fix\.js/);
  assert.match(fix, /Current step · Evidence/);
  assert.match(fix, /additional bounded runtime check/);
  assert.match(fix, /restorePrimaryActions/);
  assert.match(fix, /data-evidence-gap/);
  assert.match(fix, /evidence questions remain open for reviewer-specific evidence/i);
  assert.match(fix, /text !== '-'/);
  assert.match(read('public/inspector-evidence-plan.js'), /Evidence question details unavailable/);
});

test('result page separates declarations from confirmed findings and fixes post-review copy', () => {
  const html = read('public/result.html');
  const fix = read('public/result-journey-fix.js');

  assert.match(html, /result-journey-fix\.js/);
  assert.match(fix, /Current step · Evidence/);
  assert.match(fix, /Declared concerns/);
  assert.match(fix, /not confirmed findings/i);
  assert.match(fix, /Review declared concerns/);
  assert.match(fix, /nav\.textContent = 'Declarations'/);
  assert.match(fix, /additional concerns/);
  assert.match(fix, /Do not expand deployment while material evidence gaps remain unresolved/);
  assert.match(fix, /evidence limitation.*total/i);
  assert.match(fix, /Deployment decision recorded:/);
  assert.match(fix, /Close the remaining information and evidence gaps before reassessment/);
  assert.match(fix, /Review decision/);
});
