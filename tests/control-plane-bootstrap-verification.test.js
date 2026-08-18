import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('assessment bootstrap routes declared concerns to Evidence before remediation', () => {
  const source = read('public/control-plane-bootstrap.js');
  assert.match(source, /assessment answers are concerns/i);
  assert.match(source, /actionableFindings\(assessment\)\.length > 0/);
  assert.match(source, /new URLSearchParams\(\{ assessment: assessmentId \}\)/);
  assert.match(source, /location\.replace\(`\/inspector\.html\?\$\{evidenceParams\.toString\(\)\}`\)/);
  assert.doesNotMatch(source, /Assign .*fix/i);
});
