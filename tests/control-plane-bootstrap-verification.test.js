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

test('assessment bootstrap keeps Findings available for active or resolved observed evidence', () => {
  const source = read('public/control-plane-bootstrap.js');
  assert.match(source, /latestObservedState/);
  assert.match(source, /\/api\/assessments\/\$\{encodeURIComponent\(assessmentId\)\}\/inspections/);
  assert.match(source, /\/api\/inspections\/\$\{encodeURIComponent\(latest\.id\)\}/);
  assert.match(source, /hasResolvedRetest/);
  assert.match(source, /if \(!observed\.activeFindings\.length && !observed\.hasResolvedRetest\)/);
  assert.match(source, /review and record closure instead of being bounced back/i);
});

test('assessment bootstrap rejects stale runtime selection and prefers the exact assessment case', () => {
  const source = read('public/control-plane-bootstrap.js');
  assert.match(source, /validateAssessmentScopeSelection/);
  assert.match(source, /item\?\.projectKind === 'assessment_case'/);
  assert.match(source, /item\?\.assessmentId === assessmentId/);
  assert.match(source, /sessionStorage\.setItem\('arl_selected_project', exactCase\.id\)/);
  assert.match(source, /sessionStorage\.removeItem\('arl_selected_project'\)/);
  assert.match(source, /fetch\('\/assessment-remediation\.js', \{ cache: 'reload'/);
});
