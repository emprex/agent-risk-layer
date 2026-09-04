import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('assessment journey fixes are isolated to presentation and guidance', () => {
  const html = read('public/assessment.html');
  const js = read('public/assessment-journey-fix.js');
  const css = read('public/assessment-journey-fix.css');

  assert.match(html, /assessment-journey-fix\.css/);
  assert.match(html, /assessment-journey-fix\.js/);

  assert.match(js, /What are you using to answer this assessment\?/);
  assert.match(js, /Frozen source code \/ repository/);
  assert.match(js, /Test or staging deployment/);
  assert.match(js, /Production deployment/);
  assert.match(js, /This guides the questions only and never counts as proof/);
  assert.match(js, /For a source-code assessment, add the GitHub repository and the full 40-character commit SHA/);
  assert.match(js, /How do you know this\?/);
  assert.match(js, /I don't have proof yet/);
  assert.match(js, /My answer only — not verified/);
  assert.match(js, /I have supporting evidence to verify later/);
  assert.match(js, /source code alone cannot establish the business consequence/i);
  assert.match(js, /Dynamic delegation or discovery of agents that are not pre-approved/);
  assert.match(js, /Shell\/code execution, admin access or dynamic tool discovery/);

  assert.match(css, /:has\(#questionStage:not\(\[hidden\]\)\) \.assessment-intro/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.guided-option\.not-sure[\s\S]*grid-column:\s*1 \/ -1/);
});

test('assessment journey fix does not rewrite scoring or evidence verification semantics', () => {
  const js = read('public/assessment-journey-fix.js');
  assert.doesNotMatch(js, /evaluateAssessment|riskBand|points\s*:|verified\s*:/);
  assert.doesNotMatch(js, /fetch\s*\(|\/api\/assessments/);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
});
