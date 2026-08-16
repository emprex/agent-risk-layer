import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('runtime inventory UI distinguishes confirmed values from unknown evidence', () => {
  const script = read('public/runtime-workspace.js');
  assert.match(script, /privilegeStatus/);
  assert.match(script, /internetExposureStatus/);
  assert.match(script, /evidence required/);
  assert.match(script, /Unknown is neither treated as safe nor turned into a finding/);
  assert.match(script, /No confirmed risky exposure drift/);
});

test('runtime page cache-busts the inventory evidence semantics script', () => {
  const html = read('public/control-plane.html');
  assert.match(html, /runtime-workspace\.js\?v=20260816\.2/);
});
