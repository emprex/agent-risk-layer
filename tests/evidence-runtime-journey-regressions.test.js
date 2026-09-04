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
  assert.match(fix, /Prepare the runner before issuing a one-time token/);
  assert.match(fix, /first upload attempt consumes this token/i);
  assert.match(fix, /Create new one-time token/);
  assert.match(fix, /--timeout 30000/);
  assert.match(fix, /YOUR_ADAPTER_TOKEN/);
  assert.match(fix, /replace\(\/\^\(\[A-Z0-9_\]\+\)=YOUR_ADAPTER_TOKEN/);
  assert.match(fix, /sessionStorage\.setItem\(roeStorageKey/);
  assert.match(fix, /MutationObserver/);
  assert.doesNotMatch(fix, /observer\.disconnect\(\)/);
});

test('evidence page shows one current bounded check and does not render blank evidence questions', () => {
  const html = read('public/inspector.html');
  const fix = read('public/inspector-journey-fix.js');

  assert.match(html, /inspector-journey-fix\.js/);
  assert.match(fix, /Current step · Evidence/);
  assert.match(fix, /additional bounded runtime check/);
  assert.match(fix, /Other evidence dispositions/);
  assert.match(fix, /evidence questions remain open for reviewer-specific evidence/i);
  assert.match(fix, /text !== '-'/);
});

test('result page separates declarations from confirmed findings and uses Evidence language', () => {
  const html = read('public/result.html');
  const fix = read('public/result-journey-fix.js');

  assert.match(html, /result-journey-fix\.js/);
  assert.match(fix, /Current step · Evidence/);
  assert.match(fix, /Declared concerns/);
  assert.match(fix, /not confirmed findings/i);
  assert.match(fix, /Review declared concerns/);
  assert.match(fix, /nav\.textContent = 'Declarations'/);
});
