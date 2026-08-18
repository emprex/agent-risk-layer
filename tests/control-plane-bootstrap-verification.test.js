import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('assessment bootstrap does not silently turn assessment concerns into remediation fixes', () => {
  const source = read('public/control-plane-bootstrap.js');
  assert.match(source, /assessment concerns/i);
  assert.match(source, /inspector\.html/);
  assert.match(source, /arl_assessment_verification_ready/);
});
