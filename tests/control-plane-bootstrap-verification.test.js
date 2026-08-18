import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('assessment bootstrap routes declared concerns to Evidence before remediation', () => {
  const source = read('public/control-plane-bootstrap.js');
  assert.match(source, /Assessment answers are concerns/i);
  assert.match(source, /actionableFindings\(assessment\)\.length > 0/);
  assert.match(source, /new URLSearchParams\(\{ assessment: assessmentId \}\)/);
  assert.match(source, /location\.replace\(`\/inspector\.html\?\$\{evidenceParams\.toString\(\)\}`\)/);
});

test('assessment bootstrap lifts Evidence redirect once active observed findings exist', () => {
  const source = read('public/control-plane-bootstrap.js');
  assert.match(source, /latestObservedFindings/);
  assert.match(source, /\/api\/assessments\/\$\{encodeURIComponent\(assessmentId\)\}\/inspections/);
  assert.match(source, /\/api\/inspections\/\$\{encodeURIComponent\(latest\.id\)\}/);
  assert.match(source, /if \(!observed\.length\)/);
  assert.match(source, /remediation workspace is allowed to render those evidence-backed items/i);
});
