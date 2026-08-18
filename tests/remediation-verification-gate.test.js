import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { verificationGateCopy } from '../public/remediation-verification-gate.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('fresh assessment concerns are gated before remediation', () => {
  const copy = verificationGateCopy(3);
  assert.equal(copy.title, 'Verify these 3 assessment concerns first');
  assert.match(copy.body, /not confirmed findings/i);
  assert.match(copy.body, /observed or reproducible evidence/i);

  const layer = read('public/remediation-verification-gate.js');
  assert.match(layer, /0\\s\+of\\s\+\\d\+/);
  assert.match(layer, /will not create remediation fixes/i);
  assert.match(layer, /Go to Evidence and verify/);
  assert.match(layer, /observer\.disconnect\(\)/);
});

test('verification gate preserves assessment context in Evidence link', () => {
  const layer = read('public/remediation-verification-gate.js');
  assert.match(layer, /inspector\.html/);
  assert.match(layer, /query\.set\('assessment'/);
  assert.match(layer, /query\.set\('token'/);
});

test('control plane loads verification gate after the handoff clarification layer', () => {
  const html = read('public/control-plane.html');
  const clarity = html.indexOf('remediation-handoff-clarity.js');
  const gate = html.indexOf('remediation-verification-gate.js');
  assert.ok(clarity >= 0);
  assert.ok(gate > clarity);
  assert.match(html, /verify assessment concerns, fix confirmed weaknesses/i);
});
